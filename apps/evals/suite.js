/* apps/evals/suite.js — something real to evaluate.

   Every "how to run an eval" demonstration I have seen fakes the model, which
   quietly skips the hard half: the scores come out of a random number
   generator, so of course the statistics behave. Here both systems are actual
   programs, the task is one people genuinely get wrong, and every number on
   the page is computed from their real output on real inputs.

   THE TASK: pull the total out of a line off a receipt or an invoice. It looks
   trivial, it is not, and the reason is the long tail — a hundred lines are all
   "$1,234.56" and then one is "1.234,56 EUR", which is the same amount written
   by someone in Germany, and a parser that strips commas reads it as one pound
   twenty-three.

   THE TWO SYSTEMS are a first attempt and a second attempt at that parser. The
   second one is better. It is better by about three points, which is exactly
   the size of improvement that a hundred-item eval cannot see — and that is the
   whole argument of the page it feeds. */

import { rng } from './stats.js';

const CURRENCIES = { '$': 'USD', '£': 'GBP', '€': 'EUR' };
const WORDS = { dollars: 'USD', pounds: 'GBP', euros: 'EUR' };

/* Weighted so the hard cases are RARE, which is what makes this realistic and
   what makes the statistics bite. A format that is 2% of traffic is 2 items in
   a hundred-item eval — you cannot learn anything about it from a sample that
   size, however carefully you stare at the total. */
const FORMATS = [
  { id: 'us-symbol',   weight: 44, note: 'the ordinary case' },
  { id: 'iso-prefix',  weight: 16, note: 'currency code in front' },
  { id: 'gbp',         weight: 12, note: 'pounds' },
  { id: 'bare',        weight: 12, note: 'no currency marker at all' },
  { id: 'no-cents',    weight:  7, note: 'whole amount, no decimals' },
  { id: 'euro-comma',  weight:  3, note: 'European decimal comma' },
  { id: 'euro-symbol', weight:  2, note: 'euro symbol, European format' },
  { id: 'spaced',      weight:  1, note: 'space as the thousands separator' },
  { id: 'negative',    weight:  1, note: 'a refund, in accountants’ parentheses' },
  { id: 'parenthetic', weight:  2, note: 'a note in brackets, and a plain amount' },
  { id: 'scanned',     weight:  6, note: 'came through OCR and did not survive it' },
];

/* The first version of this set had every format at exactly 0% or exactly
   100%, which is not what an eval of anything real looks like — and it left
   McNemar with no items that BOTH systems failed, which is the cell that tells
   you how much headroom is left. These are the lines that arrived through a
   scanner: a 1 read as an l, a decimal point lost, a zero read as a capital O.
   Neither parser has a principled answer to any of them. */
const OCR = [
  (s) => s.replace(/1/, 'l'),
  (s) => s.replace('.', ''),
  (s) => s.replace(/0/, 'O'),
  (s) => s.replace(/(\d)/, '$1 '),
  (s) => s.replace('$', 'S'),
];

/**
 * Corrupt the line, and make sure it actually got corrupted.
 *
 * The first version picked one of the five at random and used the result. Three
 * of them are conditional — there is not always a `1` or a `0` or a `.` to
 * replace — so a fair number of items came out labelled `scanned` and were
 * perfectly clean. The per-format breakdown then reported OCR accuracy that
 * included a pile of items that had never been near a scanner.
 *
 * An eval set whose labels do not guarantee the property they name produces an
 * analysis that is quietly wrong, which is the exact failure this page is
 * about. So: only choose among the substitutions that actually apply.
 */
function scan(line, next) {
  const applicable = OCR.filter((f) => f(line) !== line);
  if (applicable.length === 0) return line.replace(/(\d)/, '$1 ');
  return applicable[(next() * applicable.length) | 0](line);
}

const LABELS = ['Total', 'Amount due', 'Balance', 'TOTAL', 'Grand total', 'Due'];

/**
 * A deterministic set of `n` items.
 *
 * Seeded so that everything downstream — every interval, every p-value, every
 * screenshot — is the same on your machine as on mine. An eval you cannot
 * reproduce exactly is an anecdote.
 */
