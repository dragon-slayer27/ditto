/* global Ditto */
const T = Ditto.text;
const L = Ditto.llm;
const $ = (id) => document.getElementById(id);

let profile = L.emptyProfile();
let pending = [];
let saveTimer = null;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function load() {
  const { profile: p, settings, memory } = await chrome.storage.local.get(['profile', 'settings', 'memory']);
  profile = p && Array.isArray(p.facts) ? p : L.emptyProfile();
  $('ollama-url').value = (settings && settings.ollamaUrl) || 'http://127.0.0.1:11434';
  $('model').dataset.wanted = (settings && settings.model) || '';
  $('memory-count').textContent = `It currently remembers ${Object.keys(memory || {}).length} page(s).`;
  renderFacts();
  checkConnection();
}

function scheduleSave() {
  $('save-status').textContent = 'Saving...';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    profile.rev = (profile.rev || 0) + 1;
    profile.vrev = (profile.vrev || 0) + 1;
    await chrome.storage.local.set({ profile });
    $('save-status').textContent = 'Saved on this computer.';
  }, 400);
}

function renderFacts() {
  const q = T.normalize($('search').value || '');
  const box = $('facts');
  $('fact-count').textContent = `${profile.facts.length}`;
  const groups = new Map();
  profile.facts.forEach((f, i) => {
    if (q && !T.normalize(`${f.key} ${f.value}`).includes(q)) return;
    const g = L.GROUPS.includes(f.group) ? f.group : 'Other';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(i);
  });
  let html = '';
  for (const g of L.GROUPS) {
    const idx = groups.get(g);
    if (!idx) continue;
    html += `<div class="group-title">${esc(g)}</div>`;
    for (const i of idx) {
      const f = profile.facts[i];
      html += `<div class="fact" data-i="${i}">
        <input type="text" data-k="key" value="${esc(f.key)}" aria-label="Label">
        <input type="text" data-k="value" value="${esc(f.value)}" aria-label="Value">
        <select data-k="group" aria-label="Group">${L.GROUPS.map((x) => `<option ${x === g ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
        <button class="del" title="Delete this fact" data-del="${i}">&times;</button></div>`;
    }
  }
  box.innerHTML = html || '<p class="muted">No facts yet. Paste something above, add one by hand, or load the demo person.</p>';
}

$('facts').addEventListener('input', (e) => {
  const row = e.target.closest('.fact');
  if (!row || !e.target.dataset.k) return;
  profile.facts[+row.dataset.i][e.target.dataset.k] = e.target.value;
  scheduleSave();
});
$('facts').addEventListener('change', (e) => {
  if (e.target.dataset.k === 'group') renderFacts();
});
$('facts').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (!del) return;
  profile.facts.splice(+del.dataset.del, 1);
  renderFacts();
  scheduleSave();
});
$('search').addEventListener('input', renderFacts);
$('add-fact').addEventListener('click', () => {
  profile.facts.push({ key: '', value: '', group: 'Other' });
  $('search').value = '';
  renderFacts();
  const rows = document.querySelectorAll('.fact');
  const last = [...rows].find((r) => +r.dataset.i === profile.facts.length - 1);
  if (last) last.querySelector('input').focus();
});

// ---------- import with Gemma ----------
function renderPending() {
  $('import-list').innerHTML = pending
    .map(
      (c, i) => `<li><label><input type="checkbox" data-p="${i}" checked><span><b>${esc(c.key)}</b><span class="tag ${c.op}">${c.op === 'add' ? 'NEW' : 'UPDATE'}</span><br>
      ${c.op === 'update' ? `<span class="old">${esc(c.old)}</span> &rarr; ` : ''}${esc(c.value)}</span></label></li>`,
    )
    .join('');
  $('import-results').hidden = !pending.length;
}

$('import-btn').addEventListener('click', async () => {
  const text = $('import-text').value.trim();
  if (!text) {
    $('import-status').textContent = 'Paste something first.';
    return;
  }
  $('import-btn').disabled = true;
  const started = Date.now();
  const tick = setInterval(() => ($('import-status').textContent = `Gemma is reading slowly but surely... ${Math.round((Date.now() - started) / 1000)}s`), 500);
  try {
    const res = await chrome.runtime.sendMessage({ cmd: 'import', text });
    if (!res || !res.ok) throw new Error(res ? res.error : 'No answer');
    pending = res.changes || [];
    $('import-status').textContent = pending.length ? `Found ${pending.length} fact(s). Untick anything you don't want.` : 'Nothing new found in that text.';
    renderPending();
  } catch (e) {
    $('import-status').textContent = `Could not extract: ${e.message}`;
  } finally {
    clearInterval(tick);
    $('import-btn').disabled = false;
  }
});

$('import-apply').addEventListener('click', async () => {
  const picked = [...document.querySelectorAll('[data-p]')].filter((i) => i.checked).map((i) => pending[+i.dataset.p]);
  const res = await chrome.runtime.sendMessage({ cmd: 'apply-changes', changes: picked });
  if (res && res.ok) {
    const { profile: p } = await chrome.storage.local.get('profile');
    profile = p;
    pending = [];
    renderPending();
    renderFacts();
    $('import-text').value = '';
    $('import-status').textContent = `Added. Ditto now knows ${res.total} facts.`;
  }
});
$('import-cancel').addEventListener('click', () => {
  pending = [];
  renderPending();
  $('import-status').textContent = '';
});

// ---------- demo ----------
$('load-demo').addEventListener('click', async () => {
  if (profile.facts.length && !confirm('Replace your current facts with the fictional demo person?')) return;
  const demo = await (await fetch(chrome.runtime.getURL('demo/meera.json'))).json();
  profile = { version: 1, rev: (profile.rev || 0) + 1, vrev: (profile.vrev || 0) + 1, facts: demo.facts };
  await chrome.storage.local.set({ profile });
  renderFacts();
  $('save-status').textContent = 'Loaded Meera. Now open a demo form and press Alt+Shift+D.';
});

// ---------- settings ----------
async function saveSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...(settings || {}), ollamaUrl: $('ollama-url').value.trim() || 'http://127.0.0.1:11434', model: $('model').value } });
}

