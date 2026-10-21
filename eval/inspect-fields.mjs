// Prints what Ditto extracts from each demo form (labels, sections, options) without calling the model.
import { startServer } from '../scripts/serve.mjs';
import { launchWithExtension, tabIdFor } from './harness.mjs';

const forms = process.argv.slice(2).length ? process.argv.slice(2) : ['job', 'bank', 'clinic', 'rental', 'hackathon'];
const { server, url } = await startServer(0);
const { context, sw } = await launchWithExtension();
try {
  // Check the Origin-rewrite rule lets the extension reach Ollama.
  const status = await sw.evaluate(async () => {
    const settings = { ollamaUrl: 'http://127.0.0.1:11434' };
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [1],
      addRules: [{ id: 1, priority: 1, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'origin', operation: 'remove' }] }, condition: { urlFilter: '|http://127.0.0.1:11434/', tabIds: [chrome.tabs.TAB_ID_NONE], resourceTypes: ['xmlhttprequest', 'other'] } }],
    });
    try {
      const r = await fetch(settings.ollamaUrl + '/api/tags');
      return `${r.status} ${(await r.text()).slice(0, 80)}`;
    } catch (e) {
      return `ERR ${e.message}`;
    }
  });
  console.log('Ollama from extension:', status);

  for (const name of forms) {
    const page = await context.newPage();
    const pageUrl = `${url}/forms/${name}.html`;
    await page.goto(pageUrl);
    await page.waitForLoadState('networkidle');
    const tabId = await tabIdFor(sw, pageUrl);
    await sw.evaluate(async (id) => {
      await chrome.scripting.executeScript({ target: { tabId: id }, files: ['lib/text.js', 'content/extract.js'] });
    }, tabId);
    const [{ result }] = await sw.evaluate(async (id) =>
      chrome.scripting.executeScript({
        target: { tabId: id },
        func: () => {
          const { page, fields } = globalThis.Ditto.extract.extractFields();
          return { page, fields: fields.map((f) => ({ id: f.id, kind: f.kind, type: f.type, label: f.label, section: f.section, skip: f.skip, hints: f.hints, options: (f.options || []).map((o) => o.text) })) };
        },
      }),
    tabId);
    console.log(`\n=== ${name}: ${result.fields.length} fields | title="${result.page.title}" | notes="${result.page.notes}"`);
    for (const f of result.fields) {
      const opts = f.options.length ? ` [${f.options.join(' / ')}]` : '';
      console.log(`${f.id.padEnd(4)} ${f.kind.padEnd(14)} ${JSON.stringify(f.label)}${opts}  §${f.section || '-'}${f.skip ? `  SKIP:${f.skip}` : ''}${f.hints.length ? `  {${f.hints.join('; ')}}` : ''}`);
    }
    await page.close();
  }
} finally {
  await context.close();
  server.close();
}
