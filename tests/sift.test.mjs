import { test, assert } from './harness.mjs';
import {
  parse, parseTable, sniffDelimiter, inferType, profileColumn, profile,
  toNumber, toDate, toBoolean, topValues, histogram,
  sortIndices, tokenize, compileFilter, filterIndices, sampleCSV, isBlank,
} from '../apps/sift/engine.js';

const fields = (text, opts) => parse(text, opts).rows;

/* ── the cases split(',') gets wrong ─────────────────────────────────────── */

test('a comma inside a quoted field is not a column break', () => {
  /* The single most common data bug in working software. It silently
     truncates the row, the row count still looks right, and nobody notices
     until a customer asks where half their address went. */
  assert.deep(fields('a,"b,c",d'), [['a', 'b,c', 'd']]);
  assert.deep(fields('"Smith, John",42'), [['Smith, John', '42']]);
});

test('a doubled quote inside a quoted field is one quote', () => {
  assert.deep(fields('a,"he said ""hi""",b'), [['a', 'he said "hi"', 'b']]);
  assert.deep(fields('"""quoted"""'), [['"quoted"']]);
  assert.deep(fields('""'), [['']], 'an empty quoted field is an empty string');
});

test('a newline inside a quoted field stays inside the row', () => {
  assert.deep(fields('a,"line one\nline two",c'), [['a', 'line one\nline two', 'c']]);
  assert.deep(fields('"x\r\ny",z'), [['x\r\ny', 'z']]);
});

test('a quote in the middle of an unquoted field is just a character', () => {
  // 5" nails, 30" monitor — this is real data, not a malformed file
  assert.deep(fields('30" monitor,2'), [['30" monitor', '2']]);
});

/* ── line endings, and the phantom row ───────────────────────────────────── */

test('CRLF, LF and bare CR all end a row exactly once', () => {
  assert.deep(fields('a,b\r\nc,d'), [['a', 'b'], ['c', 'd']]);
  assert.deep(fields('a,b\nc,d'), [['a', 'b'], ['c', 'd']]);
  assert.deep(fields('a,b\rc,d'), [['a', 'b'], ['c', 'd']]);
});

test('a trailing newline does not invent an empty row', () => {
  /* Almost every file ends with one. A parser that adds a row for it reports
     one more record than exists, and every count downstream is off by one. */
  assert.equal(fields('a,b\nc,d\n').length, 2);
  assert.equal(fields('a,b\nc,d\r\n').length, 2);
  assert.equal(fields('a,b\nc,d').length, 2);
});

test('a blank line in the middle is a row, not the end of the file', () => {
  assert.deep(fields('a\n\nb'), [['a'], [''], ['b']]);
});

test('a byte-order mark does not become part of the first column name', () => {
  // Excel writes one. Without this the first header is "﻿id" and every
  // lookup of "id" fails for reasons nobody can see on screen.
  const t = parseTable('﻿id,name\n1,Ada');
  assert.equal(t.columns[0], 'id');
});

test('empty input is an empty table rather than a crash', () => {
  for (const v of ['', null, undefined, 7, {}]) {
    const t = parseTable(v);
    assert.deep(t.columns, []);
    assert.deep(t.rows, []);
  }
});

/* ── the header ──────────────────────────────────────────────────────────── */

test('duplicate column names are made distinct instead of shadowing', () => {
  const t = parseTable('name,name,name\n1,2,3');
  assert.deep(t.columns, ['name', 'name (2)', 'name (3)']);
  assert.deep(t.rows[0], ['1', '2', '3']);
});

test('an unnamed column still gets a handle', () => {
  const t = parseTable('id,,total\n1,x,2');
  assert.equal(t.columns[1], 'column 2');
});

test('a ragged row is padded and counted, not dropped', () => {
  /* Dropping it throws away somebody's record over a stray delimiter. Keeping
     it quietly is worse. It is kept, reshaped, and reported. */
  const t = parseTable('a,b,c\n1,2,3\n4,5\n6,7,8,9');
  assert.equal(t.rows.length, 3);
  assert.deep(t.rows[1], ['4', '5', '']);
  assert.deep(t.rows[2], ['6', '7', '8']);
  assert.equal(t.ragged, 2);
});

test('limit stops early and says so', () => {
  const r = parse('a\nb\nc\nd\ne', { limit: 3 });
  assert.equal(r.rows.length, 3);
  assert.equal(r.truncated, true);
  assert.equal(parse('a\nb', { limit: 9 }).truncated, false);
});

/* ── working out the delimiter ───────────────────────────────────────────── */

