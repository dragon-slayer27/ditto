// End-to-end eval: loads the real Ditto extension in Chromium, fills every demo form with the
// fictional persona, and scores each field against eval/expected.json.
//
//   node eval/run-eval.mjs [--forms job,bank] [--model gemma4:e4b-it-qat] [--no-memory] [--headed] [--tag name]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../scripts/serve.mjs';
import { ROOT, launchWithExtension, loadProfile, tabIdFor } from './harness.mjs';
import { scoreField, summarize } from './score.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const flag = (name) => args.includes(`--${name}`);

const expected = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval', 'expected.json'), 'utf8')).forms;
const forms = (opt('forms', '') || Object.keys(expected).join(',')).split(',').filter(Boolean);
const model = opt('model', '');
const tag = opt('tag', model ? model.replace(/[^a-z0-9.]+/gi, '-') : 'default');
const withMemory = !flag('no-memory');
const persona = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'demo', 'meera.json'), 'utf8'));

function collectInPage(specs) {
  const labelText = (i) => ((i.closest('label') && i.closest('label').textContent) || i.value || '').replace(/\s+/g, ' ').trim();
  return specs.map((s) => {
    const els = [...document.querySelectorAll(s.sel)];
    if (!els.length) return { sel: s.sel, missing: true };
    const el = els[0];
    let actual;
    if (el.type === 'radio') {
      const c = els.find((e) => e.checked);
      actual = c ? labelText(c) : '';
    } else if (el.type === 'checkbox' && els.length > 1) actual = els.filter((e) => e.checked).map(labelText);
    else if (el.type === 'checkbox') actual = el.checked;
    else if (el.tagName === 'SELECT') {
      const o = el.options[el.selectedIndex];
      actual = o && o.value !== '' ? o.text.trim() : '';
    } else actual = el.value;
    return { sel: s.sel, id: el.dataset.dittoId || '', actual, status: el.dataset.dittoStatus || '' };
  });
}

async function fillAndWait(page, sw, url) {
  const tabId = await tabIdFor(sw, url);
  await page.evaluate(() => delete document.documentElement.dataset.dittoState);
  const t0 = Date.now();
  await sw.evaluate(async (id) => self.__ditto.runOnTab(id, 'fill'), tabId);
  await page.waitForFunction(() => ['done', 'error'].includes(document.documentElement.dataset.dittoState), null, { timeout: 20 * 60 * 1000, polling: 250 });
  const wall = Date.now() - t0;
  const state = await page.evaluate(() => document.documentElement.dataset.dittoState);
  const log = await page.evaluate(() => {
    const n = document.getElementById('ditto-log');
    return n ? JSON.parse(n.textContent) : null;
  });
  return { wall, state, log };
}

function scoreRun(name, values, log) {
  const items = new Map(((log && log.items) || []).map((i) => [i.id, i]));
  return expected[name].map((spec, k) => {
    const v = values[k];
    const s = scoreField(spec, v.actual, v.status);
    const it = items.get(v.id) || {};
    return { form: name, sel: spec.sel, label: it.label || spec.sel, expect: spec.expect, actual: v.actual, status: v.status, note: it.note || '', modelValue: it.value, from: it.from, ...s };
  });
}

const fmtMs = (ms) => (ms >= 10000 ? `${Math.round(ms / 1000)} s` : `${(ms / 1000).toFixed(1)} s`);
const show = (v) => (v === null ? '(empty)' : v === false ? '(unticked)' : v === true ? '(ticked)' : Array.isArray(v) ? v.join('; ') || '(none)' : String(v) === '' ? '(empty)' : String(v));

