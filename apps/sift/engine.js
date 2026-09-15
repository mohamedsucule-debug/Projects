/* ───────────────────────────────────────────────────────────────────────────
   sift/engine.js — reading a CSV properly, and working out what is in it.

   Three jobs, none of which touch the DOM:

     parse      turn text into rows, correctly, including all the cases that
                `line.split(',')` gets wrong
     profile    work out what each column actually contains
     query      a small filter language, because scrolling is not analysis

   The parser is the part worth reading. Splitting on commas is the single most
   common data bug in working software: it silently truncates any row with a
   comma inside a quoted field, and because the row count still looks about
   right, nobody notices until a customer asks why their address is missing.
   ─────────────────────────────────────────────────────────────────────────── */

/* ── parsing ────────────────────────────────────────────────────────────────
   RFC 4180, plus the things real files do that RFC 4180 does not mention:
   CRLF and bare CR endings, a byte-order mark, ragged rows, and a trailing
   newline that must not produce a phantom empty row. */

const BOM = '﻿';

/**
 * Work out what the columns are separated by, by trying each candidate and
 * seeing which gives the most consistent field count across the first few
 * lines. Guessing from the header alone breaks on a single column whose name
 * contains a comma; consistency across rows does not.
 */
export function sniffDelimiter(text, candidates = [',', '\t', ';', '|']) {
  if (typeof text !== 'string' || !text) return ',';
  const sample = text.slice(0, 64 * 1024);
  let best = ',', bestScore = -Infinity;
  for (const d of candidates) {
    const rows = parse(sample, { delimiter: d, limit: 20 }).rows;
    if (rows.length < 2) continue;
    const widths = rows.map((r) => r.length);
    const mode = widths[0];
    if (mode < 2) continue;                        // one column is not a split
    const agree = widths.filter((w) => w === mode).length / widths.length;
    // prefer agreement first, then more columns, so a tab file does not lose
    // to a comma that happens to appear once per line
    const score = agree * 10 + Math.min(mode, 30) * 0.1;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/**
 * Parse CSV text into rows of strings.
 *
 * A hand-rolled character loop rather than a regex: a regex that handles
 * quoted fields containing delimiters and newlines is either wrong or
 * unreadable, and on a 40MB file it is also slow.
 */
export function parse(text, { delimiter = ',', limit = Infinity } = {}) {
  let src = typeof text === 'string' ? text : '';
  if (src.startsWith(BOM)) src = src.slice(1);     // Excel writes one of these

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let started = false;     // has this field begun, so we know if a quote opens it
  let begun = false;       // has anything at all been consumed since the last row
  let truncated = false;

  const endField = () => { row.push(field); field = ''; started = false; };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    begun = false;
    if (rows.length >= limit) truncated = true;
  };

  for (let i = 0; i < src.length && !truncated; i++) {
    const c = src[i];

    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }   // "" is one quote
        else quoted = false;
      } else field += c;
      continue;
    }

    if (c === '"' && !started) { quoted = true; started = true; begun = true; continue; }
    if (c === delimiter) { endField(); begun = true; continue; }
    if (c === '\r') {
      if (src[i + 1] === '\n') i++;                      // CRLF is one ending
      endRow();
      continue;
    }
    if (c === '\n') { endRow(); continue; }
    field += c;
    started = true;
    begun = true;
  }

  /* Whatever is left over is a final row — unless the file ended with a
     newline, in which case there is nothing left and adding a row would
     invent an empty record that is not in the file.
     `begun` rather than a test on the field text: a file that is just `""`
     holds one empty field, and checking `field !== ''` cannot tell that apart
     from having read nothing at all. */
  if (!truncated && (begun || row.length > 0)) endRow();

  return { rows, delimiter, truncated };
}

/** Parse, and split the header off the body. */
export function parseTable(text, opts = {}) {
  const delimiter = opts.delimiter || sniffDelimiter(text);
  const { rows, truncated } = parse(text, { ...opts, delimiter });
  if (!rows.length) return { columns: [], rows: [], delimiter, truncated, ragged: 0 };

  const header = rows[0].map((h, i) => {
    const name = String(h).trim();
    return name || `column ${i + 1}`;              // an unnamed column still needs a handle
  });
  // duplicate headers are common and would silently overwrite each other
  const seen = new Map();
  const columns = header.map((name) => {
    const n = seen.get(name) || 0;
    seen.set(name, n + 1);
    return n === 0 ? name : `${name} (${n + 1})`;
  });

  const body = rows.slice(1);
  let ragged = 0;
  /* Rows are padded or trimmed to the header width rather than dropped. A row
     with one extra field is usually a stray delimiter, not a reason to throw
     away somebody's record — but it is counted and reported, because silently
     reshaping data is how you end up trusting a number that is wrong. */
  const out = body.map((r) => {
    if (r.length !== columns.length) {
      ragged++;
      const copy = r.slice(0, columns.length);
      while (copy.length < columns.length) copy.push('');
      return copy;
    }
    return r;
  });

  return { columns, rows: out, delimiter, truncated, ragged };
}