test('tabs, semicolons and pipes are found as readily as commas', () => {
  assert.equal(sniffDelimiter('a\tb\tc\n1\t2\t3\n4\t5\t6'), '\t');
  assert.equal(sniffDelimiter('a;b;c\n1;2;3\n4;5;6'), ';');
  assert.equal(sniffDelimiter('a|b|c\n1|2|3\n4|5|6'), '|');
  assert.equal(sniffDelimiter('a,b,c\n1,2,3\n4,5,6'), ',');
});

test('a comma inside a semicolon-separated file does not win', () => {
  /* Guessing from the header alone gets this wrong. Consistency across rows
     is what tells them apart. */
  const csv = 'name;note\nAda;"born 1815, London"\nAlan;"born 1912, London"\nGrace;"born 1906, New York"';
  assert.equal(sniffDelimiter(csv), ';');
  const t = parseTable(csv);
  assert.equal(t.columns.length, 2);
  assert.equal(t.rows[0][1], 'born 1815, London');
});

/* ── reading values ──────────────────────────────────────────────────────── */

test('numbers, including the ones with separators in', () => {
  assert.equal(toNumber('42'), 42);
  assert.equal(toNumber('-3.5'), -3.5);
  assert.equal(toNumber('1,234'), 1234);
  assert.equal(toNumber('1,234,567.89'), 1234567.89);
  assert.equal(toNumber(' 8 '), 8);
  assert.equal(toNumber('1e3'), 1000);
  for (const v of ['', '   ', 'abc', null, undefined, '-', '.', '12abc']) {
    assert.ok(Number.isNaN(toNumber(v)), `toNumber(${JSON.stringify(v)}) should be NaN`);
  }
});

test('dates are read only when they are unambiguous', () => {
  /* new Date('03/04/2025') is March in the US and April almost everywhere
     else. Picking one silently makes half the world's data wrong by up to
     eleven months, so anything that is not ISO stays text. */
  assert.ok(Number.isFinite(toDate('2026-03-04')));
  assert.ok(Number.isFinite(toDate('2026-03-04T11:30:00Z')));
  assert.ok(Number.isFinite(toDate('2026-03-04 11:30')));
  for (const v of ['03/04/2026', '4 March 2026', 'Mar 4 2026', '2026/03/04', '']) {
    assert.ok(Number.isNaN(toDate(v)), `${v} should not be read as a date`);
  }
  assert.equal(toDate('2026-01-02'), Date.UTC(2026, 0, 2), 'a bare date is midnight UTC, not local');
});

test('booleans, in the spellings people actually use', () => {
  for (const v of ['true', 'TRUE', 'yes', 'Y', 't']) assert.equal(toBoolean(v), true, v);
  for (const v of ['false', 'No', 'n', 'F']) assert.equal(toBoolean(v), false, v);
  for (const v of ['maybe', '1', '0', '']) assert.equal(toBoolean(v), null, v);
});

test('blank means blank, and zero does not', () => {
  assert.ok(isBlank(''));
  assert.ok(isBlank('   '));
  assert.ok(isBlank(null));
  assert.ok(isBlank(undefined));
  assert.ok(!isBlank('0'), 'zero is a value, not a gap');
  assert.ok(!isBlank('false'));
});

/* ── working out what a column is ────────────────────────────────────────── */

test('the obvious columns come out right', () => {
  assert.equal(inferType(['1', '2', '3']).type, 'integer');
  assert.equal(inferType(['1.5', '2.25', '-3']).type, 'decimal');
  assert.equal(inferType(['2026-01-01', '2026-06-30']).type, 'date');
  assert.equal(inferType(['true', 'false', 'true']).type, 'boolean');
  assert.equal(inferType(['red', 'green', 'red', 'green', 'red', 'blue']).type, 'category');
  assert.equal(inferType(['a7Xq', 'k2Lm', 'zz91', 'Q4rT', 'ppLo', 'ee12']).type, 'text');
});

test('a column of ones and zeroes stays a number', () => {
  /* It is far more often a count or a flag people want to add up than a
     true/false, and turning it into booleans loses the sum. */
  assert.equal(inferType(['1', '0', '1', '1', '0']).type, 'integer');
});

test('one bad cell does not demote a numeric column, but it is reported', () => {
  const values = [...Array(200).keys()].map(String);
  values[73] = 'n/a';
  const t = inferType(values);
  assert.equal(t.type, 'integer');
  assert.equal(t.bad, 1, 'the cell that did not fit has to be counted');
  assert.ok(t.confidence > 0.99 && t.confidence < 1);
});

test('a column that is half numbers is text, not a number', () => {
  const values = [...Array(50).keys()].map((i) => (i % 2 ? String(i) : `id-${i}`));
  assert.ok(inferType(values).type !== 'integer');
});