export function buildItems(n = 800, seed = 20260917) {
  const next = rng(seed);
  const total = FORMATS.reduce((s, f) => s + f.weight, 0);
  const items = [];

  for (let i = 0; i < n; i++) {
    let roll = next() * total, format = FORMATS[0];
    for (const f of FORMATS) { roll -= f.weight; if (roll <= 0) { format = f; break; } }

    const label = LABELS[(next() * LABELS.length) | 0];
    /* The `spaced` format is defined by having a space where the thousands
       separator goes, and a number under a thousand does not have one — so
       every `spaced` item below 1000 was silently an ordinary euro-comma item
       wearing the wrong label. That format is forced large. */
    const big = format.id === 'spaced' ? true : next() < 0.45;
    const units = big ? 1000 + ((next() * 9000) | 0) : 1 + ((next() * 400) | 0);
    const cents = (next() * 100) | 0;
    const amount = units + cents / 100;
    const grouped = units.toLocaleString('en-US');
    const cc = String(cents).padStart(2, '0');

    let line, currency = 'USD', gold = amount;
    switch (format.id) {
      case 'us-symbol':
        line = `${label}: $${grouped}.${cc}`; break;
      case 'iso-prefix':
        currency = ['USD', 'EUR', 'GBP'][(next() * 3) | 0];
        line = `${label}: ${currency} ${units}.${cc}`; break;
      case 'gbp':
        currency = 'GBP';
        line = `${label}: £${grouped}.${cc}`; break;
      case 'bare':
        line = `${label}: ${grouped}.${cc}`; break;
      case 'no-cents':
        gold = units;
        line = `${label}: $${grouped}`; break;
      case 'euro-comma':
        currency = 'EUR';
        line = `${label}: ${units.toLocaleString('de-DE')},${cc} EUR`; break;
      case 'euro-symbol':
        currency = 'EUR';
        line = `${label}: €${units.toLocaleString('de-DE')},${cc}`; break;
      case 'spaced':
        currency = 'EUR';
        line = `${label}: ${units.toLocaleString('en-US').replace(/,/g, ' ')},${cc} EUR`; break;
      case 'negative':
        gold = -amount;
        line = `${label}: ($${grouped}.${cc})`; break;
      case 'parenthetic':
        line = `${label} (${['final', 'revised', 'incl. VAT'][(next() * 3) | 0]}): $${grouped}.${cc}`; break;
      case 'scanned':
        line = scan(`${label}: $${grouped}.${cc}`, next); break;
    }
    items.push({ id: i, line, format: format.id, gold: { amount: gold, currency } });
  }
  return items;
}

/* ── the two systems ────────────────────────────────────────────────────────
   Both are honest attempts, written the way anybody writes this the first and
   second time. Neither is a straw man: v1 handles the case that is 90% of
   traffic perfectly well, which is precisely why it survives long enough to
   cause trouble. */

/** First attempt. Find a number, strip the commas, look for a currency symbol. */
export function parseV1(line) {
  const m = line.match(/([£$€])?\s*([\d,]+(?:\.\d+)?)/);
  if (!m) return null;
  const currency = m[1] ? CURRENCIES[m[1]] : (line.match(/\b(USD|EUR|GBP)\b/)?.[1] ?? 'USD');
  /* The bug that matters: stripping every comma assumes a comma is always a
     thousands separator. In "1.234,56" the comma is the decimal point, and
     this returns 1.234 — off by a factor of a thousand, silently, on a line
     that looks perfectly reasonable. */
  return { amount: Number(m[2].replace(/,/g, '')), currency };
}