async function checkConnection() {
  $('conn-status').textContent = 'Checking...';
  const s = await chrome.runtime.sendMessage({ cmd: 'status' });
  const sel = $('model');
  const wanted = sel.dataset.wanted || sel.value;
  sel.innerHTML = '<option value="">Pick automatically (prefers Gemma 4 E4B)</option>' + (s.models || []).map((m) => `<option ${m === wanted ? 'selected' : ''}>${esc(m)}</option>`).join('');
  if (!s.ollama) $('conn-status').textContent = `Can't reach Ollama at ${s.url}. Is it running?`;
  else if (!s.model) $('conn-status').textContent = 'Connected, but no model is installed. Run: ollama pull gemma4:e4b';
  else $('conn-status').textContent = `Connected. Using ${s.model} (${s.loaded ? 'awake' : 'asleep until the first fill'}).`;
}

$('ollama-url').addEventListener('change', async () => {
  await saveSettings();
  checkConnection();
});
$('model').addEventListener('change', async () => {
  $('model').dataset.wanted = $('model').value;
  await saveSettings();
  checkConnection();
});
$('test').addEventListener('click', checkConnection);

// ---------- memory & data ----------
$('forget').addEventListener('click', async () => {
  await chrome.storage.local.remove('memory');
  $('memory-count').textContent = 'It currently remembers 0 page(s).';
});

$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ditto-profile.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.facts)) throw new Error('No "facts" list in that file');
    profile = {
      version: 1,
      rev: (profile.rev || 0) + 1,
      vrev: (profile.vrev || 0) + 1,
      facts: data.facts.map((f) => ({ key: String(f.key || ''), value: String(f.value || ''), group: f.group || 'Other' })),
    };
    await chrome.storage.local.set({ profile });
    renderFacts();
    $('save-status').textContent = `Imported ${profile.facts.length} facts.`;
  } catch (err) {
    $('save-status').textContent = `Import failed: ${err.message}`;
  }
});

$('wipe').addEventListener('click', async () => {
  if (!confirm('Delete your whole profile and page memory from this computer?')) return;
  await chrome.storage.local.remove(['profile', 'memory']);
  profile = L.emptyProfile();
  renderFacts();
  $('memory-count').textContent = 'It currently remembers 0 page(s).';
  $('save-status').textContent = 'Everything deleted.';
});

load();
