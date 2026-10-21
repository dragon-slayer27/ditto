// Installs Playwright's Chromium into ./.cache/ms-playwright (keeps big downloads inside the repo folder).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(root, '.cache', 'ms-playwright');

const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['playwright', 'install', 'chromium'], {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
