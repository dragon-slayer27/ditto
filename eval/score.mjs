// Scoring rules for the Ditto eval (pure functions, unit-tested in tests/score.test.mjs).

export function norm(s) {
  return String(s == null ? '' : s)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.]+$/, '');
}

const digits = (s) => String(s == null ? '' : s).replace(/\D+/g, '');
const squash = (s) => norm(s).replace(/[^a-z0-9]+/g, '');
const normUrl = (s) => norm(s).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');

export function isEmpty(actual) {
  if (actual === false || actual == null) return true;
  if (Array.isArray(actual)) return actual.length === 0;
  return String(actual).trim() === '';
}

export function matches(spec, actual) {
  const exp = Array.isArray(spec.expect) ? spec.expect : [spec.expect];
  const a = Array.isArray(actual) ? actual : String(actual == null ? '' : actual);
  switch (spec.match || 'text') {
    case 'digits':
      return exp.some((e) => digits(a) === digits(e));
    case 'phone':
      return digits(a).length >= 10 && exp.some((e) => digits(a).slice(-10) === digits(e).slice(-10));
    case 'number':
      return exp.some((e) => Number(String(a).replace(/[,\s]/g, '')) === Number(e));
    case 'url':
      return exp.some((e) => normUrl(a) === normUrl(e));
    case 'squash':
      return exp.some((e) => squash(a) === squash(e));
    case 'contains':
      return (!spec.case || a === a.toUpperCase()) && exp.every((e) => norm(a).includes(norm(e)));
    case 'containsAny':
      return exp.some((e) => norm(a).includes(norm(e)));
    case 'containsN':
      return exp.filter((e) => norm(a).includes(norm(e))).length >= (spec.n || 1);
    case 'set': {
      const got = (Array.isArray(a) ? a : [a]).map(norm).sort();
      const want = exp.map(norm).sort();
      return got.length === want.length && got.every((g, i) => g === want[i]);
    }
    default:
      return exp.some((e) => (spec.case ? String(a).trim() === e : norm(a) === norm(e)));
  }
}

/**
 * outcome: correct | blank-ok | miss | wrong | overreach
 * A field "should be empty" when expect is null/false.
 */
export function scoreField(spec, actual, status) {
  const shouldBeEmpty = spec.expect === null || spec.expect === false;
  const empty = isEmpty(actual);
  let outcome;
  if (shouldBeEmpty) outcome = empty ? 'blank-ok' : 'overreach';
  else if (empty) outcome = spec.allowNull ? 'blank-ok' : 'miss';
  else outcome = matches(spec, actual) ? 'correct' : 'wrong';
  const green = status === 'filled' || status === 'remembered';
  const bad = outcome === 'wrong' || outcome === 'overreach';
  return { outcome, silent: bad && green, flagged: bad && status === 'check', cautious: outcome === 'correct' && status === 'check' };
}

export function summarize(rows) {
  const s = { fields: rows.length, correct: 0, blankOk: 0, miss: 0, wrong: 0, overreach: 0, silentWrong: 0, flaggedWrong: 0, cautious: 0 };
  for (const r of rows) {
    if (r.outcome === 'correct') s.correct++;
    if (r.outcome === 'blank-ok') s.blankOk++;
    if (r.outcome === 'miss') s.miss++;
    if (r.outcome === 'wrong') s.wrong++;
    if (r.outcome === 'overreach') s.overreach++;
    if (r.silent) s.silentWrong++;
    if (r.flagged) s.flaggedWrong++;
    if (r.cautious) s.cautious++;
  }
  s.right = s.correct + s.blankOk;
  s.accuracy = s.fields ? s.right / s.fields : 0;
  return s;
}
