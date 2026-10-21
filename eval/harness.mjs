// Shared Playwright helpers: launch Chromium with the real Ditto extension loaded.
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EXT = path.join(ROOT, 'extension');
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(ROOT, '.cache', 'ms-playwright');

// Best effort: Chromium can hold files for a moment after closing on Windows.
export function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (_) {
    /* leave it for the OS temp cleaner */
  }
}

export async function launchWithExtension({ headless = true, video = null, viewport = { width: 1280, height: 860 }, extraExtensions = [], userDataDir = null } = {}) {
  const { chromium } = await import('playwright');
  const dir = userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'ditto-eval-'));
  const exts = [...extraExtensions, EXT].join(',');
  const context = await chromium.launchPersistentContext(dir, {
    channel: 'chromium',
    headless,
    viewport,
    args: [`--disable-extensions-except=${exts}`, `--load-extension=${exts}`],
    ...(video ? { recordVideo: { dir: video, size: viewport } } : {}),
  });
  if (!userDataDir) context.on('close', () => removeDir(dir));
  const isDitto = (w) => w.url().endsWith('/background.js');
  let sw = context.serviceWorkers().find(isDitto);
  while (!sw) {
    const w = await context.waitForEvent('serviceworker');
    if (isDitto(w)) sw = w;
  }
  const extensionId = sw.url().split('/')[2];
  // Close the welcome/options tab the extension opens on first install.
  await new Promise((r) => setTimeout(r, 500));
  for (const p of context.pages()) if (p.url().startsWith('chrome-extension://')) await p.close();
  return { context, sw, extensionId, userDataDir: dir };
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