/** Second attempt. Work out what the separators mean before trusting them. */
export function parseV2(line) {
  const m = line.match(/([£$€])?\s*([\d.,  ]*\d)/);
  if (!m) return null;

  let body = m[2].replace(/[  ]/g, '');
  const lastComma = body.lastIndexOf(',');
  const lastDot = body.lastIndexOf('.');
  /* Whichever separator comes LAST is the decimal point, provided it has two
     digits after it. Everything else is grouping. This is the rule almost
     every real parser settles on, and it gets both conventions right without
     needing to know where the document came from. */
  if (lastComma > lastDot && body.length - lastComma === 3) {
    body = body.replace(/\./g, '').replace(',', '.');
  } else {
    body = body.replace(/,/g, '');
  }

  let amount = Number(body);
  /* Accountants write a negative as (1,234.56). Handling that is a real fix.
     Doing it by asking whether the LINE contains a bracket is the over-eager
     version of the fix, and it turns "Total (revised): $99.00" into minus
     ninety-nine. It is in here deliberately: real improvements arrive with
     real regressions attached, and an eval that cannot see the regression is
     not doing its job. */
  if (line.includes('(') && line.includes(')')) amount = -Math.abs(amount);

  let currency = m[1] ? CURRENCIES[m[1]] : line.match(/\b(USD|EUR|GBP)\b/)?.[1];
  if (!currency) {
    const word = line.toLowerCase().match(/\b(dollars|pounds|euros)\b/)?.[1];
    currency = word ? WORDS[word] : 'USD';
  }
  return { amount, currency };
}

export const SYSTEMS = {
  v1: { id: 'v1', label: 'parser v1', note: 'strips commas and hopes', parse: parseV1 },
  v2: { id: 'v2', label: 'parser v2', note: 'infers the decimal separator', parse: parseV2 },
};

/* ── graders ────────────────────────────────────────────────────────────────
   The part of an eval that decides what the number means, and the part that
   gets the least thought. The same two systems score differently under each of
   these, and none of the three is wrong — they are answering different
   questions, and the mistake is not picking the wrong one, it is not knowing
   which one you picked. */

export const GRADERS = {
  amount: {
    id: 'amount',
    label: 'amount only',
    note: 'Is the number right, to the penny? Ignores which currency it is in.',
    grade: (out, gold) => (out && Math.abs(out.amount - gold.amount) < 0.005 ? 1 : 0),
  },
  strict: {
    id: 'strict',
    label: 'amount and currency',
    note: 'Both right, or it is a failure. The one that matches what a billing '
        + 'system actually needs.',
    grade: (out, gold) =>
      (out && Math.abs(out.amount - gold.amount) < 0.005 && out.currency === gold.currency ? 1 : 0),
  },
  partial: {
    id: 'partial',
    label: 'partial credit',
    note: 'Half a mark for the amount, half for the currency. Smoother, and '
        + 'harder to interpret — a score of 0.5 could be either half.',
    grade: (out, gold) => {
      if (!out) return 0;
      return (Math.abs(out.amount - gold.amount) < 0.005 ? 0.5 : 0)
           + (out.currency === gold.currency ? 0.5 : 0);
    },
  },
};

/**
 * Score one system over `items`.
 *
 * Returns the per-item scores as well as the mean, because the mean is not
 * enough to compare two systems — the paired statistics need to know which
 * items, and any honest report needs to be able to show you the ones that
 * changed.
 */
export function runEval(system, grader, items) {
  const scores = new Array(items.length);
  const outputs = new Array(items.length);
  for (let i = 0; i < items.length; i++) {
    let out = null;
    try { out = system.parse(items[i].line); } catch { out = null; }
    outputs[i] = out;
    scores[i] = grader.grade(out, items[i].gold);
  }
  return {
    system: system.id,
    grader: grader.id,
    scores,
    outputs,
    mean: scores.reduce((a, b) => a + b, 0) / scores.length,
  };
}

/** The items where the two systems disagree — fixed on one side, broken on the other. */
export function disagreements(items, a, b) {
  const out = [];
  for (let i = 0; i < items.length; i++) {
    if (a.scores[i] === b.scores[i]) continue;
    out.push({
      item: items[i],
      before: a.outputs[i],
      after: b.outputs[i],
      direction: b.scores[i] > a.scores[i] ? 'fixed' : 'broken',
    });
  }
  return out;
}

/** How each named format fared — where the failures actually live. */
export function byFormat(items, result) {
  const rows = new Map();
  for (let i = 0; i < items.length; i++) {
    const key = items[i].format;
    if (!rows.has(key)) rows.set(key, { format: key, n: 0, score: 0 });
    const row = rows.get(key);
    row.n++;
    row.score += result.scores[i];
  }
  return [...rows.values()]
    .map((r) => ({ ...r, mean: r.score / r.n, note: FORMATS.find((f) => f.id === r.format)?.note ?? '' }))
    .sort((a, b) => b.n - a.n);
}

export { FORMATS };
