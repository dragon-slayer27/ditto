// Copies the latest eval numbers into the landing page and README, between RESULTS:START/END markers.
//   node scripts/update-results.mjs [eval/results/gemma4-e4b.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.resolve(process.argv[2] || path.join(ROOT, 'eval', 'results', 'gemma4-e4b.json'));
const r = JSON.parse(fs.readFileSync(file, 'utf8'));

const NAMES = { job: 'Job application (React)', bank: 'Bank KYC (table layout)', clinic: 'Clinic intake', rental: 'Rental application', hackathon: 'Hackathon sign-up' };
const sec = (ms) => (ms >= 10000 ? `${Math.round(ms / 1000)} s` : `${(ms / 1000).toFixed(1)} s`);
const forms = Object.entries(r.forms);
const totalMs = forms.reduce((a, [, f]) => a + f.ms, 0);
const memMs = forms.reduce((a, [, f]) => a + (f.memoryMs || 0), 0);
const t = r.total;
const pct = (100 * t.accuracy).toFixed(1);

const html = [
  '<table>',
  '            <thead><tr><th>Form</th><th>Fields</th><th>Right</th><th>Wrong (shown green)</th><th>First fill</th><th>Same form again</th></tr></thead>',
  '            <tbody>',
  ...forms.map(([k, f]) => `              <tr><td>${NAMES[k] || k}</td><td>${f.fields}</td><td>${f.right}</td><td>${f.silentWrong}</td><td>${sec(f.ms)}</td><td>${f.memoryMs != null ? sec(f.memoryMs) : '-'}</td></tr>`),
  `              <tr class="total"><td>Total</td><td>${t.fields}</td><td>${t.right} (${pct}%)</td><td>${t.silentWrong}</td><td>${sec(totalMs)}</td><td>${sec(memMs)}</td></tr>`,
  '            </tbody>',
  '          </table>',
].join('\n');

const md = [
  '| Form | Fields | Right | Wrong but flagged amber | Wrong and shown green | First fill | Same form again |',
  '|---|---|---|---|---|---|---|',
  ...forms.map(([k, f]) => `| ${NAMES[k] || k} | ${f.fields} | ${f.right} | ${f.flaggedWrong} | ${f.silentWrong} | ${sec(f.ms)} | ${f.memoryMs != null ? sec(f.memoryMs) : '-'} |`),
  `| **Total** | **${t.fields}** | **${t.right} (${pct}%)** | ${t.flaggedWrong} | ${t.silentWrong} | ${sec(totalMs)} | ${sec(memMs)} |`,
].join('\n');

function replace(target, block) {
  const p = path.join(ROOT, target);
  if (!fs.existsSync(p)) return;
  const src = fs.readFileSync(p, 'utf8');
  const out = src.replace(/(<!-- RESULTS:START -->)[\s\S]*?(<!-- RESULTS:END -->)/, `$1\n${block}\n$2`);
  fs.writeFileSync(p, out);
  console.log(`updated ${target}`);
}

replace('site/index.html', `          ${html}\n          `);
replace('README.md', md);
console.log(`${t.right}/${t.fields} right (${pct}%), ${t.silentWrong} silent, first fill ${sec(totalMs)}, again ${sec(memMs)}`);