const { server, url } = await startServer(0);
const { context, sw } = await launchWithExtension({ headless: !flag('headed') });
const results = { when: new Date().toISOString(), machine: `${os.cpus()[0].model.trim()}, ${Math.round(os.totalmem() / 2 ** 30)} GB RAM`, forms: {}, rows: [] };
try {
  await loadProfile(sw, persona);
  if (model) await sw.evaluate(async (m) => chrome.storage.local.set({ settings: { model: m } }), model);
  const st = await sw.evaluate(async () => self.__ditto.status());
  if (!st.ollama || !st.model) throw new Error(`Ollama/model not available: ${JSON.stringify(st)}`);
  results.model = st.model;
  results.modelName = st.modelName;
  console.log(`Model: ${st.model} (${st.loaded ? 'already loaded' : 'cold'})`);
  const tw = Date.now();
  await sw.evaluate(async () => self.__ditto.warmup());
  results.warmupMs = Date.now() - tw;
  console.log(`Warm-up: ${fmtMs(results.warmupMs)}`);

  for (const name of forms) {
    const page = await context.newPage();
    const pageUrl = `${url}/forms/${name}.html`;
    await page.goto(pageUrl);
    await page.waitForLoadState('networkidle');
    const first = await fillAndWait(page, sw, pageUrl);
    const values = await page.evaluate(collectInPage, expected[name]);
    const rows = scoreRun(name, values, first.log);
    const sum = summarize(rows);
    const entry = { ...sum, state: first.state, ms: first.log ? first.log.ms : first.wall, stats: first.log ? first.log.stats : null };

    if (name === 'job') {
      await page.$eval('#review', (b) => b.click());
      await page.waitForSelector('#react-state');
      const reactState = JSON.parse(await page.textContent('#react-state'));
      const domFilled = values.filter((v) => typeof v.actual === 'string' && v.actual && !v.sel.includes('authorized') && !v.sel.includes('sponsorship'));
      const inState = domFilled.filter((v) => {
        const key = v.sel.replace(/^\[name=|\]$/g, '');
        return reactState[key] != null && reactState[key] !== '';
      });
      entry.reactSync = `${inState.length}/${domFilled.length}`;
    }

    if (withMemory) {
      // Fresh tab + navigation (not reload) so the browser can't restore typed values.
      const again = await context.newPage();
      await again.goto(pageUrl);
      await again.waitForLoadState('networkidle');
      await page.close();
      const second = await fillAndWait(again, sw, pageUrl);
      const values2 = await again.evaluate(collectInPage, expected[name]);
      const sum2 = summarize(scoreRun(name, values2, second.log));
      entry.memoryMs = second.log ? second.log.ms : second.wall;
      entry.memoryRight = sum2.right;
      entry.memoryFromMemory = second.log && second.log.stats ? second.log.stats.remembered : null;
      await again.close();
    } else {
      await page.close();
    }
    results.forms[name] = entry;
    results.rows.push(...rows);
    console.log(
      `${name.padEnd(10)} ${sum.right}/${sum.fields} right (${sum.correct} filled correctly, ${sum.blankOk} correctly left empty), ` +
        `${sum.miss} missed, ${sum.wrong + sum.overreach} wrong (${sum.silentWrong} silent), ${fmtMs(entry.ms)}` +
        (entry.memoryMs != null ? ` | again from memory: ${fmtMs(entry.memoryMs)}, ${entry.memoryRight}/${sum.fields} right` : '') +
        (entry.reactSync ? ` | React state ${entry.reactSync}` : ''),
    );
    for (const r of rows.filter((x) => x.outcome !== 'correct' && x.outcome !== 'blank-ok')) {
      console.log(`    ${r.outcome.toUpperCase().padEnd(9)} ${r.label}: expected ${show(r.expect)}, got ${show(r.actual)} [${r.status || 'untouched'}${r.note ? `: ${r.note}` : ''}]`);
    }
  }

  const all = summarize(results.rows);
  results.total = all;
  const totalMs = Object.values(results.forms).reduce((a, f) => a + f.ms, 0);
  const memMs = Object.values(results.forms).reduce((a, f) => a + (f.memoryMs || 0), 0);
  console.log(`\nTOTAL ${all.right}/${all.fields} right (${(100 * all.accuracy).toFixed(1)}%), ${all.miss} missed, ${all.wrong + all.overreach} wrong, ${all.silentWrong} silent, fill time ${fmtMs(totalMs)}${withMemory ? `, from memory ${fmtMs(memMs)}` : ''}`);

  // ---------- report ----------
  const outDir = path.join(ROOT, 'eval', 'results');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${tag}.json`), JSON.stringify(results, null, 2));
  const lines = [
    `# Ditto eval: ${results.modelName} (${results.model})`,
    '',
    `Run on ${results.when.slice(0, 16).replace('T', ' ')} UTC, ${results.machine}, CPU only. Model warm-up (loading into memory): ${fmtMs(results.warmupMs)}.`,
    '',
    '"Right" = filled correctly + correctly left empty. "Silent" = wrong but shown green (the dangerous kind).',
    '',
    '| Form | Fields | Right | Filled correctly | Correctly left empty | Missed | Wrong (flagged amber) | Wrong (silent) | First fill | Same form again |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const [name, f] of Object.entries(results.forms)) {
    lines.push(`| ${name} | ${f.fields} | ${f.right} | ${f.correct} | ${f.blankOk} | ${f.miss} | ${f.flaggedWrong} | ${f.silentWrong} | ${fmtMs(f.ms)} | ${f.memoryMs != null ? fmtMs(f.memoryMs) : '-'} |`);
  }
  lines.push(`| **total** | ${all.fields} | **${all.right} (${(100 * all.accuracy).toFixed(1)}%)** | ${all.correct} | ${all.blankOk} | ${all.miss} | ${all.flaggedWrong} | ${all.silentWrong} | ${fmtMs(totalMs)} | ${withMemory ? fmtMs(memMs) : '-'} |`);
  if (results.forms.job && results.forms.job.reactSync) lines.push('', `React check: the job form's React state received ${results.forms.job.reactSync} of the text values Ditto typed.`);
  lines.push('', '## Every field that was not right', '', '| Form | Field | Expected | Got | Ditto showed |', '|---|---|---|---|---|');
  for (const r of results.rows.filter((x) => x.outcome !== 'correct' && x.outcome !== 'blank-ok')) {
    lines.push(`| ${r.form} | ${r.label} | ${show(r.expect)} | ${show(r.actual)} | ${r.status || 'untouched'}${r.note ? `: ${r.note}` : ''} |`);
  }
  fs.writeFileSync(path.join(outDir, `${tag}.md`), lines.join('\n') + '\n');
  console.log(`Report: eval/results/${tag}.md`);
} finally {
  await context.close();
  server.close();
}
