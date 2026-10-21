// Captures screenshots of Ditto in action for the README, landing page and write-up.
//   node eval/screens.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from '../scripts/serve.mjs';
import { ROOT, launchWithExtension, loadProfile, tabIdFor } from './harness.mjs';

const out = path.resolve(process.argv[2] || path.join(ROOT, 'site', 'assets', 'screens'));
fs.mkdirSync(out, { recursive: true });
const persona = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'demo', 'meera.json'), 'utf8'));

const { server, url } = await startServer(0);
const { context, sw, extensionId } = await launchWithExtension({ viewport: { width: 1280, height: 800 } });
try {
  await loadProfile(sw, persona);
  await sw.evaluate(async () => self.__ditto.warmup());

  for (const name of ['bank', 'job']) {
    const page = await context.newPage();
    const pageUrl = `${url}/forms/${name}.html`;
    await page.goto(pageUrl);
    await page.waitForLoadState('networkidle');
    const tabId = await tabIdFor(sw, pageUrl);
    await sw.evaluate(async (id) => self.__ditto.runOnTab(id, 'fill'), tabId);
    await page.waitForFunction(() => document.querySelectorAll('[data-ditto-status]').length >= 9, null, { timeout: 600000, polling: 100 });
    await page.screenshot({ path: path.join(out, `${name}-filling.png`) });
    await page.waitForFunction(() => document.documentElement.dataset.dittoState === 'done', null, { timeout: 600000, polling: 250 });
    await page.screenshot({ path: path.join(out, `${name}-done.png`) });
    await page.screenshot({ path: path.join(out, `${name}-done-full.png`), fullPage: true });
    await page.close();
  }

  const options = await context.newPage();
  await options.setViewportSize({ width: 1100, height: 900 });
  await options.goto(`chrome-extension://${extensionId}/options/options.html`);
  await options.waitForTimeout(1500);
  await options.screenshot({ path: path.join(out, 'options.png') });
  await options.close();

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 300, height: 330 });
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popup.waitForFunction(() => !document.getElementById('ollama-text').textContent.includes('Checking'), null, { timeout: 30000 });
  await popup.waitForTimeout(300);
  await popup.screenshot({ path: path.join(out, 'popup.png') });
  await popup.close();
  console.log('Screenshots in', out);
} finally {
  await context.close();
  server.close();
}
