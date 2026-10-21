// Shared Playwright helpers: launch Chromium with the real Ditto extension loaded.
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EXT = path.join(ROOT, 'extension');
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(ROOT, '.cache', 'ms-playwright');

export async function launchWithExtension({ headless = true, video = null, viewport = { width: 1280, height: 860 } } = {}) {
  const { chromium } = await import('playwright');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ditto-eval-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless,
    viewport,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    ...(video ? { recordVideo: { dir: video, size: viewport } } : {}),
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extensionId = sw.url().split('/')[2];
  // Close the welcome/options tab the extension opens on first install.
  await new Promise((r) => setTimeout(r, 500));
  for (const p of context.pages()) if (p.url().startsWith('chrome-extension://')) await p.close();
  return { context, sw, extensionId, userDataDir };
}

export async function loadProfile(sw, profile) {
  await sw.evaluate(async (p) => {
    await chrome.storage.local.set({ profile: p, memory: {} });
  }, profile);
}

export async function tabIdFor(sw, url) {
  return sw.evaluate(async (u) => {
    const tabs = await chrome.tabs.query({});
    const t = tabs.find((x) => x.url === u);
    return t ? t.id : null;
  }, url);
}
