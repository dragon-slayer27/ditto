/*
 * Ditto background service worker.
 * - Injects the content scripts only when you ask (toolbar button, Alt+Shift+D, or right-click menu).
 * - Talks to Ollama on this computer. Nothing else on the network is ever contacted.
 */
/* global importScripts */
importScripts('lib/text.js', 'lib/llm.js');

const T = self.Ditto.text;
const L = self.Ditto.llm;

const DEFAULT_SETTINGS = { ollamaUrl: 'http://127.0.0.1:11434', model: '', numCtx: 8192 };
const CONTENT_FILES = ['lib/text.js', 'content/extract.js', 'content/fill.js', 'content/panel.js', 'content/main.js'];
const KEEP_ALIVE = '30m';
const ORIGIN_RULE_ID = 1;

// ---------- storage ----------
async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function getProfile() {
  const { profile } = await chrome.storage.local.get('profile');
  return profile && Array.isArray(profile.facts) ? profile : L.emptyProfile();
}

async function saveProfile(profile) {
  await chrome.storage.local.set({ profile });
}

async function getMemory() {
  const { memory } = await chrome.storage.local.get('memory');
  return memory || {};
}

function pageKey(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/+$/, '') || '/'}`;
  } catch (_) {
    return String(url || '');
  }
}

// A remembered answer is reused if you typed it yourself, or if the profile hasn't changed in a way that
// affects it: empty answers are re-asked after any change (a new fact may answer them), filled answers
// only after an existing fact was edited or removed.
function memoryUsable(m, profile) {
  if (!m) return false;
  if (m.source === 'user') return true;
  if (m.value == null) return m.pv === (profile.rev || 0);
  return m.pvv === (profile.vrev || 0);
}

// ---------- Ollama ----------
// Ollama rejects browser-extension origins by default. This session rule removes the Origin header,
// but only for requests the extension itself makes (tabId -1), so web pages still can't reach Ollama.
async function ensureOriginRule(ollamaUrl) {
  const origin = new URL(ollamaUrl).origin;
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [ORIGIN_RULE_ID],
    addRules: [
      {
        id: ORIGIN_RULE_ID,
        priority: 1,
        action: { type: 'modifyHeaders', requestHeaders: [{ header: 'origin', operation: 'remove' }] },
        condition: { urlFilter: `|${origin}/`, tabIds: [chrome.tabs.TAB_ID_NONE], resourceTypes: ['xmlhttprequest', 'other'] },
      },
    ],
  });
}

async function ollamaJson(settings, path, body, timeoutMs) {
  await ensureOriginRule(settings.ollamaUrl);
  const ctrl = new AbortController();
  const timer = timeoutMs ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(settings.ollamaUrl.replace(/\/+$/, '') + path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Ollama answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function* chatStream(settings, body, signal) {
  await ensureOriginRule(settings.ollamaUrl);
  const res = await fetch(settings.ollamaUrl.replace(/\/+$/, '') + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });
  if (!res.ok) throw new Error(`Ollama answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const obj = JSON.parse(line);
      if (obj.error) throw new Error(obj.error);
      yield obj;
    }
  }
}

const capabilityCache = new Map();
async function modelThinks(settings, model) {
  if (!capabilityCache.has(model)) {
    try {
      const info = await ollamaJson(settings, '/api/show', { model }, 8000);
      capabilityCache.set(model, Array.isArray(info.capabilities) && info.capabilities.includes('thinking'));
    } catch (_) {
      capabilityCache.set(model, false);
    }
  }
  return capabilityCache.get(model);
}

function pickModel(models, preferred) {
  if (preferred && models.includes(preferred)) return preferred;
  const order = [/^gemma4:e4b/, /^gemma4/, /^gemma3n/, /^gemma3/, /gemma/i];
  for (const re of order) {
    const hit = models.find((m) => re.test(m));
    if (hit) return hit;
  }
  return models[0] || '';
}