test('blanks are counted separately and never decide the type', () => {
  const t = inferType(['1', '', '  ', '2', null, '3']);
  assert.equal(t.type, 'integer');
  assert.equal(t.blanks, 3);
  assert.equal(t.bad, 0);
  assert.equal(t.total, 6);
});

test('a column with nothing in it does not divide by zero', () => {
  const t = inferType(['', '   ', null]);
  assert.equal(t.type, 'text');
  assert.equal(t.confidence, 0);
  assert.equal(t.blanks, 3);
});

/* ── the numbers about the numbers ───────────────────────────────────────── */

test('the summary statistics are the right ones', () => {
  const c = profileColumn(['1', '2', '3', '4', '5', '', '100']);
  assert.equal(c.type, 'integer');
  assert.equal(c.stats.n, 6);
  assert.equal(c.stats.min, 1);
  assert.equal(c.stats.max, 100);
  assert.equal(c.stats.sum, 115);
  assert.close(c.stats.mean, 115 / 6, 1e-9);
  assert.close(c.stats.median, 3.5, 1e-9);
  assert.equal(c.blanks, 1);
});

test('the median of an even and an odd count', () => {
  assert.close(profileColumn(['1', '2', '3']).stats.median, 2, 1e-9);
  assert.close(profileColumn(['1', '2', '3', '4']).stats.median, 2.5, 1e-9);
});

test('a single value has no spread rather than a NaN', () => {
  const c = profileColumn(['5']);
  assert.equal(c.stats.sd, 0);
  assert.equal(c.stats.median, 5);
  assert.equal(c.stats.p95, 5);
});

test('every value lands in exactly one histogram bucket', () => {
  /* The maximum is the one that gets lost: (max-min)/width is exactly the
     bucket count, which is one past the end of the array. */
  const nums = [...Array(500).keys()].map((i) => i * 0.37);
  const h = histogram(nums);
  assert.equal(h.reduce((a, b) => a + b.count, 0), nums.length);
  const flat = histogram([4, 4, 4]);
  assert.equal(flat.length, 1, 'a column with one distinct value is one bucket, not a division by zero');
  assert.equal(flat[0].count, 3);
  assert.deep(histogram([]), []);
});

test('the top values are the commonest, biggest first', () => {
  const t = topValues(['a', 'b', 'a', 'c', 'a', 'b', '', '  ']);
  assert.deep(t, [{ value: 'a', count: 3 }, { value: 'b', count: 2 }, { value: 'c', count: 1 }]);
});

test('a date column reports the range it covers', () => {
  const c = profileColumn(['2026-03-04', '2026-01-01', '2026-12-31']);
  assert.equal(c.type, 'date');
  assert.equal(c.stats.min, Date.UTC(2026, 0, 1));
  assert.equal(c.stats.max, Date.UTC(2026, 11, 31));
});

/* ── sorting ─────────────────────────────────────────────────────────────── */

const rows = [['b', '10'], ['a', '9'], ['c', ''], ['d', '100']];

test('a numeric column sorts as numbers, not as text', () => {
  // the bug this catches: "100" < "9" is true for strings
  const out = sortIndices(rows, 1, { type: 'integer', dir: 1 }).map((i) => rows[i][1]);
  assert.deep(out, ['9', '10', '100', '']);
});

test('blanks sink to the bottom whichever way you sort', () => {
  const up = sortIndices(rows, 1, { type: 'integer', dir: 1 });
  const down = sortIndices(rows, 1, { type: 'integer', dir: -1 });
  assert.equal(rows[up[up.length - 1]][1], '');
  assert.equal(rows[down[down.length - 1]][1], '',
    'sorting worst-first should not open with four hundred empty cells');
});

test('sorting is stable, so a second sort does not scramble the first', () => {
  const same = [['x', '1'], ['y', '1'], ['z', '1']];
  assert.deep(sortIndices(same, 1, { type: 'integer' }), [0, 1, 2]);
  assert.deep(sortIndices(same, 1, { type: 'integer', dir: -1 }), [0, 1, 2]);
});

test('text sorts case-insensitively, and dates chronologically', () => {
  const t = [['Banana'], ['apple'], ['Cherry']];
  assert.deep(sortIndices(t, 0, { type: 'text' }).map((i) => t[i][0]), ['apple', 'Banana', 'Cherry']);
  const d = [['2026-12-01'], ['2026-02-01'], ['2026-07-01']];
  assert.deep(sortIndices(d, 0, { type: 'date' }).map((i) => d[i][0]),
    ['2026-02-01', '2026-07-01', '2026-12-01']);
});

test('sorting an already-filtered set keeps only those rows', () => {
  const out = sortIndices(rows, 0, { type: 'text', indices: [1, 3] });
  assert.deep(out, [1, 3]);
});

/* ── the filter language ─────────────────────────────────────────────────── */

