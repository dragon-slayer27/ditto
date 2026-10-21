/*
 * Ditto content script: turns the page's form controls into plain-language field descriptions.
 * Runs in the extension's isolated world. Exposes globalThis.Ditto.extract.
 */
(function () {
  'use strict';
  const D = (globalThis.Ditto = globalThis.Ditto || {});
  if (D.extract) return;
  const T = D.text;

  const SKIP_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'file', 'password', 'range', 'color']);
  const CONTROL_SELECTOR = 'input, select, textarea';
  const HEADING_SELECTOR = 'h2, h3, h4, h5, h6, caption, [role="heading"], th[colspan], .section-title, .section-header';
  const NOTE_RE = /block\s+letters|capital\s+letters|in\s+capitals|uppercase|dd\s*\/\s*mm\s*\/\s*yyyy|mm\s*\/\s*dd\s*\/\s*yyyy|in\s+english\s+only/i;
  const UPPER_RE = /block\s+letters|capital\s+letters|in\s+capitals|upper\s*case/i;

  function isControl(node) {
    return node && node.nodeType === 1 && node.matches(CONTROL_SELECTOR);
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
    return el.getClientRects().length > 0;
  }

  function textOf(node) {
    if (!node) return '';
    const clone = node.cloneNode(true);
    clone.querySelectorAll('select, option, script, style, textarea, input, button, svg, [data-ditto-ui]').forEach((n) => n.remove());
    return T.cleanText(clone.textContent);
  }

  function byIds(ids) {
    return String(ids || '')
      .split(/\s+/)
      .map((id) => id && document.getElementById(id))
      .filter(Boolean)
      .map(textOf)
      .filter(Boolean)
      .join(' ');
  }

  function labelElementFor(el) {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return l;
    }
    return el.closest('label');
  }

  // Text that sits just before a control (or its wrapper), stopping at the previous control or a heading.
  function nearbyText(el) {
    let node = el;
    for (let level = 0; level < 4 && node && node.parentElement && node !== document.body; level++) {
      let sib = node.previousSibling;
      while (sib) {
        if (sib.nodeType === 3) {
          const t = T.cleanText(sib.textContent);
          if (t && t.length > 1) return t.slice(0, 200);
        } else if (sib.nodeType === 1) {
          if (isControl(sib) || sib.querySelector(CONTROL_SELECTOR)) return '';
          if (sib.matches(HEADING_SELECTOR) || /^(H1|LEGEND)$/.test(sib.tagName)) return '';
          const t = textOf(sib);
          if (t) return t.slice(0, 200);
        }
        sib = sib.previousSibling;
      }
      node = node.parentElement;
    }
    return '';
  }

  // Short text right after a control, e.g. "(DD/MM/YYYY)" or "digits only".
  function suffixText(el) {
    let sib = el.nextSibling;
    for (let i = 0; i < 3 && sib; i++, sib = sib.nextSibling) {
      if (sib.nodeType === 1 && (isControl(sib) || sib.querySelector(CONTROL_SELECTOR))) return '';
      const t = sib.nodeType === 3 ? T.cleanText(sib.textContent) : sib.nodeType === 1 ? textOf(sib) : '';
      if (t) return t.length <= 60 ? t : '';
    }
    return '';
  }

  function tableLabel(el) {
    const cell = el.closest('td, th');
    if (!cell) return '';
    let prev = cell.previousElementSibling;
    while (prev) {
      if (!prev.querySelector(CONTROL_SELECTOR)) {
        const t = textOf(prev);
        if (t) return t;
      } else break;
      prev = prev.previousElementSibling;
    }
    // Column header in the row above (label row / input row layout)
    const row = cell.parentElement;
    const prevRow = row && row.previousElementSibling;
    if (prevRow && !prevRow.querySelector(CONTROL_SELECTOR)) {
      const headerCell = prevRow.children[cell.cellIndex];
      const t = headerCell && !headerCell.hasAttribute('colspan') ? textOf(headerCell) : '';
      if (t) return t;
    }
    return '';
  }

  function ariaName(el) {
    return byIds(el.getAttribute('aria-labelledby')) || T.cleanText(el.getAttribute('aria-label') || '');
  }

  /** Returns {label, from} where from says which strategy found it (useful for debugging). */
  function labelFor(el) {
    const aria = byIds(el.getAttribute('aria-labelledby'));
    if (aria) return { label: aria, from: 'aria-labelledby' };
    const lab = labelElementFor(el);
    if (lab) {
      const t = textOf(lab);
      if (t) return { label: t, from: 'label' };
    }
    const al = T.cleanText(el.getAttribute('aria-label') || '');
    if (al) return { label: al, from: 'aria-label' };
    const tl = tableLabel(el);
    if (tl) return { label: tl, from: 'table' };
    const near = nearbyText(el);
    if (near) return { label: near, from: 'nearby' };
    const ph = T.cleanText(el.getAttribute('placeholder') || '');
    if (ph) return { label: ph, from: 'placeholder' };
    const title = T.cleanText(el.getAttribute('title') || '');
    if (title) return { label: title, from: 'title' };
    return { label: T.humanize(el.name || el.id || ''), from: 'name' };
  }

  function commonAncestor(nodes) {
    let anc = nodes[0].parentElement;
    while (anc && !nodes.every((n) => anc.contains(n))) anc = anc.parentElement;
    return anc || document.body;
  }

  // The question for a radio / checkbox group ("Gender", "Do you smoke?").
  function groupQuestion(inputs) {
    const first = inputs[0];
    const rg = first.closest('[role="radiogroup"], [role="group"]');
    if (rg && inputs.every((i) => rg.contains(i))) {
      const t = ariaName(rg);
      if (t) return t;
    }
    const fs = first.closest('fieldset');
    if (fs && inputs.every((i) => fs.contains(i))) {
      const others = [...fs.querySelectorAll(CONTROL_SELECTOR)].filter((c) => !inputs.includes(c));
      const lg = fs.querySelector(':scope > legend');
      if (lg && others.length === 0) {
        const t = textOf(lg);
        if (t) return t;
      }
    }
    const container = commonAncestor(inputs);
    const tl = tableLabel(container.closest('td, th') ? container : first);
    if (tl) return tl;
    // Text inside the container that is not one of the option labels.
    const clone = container.cloneNode(true);
    clone.querySelectorAll('label, input, select, textarea, button, script, style').forEach((n) => n.remove());
    const inner = T.cleanText(clone.textContent);
    if (inner && inner.length <= 200) return inner;
    const near = nearbyText(container);
    if (near) return near;
    return T.humanize(first.name || '');
  }

  function optionLabel(input) {
    const lab = labelElementFor(input);
    const t = lab ? textOf(lab) : '';
    return t || ariaName(input) || suffixText(input) || T.cleanText(input.value);
  }

  function collectHeadings() {
    return [...document.querySelectorAll(HEADING_SELECTOR)].filter((h) => !h.closest('[data-ditto-ui]') && textOf(h));
  }

  function sectionFor(el, headings, label) {
    const parts = [];
    let best = null;
    for (const h of headings) {
      if (h.contains(el)) continue;
      if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) best = h;
      else break;
    }
    if (best) parts.push(textOf(best));
    const fs = el.closest('fieldset');
    const lg = fs && fs.querySelector(':scope > legend');
    if (lg) parts.push(textOf(lg));
    const clean = [...new Set(parts.filter((p) => p && T.squash(p) !== T.squash(label)))];
    return clean.join(' > ').slice(0, 180);
  }

  function pageNotes() {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode() && out.length < 3) {
      const node = walker.currentNode;
      if (node.parentElement && node.parentElement.closest('label, option, script, style, [data-ditto-ui]')) continue;
      const t = T.cleanText(node.textContent);
      if (t.length > 8 && t.length < 300 && NOTE_RE.test(t) && !out.includes(t)) out.push(t);
    }
    return out.join(' ');
  }

  function hintsFor(el, kind, labelFrom, label) {
    const hints = [];
    const ph = T.cleanText(el.getAttribute('placeholder') || '');
    if (ph && labelFrom !== 'placeholder' && T.squash(ph) !== T.squash(label)) hints.push(`placeholder "${ph}"`);
    const suffix = kind === 'text' ? suffixText(el) : '';
    if (suffix) hints.push(`note "${suffix}"`);
    if (el.maxLength > 0 && el.maxLength < 200) hints.push(`max ${el.maxLength} chars`);
    const pattern = el.getAttribute('pattern');
    if (pattern && pattern.length <= 40) hints.push(`pattern ${pattern}`);
    if (el.getAttribute('inputmode') === 'numeric') hints.push('digits only');
    const ac = (el.getAttribute('autocomplete') || '').trim();
    if (ac && !/^(on|off|nope|false|new-password)$/i.test(ac)) hints.push(`autocomplete ${ac}`);
    return hints;
  }

  function formKey(el) {
    const f = el.form;
    return f ? [...document.forms].indexOf(f) : -1;
  }

  /**
   * Extract fillable fields.
   * Returns {page, fields, registry} where fields are serialisable descriptors and registry maps id -> DOM handles.
   */
  function extractFields() {
    const headings = collectHeadings();
    const notes = pageNotes();
    const pageUpper = UPPER_RE.test(notes);
    const all = [...document.querySelectorAll(CONTROL_SELECTOR)].filter((el) => !el.closest('[data-ditto-ui]'));
    const checkboxNameCount = new Map();
    for (const el of all) {
      if (el.type === 'checkbox' && el.name) {
        const k = `${formKey(el)}::${el.name}`;
        checkboxNameCount.set(k, (checkboxNameCount.get(k) || 0) + 1);
      }
    }

    const fields = [];
    const registry = new Map();
    const groups = new Map();
    let n = 0;
    const nextId = () => `d${++n}`;

    for (const el of all) {
      const tag = el.tagName.toLowerCase();
      const type = (tag === 'input' ? el.type || 'text' : tag).toLowerCase();
      if (el.disabled) continue;
      if (tag === 'input' && SKIP_INPUT_TYPES.has(type)) continue;

      if (type === 'radio' || (type === 'checkbox' && el.name && checkboxNameCount.get(`${formKey(el)}::${el.name}`) > 1)) {
        const lab = labelElementFor(el);
        if (!visible(el) && !(lab && visible(lab))) continue;
        const key = `${type}::${formKey(el)}::${el.name || el.id}`;
        let g = groups.get(key);
        if (!g) {
          g = { id: nextId(), kind: type === 'radio' ? 'radio' : 'checkbox-group', inputs: [] };
          groups.set(key, g);
          fields.push(g);
        }
        g.inputs.push(el);
        continue;
      }

      if (tag !== 'select' && el.readOnly) continue;
      const shown = visible(el) || (tag === 'select' && el.parentElement && visible(el.parentElement));
      if (!shown) continue;
      const kind = tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : type === 'checkbox' ? 'checkbox' : 'text';
      fields.push({ id: nextId(), kind, el, type });
    }

    const out = [];
    for (const f of fields) {
      let desc;
      if (f.inputs) {
        const label = groupQuestion(f.inputs);
        const options = f.inputs.map((i) => ({ text: optionLabel(i), value: i.value }));
        desc = { id: f.id, kind: f.kind, type: f.kind, label, name: f.inputs[0].name || '', options, hints: [] };
        desc.section = sectionFor(f.inputs[0], headings, label);
        registry.set(f.id, { kind: f.kind, els: f.inputs, options });
        f.inputs.forEach((i) => (i.dataset.dittoId = f.id));
      } else {
        const el = f.el;
        const { label, from } = labelFor(el);
        desc = { id: f.id, kind: f.kind, type: f.type, label, name: el.name || el.id || '', hints: hintsFor(el, f.kind, from, label) };
        desc.autocomplete = (el.getAttribute('autocomplete') || '').trim();
        desc.section = sectionFor(el, headings, label);
        const entry = { kind: f.kind, el, type: f.type };
        if (f.kind === 'text' || f.kind === 'textarea') {
          entry.upper = pageUpper || UPPER_RE.test(`${label} ${desc.section} ${desc.hints.join(' ')}`);
        }
        if (f.kind === 'select') {
          const options = [];
          [...el.options].forEach((o, index) => {
            const text = T.cleanText(o.text);
            if (o.disabled || (!o.value && /^(-+\s*)?(select|choose|pick|please|--)|^\s*$/i.test(text)) || (!o.value && index === 0)) return;
            options.push({ text, value: o.value, index });
          });
          desc.options = options.map((o) => ({ text: o.text, value: o.value }));
          entry.options = options;
          if (el.multiple) desc.hints.push('several allowed, separate with "; "');
        }
        if (f.kind === 'checkbox') desc.options = [];
        registry.set(f.id, entry);
        el.dataset.dittoId = f.id;
      }
      desc.skip = T.skipReason(desc);
      desc.sig = T.fieldSignature(desc);
      out.push(desc);
    }

    const page = {
      title: T.cleanText((document.querySelector('h1') && textOf(document.querySelector('h1'))) || document.title),
      host: location.host,
      url: location.origin + location.pathname,
      notes,
    };
    return { page, fields: out, registry };
  }

  D.extract = { extractFields, labelFor, groupQuestion, textOf, visible };
})();
