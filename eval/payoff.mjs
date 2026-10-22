// "Lazy payoff": how long the five demo forms take by hand vs with Ditto.
// By hand: the Keystroke-Level Model (Card, Moran & Newell, 1980), the standard HCI method for
// estimating how long a skilled user takes to do a task with keyboard and mouse.
// With Ditto: the times measured in eval/results/gemma4-e4b.json plus a modelled review pass.
//   node eval/payoff.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './harness.mjs';

const r = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval', 'results', 'gemma4-e4b.json'), 'utf8'));

// KLM operators, seconds.
const K = 0.28; // one keystroke, average non-secretary typist (about 40 words per minute)
const P = 1.1; // point at something with the mouse
const BB = 0.2; // click (press + release)
const H = 0.4; // move a hand between mouse and keyboard
const M = 1.35; // mentally prepare / recall / decide
// Estimates (not KLM operators).
const LOOKUP = 15; // fetching something nobody knows by heart: a PAN card, policy number, profile URL
const GLANCE = 0.5; // glancing at a green field Ditto filled
const CHECK = M + 1; // actually checking an amber field

const CHOICE = new Set(['phoneCountry', 'country', 'notice', 'degree', 'gender', 'authorized', 'sponsorship', 'rdoGender', 'ddlMarital', 'ddlOccupation', 'ddlIncome', 'ddlPermState', 'rdoSameAddr', 'sex', 'bloodGroup', 'smoke', 'alcohol', 'pets', 'parking', 'food', 'role', 'tshirt', 'diet']);
const RADIO = new Set(['authorized', 'sponsorship', 'rdoGender', 'rdoSameAddr', 'sex', 'smoke', 'food', 'tshirt']);
const LOOKUPS = new Set(['bank:txtPAN', 'bank:txtAadhaar', 'rental:pan', 'clinic:policy', 'rental:vehicleNumber', 'job:linkedin', 'job:website', 'hackathon:github', 'hackathon:linkedin']);
// Fields where a person also has to work something out (income bracket from salary, age from birthday).
const THINK = new Set(['bank:ddlIncome', 'clinic:age']);

const nameOf = (sel) => sel.replace(/^\[name=|\]$/g, '');

function manual(form, row) {
  const name = nameOf(row.sel);
  const key = `${form}:${name}`;
  let mouse;
  let keys;
  if (Array.isArray(row.actual)) {
    // checkbox group: read the list, tick each matching box
    mouse = M + row.actual.length * (P + BB);
    keys = M + row.actual.length * 2 * K;
  } else if (RADIO.has(name)) {
    mouse = M + P + BB;
    keys = M + 2 * K; // Tab, then arrow/space
  } else if (CHOICE.has(name)) {
    mouse = M + P + BB + M + P + BB; // open the dropdown, find and pick the option
    keys = M + K + 3 * K; // Tab, type a few letters
  } else {
    const n = String(row.actual).length;
    mouse = M + P + BB + H + n * K + H;
    keys = M + K + n * K; // Tab, type
  }
  const extra = (LOOKUPS.has(key) ? LOOKUP : 0) + (THINK.has(key) ? M : 0);
  return { mouse: mouse + extra, keys: keys + extra, chars: Array.isArray(row.actual) || CHOICE.has(name) ? 0 : String(row.actual).length };
}

const fmt = (s) => {
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const t = Math.round(s);
  return `${Math.floor(t / 60)} min ${String(t % 60).padStart(2, '0')} s`;
};
const out = [];
const totals = { low: 0, high: 0, chars: 0, fields: 0, choices: 0, human: 0, hands: 0, first: 0, again: 0 };
out.push('| Form | Fields Ditto fills | By hand (keyboard only to mouse + keyboard) | With Ditto: your hands-on time | With Ditto: first fill, wall clock | Same form again |');
out.push('|---|---|---|---|---|---|');
for (const [form, f] of Object.entries(r.forms)) {
  const rows = r.rows.filter((x) => x.form === form);
  let low = 0;
  let high = 0;
  let review = M + 3 * K; // press the shortcut
  let filled = 0;
  for (const row of rows) {
    const human = row.outcome === 'blank-ok' || row.outcome === 'overreach';
    if (human) {
      totals.human++;
      // Needed by a human either way; if Ditto put a guess there, the person also has to clear it.
      if (row.outcome === 'overreach') review += CHECK + 2 * K;
      continue;
    }
    const m = manual(form, row);
    low += m.keys;
    high += m.mouse;
    totals.chars += m.chars;
    if (!m.chars) totals.choices++;
    filled++;
    review += row.status === 'check' ? CHECK : GLANCE;
  }
  const first = f.ms / 1000 + review;
  const again = (f.memoryMs || 0) / 1000 + review;
  Object.assign(totals, { low: totals.low + low, high: totals.high + high, fields: totals.fields + filled, hands: totals.hands + review, first: totals.first + first, again: totals.again + again });
  out.push(`| ${form} | ${filled} | ${fmt(low)} to ${fmt(high)} | ${fmt(review)} | ${fmt(first)} | ${fmt(again)} |`);
}
out.push(`| **all five** | **${totals.fields}** | **${fmt(totals.low)} to ${fmt(totals.high)}** | **${fmt(totals.hands)}** | **${fmt(totals.first)}** | **${fmt(totals.again)}** |`);

const md = [
  '# Lazy payoff',
  '',
  `Ditto filled ${totals.fields} fields across the five demo forms: ${totals.chars} typed characters and ${totals.choices} dropdown, radio and checkbox choices. ${totals.human} more fields need a person either way (essays, consent, questions the profile can't answer) and are left out of both columns.`,
  '',
  ...out,
  '',
  '**By hand** uses the Keystroke-Level Model (Card, Moran & Newell, 1980): keystroke 0.28 s (about 40 wpm), point 1.1 s, click 0.2 s, hand between mouse and keyboard 0.4 s, recall/decide 1.35 s per field. The low end assumes you Tab through the form; the high end assumes you click into each field. Both add an estimated 15 s for each value nobody knows by heart (PAN, Aadhaar, policy and vehicle numbers, profile URLs). Typos, corrections and switching to another tab to copy your address are not counted, so real numbers are higher.',
  '',
  '**With Ditto**: "hands-on" is pressing the shortcut, a 0.5 s glance at each green field, about 2.35 s to check each amber field, and clearing the two wrong guesses. "First fill" adds the measured fill time from the eval (Gemma 4 E4B on a laptop CPU), which you can spend doing something else. "Same form again" uses the measured page-memory fill.',
  '',
];
fs.writeFileSync(path.join(ROOT, 'eval', 'results', 'payoff.md'), md.join('\n'));
console.log(md.join('\n'));
console.log(JSON.stringify({ low: totals.low, high: totals.high, hands: totals.hands, first: totals.first, again: totals.again }));
