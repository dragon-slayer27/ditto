/*
 * Ditto content script entry point. Coordinates extraction, the background worker and the panel.
 * Started by the service worker with globalThis.Ditto.main.start('fill' | 'learn').
 */
(function () {
  'use strict';
  const D = (globalThis.Ditto = globalThis.Ditto || {});
  if (D.main) return;

  let session = null;
  let port = null;
  let pingTimer = null;
  let lastMode = 'fill';

  const isLocalDemo = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);

  function setState(s) {
    document.documentElement.dataset.dittoState = s;
  }

  function stopPing() {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
  }

  function closePort() {
    stopPing();
    if (port) {
      try {
        port.disconnect();
      } catch (_) {
        /* already gone */
      }
      port = null;
    }
  }

  function openPort() {
    closePort();
    const p = chrome.runtime.connect({ name: 'ditto' });
    port = p;
    p.onMessage.addListener(onMessage);
    p.onDisconnect.addListener(() => {
      if (port !== p) return;
      stopPing();
      port = null;
      const phase = D.panel.get().phase;
      if (phase === 'working' || phase === 'learning') fail({ message: "Ditto's background worker stopped unexpectedly. Please try again." });
    });
    pingTimer = setInterval(() => {
      try {
        if (port) port.postMessage({ type: 'ping' });
      } catch (_) {
        /* ignore */
      }
    }, 15000);
    return p;
  }

  function hasUserValue(entry) {
    if (entry.kind === 'radio') return entry.els.some((i) => i.checked && !i.defaultChecked);
    if (entry.kind === 'checkbox-group') return entry.els.some((i) => i.checked);
    if (entry.kind === 'checkbox') return entry.el.checked;
    if (entry.kind === 'select') {
      const el = entry.el;
      if (el.multiple) return el.selectedOptions.length > 0;
      const real = entry.options.some((o) => o.index === el.selectedIndex);
      return real && el.selectedIndex > 0;
    }
    return String(entry.el.value || '').trim() !== '';
  }

  const SKIP_NOTES = {
    consent: 'Agreeing is your call, so Ditto leaves this to you',
    sensitive: 'Payment, OTP and captcha fields are never filled',
    essay: 'This one needs your own words',
  };

  function newSession() {
    const { page, fields, registry } = D.extract.extractFields();
    session = {
      page,
      fields,
      registry,
      byId: new Map(fields.map((f) => [f.id, f])),
      results: new Map(),
      t0: performance.now(),
      counts: { filled: 0, remembered: 0, check: 0, needs: 0 },
      check: [],
      needs: [],
      total: 0,
      asked: [],
      kept: 0,
      log: [],
    };
    return session;
  }

  function record(f, res) {
    session.results.set(f.id, res);
    session.counts[res.status] = (session.counts[res.status] || 0) + 1;
    if (res.status === 'check') session.check.push({ id: f.id, label: f.label, note: res.note });
    if (res.status === 'needs') session.needs.push({ id: f.id, label: f.label, note: res.note });
  }

  function progress(extra) {
    D.panel.set({
      done: session.results.size,
      total: session.total,
      counts: { ...session.counts },
      check: session.check.slice(),
      needs: session.needs.slice(),
      ...(extra || {}),
    });
  }

  function wirePanel() {
    D.panel.on('close', () => {
      closePort();
      D.fill.clearHighlights();
      D.panel.close();
      setState('closed');
    });
    D.panel.on('undo', undoFill);
    D.panel.on('remember', startLearn);
    D.panel.on('goto', gotoField);
    D.panel.on('save-learn', (changes) => {
      if (!port) openPort();
      D.panel.set({ phase: 'learning', status: 'Saving...' });
      port.postMessage({ type: 'learn-save', changes });
    });
    D.panel.on('cancel-learn', () => {
      closePort();
      D.panel.set({ phase: 'done', status: 'OK, nothing was saved.' });
      setState('done');
    });
    D.panel.on('options', () => chrome.runtime.sendMessage({ cmd: 'open-options' }));
    D.panel.on('retry', () => (lastMode === 'learn' ? startLearn() : startFill()));
  }

  function startFill() {
    lastMode = 'fill';
    closePort();
    D.fill.clearHighlights();
    newSession();
    D.panel.open();
    wirePanel();
    setState('working');

    for (const f of session.fields) {
      const entry = session.registry.get(f.id);
      if (f.skip) {
        session.total++;
        D.fill.mark(entry, 'needs');
        record(f, { status: 'needs', note: SKIP_NOTES[f.skip] });
        continue;
      }
      if (hasUserValue(entry)) {
        session.kept++;
        continue;
      }
      session.total++;
      session.asked.push(f);
    }

    if (!session.fields.length) {
      D.panel.set({ phase: 'done', status: "I couldn't find any form fields on this page.", total: 0 });
      setState('done');
      return;
    }
    if (!session.asked.length) {
      finish({ note: session.kept ? `Kept ${session.kept} answer(s) you had already typed.` : '' });
      return;
    }
    progress({ status: `Reading ${session.asked.length} fields...` });
    openPort().postMessage({ type: 'fill', page: session.page, fields: session.asked });
  }

  function handleItem(item) {
    const f = session && session.byId.get(item.id);
    if (!f || session.results.has(item.id)) return;
    const entry = session.registry.get(item.id);
    const res = D.fill.apply(entry, item);
    res.item = item;
    record(f, res);
    if (isLocalDemo) session.log.push({ id: f.id, label: f.label, value: item.value, sure: item.sure, supported: item.supported, remembered: !!item.remembered, status: res.status, note: res.note || '' });
    progress({ status: item.remembered ? 'Filling from memory...' : 'Filling slowly, but surely...' });
  }

  // The model lists fields it wasn't sure about after all values; turn those amber.
  function markUnsure(ids) {
    for (const id of ids || []) {
      const res = session.results.get(id);
      if (!res || res.status !== 'filled') continue;
      const f = session.byId.get(id);
      session.counts.filled--;
      session.counts.check++;
      res.status = 'check';
      res.note = 'Gemma was not sure about this one, please check';
      session.check.push({ id, label: f.label, note: res.note });
      D.fill.mark(session.registry.get(id), 'check', res.chosen);
      const logItem = session.log.find((x) => x.id === id);
      if (logItem) Object.assign(logItem, { sure: false, status: 'check', note: res.note });
    }
    progress();
  }

  function finish(stats) {
    closePort();
    for (const f of session.asked) {
      if (session.results.has(f.id)) continue;
      const entry = session.registry.get(f.id);
      D.fill.mark(entry, 'needs');
      record(f, { status: 'needs', note: 'No answer came back' });
    }
    const ms = Math.round(performance.now() - session.t0);
    const secs = (ms / 1000).toFixed(ms < 10000 ? 1 : 0);
    const c = session.counts;
    const status =
      c.check || c.needs ? `Done in ${secs}s. A few fields need you.` : `Done in ${secs}s. Have a look, then submit it yourself.`;
    const metaBits = [];
    if (stats && stats.remembered) metaBits.push(`${stats.remembered} from memory`);
    if (session.kept) metaBits.push(`kept ${session.kept} you typed`);
    progress({ phase: 'done', status, meta: metaBits.join(' · '), model: (stats && stats.model) || D.panel.get().model });
    document.documentElement.dataset.dittoMs = String(ms);
    if (isLocalDemo) {
      let node = document.getElementById('ditto-log');
      if (!node) {
        node = document.createElement('script');
        node.type = 'application/json';
        node.id = 'ditto-log';
        document.body.appendChild(node);
      }
      node.textContent = JSON.stringify({ ms, stats: stats || {}, items: session.log });
    }
    setState('done');
  }

  function fail(err) {
    closePort();
    let help = '';
    if (err.code === 'no-ollama') help = 'Start Ollama (open the Ollama app, or run <code>ollama serve</code>), then try again.';
    else if (err.code === 'no-model') help = 'Download a Gemma model first: <code>ollama pull gemma4:e4b</code>';
    else if (err.code === 'no-profile') help = 'Open your profile to add a few facts, paste your resume, or load the demo persona.';
    D.panel.set({ phase: 'error', error: { message: err.message || 'Something went wrong.', help } });
    setState('error');
  }

  function undoFill() {
    if (!session) return;
    for (const res of session.results.values()) if (res.snapshot) D.fill.restore(res.snapshot);
    D.fill.clearHighlights();
    session.results.clear();
    session.counts = { filled: 0, remembered: 0, check: 0, needs: 0 };
    session.check = [];
    session.needs = [];
    progress({ phase: 'done', status: 'Undone. The form is back to how it was.', done: 0 });
    setState('undone');
  }

  function gotoField(id) {
    const entry = session && session.registry.get(id);
    if (!entry) return;
    const el = entry.el || entry.els[0];
    const target = el.closest('label') && entry.els ? el.closest('label') : el;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    try {
      el.focus({ preventScroll: true });
    } catch (_) {
      /* not focusable */
    }
  }

  function startLearn() {
    lastMode = 'learn';
    if (!session) {
      newSession();
      D.panel.open();
      wirePanel();
    }
    const answers = [];
    for (const f of session.fields) {
      if (f.skip) continue;
      const entry = session.registry.get(f.id);
      const value = D.fill.currentValue(entry);
      if (!value || value === 'unchecked') continue;
      const r = session.results.get(f.id);
      answers.push({
        sig: f.sig,
        label: f.label,
        section: f.section,
        kind: f.kind,
        value,
        dittoValue: r && r.applied != null ? String(r.applied) : null,
      });
    }
    if (!answers.length) {
      D.panel.set({ phase: 'review', changes: [], note: "There's nothing typed on this page yet." });
      setState('review');
      return;
    }
    D.panel.set({ phase: 'learning', status: 'Reading what you typed...' });
    setState('learning');
    openPort().postMessage({ type: 'learn', page: session.page, answers });
  }

  function onMessage(msg) {
    if (!msg || !session) return;
    switch (msg.type) {
      case 'status':
        D.panel.set({ status: msg.text, ...(msg.model ? { model: msg.model } : {}) });
        break;
      case 'item':
        handleItem(msg.item);
        break;
      case 'unsure':
        markUnsure(msg.ids);
        break;
      case 'done':
        finish(msg.stats);
        break;
      case 'error':
        fail(msg);
        break;
      case 'learn-proposal':
        D.panel.set({ phase: 'review', changes: msg.changes || [], note: msg.note || '' });
        setState('review');
        break;
      case 'learn-saved':
        closePort();
        D.panel.set({
          phase: 'saved',
          status: 'Saved to your profile',
          note: `Learned ${msg.count} thing(s). Ditto now knows ${msg.total} facts about you, and this page will fill instantly next time.`,
          check: [],
          needs: [],
        });
        setState('learned');
        break;
      default:
        break;
    }
  }

  D.main = {
    start(cmd) {
      if (cmd === 'learn') startLearn();
      else startFill();
    },
  };
})();
