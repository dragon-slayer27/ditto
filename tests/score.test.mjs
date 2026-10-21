import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matches, scoreField, summarize } from '../eval/score.mjs';

test('matching modes', () => {
  assert.ok(matches({ expect: 'Meera' }, ' meera '));
  assert.ok(!matches({ expect: 'MEERA', case: true }, 'Meera'));
  assert.ok(matches({ match: 'phone', expect: '9845012345' }, '+91 98450 12345'));
  assert.ok(matches({ match: 'number', expect: '1800000' }, '18,00,000'));
  assert.ok(matches({ match: 'url', expect: 'https://github.com/meera-builds' }, 'github.com/meera-builds/'));
  assert.ok(matches({ match: 'contains', expect: ['302', 'lakeview'] }, 'Flat 302, Lakeview Residency'));
  assert.ok(!matches({ match: 'contains', case: true, expect: ['302', 'LAKEVIEW'] }, 'Flat 302, Lakeview'));
  assert.ok(matches({ match: 'containsN', n: 2, expect: ['react', 'aws', 'go'] }, 'React, AWS'));
  assert.ok(matches({ match: 'set', expect: ['Asthma'] }, ['asthma']));
  assert.ok(matches({ match: 'squash', expect: 'KA01HX4821' }, 'KA-01-HX-4821'));
});

test('outcomes and silent errors', () => {
  assert.equal(scoreField({ expect: null }, '', 'needs').outcome, 'blank-ok');
  assert.equal(scoreField({ expect: false }, false, 'needs').outcome, 'blank-ok');
  const over = scoreField({ expect: null }, '150000', 'filled');
  assert.equal(over.outcome, 'overreach');
  assert.equal(over.silent, true);
  const flagged = scoreField({ expect: 'X' }, 'Y', 'check');
  assert.equal(flagged.outcome, 'wrong');
  assert.equal(flagged.flagged, true);
  assert.equal(scoreField({ expect: 'X' }, '', 'needs').outcome, 'miss');
  assert.equal(scoreField({ expect: 'X', allowNull: true }, '', 'needs').outcome, 'blank-ok');
  const s = summarize([over, flagged, scoreField({ expect: 'X' }, 'x', 'filled')]);
  assert.equal(s.right, 1);
  assert.equal(s.silentWrong, 1);
  assert.equal(s.flaggedWrong, 1);
});