function prettyModel(name) {
  const m = /^gemma(\d+)(n)?(?::([a-z0-9.]+))?/i.exec(name || '');
  if (!m) return name || 'your local model';
  const size = (m[3] || '').split('-')[0].toUpperCase();
  return `Gemma ${m[1]}${m[2] ? 'n' : ''}${size && size !== 'LATEST' ? ` ${size}` : ''}`;
}

class DittoError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function resolveModel(settings) {
  let tags;
  try {
    tags = await ollamaJson(settings, '/api/tags', null, 5000);
  } catch (e) {
    throw new DittoError('no-ollama', `I can't reach Ollama at ${settings.ollamaUrl}.`);
  }
  const models = (tags.models || []).map((m) => m.name);
  const model = pickModel(models, settings.model);
  if (!model) throw new DittoError('no-model', 'Ollama is running, but no model is installed yet.');
  return model;
}

async function isLoaded(settings, model) {
  try {
    const ps = await ollamaJson(settings, '/api/ps', null, 4000);
    return (ps.models || []).some((m) => m.name === model || m.model === model);
  } catch (_) {
    return false;
  }
}

async function baseRequest(settings, model) {
  const body = { model, keep_alive: KEEP_ALIVE, options: { temperature: 0, num_ctx: settings.numCtx } };
  if (await modelThinks(settings, model)) body.think = false;
  return body;
}

function keepAwake() {
  const timer = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  return () => clearInterval(timer);
}

// ---------- fill ----------
function postProcess(id, rawValue, field, evidence) {
  let value = rawValue;
  if (typeof value === 'string') {
    value = value.trim();
    if (!value || /^(null|n\/?a|unknown|not provided|not available|not specified|-)$/i.test(value)) value = null;
  } else if (value != null) {
    value = String(value);
  }
  const choice = field.kind === 'select' || field.kind === 'radio' || field.kind === 'checkbox' || field.kind === 'checkbox-group';
  const check = value == null || choice ? { ok: true, unsupported: [] } : T.isSupported(value, evidence);
  return { id, value, sure: true, supported: check.ok, unsupported: check.unsupported };
}

async function handleFill(port, msg, signal) {
  const t0 = Date.now();
  const send = (m) => {
    try {
      port.postMessage(m);
    } catch (_) {
      /* tab closed */
    }
  };
  const [settings, profile, memoryAll] = await Promise.all([getSettings(), getProfile(), getMemory()]);
  if (!profile.facts.length) throw new DittoError('no-profile', 'Your Ditto profile is empty, so there is nothing to fill with yet.');

  const key = pageKey(msg.page.url);
  const mem = memoryAll[key] || {};
  const pending = [];
  let remembered = 0;
  for (const f of msg.fields) {
    const m = mem[f.sig];
    if (memoryUsable(m, profile)) {
      remembered++;
      send({ type: 'item', item: { id: f.id, value: m.value, sure: m.sure !== false, supported: true, remembered: true } });
    } else {
      pending.push(f);
    }
  }

  const stats = { model: '', remembered, asked: pending.length, ms: 0, promptTokens: 0, outputTokens: 0, genMs: 0, unsure: 0 };
  if (pending.length) {
    const model = await resolveModel(settings);
    stats.model = prettyModel(model);
    const loaded = await isLoaded(settings, model);
    send({
      type: 'status',
      model: stats.model,
      text: loaded ? `Asking ${stats.model}...` : `Waking up ${stats.model}. The first fill loads it into memory, which takes about a minute.`,
    });
    const evidence = L.profileEvidence(profile);
    const base = await baseRequest(settings, model);
    for (const chunk of L.chunkFields(pending)) {
      const byId = new Map(chunk.map((f) => [f.id, f]));
      const items = new Map();
      const onPair = (id, value) => {
        if (!byId.has(id) || items.has(id)) return;
        const item = postProcess(id, value, byId.get(id), evidence);
        items.set(id, item);
        send({ type: 'item', item });
      };
      const feed = L.createPairStream(onPair);
      let full = '';
      const body = { ...base, messages: L.buildFillMessages(profile, msg.page, chunk), format: L.buildFillSchema(chunk) };
      for await (const part of chatStream(settings, body, signal)) {
        const text = (part.message && part.message.content) || '';
        if (text) {
          full += text;
          feed(text);
        }
        if (part.done) {
          stats.promptTokens += part.prompt_eval_count || 0;
          stats.outputTokens += part.eval_count || 0;
          stats.genMs += Math.round((part.eval_duration || 0) / 1e6);
        }
      }
      let unsure = [];
      try {
        const obj = JSON.parse(full);
        for (const [id, value] of Object.entries(obj.values || {})) onPair(id, value);
        unsure = (obj.unsure || []).filter((id) => items.has(id) && items.get(id).value != null);
      } catch (_) {
        /* the streamed values are all we have */
      }
      for (const f of chunk) if (!items.has(f.id)) onPair(f.id, null);
      if (unsure.length) {
        stats.unsure += unsure.length;
        unsure.forEach((id) => (items.get(id).sure = false));
        send({ type: 'unsure', ids: unsure });
      }
      for (const [id, item] of items) {
        mem[byId.get(id).sig] = { value: item.value, sure: item.sure && item.supported, source: 'ditto', pv: profile.rev || 0, pvv: profile.vrev || 0, at: Date.now() };
      }
    }
  }
  memoryAll[key] = mem;
  await chrome.storage.local.set({ memory: memoryAll });
  stats.ms = Date.now() - t0;
  send({ type: 'done', stats });
}

