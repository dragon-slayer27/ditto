/*
 * Ditto content script: writes values into fields (framework-safe), highlights them, and can undo.
 * Exposes globalThis.Ditto.fill.
 */
(function () {
  'use strict';
  const D = (globalThis.Ditto = globalThis.Ditto || {});
  if (D.fill) return;
  const T = D.text;

  const COLORS = { filled: '#16a34a', remembered: '#0d9488', check: '#d97706', needs: '#94a3b8' };
  const STYLES = { filled: 'solid', remembered: 'solid', check: 'dashed', needs: 'dotted' };
  const touched = new Map(); // element -> original inline outline styles

  const ON_RE = /^(checked|check|yes|y|true|1|on|tick|ticked|selected)$/i;
  const OFF_RE = /^(unchecked|uncheck|no|n|false|0|off|unticked|not selected)$/i;

  function nativeSetter(el) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    return Object.getOwnPropertyDescriptor(proto, 'value').set;
  }

  function fire(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur'));
  }

  function setValue(el, value) {
    nativeSetter(el).call(el, value);
    fire(el);
  }

  function setSelectIndex(el, index) {
    el.selectedIndex = index;
    fire(el);
  }

  function setChecked(input, want) {
    if (input.checked !== want) input.click();
    if (input.checked !== want) {
      input.checked = want;
      fire(input);
    }
  }

  // ---------- snapshots (undo) ----------
  function snapshot(entry) {
    if (entry.els) return { entry, checked: entry.els.map((i) => i.checked) };
    if (entry.kind === 'checkbox') return { entry, checked: [entry.el.checked] };
    if (entry.kind === 'select') return { entry, selectedIndex: entry.el.selectedIndex };
    return { entry, value: entry.el.value };
  }

  function restore(snap) {
    const { entry } = snap;
    if (entry.els) entry.els.forEach((i, k) => setChecked(i, snap.checked[k]));
    else if (entry.kind === 'checkbox') setChecked(entry.el, snap.checked[0]);
    else if (entry.kind === 'select') setSelectIndex(entry.el, snap.selectedIndex);
    else setValue(entry.el, snap.value);
  }

  // ---------- reading ----------
  function currentValue(entry) {
    if (entry.kind === 'radio') {
      const i = entry.els.findIndex((x) => x.checked);
      return i >= 0 ? entry.options[i].text : '';
    }
    if (entry.kind === 'checkbox-group') {
      return entry.els
        .map((x, i) => (x.checked ? entry.options[i].text : null))
        .filter(Boolean)
        .join('; ');
    }
    if (entry.kind === 'checkbox') return entry.el.checked ? 'checked' : 'unchecked';
    if (entry.kind === 'select') {
      const el = entry.el;
      if (el.multiple) return [...el.selectedOptions].map((o) => T.cleanText(o.text)).join('; ');
      const opt = el.options[el.selectedIndex];
      if (!opt || !entry.options.some((o) => o.index === el.selectedIndex)) return '';
      return T.cleanText(opt.text);
    }
    return String(entry.el.value || '').trim();
  }

  // ---------- highlighting ----------
  function highlightTargets(entry, chosenIndexes) {
    if (entry.els) {
      const pick = chosenIndexes && chosenIndexes.length ? chosenIndexes.map((i) => entry.els[i]) : entry.els;
      return pick.map((i) => i.closest('label') || (i.id && document.querySelector(`label[for="${CSS.escape(i.id)}"]`)) || i);
    }
    return [entry.el];
  }

  function paint(targets, status) {
    for (const t of targets) {
      if (!touched.has(t)) touched.set(t, { outline: t.style.outline, outlineOffset: t.style.outlineOffset });
      t.style.setProperty('outline', `2px ${STYLES[status]} ${COLORS[status]}`, 'important');
      t.style.setProperty('outline-offset', '2px', 'important');
    }
  }

  function mark(entry, status, chosenIndexes) {
    const controls = entry.els || [entry.el];
    controls.forEach((c) => (c.dataset.dittoStatus = status));
    paint(highlightTargets(entry, status === 'needs' ? null : chosenIndexes), status);
  }

  function clearHighlights() {
    for (const [t, orig] of touched) {
      t.style.outline = orig.outline;
      t.style.outlineOffset = orig.outlineOffset;
    }
    touched.clear();
    document.querySelectorAll('[data-ditto-status]').forEach((el) => delete el.dataset.dittoStatus);
  }

  // ---------- applying ----------
  function baseStatus(item) {
    if (item.remembered) return 'remembered';
    return item.sure && item.supported !== false ? 'filled' : 'check';
  }

  function checkNote(item) {
    if (item.supported === false) return `Not found in your profile: ${item.unsupported.slice(0, 3).join(', ')}`;
    if (!item.sure) return 'Gemma was not sure, please check';
    return '';
  }

  function applyText(entry, raw, item) {
    const el = entry.el;
    let value = raw;
    if (entry.upper && !/^(email|url)$/.test(entry.type) && !/@|:\/\/|^www\./i.test(raw)) value = raw.toUpperCase();
    if (entry.type === 'date') {
      const d = T.parseDate(raw);
      if (!d) return { status: 'check', note: `Suggested "${raw}", which is not a date`, suggestion: raw };
      value = T.formatYMD(d);
    } else if (entry.type === 'number') {
      const num = raw.replace(/[,\s\u20b9$\u20ac\u00a3]/g, '').replace(/(lpa|lakhs?|inr|rs\.?|kg|cm|years?|yrs?)$/i, '');
      if (!/^-?\d+(\.\d+)?$/.test(num)) return { status: 'check', note: `Suggested "${raw}", which is not a number`, suggestion: raw };
      value = num;
    } else if (entry.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
      return { status: 'check', note: `Suggested "${raw}", which is not an email`, suggestion: raw };
    }
    setValue(el, value);
    let status = baseStatus(item);
    let note = status === 'check' ? checkNote(item) : '';
    if (el.maxLength > 0 && value.length > el.maxLength) {
      status = 'check';
      note = `Longer than the ${el.maxLength} characters this field allows`;
    } else if (typeof el.checkValidity === 'function' && !el.checkValidity()) {
      status = 'check';
      note = el.validationMessage || 'The page says this value is invalid';
    }
    return { status, note, applied: value };
  }

  function applySelect(entry, raw, item) {
    const el = entry.el;
    if (el.multiple) {
      const parts = raw.split(/\s*[;|]\s*/).filter(Boolean);
      const hits = parts.map((p) => T.matchOption(p, entry.options)).filter((m) => m.index >= 0);
      if (!hits.length) return { status: 'check', note: `Suggested "${raw}", but no option matches`, suggestion: raw };
      hits.forEach((m) => (el.options[entry.options[m.index].index].selected = true));
      fire(el);
      const exact = hits.every((m) => m.exact) && hits.length === parts.length;
      return { status: exact ? baseStatus(item) : 'check', note: exact ? '' : 'Closest options picked', applied: currentValue(entry) };
    }
    const m = T.matchOption(raw, entry.options);
    if (m.index < 0) return { status: 'check', note: `Suggested "${raw}", but no option matches`, suggestion: raw };
    setSelectIndex(el, entry.options[m.index].index);
    const status = m.exact ? baseStatus(item) : 'check';
    return { status, note: m.exact ? (status === 'check' ? checkNote(item) : '') : `Closest option to "${raw}"`, applied: entry.options[m.index].text };
  }

  function applyRadio(entry, raw, item) {
    const m = T.matchOption(raw, entry.options);
    if (m.index < 0) return { status: 'check', note: `Suggested "${raw}", but no option matches`, suggestion: raw };
    setChecked(entry.els[m.index], true);
    const status = m.exact ? baseStatus(item) : 'check';
    return { status, note: m.exact ? (status === 'check' ? checkNote(item) : '') : `Closest option to "${raw}"`, applied: entry.options[m.index].text, chosen: [m.index] };
  }

  function applyCheckbox(entry, raw, item) {
    const want = ON_RE.test(raw) ? true : OFF_RE.test(raw) ? false : null;
    if (want == null) return { status: 'check', note: `Suggested "${raw}" for a checkbox`, suggestion: raw };
    setChecked(entry.el, want);
    const status = baseStatus(item);
    return { status, note: status === 'check' ? checkNote(item) : '', applied: want ? 'checked' : 'unchecked' };
  }

  function applyCheckboxGroup(entry, raw, item) {
    const parts = raw.split(/\s*[;,|]\s*/).filter(Boolean);
    const chosen = [];
    let exact = true;
    for (const p of parts) {
      const m = T.matchOption(p, entry.options);
      if (m.index < 0) {
        exact = false;
        continue;
      }
      if (!m.exact) exact = false;
      setChecked(entry.els[m.index], true);
      chosen.push(m.index);
    }
    if (!chosen.length) return { status: 'check', note: `Suggested "${raw}", but no option matches`, suggestion: raw };
    const status = exact ? baseStatus(item) : 'check';
    return { status, note: exact ? (status === 'check' ? checkNote(item) : '') : 'Some answers did not match an option', applied: currentValue(entry), chosen };
  }

  /**
   * Apply one model answer to a field. Returns {status, note, applied, snapshot}.
   * status: filled | remembered | check | needs
   */
  function apply(entry, item) {
    const raw = item.value == null ? '' : String(item.value).trim();
    if (!raw) {
      mark(entry, 'needs');
      return { status: 'needs', note: 'Not in your profile yet' };
    }
    const snap = snapshot(entry);
    let res;
    try {
      if (entry.kind === 'select') res = applySelect(entry, raw, item);
      else if (entry.kind === 'radio') res = applyRadio(entry, raw, item);
      else if (entry.kind === 'checkbox') res = applyCheckbox(entry, raw, item);
      else if (entry.kind === 'checkbox-group') res = applyCheckboxGroup(entry, raw, item);
      else res = applyText(entry, raw, item);
    } catch (e) {
      res = { status: 'check', note: `Could not fill: ${e.message}`, suggestion: raw };
    }
    mark(entry, res.status, res.chosen);
    res.snapshot = snap;
    return res;
  }

  D.fill = { apply, restore, currentValue, mark, clearHighlights, COLORS };
})();