/* ── working out what a column is ──────────────────────────────────────────── */

export const TYPES = ['integer', 'decimal', 'boolean', 'date', 'category', 'text'];

const BLANK = /^\s*$/;
export const isBlank = (v) => v == null || BLANK.test(String(v));

const INT = /^[+-]?\d{1,3}(,\d{3})*$|^[+-]?\d+$/;
const DEC = /^[+-]?(\d{1,3}(,\d{3})*|\d+)?(\.\d+)?([eE][+-]?\d+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const TRUE = new Set(['true', 'yes', 'y', 't']);
const FALSE = new Set(['false', 'no', 'n', 'f']);

/** The number a cell means, or NaN. Thousands separators are tolerated. */
export function toNumber(v) {
  if (isBlank(v)) return NaN;
  const s = String(v).trim().replace(/,/g, '');
  if (s === '' || s === '+' || s === '-' || s === '.') return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** The instant a cell means, or NaN. ISO only — see the note below. */
export function toDate(v) {
  if (isBlank(v)) return NaN;
  const s = String(v).trim();
  /* ISO only, deliberately. `new Date('03/04/2025')` is March in the US and
     April almost everywhere else, and picking one silently means half the
     world's data is quietly wrong by up to eleven months. A column that is not
     unambiguous is left as text, where it is at least visibly unparsed. */
  if (!ISO_DATE.test(s)) return NaN;
  const t = Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s);
  return Number.isFinite(t) ? t : NaN;
}

export function toBoolean(v) {
  const s = String(v).trim().toLowerCase();
  if (TRUE.has(s)) return true;
  if (FALSE.has(s)) return false;
  return null;
}

/**
 * Decide what a column holds.
 *
 * A type is accepted when at least `threshold` of the non-blank values fit it,
 * so one corrupt cell in ten thousand does not demote a numeric column to
 * text — but the count that did not fit is always reported, because a column
 * that is "97% a number" is a thing somebody needs to know about.
 */
export function inferType(values, { threshold = 0.95 } = {}) {
  const present = [];
  let blanks = 0;
  for (const v of values) (isBlank(v) ? blanks++ : present.push(String(v).trim()));
  if (!present.length) return { type: 'text', confidence: 0, blanks, bad: 0, total: values.length };

  const count = (fn) => present.reduce((n, v) => n + (fn(v) ? 1 : 0), 0);
  const ints = count((v) => INT.test(v));
  const decs = count((v) => DEC.test(v) && v !== '' && /\d/.test(v));
  const dates = count((v) => ISO_DATE.test(v));
  const bools = count((v) => toBoolean(v) !== null);

  const ratio = (n) => n / present.length;
  const pick = (type, n) => ({ type, confidence: ratio(n), blanks, bad: present.length - n, total: values.length });

  /* Order matters: most specific first. Booleans are checked before integers
     so a column of 1s and 0s stays a number — it is far more often a count or
     a flag people want to sum than a true/false. */
  if (ratio(dates) >= threshold) return pick('date', dates);
  if (ratio(ints) >= threshold) return pick('integer', ints);
  if (ratio(decs) >= threshold) return pick('decimal', decs);
  if (ratio(bools) >= threshold) return pick('boolean', bools);

  const distinct = new Set(present).size;
  if (distinct <= 24 && distinct <= present.length * 0.5) {
    return { type: 'category', confidence: 1, blanks, bad: 0, total: values.length, distinct };
  }
  return { type: 'text', confidence: 1, blanks, bad: 0, total: values.length, distinct };
}

const quantile = (sorted, q) => {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/** Everything worth knowing about one column. */
export function profileColumn(values, name = '') {
  const t = inferType(values);
  const out = { name, ...t, distinct: t.distinct };
  const present = values.length - (t.blanks || 0);

  if (t.type === 'integer' || t.type === 'decimal') {
    const nums = [];
    for (const v of values) { const n = toNumber(v); if (Number.isFinite(n)) nums.push(n); }
    nums.sort((a, b) => a - b);
    const sum = nums.reduce((a, b) => a + b, 0);
    const mean = nums.length ? sum / nums.length : NaN;
    const varr = nums.length > 1
      ? nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (nums.length - 1)
      : 0;
    out.stats = {
      n: nums.length, sum, mean,
      min: nums[0], max: nums[nums.length - 1],
      median: quantile(nums, 0.5), p95: quantile(nums, 0.95),
      sd: Math.sqrt(varr),
    };
    out.distinct = new Set(nums).size;
    /* A column of quantities 1 to 5 spread across twenty-four buckets draws
       five spikes with gaps between them, which looks like missing data
       rather than like five values. Never more buckets than there are
       distinct numbers to put in them. */
    out.histogram = histogram(nums, Math.min(24, Math.max(1, out.distinct)));
  } else if (t.type === 'date') {
    const ts = [];
    for (const v of values) { const d = toDate(v); if (Number.isFinite(d)) ts.push(d); }
    ts.sort((a, b) => a - b);
    out.stats = { n: ts.length, min: ts[0], max: ts[ts.length - 1] };
  } else {
    out.top = topValues(values, 8);
    if (out.distinct === undefined) out.distinct = new Set(values.filter((v) => !isBlank(v)).map(String)).size;
  }
  /* A column where every value appears once is an identifier, and saying so is
     more use than listing eight values with a count of one beside each. */
  out.unique = present > 1 && out.distinct === present;
  return out;
}

/** The commonest values, biggest first. */
export function topValues(values, n = 8) {
  const counts = new Map();
  for (const v of values) {
    if (isBlank(v)) continue;
    const k = String(v).trim();
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, n)
    .map(([value, count]) => ({ value, count }));
}

/** Equal-width buckets, for a shape you can see at a glance. */
export function histogram(nums, buckets = 24) {
  if (!nums.length) return [];
  const min = nums[0], max = nums[nums.length - 1];
  if (!(max > min)) return [{ from: min, to: max, count: nums.length }];
  const width = (max - min) / buckets;
  const bins = new Array(buckets).fill(0);
  for (const n of nums) {
    let i = Math.floor((n - min) / width);
    if (i >= buckets) i = buckets - 1;              // the maximum lands in the last bucket
    if (i < 0) i = 0;
    bins[i]++;
  }
  return bins.map((count, i) => ({ from: min + i * width, to: min + (i + 1) * width, count }));
}

export function profile(columns, rows) {
  return columns.map((name, i) => profileColumn(rows.map((r) => r[i]), name));
}

/* ── sorting ─────────────────────────────────────────────────────────────── */

/**
 * Sort row indices by one column.
 *
 * Indices rather than the rows themselves, so a 200k-row table is not copied
 * on every click. Blanks always sink to the bottom, ascending or descending —
 * a column sorted "worst first" that opens with four hundred empty cells has
 * not answered anybody's question.
 */
export function sortIndices(rows, col, { type = 'text', dir = 1, indices = null } = {}) {
  const idx = indices ? [...indices] : rows.map((_, i) => i);
  const numeric = type === 'integer' || type === 'decimal';
  const dated = type === 'date';

  const key = (i) => {
    const v = rows[i][col];
    if (isBlank(v)) return null;
    if (numeric) { const n = toNumber(v); return Number.isFinite(n) ? n : null; }
    if (dated) { const d = toDate(v); return Number.isFinite(d) ? d : null; }
    return String(v).trim().toLowerCase();
  };

  const keys = idx.map(key);
  const pos = new Map(idx.map((v, k) => [v, k]));

  return idx.sort((a, b) => {
    const ka = keys[pos.get(a)], kb = keys[pos.get(b)];
    if (ka === null && kb === null) return a - b;
    if (ka === null) return 1;                      // blanks last, both ways
    if (kb === null) return -1;
    if (ka < kb) return -dir;
    if (ka > kb) return dir;
    return a - b;                                   // stable: original order wins ties
  });
}

/* ── the filter language ─────────────────────────────────────────────────────
   Small on purpose. Bare words search everywhere; `column:value` narrows to
   one column; the comparison operators do what they look like. Terms are
   ANDed, because that is what people mean when they type two things. */

const OPS = ['>=', '<=', '!=', '>', '<', '=', ':'];

/** Split a query into terms, respecting quotes. */
export function tokenize(query) {
  const out = [];
  let cur = '', q = null;
  for (const c of String(query)) {
    if (q) { if (c === q) q = null; else cur += c; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (/\s/.test(c)) { if (cur) out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Turn a query into a predicate over a row.
 *
 * An unknown column name is a no-op term rather than an error, so a query does
 * not blow up halfway through being typed.
 */
export function compileFilter(query, columns, types = []) {
  const terms = tokenize(query).map((tok) => {
    for (const op of OPS) {
      const at = tok.indexOf(op);
      if (at <= 0) continue;
      const name = tok.slice(0, at).trim().toLowerCase();
      const value = tok.slice(at + op.length).trim();
      const col = columns.findIndex((c) => c.toLowerCase() === name);
      if (col === -1) break;                        // not a column: treat the whole thing as text
      return { kind: 'column', col, op, value, type: types[col] };
    }
    return { kind: 'any', value: tok.toLowerCase() };
  });

  if (!terms.length) return () => true;

  return (row) => {
    for (const t of terms) {
      if (t.kind === 'any') {
        let hit = false;
        for (const cell of row) {
          if (cell != null && String(cell).toLowerCase().includes(t.value)) { hit = true; break; }
        }
        if (!hit) return false;
        continue;
      }
      if (!matches(row[t.col], t)) return false;
    }
    return true;
  };
}

function matches(cell, term) {
  const { op, value, type } = term;
  const text = cell == null ? '' : String(cell).trim();

  if (value === '') return op === '=' ? isBlank(cell) : !isBlank(cell);

  if (op === ':') return text.toLowerCase().includes(value.toLowerCase());
  if (op === '=') return text.toLowerCase() === value.toLowerCase();
  if (op === '!=') return text.toLowerCase() !== value.toLowerCase();

  /* A blank is not less than fifty. It is unknown, and unknown fails every
     ordering test — otherwise `total<50` quietly returns every row with no
     total in it, which is the opposite of what was asked. */
  if (isBlank(cell)) return false;

  /* The ordering operators compare as numbers or dates when both sides can be
     read as one, and fall back to text otherwise — so `name>m` still does
     something sensible rather than nothing. */
  const dated = type === 'date';
  const a = dated ? toDate(text) : toNumber(text);
  const b = dated ? toDate(value) : toNumber(value);
  const useNum = Number.isFinite(a) && Number.isFinite(b);
  const x = useNum ? a : text.toLowerCase();
  const y = useNum ? b : value.toLowerCase();

  if (op === '>') return x > y;
  if (op === '>=') return x >= y;
  if (op === '<') return x < y;
  if (op === '<=') return x <= y;
  return true;
}

/** Row indices that survive the query. */
export function filterIndices(rows, predicate) {
  const out = [];
  for (let i = 0; i < rows.length; i++) if (predicate(rows[i])) out.push(i);
  return out;
}

/* ── something to look at on arrival ─────────────────────────────────────────
   A tool with an empty state is a tool nobody sees working. This generates a
   plausible order book from a seed, so the page has real data in it the moment
   it opens and the same data every time. */

function rng(seed = 7) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CITIES = ['London', 'Manchester', 'Bristol', 'Leeds', 'Glasgow', 'Cardiff', 'Belfast', 'Newcastle'];
const CHANNELS = ['web', 'app', 'phone', 'partner'];
const STATUS = ['shipped', 'shipped', 'shipped', 'pending', 'refunded', 'cancelled'];
const ITEMS = ['Desk lamp', 'Oak shelf, small', 'Chair', 'Rug', 'Mirror', 'Side table', 'Planter', 'Stool'];

export function sampleCSV(n = 4000, seed = 7) {
  const rand = rng(seed);
  const pick = (a) => a[Math.floor(rand() * a.length) % a.length];
  const lines = ['order_id,placed_at,customer,city,channel,item,quantity,unit_price,total,status,note'];
  const start = Date.UTC(2026, 0, 1);

  for (let i = 0; i < n; i++) {
    const day = Math.floor(rand() * 250);
    const placed = new Date(start + day * 86400000 + Math.floor(rand() * 86400000));
    const qty = 1 + Math.floor(rand() * 5);
    const price = Math.round((6 + rand() * 240) * 100) / 100;
    const item = pick(ITEMS);
    const city = pick(CITIES);
    /* One row in forty has a comma inside a quoted field and one in sixty is
       blank, because a sample that is too tidy demonstrates nothing. */
    const note = rand() < 0.025 ? '"Leave with the neighbour, number 14"' : '';
    const customer = `"${pick(['Ade', 'Nia', 'Tom', 'Priya', 'Sam', 'Iris', 'Omar', 'Faye'])} ${pick(['Okafor', 'Bell', 'Nkemdirim', 'Shah', 'Doyle', 'Vance'])}"`;
    lines.push([
      `A-${(100000 + i).toString(36).toUpperCase()}`,
      placed.toISOString().slice(0, 10),
      customer,
      city,
      pick(CHANNELS),
      item.includes(',') ? `"${item}"` : item,
      qty,
      rand() < 0.017 ? '' : price.toFixed(2),      // a few missing prices, on purpose
      (qty * price).toFixed(2),
      pick(STATUS),
      note,
    ].join(','));
  }
  return lines.join('\n');
}
