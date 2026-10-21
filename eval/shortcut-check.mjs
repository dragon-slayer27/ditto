// Model-free check of Ditto's keyboard shortcut handling in a real Chromium (runs in CI):
// 1. Clean profile: Chrome assigns the suggested shortcut, so it isn't a key Chrome reserves.
// 2. Another extension already owns that key (like Dark Reader owning Alt+Shift+D): Chrome silently
//    skips Ditto's shortcut, and Ditto must say so in the popup and on the profile page, with a
//    working link to chrome://extensions/shortcuts.
//   node eval/shortcut-check.mjs [screenshotDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EXT, launchWithExtension, loadProfile, removeDir } from './harness.mjs';

const shotDir = process.argv[2] || '';
const suggested = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')).commands['fill-form'].suggested_key.default;
const persona = JSON.parse(fs.readFileSync(path.join(EXT, 'demo', 'meera.json'), 'utf8'));
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) failures++;
};
const title = (sw) => sw.evaluate(() => chrome.action.getTitle({}));

// ---------- 1. clean profile ----------
{
  const { context, sw, extensionId } = await launchWithExtension();
  await loadProfile(sw, persona);
  const info = await sw.evaluate(() => self.__ditto.shortcutInfo());
  check(info.shortcut === suggested, `clean profile: Chrome gave Ditto ${suggested} (got "${info.shortcut}")`);
  check((await title(sw)).includes('Alt+Shift+.'), `clean profile: toolbar tooltip shows the shortcut ("${await title(sw)}")`);
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 300, height: 360 });
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popup.waitForFunction(() => !document.getElementById('key-text').textContent.includes('Checking'));
  const text = await popup.textContent('#key-text');
  check(/Press Alt\+Shift\+\. on any form/.test(text), `clean profile: popup says "${text.trim()}"`);
  if (shotDir) await popup.screenshot({ path: path.join(shotDir, 'popup-shortcut-ok.png') });
  await context.close();
}

// ---------- 2. another extension got there first ----------
{
  const { chromium } = await import('playwright');
  const hog = fs.mkdtempSync(path.join(os.tmpdir(), 'ditto-hog-'));
  fs.writeFileSync(
    path.join(hog, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Shortcut Hog',
      version: '1.0',
      background: { service_worker: 'hog.js' },
      commands: { toggle: { suggested_key: { default: suggested }, description: 'Toggle something' } },
    }),
  );
  fs.writeFileSync(path.join(hog, 'hog.js'), '// claims the shortcut, does nothing\n');

  // Install the hog alone first so it owns the key, then add Ditto to the same profile.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ditto-conflict-'));
  const first = await chromium.launchPersistentContext(dir, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${hog}`, `--load-extension=${hog}`] });
  if (!first.serviceWorkers().length) await first.waitForEvent('serviceworker');
  const hogKey = await first.serviceWorkers()[0].evaluate(async () => (await chrome.commands.getAll()).find((c) => c.name === 'toggle').shortcut);
  check(hogKey === suggested, `conflict setup: the other extension owns ${suggested} (got "${hogKey}")`);
  await first.close();

  const { context, sw, extensionId } = await launchWithExtension({ userDataDir: dir, extraExtensions: [hog] });
  await loadProfile(sw, persona);
  const info = await sw.evaluate(() => self.__ditto.shortcutInfo());
  check(info.shortcut === '', `conflict: Chrome skipped Ditto's shortcut, reproducing the bug (got "${info.shortcut}")`);
  check((await title(sw)).includes('no keyboard shortcut'), `conflict: toolbar tooltip says so ("${await title(sw)}")`);

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 300, height: 400 });
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popup.waitForFunction(() => !document.getElementById('key-text').textContent.includes('Checking'));
  const text = (await popup.textContent('#key-text')).replace(/\s+/g, ' ').trim();
  check(text.includes('No keyboard shortcut yet') && text.includes('Alt+Shift+.') && text.includes('Choose one'), `conflict: popup explains it: "${text}"`);
  check(await popup.isHidden('#key-kbd'), 'conflict: popup footer hides the shortcut badge');
  if (shotDir) await popup.screenshot({ path: path.join(shotDir, 'popup-shortcut-missing.png') });
  const [settings] = await Promise.all([context.waitForEvent('page'), popup.click('#set-key')]);
  await settings.waitForLoadState().catch(() => {});
  check(settings.url().startsWith('chrome://extensions/shortcuts'), `conflict: "Choose one" opens Chrome's shortcut settings (${settings.url()})`);

  const options = await context.newPage();
  await options.setViewportSize({ width: 1000, height: 700 });
  await options.goto(`chrome-extension://${extensionId}/options/options.html`);
  await options.waitForFunction(() => !document.getElementById('key-status').textContent.includes('Checking'));
  check(await options.isVisible('#key-banner'), 'conflict: profile page shows the "pick a keyboard shortcut" banner');
  check((await options.textContent('.how-to-fill')).includes('toolbar button'), 'conflict: demo instructions point to the toolbar button instead');
  if (shotDir) await options.screenshot({ path: path.join(shotDir, 'options-shortcut-missing.png') });
  await options.click('#key-dismiss');
  await options.reload();
  await options.waitForFunction(() => !document.getElementById('key-status').textContent.includes('Checking'));
  check(await options.isHidden('#key-banner'), 'conflict: "I\'ll use the toolbar button" hides the banner for good');
  check((await options.textContent('#key-status')).includes('Not set yet'), 'conflict: the Keyboard shortcut card still explains how to set one');
  await context.close();
  removeDir(dir);
  removeDir(hog);
}

console.log(failures ? `${failures} problem(s)` : 'Shortcut handling works in both cases.');
process.exit(failures ? 1 : 0);
