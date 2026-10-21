import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.Ditto = { text: require('../extension/lib/text.js') };
const L = require('../extension/lib/llm.js');

const profile = {
  rev: 3,
  vrev: 1,
  facts: [
    { key: 'Full name', value: 'Meera Krishnan Iyer', group: 'Identity' },
    { key: 'Date of birth', value: '2001-08-14', group: 'Identity' },
    { key: 'Nominee date of birth', value: '1968-03-02', group: 'Family' },
    { key: 'Mobile number', value: '+91 98450 12345', group: 'Contact' },
  ],
};

test('pair stream emits values as soon as each one completes', () => {
  const got = [];
  const feed = L.createPairStream((k, v) => got.push([k, v]));
  const doc = '{"values": {"d1": "MEERA \\"K\\" IYER", "d2": null, "d3": "14/08/2001"}, "unsure": ["d3"]}';
  for (let i = 0; i < doc.length; i += 3) feed(doc.slice(i, i + 3));
  assert.deepEqual(got, [
    ['d1', 'MEERA "K" IYER'],
    ['d2', null],
    ['d3', '14/08/2001'],
  ]);
});

test('pair stream ignores the unsure list and whitespace', () => {
  const got = [];
  const feed = L.createPairStream((k, v) => got.push([k, v]));
  feed('{\n  "values" : {\n    "d1" : "a" ,\n    "d2" : null\n  },\n  "unsure" : [ "d1" ]\n}');
  assert.deepEqual(got, [
    ['d1', 'a'],
    ['d2', null],
  ]);
});

test('fill schema requires every field id', () => {
  const s = L.buildFillSchema([{ id: 'd1' }, { id: 'd2' }]);
  assert.deepEqual(s.properties.values.required, ['d1', 'd2']);
  assert.deepEqual(s.properties.unsure.items.enum, ['d1', 'd2']);
});

test('derived facts compute age from the user (not the nominee) date of birth', () => {
  const facts = L.derivedFacts(profile, new Date(2026, 9, 21));
  assert.deepEqual(facts, [
    { key: "Today's date", value: '2026-10-21' },
    { key: 'Age in years', value: '25' },
  ]);
});

test('fill prompt lists profile, page notes and fields', () => {
  const msgs = L.buildFillMessages(profile, { title: 'Bank form', host: 'bank.example', notes: 'Use BLOCK LETTERS' }, [
    { id: 'd1', kind: 'text', type: 'text', label: 'Name', section: 'Nominee', hints: [] },
    { id: 'd2', kind: 'radio', label: 'Gender', options: [{ text: 'M' }, { text: 'F' }], hints: [] },
  ]);
  assert.equal(msgs[0].role, 'system');
  const user = msgs[1].content;
  assert.match(user, /- Full name: Meera Krishnan Iyer/);
  assert.match(user, /Page notes: Use BLOCK LETTERS/);
  assert.match(user, /\[d1\] Name \| text \| section: Nominee/);
  assert.match(user, /\[d2\] Gender \| radio: M \/ F/);
});

test('diffFacts proposes only real changes and reuses existing keys', () => {
  const changes = L.diffFacts(profile, [
    { key: 'Mobile Number', value: '+91 98450 12345', group: 'Contact' },
    { key: 'Mobile number', value: '+91 90000 00000', group: 'Contact' },
    { key: 'Blood group', value: 'B+', group: 'Health' },
    { key: '', value: 'x', group: 'Other' },
  ]);
  assert.deepEqual(changes, [{ op: 'add', key: 'Blood group', value: 'B+', group: 'Health' }]);
  const upd = L.diffFacts(profile, [{ key: 'Mobile number', value: '+91 90000 00000', group: 'Contact' }]);
  assert.equal(upd[0].op, 'update');
  assert.equal(upd[0].old, '+91 98450 12345');
});

test('applyFactChanges bumps vrev only when an existing value changes', () => {
  const added = L.applyFactChanges(profile, [{ op: 'add', key: 'Blood group', value: 'B+', group: 'Health' }]);
  assert.equal(added.rev, 4);
  assert.equal(added.vrev, 1);
  assert.equal(added.facts.length, 5);
  const updated = L.applyFactChanges(profile, [{ op: 'update', key: 'Mobile number', value: '+91 90000 00000' }]);
  assert.equal(updated.vrev, 2);
  assert.equal(updated.facts.find((f) => f.key === 'Mobile number').value, '+91 90000 00000');
});