// ---------- learn ----------
async function proposeFacts(settings, profile, messages) {
  const model = await resolveModel(settings);
  const base = await baseRequest(settings, model);
  const res = await ollamaJson(settings, '/api/chat', { ...base, stream: false, messages, format: L.FACTS_SCHEMA });
  let facts = [];
  try {
    facts = JSON.parse(res.message.content).facts || [];
  } catch (_) {
    facts = [];
  }
  return { changes: L.diffFacts(profile, facts), model: prettyModel(model) };
}

async function handleLearn(port, msg) {
  const [settings, profile, memoryAll] = await Promise.all([getSettings(), getProfile(), getMemory()]);
  const key = pageKey(msg.page.url);
  const mem = memoryAll[key] || {};
  for (const a of msg.answers) {
    const fromDitto = a.dittoValue != null && a.dittoValue === a.value;
    // Free text you typed into a big box is usually about this one occasion, so it isn't replayed.
    if (!fromDitto && a.kind === 'textarea') continue;
    mem[a.sig] = { value: a.value, sure: true, source: fromDitto ? 'ditto' : 'user', pv: profile.rev || 0, pvv: profile.vrev || 0, at: Date.now() };
  }
  memoryAll[key] = mem;
  await chrome.storage.local.set({ memory: memoryAll });

  const typed = msg.answers.filter((a) => a.dittoValue == null || a.dittoValue !== a.value);
  if (!typed.length) {
    port.postMessage({ type: 'learn-proposal', changes: [], note: 'Every answer on this page came from your profile, so there is nothing new to learn. I did remember this page.' });
    return;
  }
  port.postMessage({ type: 'status', text: `Reading ${typed.length} answer(s) you typed...` });
  const { changes } = await proposeFacts(settings, profile, L.buildLearnMessages(profile, msg.page, typed));
  port.postMessage({
    type: 'learn-proposal',
    changes,
    note: changes.length ? '' : 'Those answers look specific to this form, so I only remembered them for this page.',
  });
}

async function saveChanges(changes) {
  const profile = await getProfile();
  const next = L.applyFactChanges(profile, changes);
  await saveProfile(next);
  return next;
}

