/*
 * Ditto content script: the small floating panel (Shadow DOM, so page styles can't leak in or out).
 * Exposes globalThis.Ditto.panel.
 */
(function () {
  'use strict';
  const D = (globalThis.Ditto = globalThis.Ditto || {});
  if (D.panel) return;

  const STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .card { width: 320px; max-height: min(78vh, 640px); display: flex; flex-direction: column; background: #fffdf7; color: #1f2937;
    border: 1px solid #e8e0cc; border-radius: 16px; box-shadow: 0 18px 50px rgba(31, 41, 55, .22), 0 2px 6px rgba(31,41,55,.08);
    font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; overflow: hidden; }
  header { display: flex; align-items: center; gap: 10px; padding: 12px 12px 8px 14px; }
  .sloth { width: 34px; height: 34px; border-radius: 50%; background: #f3e8cf; display: grid; place-items: center; font-size: 20px; flex: none; }
  .sloth.busy span { display: inline-block; transform-origin: 50% 0; animation: swing 2.4s ease-in-out infinite; }
  @keyframes swing { 0%,100% { transform: rotate(-10deg); } 50% { transform: rotate(10deg); } }
  .titles { flex: 1; min-width: 0; }
  .name { font-weight: 700; font-size: 14px; letter-spacing: .2px; }
  .sub { color: #6b7280; font-size: 11.5px; }
  .icon { border: 0; background: transparent; color: #6b7280; width: 26px; height: 26px; border-radius: 8px; cursor: pointer; font-size: 16px; line-height: 1; }
  .icon:hover { background: #f1ece0; color: #111827; }
  .body { padding: 0 14px 10px; overflow: auto; }
  .status { font-weight: 600; margin: 2px 0 8px; }
  .bar { height: 8px; border-radius: 99px; background: #efe8d8; overflow: hidden; }
  .bar > i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #65a30d, #16a34a); border-radius: 99px; transition: width .35s ease; }
  .progress { display: flex; justify-content: space-between; color: #6b7280; font-size: 11.5px; margin-top: 4px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 4px; }
  .chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 99px; font-size: 11.5px; font-weight: 600; background: #f4f1ea; }
  .dot { width: 8px; height: 8px; border-radius: 50%; }
  h4 { margin: 12px 0 6px; font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: #6b7280; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; }
  li.field { padding: 7px 9px; border-radius: 10px; background: #fff; border: 1px solid #eee6d4; border-left-width: 4px; cursor: pointer; }
  li.field:hover { background: #fbf7ee; }
  li.check { border-left-color: #d97706; }
  li.needs { border-left-color: #94a3b8; }
  .fl { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fn { color: #6b7280; font-size: 11.5px; }
  .muted { color: #6b7280; }
  .error { background: #fef2f2; border: 1px solid #fecaca; color: #7f1d1d; padding: 10px; border-radius: 10px; }
  .error code { background: #fff; padding: 1px 5px; border-radius: 6px; border: 1px solid #fecaca; font-size: 12px; }
  footer { border-top: 1px solid #efe8d8; padding: 10px 14px 12px; display: grid; gap: 8px; background: #fffaf0; }
  .privacy { color: #6b7280; font-size: 11px; }
  .actions { display: flex; gap: 8px; }
  button.btn { flex: 1; border: 1px solid #d6ccb4; background: #fff; color: #1f2937; border-radius: 10px; padding: 8px 10px; font: 600 12.5px system-ui, sans-serif; cursor: pointer; white-space: nowrap; }
  button.btn.primary { flex: 1.8; }
  button.btn:hover { background: #f8f3e7; }
  button.primary { background: #3f6212; border-color: #3f6212; color: #fff; }
  button.primary:hover { background: #365314; }
  button[disabled] { opacity: .55; cursor: default; }
  label.change { display: flex; gap: 8px; align-items: flex-start; padding: 7px 9px; border: 1px solid #eee6d4; border-radius: 10px; background: #fff; cursor: pointer; }
  label.change input { margin-top: 2px; accent-color: #3f6212; }
  .tag { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 99px; margin-left: 6px; vertical-align: 1px; }
  .tag.add { background: #dcfce7; color: #166534; }
  .tag.update { background: #fef3c7; color: #92400e; }
  .old { text-decoration: line-through; color: #9ca3af; }
  .pill { display: flex; align-items: center; gap: 8px; padding: 8px 12px 8px 8px; background: #fffdf7; border: 1px solid #e8e0cc; border-radius: 99px;
    box-shadow: 0 10px 30px rgba(31,41,55,.2); font: 600 13px system-ui, sans-serif; color: #1f2937; cursor: pointer; }
  `;

  const COLORS = { filled: '#16a34a', remembered: '#0d9488', check: '#d97706', needs: '#94a3b8' };

  let host = null;
  let root = null;
  const handlers = {};
  let state = fresh();

  function fresh() {
    return {
      phase: 'working',
      status: 'Reading the form...',
      done: 0,
      total: 0,
      counts: { filled: 0, remembered: 0, check: 0, needs: 0 },
      check: [],
      needs: [],
      model: '',
      meta: '',
      error: null,
      changes: [],
      note: '',
      minimized: false,
    };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function ensure() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.setAttribute('data-ditto-ui', '');
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; right: 16px; top: 16px;';
    root = host.attachShadow({ mode: 'open' });
    root.addEventListener('click', onClick);
    document.documentElement.appendChild(host);
  }

  function onClick(e) {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const action = t.getAttribute('data-action');
    if (action === 'minimize') return set({ minimized: true });
    if (action === 'expand') return set({ minimized: false });
    if (action === 'save-learn') {
      const picked = [...root.querySelectorAll('input[data-change]')].filter((i) => i.checked).map((i) => state.changes[+i.dataset.change]);
      return handlers['save-learn'] && handlers['save-learn'](picked);
    }
    if (handlers[action]) handlers[action](t.getAttribute('data-id'));
  }

  function chip(color, n, label) {
    return n ? `<span class="chip"><span class="dot" style="background:${color}"></span>${n} ${esc(label)}</span>` : '';
  }

  function list(items, cls) {
    return `<ul>${items
      .map((it) => `<li class="field ${cls}" data-action="goto" data-id="${esc(it.id)}"><div class="fl">${esc(it.label || '(unlabelled field)')}</div>${it.note ? `<div class="fn">${esc(it.note)}</div>` : ''}</li>`)
      .join('')}</ul>`;
  }

  function bodyHtml() {
    const s = state;
    if (s.phase === 'error') {
      return `<div class="status">Something needs your attention</div><div class="error">${esc(s.error.message)}${s.error.help ? `<div style="margin-top:6px">${s.error.help}</div>` : ''}</div>`;
    }
    if (s.phase === 'review') {
      if (!s.changes.length) return `<div class="status">Nothing new to learn</div><div class="muted">${esc(s.note || 'Every answer on this page already matches your profile.')}</div>`;
      return `<div class="status">I can remember these for next time</div>
        <div class="muted" style="margin-bottom:8px">Untick anything you don't want saved. It stays on this computer.</div>
        <div style="display:grid;gap:6px">${s.changes
          .map(
            (c, i) => `<label class="change"><input type="checkbox" data-change="${i}" checked><span><b>${esc(c.key)}</b><span class="tag ${c.op}">${c.op === 'add' ? 'NEW' : 'UPDATE'}</span><br>
              ${c.op === 'update' ? `<span class="old">${esc(c.old)}</span> &rarr; ` : ''}${esc(c.value)}</span></label>`,
          )
          .join('')}</div>`;
    }
    const pct = s.total ? Math.round((100 * s.done) / s.total) : s.phase === 'done' ? 100 : 0;
    let html = `<div class="status">${esc(s.status)}</div>`;
    if (s.phase === 'working' || s.phase === 'done') {
      html += `<div class="bar"><i style="width:${pct}%"></i></div><div class="progress"><span>${s.done} / ${s.total} fields</span><span>${esc(s.meta)}</span></div>`;
      html += `<div class="chips">${chip(COLORS.filled, s.counts.filled, 'filled')}${chip(COLORS.remembered, s.counts.remembered, 'remembered')}${chip(COLORS.check, s.counts.check, 'to check')}${chip(COLORS.needs, s.counts.needs, 'need you')}</div>`;
    }
    if (s.check.length) html += `<h4>Please check</h4>${list(s.check, 'check')}`;
    if (s.needs.length && s.phase !== 'working') html += `<h4>Needs you</h4>${list(s.needs, 'needs')}`;
    if (s.phase === 'saved') html += `<div class="muted" style="margin-top:8px">${esc(s.note)}</div>`;
    return html;
  }

  function footerHtml() {
    const s = state;
    const privacy = `<div class="privacy">&#128274; ${esc(s.model ? `${s.model} on this computer.` : 'Runs on this computer.')} Nothing is sent online. Ditto never submits.</div>`;
    if (s.phase === 'review') {
      return `${privacy}<div class="actions">${s.changes.length ? '<button class="btn primary" data-action="save-learn">Save to profile</button>' : ''}<button class="btn" data-action="cancel-learn">${s.changes.length ? 'Not now' : 'Close'}</button></div>`;
    }
    if (s.phase === 'error') {
      return `${privacy}<div class="actions"><button class="btn primary" data-action="retry">Try again</button><button class="btn" data-action="options">Open profile</button></div>`;
    }
    const busy = s.phase === 'working' || s.phase === 'learning';
    return `${privacy}<div class="actions"><button class="btn primary" data-action="remember" ${busy ? 'disabled' : ''}>Remember what I typed</button><button class="btn" data-action="undo" ${s.phase === 'working' ? 'disabled' : ''}>Undo</button></div>`;
  }

  function render() {
    ensure();
    const s = state;
    const busy = s.phase === 'working' || s.phase === 'learning';
    if (s.minimized) {
      root.innerHTML = `<style>${STYLE}</style><div class="pill" data-action="expand"><span class="sloth ${busy ? 'busy' : ''}"><span>&#129445;</span></span>${esc(busy ? `${s.done} / ${s.total}` : 'Ditto')}</div>`;
      return;
    }
    root.innerHTML = `<style>${STYLE}</style><div class="card" role="dialog" aria-label="Ditto form filler">
      <header><div class="sloth ${busy ? 'busy' : ''}"><span>&#129445;</span></div>
        <div class="titles"><div class="name">Ditto</div><div class="sub">type it once &middot; local form filler</div></div>
        <button class="icon" title="Minimise" data-action="minimize">&#8211;</button><button class="icon" title="Close (keeps what was filled)" data-action="close">&times;</button></header>
      <div class="body">${bodyHtml()}</div><footer>${footerHtml()}</footer></div>`;
  }

  function set(patch) {
    state = { ...state, ...patch };
    render();
  }

  D.panel = {
    open() {
      state = fresh();
      render();
    },
    close() {
      if (host) host.remove();
      host = null;
      root = null;
    },
    set,
    get: () => state,
    on(action, fn) {
      handlers[action] = fn;
    },
    isOpen: () => !!(host && host.isConnected),
  };
})();
