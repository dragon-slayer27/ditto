// Creates (or updates) the DEV post as an unpublished draft from submission/devto-post.md.
//   PowerShell:  $env:DEV_API_KEY = "<key from https://dev.to/settings/extensions>"; node scripts/devto-draft.mjs
// The front matter keeps published: false, so nothing goes live until you press Publish on DEV.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POST = path.join(ROOT, 'submission', 'devto-post.md');
const ID_FILE = path.join(ROOT, 'submission', '.devto-id');
const key = process.env.DEV_API_KEY;
if (!key) {
  console.error('Set DEV_API_KEY first (create one at https://dev.to/settings/extensions).');
  process.exit(1);
}

const body_markdown = fs.readFileSync(POST, 'utf8');
if (!/^published:\s*false\s*$/m.test(body_markdown)) {
  console.error('Refusing to send: the front matter must say "published: false" so this stays a draft.');
  process.exit(1);
}

const existing = fs.existsSync(ID_FILE) ? fs.readFileSync(ID_FILE, 'utf8').trim() : '';
const res = await fetch(`https://dev.to/api/articles${existing ? `/${existing}` : ''}`, {
  method: existing ? 'PUT' : 'POST',
  headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/vnd.forem.api-v1+json' },
  body: JSON.stringify({ article: { body_markdown } }),
});
const data = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`DEV API error ${res.status}:`, data);
  process.exit(1);
}
fs.writeFileSync(ID_FILE, String(data.id));
console.log(`${existing ? 'Updated' : 'Created'} draft #${data.id}: "${data.title}"`);
console.log('Review and publish it from https://dev.to/dashboard');