// ---------- wiring ----------
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ditto') return;
  const ctrl = new AbortController();
  port.onDisconnect.addListener(() => ctrl.abort());
  port.onMessage.addListener(async (msg) => {
    if (!msg || msg.type === 'ping') return;
    const release = keepAwake();
    try {
      if (msg.type === 'fill') await handleFill(port, msg, ctrl.signal);
      else if (msg.type === 'learn') await handleLearn(port, msg);
      else if (msg.type === 'learn-save') {
        const next = await saveChanges(msg.changes || []);
        port.postMessage({ type: 'learn-saved', count: (msg.changes || []).length, total: next.facts.length });
      }
    } catch (e) {
      if (ctrl.signal.aborted) return;
      try {
        port.postMessage({ type: 'error', code: e.code || 'failed', message: e.message || String(e) });
      } catch (_) {
        /* tab went away */
      }
    } finally {
      release();
    }
  });
});

async function runOnTab(tabId, what) {
  await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
  await chrome.scripting.executeScript({ target: { tabId }, func: (w) => globalThis.Ditto.main.start(w), args: [what] });
}

async function flagError(tabId, e) {
  console.warn('Ditto could not run on this tab:', e && e.message);
  await chrome.action.setBadgeBackgroundColor({ color: '#b91c1c', tabId });
  await chrome.action.setBadgeText({ text: '!', tabId });
  setTimeout(() => chrome.action.setBadgeText({ text: '', tabId }), 4000);
}

async function status() {
  const settings = await getSettings();
  const profile = await getProfile();
  const out = { facts: profile.facts.length, ollama: false, model: '', modelName: '', loaded: false, models: [], url: settings.ollamaUrl };
  try {
    const tags = await ollamaJson(settings, '/api/tags', null, 4000);
    out.ollama = true;
    out.models = (tags.models || []).map((m) => m.name);
    out.model = pickModel(out.models, settings.model);
    out.modelName = prettyModel(out.model);
    out.loaded = out.model ? await isLoaded(settings, out.model) : false;
  } catch (_) {
    out.ollama = false;
  }
  return out;
}

async function warmup() {
  const settings = await getSettings();
  const model = await resolveModel(settings);
  if (await isLoaded(settings, model)) return { ok: true, already: true };
  const base = await baseRequest(settings, model);
  await ollamaJson(settings, '/api/chat', { ...base, stream: false, messages: [] });
  return { ok: true };
}

// Hooks for the automated eval (eval/run-eval.mjs drives the real extension through these).
self.__ditto = { runOnTab, warmup, status };

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const reply = (p) =>
    p.then(
      (r) => sendResponse({ ok: true, ...r }),
      (e) => sendResponse({ ok: false, code: e.code || 'failed', error: e.message || String(e) }),
    );
  if (!msg || !msg.cmd) return false;
  switch (msg.cmd) {
    case 'status':
      reply(status());
      return true;
    case 'warmup':
      reply(warmup());
      return true;
    case 'run':
      reply(runOnTab(msg.tabId, msg.what).then(() => ({})));
      return true;
    case 'open-options':
      chrome.runtime.openOptionsPage();
      return false;
    case 'import': {
      const release = keepAwake();
      reply(
        (async () => {
          const settings = await getSettings();
          const profile = await getProfile();
          return proposeFacts(settings, profile, L.buildImportMessages(profile, msg.text));
        })().finally(release),
      );
      return true;
    }
    case 'apply-changes':
      reply(saveChanges(msg.changes || []).then((p) => ({ total: p.facts.length })));
      return true;
    default:
      return false;
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'fill-form' || !tab) return;
  runOnTab(tab.id, 'fill').catch((e) => flagError(tab.id, e));
});

chrome.runtime.onInstalled.addListener(async (details) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'ditto-fill', title: 'Fill this form with Ditto', contexts: ['page', 'editable'] });
    chrome.contextMenus.create({ id: 'ditto-learn', title: 'Ditto: remember what I typed', contexts: ['page', 'editable'] });
  });
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return;
  const what = info.menuItemId === 'ditto-learn' ? 'learn' : 'fill';
  runOnTab(tab.id, what).catch((e) => flagError(tab.id, e));
});
