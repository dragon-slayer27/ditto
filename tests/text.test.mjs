import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const T = require('../extension/lib/text.js');

test('cleanText strips required markers and trailing colons', () => {
  assert.equal(T.cleanText('  PAN * '), 'PAN');
  assert.equal(T.cleanText('Name: *'), 'Name');
  assert.equal(T.cleanText('Date of Birth\n  (DD/MM/YYYY):'), 'Date of Birth (DD/MM/YYYY)');
});

test('humanize turns identifiers into words', () => {
  assert.equal(T.humanize('father_name'), 'father name');
  assert.equal(T.humanize('dateOfBirth'), 'date of birth');
});

test('parseDate understands common formats', () => {
  assert.deepEqual(T.parseDate('2001-08-14'), { y: 2001, m: 8, d: 14 });
  assert.deepEqual(T.parseDate('14/08/2001'), { y: 2001, m: 8, d: 14 });
  assert.deepEqual(T.parseDate('14 Aug 2001'), { y: 2001, m: 8, d: 14 });
  assert.deepEqual(T.parseDate('August 14, 2001'), { y: 2001, m: 8, d: 14 });
  assert.deepEqual(T.parseDate('04/05/2003', 'mdy'), { y: 2003, m: 4, d: 5 });
  assert.equal(T.parseDate('31/02/2001'), null);
  assert.equal(T.parseDate('not a date'), null);
});

test('ageOn handles birthdays not yet reached this year', () => {
  assert.equal(T.ageOn({ y: 2001, m: 8, d: 14 }, { y: 2026, m: 10, d: 21 }), 25);
  assert.equal(T.ageOn({ y: 2001, m: 12, d: 1 }, { y: 2026, m: 10, d: 21 }), 24);
});

test('matchOption picks exact, normalized and fuzzy matches', () => {
  const opts = ['+1 United States', '+91 India', 'Female', 'M', 'F', "Bachelor's degree", '10 - 25 Lakh'].map((t) => ({ text: t, value: t }));
  assert.deepEqual(T.matchOption('+91 India', opts), { index: 1, exact: true });
  assert.deepEqual(T.matchOption('female', opts), { index: 2, exact: true });
  assert.equal(T.matchOption('F', opts).index, 4);
  assert.equal(T.matchOption("Bachelors degree", opts).index, 5);
  assert.equal(T.matchOption('India', opts).index, 1);
  assert.equal(T.matchOption('Martian', opts).index, -1);
});

test('isSupported traces values back to the profile', () => {
  const ev = T.buildEvidence(['Meera Krishnan Iyer', '+91 98450 12345', '2001-08-14', '4821 7735 9012', 'Flat 302, Lakeview Residency, Bengaluru 560102']);
  assert.equal(T.isSupported('MEERA KRISHNAN IYER', ev).ok, true);
  assert.equal(T.isSupported('9845012345', ev).ok, true);
  assert.equal(T.isSupported('14/08/2001', ev).ok, true);
  assert.equal(T.isSupported('9012', ev).ok, true);
  assert.equal(T.isSupported('Flat 302, Lakeview Residency', ev).ok, true);
  const invented = T.isSupported('Z9999999', ev);
  assert.equal(invented.ok, false);
  assert.equal(T.isSupported('150000', ev).ok, false);
});

test('isSupported rejects small invented numbers but accepts ones the profile states', () => {
  const ev = T.buildEvidence(['3 years (since July 2023)', '56 kg', '12, Ganapathy Street', '25']);
  assert.equal(T.isSupported('3', ev).ok, true);
  assert.equal(T.isSupported('56', ev).ok, true);
  assert.equal(T.isSupported('12', ev).ok, true);
  assert.equal(T.isSupported('25', ev).ok, true);
  assert.equal(T.isSupported('1', ev).ok, false);
  assert.equal(T.isSupported('4', ev).ok, false);
});

test('skipReason protects consent, payment and essay fields', () => {
  assert.equal(T.skipReason({ kind: 'checkbox', label: 'I agree to the Code of Conduct' }), 'consent');
  assert.equal(T.skipReason({ kind: 'checkbox', label: 'Subscribe me to the newsletter' }), 'consent');
  assert.equal(T.skipReason({ kind: 'text', label: 'Card number', name: 'cc' }), 'sensitive');
  assert.equal(T.skipReason({ kind: 'text', label: 'Enter OTP' }), 'sensitive');
  assert.equal(T.skipReason({ kind: 'text', label: 'PIN Code' }), '');
  assert.equal(T.skipReason({ kind: 'text', label: 'Passport expiry date' }), '');
  assert.equal(T.skipReason({ kind: 'textarea', label: 'Why do you want to work here?' }), 'essay');
  assert.equal(T.skipReason({ kind: 'textarea', label: "Reason for today's visit" }), 'essay');
  assert.equal(T.skipReason({ kind: 'textarea', label: 'Home address' }), '');
});

test('fieldSignature is stable and sensitive to label and options', () => {
  const a = T.fieldSignature({ label: 'Gender', section: 'You', name: 'g', kind: 'select', options: [{ text: 'M' }, { text: 'F' }] });
  const b = T.fieldSignature({ label: 'Gender', section: 'You', name: 'g', kind: 'select', options: [{ text: 'M' }, { text: 'F' }] });
  const c = T.fieldSignature({ label: 'Gender', section: 'Nominee', name: 'g', kind: 'select', options: [{ text: 'M' }, { text: 'F' }] });
  assert.equal(a, b);
  assert.notEqual(a, c);
});
