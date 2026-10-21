/*
 * Prompt builders, JSON schemas and streaming helpers for talking to a local Gemma model.
 * Pure functions (no chrome.* / DOM) so they are unit-testable in Node.
 */
(function (root) {
  'use strict';

  const T = root.Ditto && root.Ditto.text ? root.Ditto.text : typeof require === 'function' ? require('./text.js') : null;

  const GROUPS = ['Identity', 'Family', 'Contact', 'Address', 'Work', 'Education', 'Documents', 'Health', 'Emergency contact', 'Preferences', 'Other'];
  const MAX_FIELDS_PER_REQUEST = 30;
  const LONG_OPTION_LIST = 40;

  // ---------- profile ----------
  function emptyProfile() {
    return { version: 1, rev: 0, vrev: 0, facts: [] };
  }

  function todayParts(now) {
    const d = now || new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  }

  function findDob(profile) {
    const fact = (profile.facts || []).find(
      (f) => /\b(date\s+of\s+birth|dob|birth\s*date|born\s+on)\b/i.test(f.key) && !/\b(nominee|father|mother|spouse|brother|sister|child|son|daughter|guardian|emergency|reference)\b/i.test(f.key),
    );
    return fact ? T.parseDate(fact.value) : null;
  }

  /** Facts Ditto computes itself (never asks the model to do date arithmetic it can get wrong). */
  function derivedFacts(profile, now) {
    const today = todayParts(now);
    const out = [{ key: "Today's date", value: T.formatYMD(today) }];
    const dob = findDob(profile);
    const age = T.ageOn(dob, today);
    if (age != null) out.push({ key: 'Age in years', value: String(age) });
    return out;
  }

  function profileBlock(profile, now) {
    const byGroup = new Map();
    for (const f of profile.facts || []) {
      if (!f || !String(f.key || '').trim() || String(f.value == null ? '' : f.value).trim() === '') continue;
      const g = GROUPS.includes(f.group) ? f.group : 'Other';
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(f);
    }
    const lines = [];
    for (const g of GROUPS) {
      const list = byGroup.get(g);
      if (!list) continue;
      lines.push(`## ${g}`);
      for (const f of list) lines.push(`- ${T.cleanText(f.key)}: ${String(f.value).replace(/\s*\n\s*/g, ', ').trim()}`);
    }
    lines.push('## Computed by Ditto');
    for (const f of derivedFacts(profile, now)) lines.push(`- ${f.key}: ${f.value}`);
    return lines.join('\n');
  }

  function profileEvidence(profile, now) {
    const values = (profile.facts || []).map((f) => f.value).concat(derivedFacts(profile, now).map((f) => f.value));
    return T.buildEvidence(values);
  }

  // ---------- fill ----------
  const FILL_SYSTEM = [
    'You are Ditto, a careful assistant that fills web forms for one person using ONLY their saved profile.',
    'For every field, decide the exact text to put in it.',
    'Rules:',
    '1. Use only facts from PROFILE. If the profile does not contain the answer, the value is null. Never guess or make up names, numbers, dates, IDs or links.',
    '2. Read each label together with its section. A name, phone, date of birth or relationship field inside a section about a nominee, emergency contact, guardian, reference or landlord is about THAT person, not the user.',
    '3. Follow the format the field asks for. Page notes apply to every field. BLOCK LETTERS or CAPITALS means uppercase; write dates exactly as DD/MM/YYYY or MM/DD/YYYY when shown; "last 4 digits" means only the last 4; "without country code" or a 10-digit mobile means drop the +91 or other country code; number fields get digits only, no currency symbols or commas.',
    '4. Fields of type date always take YYYY-MM-DD.',
    '5. For select and radio fields answer with one of the listed options exactly as written, or null if none fits. For long lists, answer with the plain name.',
    '6. For a checkbox answer "checked" or "unchecked". For a checkbox group answer every matching option separated by "; ".',
    '7. Split or combine profile facts when needed. For first, middle and last name fields: the first word of the full name is the first name, the last word is the last name, and any words in between are the middle name. Addresses split into house number, street, area, city, state and PIN code. Use the current address unless the label or section says permanent.',
    '8. When a field could take either of two facts (for example "college or company"), use the one that describes the person now: their current employer, current city, current address.',
    '9. Questions about this particular application (how they heard about it, referrals, start or move-in dates, team names, previous landlords, essays) are null unless the profile answers them directly.',
    '10. Put a field id in "unsure" when you calculated something, converted units, picked the closest option, or the field is ambiguous.',
    'Reply with JSON: {"values": {"<field id>": "<exact text to enter>" or null, ...}, "unsure": ["<field id>", ...]}. Include every field id, in the given order.',
  ].join('\n');

  /** Per-request schema: every field id is a required key, so the model can't skip or invent fields. */
  function buildFillSchema(fields) {
    const ids = fields.map((f) => f.id);
    return {
      type: 'object',
      properties: {
        values: {
          type: 'object',
          properties: Object.fromEntries(ids.map((id) => [id, { type: ['string', 'number', 'null'] }])),
          required: ids,
          additionalProperties: false,
        },
        unsure: { type: 'array', items: { type: 'string', enum: ids } },
      },
      required: ['values', 'unsure'],
      additionalProperties: false,
    };
  }

  function quote(s) {
    return `"${String(s).replace(/"/g, "'")}"`;
  }

  function describeField(f) {
    const parts = [`[${f.id}] ${T.cleanText(f.label) || '(no label)'}`];
    let kind = f.kind === 'text' ? f.type || 'text' : f.kind;
    if (f.kind === 'select' || f.kind === 'radio' || f.kind === 'checkbox-group') {
      const opts = (f.options || []).map((o) => T.cleanText(o.text)).filter(Boolean);
      if (opts.length > LONG_OPTION_LIST) kind = `${f.kind} (long list of ${opts.length} options, answer with the plain name)`;
      else kind = `${f.kind}: ${opts.join(' / ')}`;
    }
    parts.push(kind);
    if (f.section) parts.push(`section: ${T.cleanText(f.section)}`);
    if (f.hints && f.hints.length) parts.push(f.hints.join(', '));
    return parts.join(' | ');
  }

  function buildFillMessages(profile, page, fields, now) {
    const pageLines = [`FORM: ${quote(T.cleanText(page && page.title) || 'Untitled form')}${page && page.host ? ` on ${page.host}` : ''}`];
    if (page && page.notes) pageLines.push(`Page notes: ${T.cleanText(page.notes).slice(0, 400)}`);
    const user = ['PROFILE', profileBlock(profile, now), '', ...pageLines, '', 'FIELDS', ...fields.map(describeField)].join('\n');
    return [
      { role: 'system', content: FILL_SYSTEM },
      { role: 'user', content: user },
    ];
  }

  function chunkFields(fields, size) {
    const n = size || MAX_FIELDS_PER_REQUEST;
    const out = [];
    for (let i = 0; i < fields.length; i += n) out.push(fields.slice(i, i + n));
    return out;
  }

  // ---------- learn / import ----------
  const FACTS_SCHEMA = {
    type: 'object',
    properties: {
      facts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            value: { type: 'string' },
            group: { type: 'string', enum: GROUPS },
          },
          required: ['key', 'value', 'group'],
        },
      },
    },
    required: ['facts'],
  };

  const FACT_RULES = [
    'Each fact is {key, value, group}.',
    '- key: a short, general label that would make sense on any form (e.g. "Blood group", "Emergency contact phone", "Notice period", "Passport number").',
    '- value: the answer in a neutral format: normal capitalisation (not ALL CAPS), dates as YYYY-MM-DD, phone numbers with the country code when known.',
    '- If a fact updates something already in the profile, reuse EXACTLY the existing key.',
    '- If the fact is about another person (nominee, emergency contact, reference, parent), the key must say so (e.g. "Nominee name").',
    `- group is one of: ${GROUPS.join(', ')}.`,
  ].join('\n');

  const LEARN_SYSTEM = [
    "You maintain a person's private form-filling profile. They just typed answers into a web form by hand.",
    'Turn those answers into reusable facts that will help fill future forms.',
    FACT_RULES,
    'Skip anything that only makes sense for this one form: essays and opinions, how they heard about it, dates or IDs of this application, agreement or consent checkboxes, team names, yes/no questions about this specific application.',
    'Return {"facts": []} when nothing is worth keeping.',
  ].join('\n');

  const IMPORT_SYSTEM = [
    "You build a person's private form-filling profile from text they pasted (a resume, an old form, a bio or notes).",
    'Extract every fact that could help fill forms later: names, contact details, addresses, family members, work, education, ID numbers, health details, emergency contacts, preferences.',
    FACT_RULES,
    'Only include facts that are explicitly stated in the text. Do not guess. Summarise skills or languages as one comma-separated fact.',
  ].join('\n');

  function existingKeysLine(profile) {
    const keys = (profile.facts || []).map((f) => T.cleanText(f.key)).filter(Boolean);
    return keys.length ? keys.join('; ') : '(profile is empty)';
  }

  function buildLearnMessages(profile, page, answers) {
    const lines = answers.map((a) => `- ${a.section ? `[${T.cleanText(a.section)}] ` : ''}${T.cleanText(a.label) || '(no label)'}: ${String(a.value).trim()}`);
    const user = [
      `EXISTING PROFILE KEYS: ${existingKeysLine(profile)}`,
      `FORM: ${quote(T.cleanText(page && page.title) || 'Untitled form')}${page && page.host ? ` on ${page.host}` : ''}`,
      'ANSWERS THE PERSON TYPED',
      ...lines,
    ].join('\n');
    return [
      { role: 'system', content: LEARN_SYSTEM },
      { role: 'user', content: user },
    ];
  }

  function buildImportMessages(profile, text) {
    const user = [`EXISTING PROFILE KEYS: ${existingKeysLine(profile)}`, 'TEXT', String(text || '').slice(0, 12000)].join('\n');
    return [
      { role: 'system', content: IMPORT_SYSTEM },
      { role: 'user', content: user },
    ];
  }

  /** Compare proposed facts with the profile. Returns only real changes: [{op:'add'|'update', key, value, group, old}]. */
  function diffFacts(profile, facts) {
    const out = [];
    const seen = new Set();
    for (const raw of facts || []) {
      const key = T.cleanText(raw && raw.key);
      const value = String(raw && raw.value != null ? raw.value : '').trim();
      if (!key || !value) continue;
      const sq = T.squash(key);
      if (seen.has(sq)) continue;
      seen.add(sq);
      const group = GROUPS.includes(raw.group) ? raw.group : 'Other';
      const existing = (profile.facts || []).find((f) => T.squash(f.key) === sq);
      if (!existing) out.push({ op: 'add', key, value, group });
      else if (T.squash(existing.value) !== T.squash(value)) out.push({ op: 'update', key: existing.key, value, group: existing.group || group, old: existing.value });
    }
    return out;
  }

  function applyFactChanges(profile, changes) {
    const next = { ...profile, facts: (profile.facts || []).map((f) => ({ ...f })) };
    for (const c of changes || []) {
      const i = next.facts.findIndex((f) => T.squash(f.key) === T.squash(c.key));
      if (i >= 0) next.facts[i] = { ...next.facts[i], value: c.value, group: next.facts[i].group || c.group };
      else next.facts.push({ key: c.key, value: c.value, group: GROUPS.includes(c.group) ? c.group : 'Other' });
    }
    next.rev = (profile.rev || 0) + 1;
    // vrev only moves when an existing value changed, so answers Ditto already filled stay valid after additions.
    next.vrev = (profile.vrev || 0) + ((changes || []).some((c) => c.op === 'update') ? 1 : 0);
    return next;
  }

  // ---------- streaming ----------
  /**
   * Streams the text of {"values": {"d1": "...", "d2": null, ...}, "unsure": [...]} and calls
   * onPair(id, value) as soon as each value is complete, so Ditto can fill fields one by one.
   */
  function createPairStream(onPair) {
    const stack = [];
    let inString = false;
    let escaped = false;
    let raw = '';
    let key = null;
    let afterColon = false;
    let literal = '';
    let topKey = null;
    const inValues = () => stack.length === 2 && stack[1] === 'o' && topKey === 'values';

    function endString() {
      let s;
      try {
        s = JSON.parse(`"${raw}"`);
      } catch (_) {
        s = raw;
      }
      raw = '';
      if (stack.length === 1 && !afterColon) {
        topKey = s;
        return;
      }
      if (!inValues()) return;
      if (!afterColon) key = s;
      else {
        onPair(key, s);
        key = null;
        afterColon = false;
      }
    }

    function endLiteral() {
      if (!literal) return;
      if (inValues() && afterColon && key != null) {
        onPair(key, literal === 'null' ? null : literal);
        key = null;
        afterColon = false;
      }
      literal = '';
    }

    return function feed(chunk) {
      for (const ch of String(chunk || '')) {
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === '\\') escaped = true;
          else if (ch === '"') {
            inString = false;
            endString();
            continue;
          }
          raw += ch;
          continue;
        }
        if (ch === '"') {
          endLiteral();
          inString = true;
          raw = '';
        } else if (ch === ':') {
          endLiteral();
          afterColon = true;
        } else if (ch === ',') {
          endLiteral();
          afterColon = false;
        } else if (ch === '{' || ch === '[') {
          endLiteral();
          stack.push(ch === '{' ? 'o' : 'a');
          afterColon = false;
        } else if (ch === '}' || ch === ']') {
          endLiteral();
          stack.pop();
          afterColon = false;
        } else if (/\s/.test(ch)) {
          endLiteral();
        } else {
          literal += ch;
        }
      }
    };
  }

  const api = {
    GROUPS,
    MAX_FIELDS_PER_REQUEST,
    FILL_SYSTEM,
    FACTS_SCHEMA,
    emptyProfile,
    derivedFacts,
    profileBlock,
    profileEvidence,
    describeField,
    buildFillMessages,
    buildFillSchema,
    chunkFields,
    buildLearnMessages,
    buildImportMessages,
    diffFacts,
    applyFactChanges,
    createPairStream,
  };

  root.Ditto = root.Ditto || {};
  root.Ditto.llm = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
