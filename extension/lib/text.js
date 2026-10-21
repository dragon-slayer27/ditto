/*
 * Ditto shared helpers. Pure functions only (no DOM, no chrome.*), so the same file runs in the
 * service worker (importScripts), in content scripts (scripting.executeScript) and in Node tests.
 */
(function (root) {
  'use strict';

  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const MONTH_TOKENS = new Set(MONTHS.concat(MONTHS.map((m) => m.slice(0, 3)), ['sept']));
  // Small connective words that can appear when the model composes a value (e.g. joins an address).
  const FILLER_TOKENS = new Set(['and', 'the', 'of', 'with', 'for', 'near', 'opp', 'via', 'none', 'nil', 'not', 'applicable']);

  function cleanText(s) {
    return String(s == null ? '' : s)
      .replace(/[\u00a0\s]+/g, ' ')
      .replace(/(\s*[:*\uFF1A])+\s*$/, '')
      .replace(/^\s*[*]+\s*/, '')
      .trim();
  }

  // "father_name" -> "father name", "dateOfBirth" -> "date of birth"
  function humanize(id) {
    return String(id || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_\-.[\]]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function normalize(s) {
    return String(s == null ? '' : s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function tokens(s) {
    return normalize(s).match(/[a-z]+|\d+/g) || [];
  }

  function digitsOnly(s) {
    return String(s == null ? '' : s).replace(/\D+/g, '');
  }

  function squash(s) {
    return normalize(s).replace(/[^a-z0-9]+/g, '');
  }

  // ---------- dates ----------
  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function isValidYMD(y, m, d) {
    if (!(y >= 1000 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  function monthFromName(name) {
    const n = normalize(name).slice(0, 3);
    const i = MONTHS.findIndex((m) => m.startsWith(n));
    return i >= 0 ? i + 1 : 0;
  }

  /**
   * Parse a date written in a common format. Returns {y, m, d} or null.
   * order: 'dmy' (default, used outside the US) or 'mdy' for ambiguous numeric dates like 04/05/2003.
   */
  function parseDate(input, order) {
    const s = String(input == null ? '' : input).trim();
    if (!s) return null;
    let m;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/))) {
      const r = { y: +m[1], m: +m[2], d: +m[3] };
      return isValidYMD(r.y, r.m, r.d) ? r : null;
    }
    if ((m = s.match(/^(\d{1,2})[-/.\s](\d{1,2})[-/.\s](\d{4})$/))) {
      const a = +m[1];
      const b = +m[2];
      const y = +m[3];
      let r;
      if (order === 'mdy') r = isValidYMD(y, a, b) ? { y, m: a, d: b } : isValidYMD(y, b, a) ? { y, m: b, d: a } : null;
      else r = isValidYMD(y, b, a) ? { y, m: b, d: a } : isValidYMD(y, a, b) ? { y, m: a, d: b } : null;
      return r;
    }
    if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s\-/.,]+([A-Za-z]{3,9})[\s\-/.,]+(\d{4})$/))) {
      const r = { y: +m[3], m: monthFromName(m[2]), d: +m[1] };
      return isValidYMD(r.y, r.m, r.d) ? r : null;
    }
    if ((m = s.match(/^([A-Za-z]{3,9})[\s\-/.]+(\d{1,2})(?:st|nd|rd|th)?,?[\s\-/.]+(\d{4})$/))) {
      const r = { y: +m[3], m: monthFromName(m[1]), d: +m[2] };
      return isValidYMD(r.y, r.m, r.d) ? r : null;
    }
    return null;
  }

  function formatYMD(d) {
    return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : '';
  }

  // Finds every date-looking substring in free text and returns canonical YYYY-MM-DD strings.
  function extractDates(text) {
    const out = new Set();
    const s = String(text == null ? '' : text);
    const patterns = [
      /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g,
      /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{4}\b/g,
      /\b\d{1,2}(?:st|nd|rd|th)?[\s\-/.,]+[A-Za-z]{3,9}[\s\-/.,]+\d{4}\b/g,
      /\b[A-Za-z]{3,9}[\s\-/.]+\d{1,2}(?:st|nd|rd|th)?,?[\s\-/.]+\d{4}\b/g,
    ];
    for (const re of patterns) {
      for (const hit of s.match(re) || []) {
        for (const order of ['dmy', 'mdy']) {
          const d = parseDate(hit, order);
          if (d) out.add(formatYMD(d));
        }
      }
    }
    return out;
  }

  function ageOn(dob, today) {
    if (!dob || !today) return null;
    let age = today.y - dob.y;
    if (today.m < dob.m || (today.m === dob.m && today.d < dob.d)) age -= 1;
    return age >= 0 && age < 150 ? age : null;
  }

  // ---------- option matching ----------
  /**
   * Pick the option that best matches a model answer.
   * options: [{text, value}]. Returns {index, exact} (index -1 when nothing fits).
   */
  function matchOption(answer, options) {
    const raw = cleanText(answer);
    if (!raw || !Array.isArray(options) || !options.length) return { index: -1, exact: false };
    const a = normalize(raw).trim();
    const aSq = squash(raw);
    for (let i = 0; i < options.length; i++) {
      if (cleanText(options[i].text) === raw || String(options[i].value) === raw) return { index: i, exact: true };
    }
    for (let i = 0; i < options.length; i++) {
      if (normalize(cleanText(options[i].text)).trim() === a || normalize(options[i].value).trim() === a) return { index: i, exact: true };
    }
    if (aSq) {
      for (let i = 0; i < options.length; i++) {
        if (squash(options[i].text) === aSq || squash(options[i].value) === aSq) return { index: i, exact: true };
      }
    }
    // Prefix / containment (e.g. "Female" vs "F", "+91" vs "+91 (India)")
    let best = -1;
    let bestScore = 0;
    const aTokens = new Set(tokens(raw));
    for (let i = 0; i < options.length; i++) {
      const oSq = squash(options[i].text);
      if (!oSq) continue;
      let score = 0;
      if (aSq && (oSq.startsWith(aSq) || aSq.startsWith(oSq))) score = 0.8 * Math.min(oSq.length, aSq.length) / Math.max(oSq.length, aSq.length) + 0.2;
      const oTokens = new Set(tokens(options[i].text));
      if (oTokens.size && aTokens.size) {
        let inter = 0;
        for (const t of aTokens) if (oTokens.has(t)) inter++;
        const jaccard = inter / (aTokens.size + oTokens.size - inter);
        score = Math.max(score, jaccard);
      }
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return bestScore >= 0.5 ? { index: best, exact: false } : { index: -1, exact: false };
  }

  // ---------- hallucination tripwire ----------
  /** Build an index of everything the profile actually says, so filled values can be traced back to it. */
  function buildEvidence(values) {
    const list = (values || []).map((v) => String(v == null ? '' : v));
    const text = normalize(list.join(' \n '));
    const tokenSet = new Set(tokens(text));
    const digitStrings = list.map(digitsOnly).filter((d) => d.length > 0);
    const dates = new Set();
    for (const v of list) for (const d of extractDates(v)) dates.add(d);
    return { text, tokenSet, digitStrings, dates };
  }

  /**
   * Is every meaningful piece of `value` present somewhere in the profile evidence?
   * Returns {ok, unsupported: [...]}. Connective words are allowed; short numbers must appear on their own.
   */
  function isSupported(value, evidence) {
    const v = String(value == null ? '' : value).trim();
    if (!v || !evidence) return { ok: true, unsupported: [] };
    for (const order of ['dmy', 'mdy']) {
      const d = parseDate(v, order);
      if (d && evidence.dates.has(formatYMD(d))) return { ok: true, unsupported: [] };
    }
    const unsupported = [];
    const vDigits = digitsOnly(v);
    const digitRunsOk = vDigits.length >= 3 && evidence.digitStrings.some((ds) => ds.includes(vDigits));
    for (const t of tokens(v)) {
      if (/^\d+$/.test(t)) {
        if (digitRunsOk) continue;
        // Short numbers (counts, ages, years) must appear as a standalone number somewhere in the profile.
        if (t.length < 3) {
          if (!evidence.tokenSet.has(t) && !evidence.tokenSet.has(String(Number(t)))) unsupported.push(t);
          continue;
        }
        if (evidence.digitStrings.some((ds) => ds.includes(t))) continue;
        unsupported.push(t);
      } else {
        if (t.length < 3 || FILLER_TOKENS.has(t) || MONTH_TOKENS.has(t)) continue;
        if (evidence.tokenSet.has(t)) continue;
        // allow simple plural/singular drift ("years" vs "year")
        if (t.endsWith('s') && evidence.tokenSet.has(t.slice(0, -1))) continue;
        if (evidence.tokenSet.has(t + 's')) continue;
        unsupported.push(t);
      }
    }
    return { ok: unsupported.length === 0, unsupported };
  }

  // ---------- field signature (for site memory) ----------
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  function fieldSignature(f) {
    const opts = (f.options || []).map((o) => squash(o.text)).join('|');
    return fnv1a([squash(f.label), squash(f.section), squash(f.name), f.kind, f.type || '', opts].join('#'));
  }

  // ---------- skip rules ----------
  const SENSITIVE_RE = /\b(cvv|cvc|card\s*(number|no\.?)|name\s+on\s+(the\s+)?card|otp|one[\s-]*time\s*pass(word|code)?|captcha|verification\s*code|security\s*code|(atm|card|upi)\s*pin)\b/i;
  const CONSENT_RE = /\b(i\s+agree|agree\s+to|consent|i\s+accept|accept\s+the|certify|hereby|declare|declaration|confirm\s+that|acknowledge|authori[sz]e|terms|privacy\s+policy|code\s+of\s+conduct|subscribe|newsletter|marketing|promotional)\b/i;
  const ESSAY_RE = /\b(why\s+(do|would|are|should)|describe|tell\s+us|cover\s+letter|motivation|what\s+(do\s+you\s+want|would\s+you|makes\s+you)|explain|statement\s+of\s+purpose|anything\s+else|additional\s+(information|comments|details)|reason\s+for\s+(today'?s?|your|the|this)\s+(visit|appointment)|what\s+do\s+you\s+(want|hope|plan)\s+to\s+build)\b/i;

  function skipReason(f) {
    const text = `${f.label || ''} ${f.name || ''} ${f.autocomplete || ''}`;
    if (/^cc-/.test(f.autocomplete || '') || SENSITIVE_RE.test(text) || (/expir/i.test(text) && /card/i.test(`${text} ${f.section || ''}`))) {
      return 'sensitive';
    }
    if (f.kind === 'checkbox' && CONSENT_RE.test(f.label || '')) return 'consent';
    if (f.kind === 'textarea' && ESSAY_RE.test(f.label || '')) return 'essay';
    return '';
  }

  // Chrome reports shortcuts like "Alt+Shift+Period"; show keys the way they're printed on the keyboard.
  function prettyShortcut(s) {
    const keys = { Period: '.', Comma: ',' };
    return String(s || '')
      .split('+')
      .map((k) => keys[k] || k)
      .join('+');
  }

  const api = {
    MONTHS,
    cleanText,
    humanize,
    normalize,
    tokens,
    digitsOnly,
    squash,
    parseDate,
    formatYMD,
    extractDates,
    ageOn,
    matchOption,
    buildEvidence,
    isSupported,
    fnv1a,
    fieldSignature,
    skipReason,
    prettyShortcut,
  };

  root.Ditto = root.Ditto || {};
  root.Ditto.text = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