test('quoted phrases survive tokenizing', () => {
  assert.deep(tokenize('a b'), ['a', 'b']);
  assert.deep(tokenize('city:"New York" total>50'), ['city:New York', 'total>50']);
  assert.deep(tokenize("  spaced   out  "), ['spaced', 'out']);
  assert.deep(tokenize(''), []);
});

const cols = ['name', 'city', 'total'];
const types = ['text', 'category', 'decimal'];
const data = [
  ['Ada Lovelace', 'London', '120.50'],
  ['Alan Turing', 'Manchester', '80'],
  ['Grace Hopper', 'New York', ''],
  ['Ada Byron', 'Bristol', '9.99'],
];
const run = (q) => filterIndices(data, compileFilter(q, cols, types)).map((i) => data[i][0]);

test('an empty query keeps everything', () => {
  assert.equal(run('').length, 4);
  assert.equal(run('   ').length, 4);
});

test('a bare word searches every column', () => {
  assert.deep(run('london'), ['Ada Lovelace']);
  assert.deep(run('ada'), ['Ada Lovelace', 'Ada Byron']);
});

test('two terms mean both, because that is what people mean', () => {
  assert.deep(run('ada bristol'), ['Ada Byron']);
  assert.deep(run('ada manchester'), []);
});

test('column:value narrows to one column', () => {
  assert.deep(run('city:man'), ['Alan Turing']);
  assert.deep(run('name:ada'), ['Ada Lovelace', 'Ada Byron']);
});

test('the comparisons compare numerically when they can', () => {
  assert.deep(run('total>50'), ['Ada Lovelace', 'Alan Turing']);
  assert.deep(run('total>=80'), ['Ada Lovelace', 'Alan Turing']);
  assert.deep(run('total<50'), ['Ada Byron']);
  assert.deep(run('total=80'), ['Alan Turing']);
  assert.deep(run('total!=80').length, 3);
});

test('a column with a space in its value still works', () => {
  assert.deep(run('city:"new york"'), ['Grace Hopper']);
});

test('an empty comparison finds the gaps', () => {
  assert.deep(run('total='), ['Grace Hopper'], 'total= should find the blanks');
  assert.equal(run('total!=').length, 3);
});

test('an unknown column is searched as text rather than throwing', () => {
  // it has to survive being typed one character at a time
  assert.equal(run('nosuch:thing').length, 0);
  for (const q of ['c', 'ci', 'cit', 'city', 'city:', 'city:l']) {
    assert.ok(Array.isArray(run(q)), `query "${q}" threw`);
  }
});

test('dates compare chronologically, not alphabetically', () => {
  const d = [['2026-02-01'], ['2026-11-01']];
  const keep = filterIndices(d, compileFilter('when>2026-09-01', ['when'], ['date']));
  assert.deep(keep, [1]);
});

/* ── the sample, and the size it has to cope with ────────────────────────── */

test('the built-in sample is a real file, with the awkward bits in', () => {
  const t = parseTable(sampleCSV(500, 3));
  assert.equal(t.rows.length, 500);
  assert.equal(t.ragged, 0, 'the sample should not be malformed');
  const p = profile(t.columns, t.rows);
  const byName = Object.fromEntries(p.map((c) => [c.name, c]));
  assert.equal(byName.placed_at.type, 'date');
  assert.equal(byName.quantity.type, 'integer');
  assert.equal(byName.total.type, 'decimal');
  assert.equal(byName.city.type, 'category');
  assert.ok(byName.unit_price.blanks > 0, 'a sample with no gaps in it demonstrates nothing');
  const notes = t.rows.map((r) => r[10]).filter(Boolean);
  assert.ok(notes.some((n) => n.includes(',')),
    'the sample needs a comma inside a quoted field, or it proves nothing');
});

test('the same seed gives the same file', () => {
  assert.equal(sampleCSV(50, 11), sampleCSV(50, 11));
  assert.ok(sampleCSV(50, 11) !== sampleCSV(50, 12));
});

test('a hundred thousand rows parse and profile in a reasonable time', () => {
  /* Not a benchmark — a tripwire. If someone reaches for a regex or starts
     concatenating arrays in a loop, this goes from under two seconds to
     thirty and the tool stops being usable on the files people actually have. */
  const csv = sampleCSV(100000, 5);
  const t0 = Date.now();
  const t = parseTable(csv);
  const parsed = Date.now() - t0;
  assert.equal(t.rows.length, 100000);
  const t1 = Date.now();
  profile(t.columns, t.rows);
  const profiled = Date.now() - t1;
  assert.ok(parsed < 4000, `parsing 100k rows took ${parsed}ms`);
  assert.ok(profiled < 6000, `profiling 100k rows took ${profiled}ms`);
});
