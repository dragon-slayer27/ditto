// Debug helper: prints the raw model output for one demo form (same prompt and schema the extension uses).
//   node eval/debug-raw.mjs clinic
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startServer } from '../scripts/serve.mjs';
import { ROOT, launchWithExtension, tabIdFor } from './harness.mjs';

const require = createRequire(import.meta.url);
globalThis.Ditto = { text: require('../extension/lib/text.js') };
const L = require('../extension/lib/llm.js');

const name = process.argv[2] || 'clinic';
const persona = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'demo', 'meera.json'), 'utf8'));
const { server, url } = await startServer(0);
const { context, sw } = await launchWithExtension();
try {
  const page = await context.newPage();
  const pageUrl = `${url}/forms/${name}.html`;
  await page.goto(pageUrl);
  await page.waitForLoadState('networkidle');
  const tabId = await tabIdFor(sw, pageUrl);
  await sw.evaluate(async (id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ['lib/text.js', 'content/extract.js'] }), tabId);
  const [{ result }] = await sw.evaluate(
    async (id) =>
      chrome.scripting.executeScript({
        target: { tabId: id },
        func: () => {
          const { page, fields } = globalThis.Ditto.extract.extractFields();
          return { page, fields };
        },
      }),
    tabId,
  );
  const fields = result.fields.filter((f) => !f.skip);
  const messages = L.buildFillMessages(persona, result.page, fields);
  if (process.argv.includes('--prompt')) console.log(messages[1].content, '\n-----');
  const res = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST',
    body: JSON.stringify({ model: 'gemma4:e4b-it-qat', messages, format: L.buildFillSchema(fields), stream: false, think: false, keep_alive: '30m', options: { temperature: 0, num_ctx: 8192 } }),
  });
  const json = await res.json();
  console.log(json.message.content);
  const got = [];
  const feed = L.createPairStream((k, v) => got.push([k, v]));
  feed(json.message.content);
  console.log('\nstream parser saw:', JSON.stringify(got));
} finally {
  await context.close();
  server.close();
}
