/* tests/evals.test.mjs — the statistics, and the thing they are measuring.

   Statistics code is the most dangerous kind of code to get wrong, because it
   produces a plausible number whatever you do. A confidence interval computed
   with a bug is still an interval; it still has two ends; it still looks like
   an answer. The only defence is to check it against values that are known
   independently, and to check that it does the thing it CLAIMS — so the
   bootstrap here is tested for coverage, not just for not crashing. */

import { test, assert } from './harness.mjs';
import {
  mean, stdev, rng, bootstrapMeanCI, pairedDiffCI, unpairedDiffCI, quantile,
  wilson, mcnemar, requiredN, normalQuantile, detectableEffect,
} from '../apps/evals/stats.js';
import {
  buildItems, parseV1, parseV2, SYSTEMS, GRADERS, runEval, disagreements, byFormat,
} from '../apps/evals/suite.js';

/* ── the basics ─────────────────────────────────────────────────────────── */

test('mean and standard deviation', () => {
  assert.close(mean([2, 4, 4, 4, 5, 5, 7, 9]), 5, 1e-12);
  /* The sample standard deviation of that set is sqrt(32/7). Using n instead
     of n−1 would give exactly 2, which is the number most people expect and
     the reason the bug survives. */
  assert.close(stdev([2, 4, 4, 4, 5, 5, 7, 9]), Math.sqrt(32 / 7), 1e-12);
});

test('standard deviation of a single observation is zero, not NaN', () => {
  assert.equal(stdev([4]), 0);
});

test('quantile interpolates', () => {
  const s = Float64Array.from([0, 1, 2, 3, 4]);
  assert.close(quantile(s, 0), 0, 1e-12);
  assert.close(quantile(s, 1), 4, 1e-12);
  assert.close(quantile(s, 0.5), 2, 1e-12);
  assert.close(quantile(s, 0.25), 1, 1e-12);
});

/* ── the normal quantile ────────────────────────────────────────────────── */

test('normalQuantile against values from a table', () => {
  assert.close(normalQuantile(0.5), 0, 1e-9);
  assert.close(normalQuantile(0.975), 1.959964, 1e-5);
  assert.close(normalQuantile(0.95), 1.644854, 1e-5);
  assert.close(normalQuantile(0.8), 0.841621, 1e-5);
  assert.close(normalQuantile(0.99), 2.326348, 1e-5);
});

test('normalQuantile is antisymmetric about a half', () => {
  for (const p of [0.01, 0.1, 0.3, 0.45]) {
    assert.close(normalQuantile(p), -normalQuantile(1 - p), 1e-8);
  }
});

test('normalQuantile refuses a certainty', () => {
  assert.throws(() => normalQuantile(0));
  assert.throws(() => normalQuantile(1));
});

/* ── Wilson ─────────────────────────────────────────────────────────────── */

test('Wilson does not claim certainty from twenty observations', () => {
  /* The textbook normal approximation gives [1, 1] here — twenty out of twenty
     and therefore, apparently, definitely always. Wilson gives a lower bound
     around 0.839, which is the honest reading. */
  const w = wilson(20, 20);
  assert.equal(w.estimate, 1);
  assert.close(w.low, 0.8389, 1e-3);
  assert.equal(w.high, 1);
});

test('Wilson on zero successes', () => {
  const w = wilson(0, 30);
  assert.equal(w.low, 0);
  assert.close(w.high, 0.1132, 1e-3);
});

test('Wilson on a middling proportion is close to the textbook interval', () => {
  /* Away from the edges the two agree; that is why the wrong one survives. */
  const w = wilson(50, 100);
  const naiveHalf = 1.959964 * Math.sqrt(0.25 / 100);
  assert.close(w.low, 0.5 - naiveHalf, 0.01);
  assert.close(w.high, 0.5 + naiveHalf, 0.01);
});

test('a Wilson interval narrows as the sample grows', () => {
  const widths = [25, 100, 400, 1600].map((n) => {
    const w = wilson(Math.round(n * 0.9), n);
    return w.high - w.low;
  });
  for (let i = 1; i < widths.length; i++) assert.ok(widths[i] < widths[i - 1]);
  /* Four times the data, half the width. If this ratio is off, the n is in the
     wrong place in the formula. */
  assert.close(widths[0] / widths[1], 2, 0.25);
});

/* ── the bootstrap ──────────────────────────────────────────────────────── */

test('a bootstrap interval brackets the sample mean', () => {
  const xs = Array.from({ length: 200 }, (_, i) => (i % 7) / 6);
  const ci = bootstrapMeanCI(xs, { iters: 2000 });
  assert.close(ci.estimate, mean(xs), 1e-12);
  assert.ok(ci.low < ci.estimate && ci.estimate < ci.high, 'the estimate fell outside its own interval');
});

test('the same seed gives the same interval', () => {
  const xs = Array.from({ length: 60 }, (_, i) => i % 2);
  const a = bootstrapMeanCI(xs, { seed: 5 });
  const b = bootstrapMeanCI(xs, { seed: 5 });
  assert.equal(a.low, b.low);
  assert.equal(a.high, b.high);
});

test('a 95% bootstrap interval covers the truth about 95% of the time', () => {
  /* The property that makes the interval mean anything, checked the only way
     it can be: draw many samples from a population whose mean is known, and
     count how often the interval contains it. Anything far from 95% means the
     resampling is wrong however reasonable the numbers look.

     200 trials, so the count itself has a standard error of about 1.5 points;
     the band below is deliberately loose enough not to fail on noise and tight
     enough to catch an off-by-one in the percentile. */
  const truth = 0.7;
  const next = rng(31337);
  let covered = 0;
  const trials = 200;
  for (let t = 0; t < trials; t++) {
    const sample = Array.from({ length: 120 }, () => (next() < truth ? 1 : 0));
    const ci = bootstrapMeanCI(sample, { iters: 600, seed: 1000 + t });
    if (ci.low <= truth && truth <= ci.high) covered++;
  }
  const rate = covered / trials;
  assert.ok(rate > 0.90 && rate < 0.995, `covered ${(rate * 100).toFixed(1)}% of the time, expected about 95%`);
});

test('a wider interval is asked for by a smaller alpha', () => {
  const xs = Array.from({ length: 100 }, (_, i) => i % 3);
  const a = bootstrapMeanCI(xs, { alpha: 0.05, seed: 8 });
  const b = bootstrapMeanCI(xs, { alpha: 0.2, seed: 8 });
  assert.ok((a.high - a.low) > (b.high - b.low), '95% should be wider than 80%');
});

test('bootstrapping nothing is an error, not an empty interval', () => {
  assert.throws(() => bootstrapMeanCI([]));
});

/* ── paired versus unpaired ─────────────────────────────────────────────── */

test('paired comparison refuses mismatched lengths', () => {
  assert.throws(() => pairedDiffCI([1, 0, 1], [1, 0]));
});

test('two identical systems produce an interval straddling zero', () => {
  const xs = Array.from({ length: 300 }, (_, i) => i % 4 > 0 ? 1 : 0);
  const ci = pairedDiffCI(xs, xs);
  assert.close(ci.estimate, 0, 1e-12);
  assert.ok(!ci.conclusive, 'a system compared against itself came out significantly different');
});

test('pairing is narrower than not pairing when difficulty is shared', () => {
  /* The entire argument for paired evaluation. Items vary a lot in difficulty;
     the second system is uniformly a little better. Unpaired, the item
     variance swamps the difference. Paired, it cancels. */
  const next = rng(4);
  const a = [], b = [];
  for (let i = 0; i < 300; i++) {
    const hard = next() < 0.5;
    const base = hard ? 0.3 : 0.95;
    a.push(next() < base ? 1 : 0);
    b.push(next() < Math.min(1, base + 0.05) ? 1 : 0);
  }
  const p = pairedDiffCI(a, b, { seed: 2 });
  const u = unpairedDiffCI(a, b, { seed: 2 });
  assert.ok((p.high - p.low) < (u.high - u.low),
    `paired interval ${(p.high - p.low).toFixed(4)} was not narrower than unpaired ${(u.high - u.low).toFixed(4)}`);
});

test('a large, real difference is called conclusive', () => {
  const a = Array.from({ length: 400 }, (_, i) => (i % 10 < 5 ? 1 : 0));
  const b = Array.from({ length: 400 }, (_, i) => (i % 10 < 9 ? 1 : 0));
  const ci = pairedDiffCI(a, b);
  assert.ok(ci.conclusive);
  assert.ok(ci.low > 0, 'the interval should sit entirely above zero');
});

/* ── McNemar ────────────────────────────────────────────────────────────── */

test('McNemar counts the four cells', () => {
  const m = mcnemar([1, 1, 0, 0, 1], [1, 0, 1, 0, 1]);
  assert.equal(m.both, 2);
  assert.equal(m.neither, 1);
  assert.equal(m.onlyA, 1);
  assert.equal(m.onlyB, 1);
});

test('McNemar ignores the items both systems got right', () => {
  /* The property that makes it the right test: agreement carries no
     information about which is better, so padding the eval with a thousand
     easy items must not change the verdict by a hair. */
  const a = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0];
  const b = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1];
  const small = mcnemar(a, b);
  const padded = mcnemar(a.concat(Array(1000).fill(1)), b.concat(Array(1000).fill(1)));
  assert.close(small.p, padded.p, 1e-12);
  /* 1000, not 1010: the two original arrays are exact opposites, so none of
     the first eighteen items is one both systems got right. Every both-correct
     item here is one of the thousand that were added. */
  assert.equal(padded.both, 1000);
  assert.equal(small.both, 0);
});

test('an even split of disagreements is no evidence at all', () => {
  const m = mcnemar([1, 1, 0, 0], [0, 0, 1, 1]);
  assert.equal(m.discordant, 4);
  assert.equal(m.p, 1);
});

test('ten fixes and no regressions is strong evidence', () => {
  const a = Array(10).fill(0), b = Array(10).fill(1);
  const m = mcnemar(a, b);
  /* Exactly 2 · (1/2)^10 — the two-sided exact binomial tail. */
  assert.close(m.p, 2 * Math.pow(0.5, 10), 1e-12);
});

test('no disagreements at all is p = 1', () => {
  assert.equal(mcnemar([1, 1, 1], [1, 1, 1]).p, 1);
});

/* ── planning ───────────────────────────────────────────────────────────── */

test('required sample size for a three-point move is in the thousands', () => {
  /* The number that ends most arguments about a hundred-item eval. Standard
     two-proportion power calculation; this agrees with the textbook value to
     within rounding. */
  const n = requiredN(0.90, 0.93);
  assert.ok(n > 1000 && n < 1800, `expected roughly 1,400 per side, got ${n}`);
});

test('a bigger effect needs fewer items', () => {
  const sizes = [0.02, 0.05, 0.1, 0.2].map((d) => requiredN(0.8, 0.8 + d));
  for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] < sizes[i - 1]);
});

test('detecting no difference at all takes infinitely many items', () => {
  assert.equal(requiredN(0.9, 0.9), Infinity);
});

test('more power costs more items', () => {
  assert.ok(requiredN(0.8, 0.85, { power: 0.95 }) > requiredN(0.8, 0.85, { power: 0.8 }));
});

test('detectableEffect inverts requiredN', () => {
  const n = 400, baseline = 0.85;
  const effect = detectableEffect(n, baseline);
  assert.ok(requiredN(baseline, baseline + effect) <= n + 2, 'the effect it returned needs more items than we have');
  assert.ok(requiredN(baseline, baseline + effect * 0.85) > n, 'a smaller effect should have been out of reach');
});

/* ── the suite being measured ───────────────────────────────────────────── */

const items = buildItems(800);

test('the item set is the same every time', () => {
  assert.deep(buildItems(20).map((i) => i.line), buildItems(20).map((i) => i.line));
});

test('every item actually exhibits the format it is labelled with', () => {
  /* Two generator bugs found by reading the sample table on the page, both the
     same bug: a label that did not guarantee the property it names.

     `spaced` is defined by having a space where the thousands separator goes,
     and more than half its items were under a thousand — so they had no
     separator, and were ordinary euro-comma items wearing the wrong label.
     `scanned` picked one of five OCR substitutions at random, three of which
     are conditional, so items came out labelled as corrupted and were pristine.

     Neither would ever throw. They would quietly make the per-format breakdown
     — the analysis this whole exercise exists to demonstrate — report accuracy
     for a category against items that were never in it. */
  const items = buildItems(1200);
  const clean = (s) => s.replace(/[  ]/g, '');

  for (const it of items.filter((i) => i.format === 'spaced')) {
    assert.ok(it.line.includes(' '), `spaced item has no space in it: ${JSON.stringify(it.line)}`);
  }
  for (const it of items.filter((i) => i.format === 'euro-comma' || i.format === 'euro-symbol')) {
    assert.ok(/,\d\d(\s|$)/.test(it.line), `no decimal comma in ${JSON.stringify(it.line)}`);
  }
  for (const it of items.filter((i) => i.format === 'negative')) {
    assert.ok(it.gold.amount < 0, 'a refund should have a negative gold amount');
  }
  for (const it of items.filter((i) => i.format === 'parenthetic')) {
    assert.ok(it.gold.amount > 0 && it.line.includes('('), 'a bracketed note is not a refund');
  }
  /* An uncorrupted line has exactly one shape — "Label: $1,234.56" — so a
     scanned item is one that does NOT have it. Stating the pristine form and
     negating it is the whole assertion; the first attempt at this test was a
     pile of alternatives about stray letters and missing dots, which is an
     unreadable way of saying the same thing less precisely. */
  const PRISTINE = /^[A-Za-z ]+: \$[\d,]+\.\d{2}$/;
  for (const it of items.filter((i) => i.format === 'scanned')) {
    assert.ok(!PRISTINE.test(it.line), `scanned item is not corrupted: ${JSON.stringify(it.line)}`);
  }
  for (const it of items.filter((i) => i.format === 'us-symbol')) {
    assert.ok(PRISTINE.test(it.line), `ordinary item is malformed: ${JSON.stringify(it.line)}`);
  }
});

test('every item has a gold answer and a format', () => {
  for (const it of items) {
    assert.ok(Number.isFinite(it.gold.amount), `item ${it.id} has no gold amount`);
    assert.ok(['USD', 'EUR', 'GBP'].includes(it.gold.currency), `item ${it.id} has a strange currency`);
    assert.ok(it.line.length > 0);
  }
});

test('v1 reads a European decimal comma as a thousands separator', () => {
  /* The bug the whole exercise is about, pinned so it cannot be fixed by
     accident: 1.234,56 euros comes back as one euro twenty-three. */
  const out = parseV1('Total: 1.234,56 EUR');
  assert.close(out.amount, 1.234, 1e-9);
});

test('v2 gets the same line right', () => {
  const out = parseV2('Total: 1.234,56 EUR');
  assert.close(out.amount, 1234.56, 1e-9);
  assert.equal(out.currency, 'EUR');
});

test('both agree on the ordinary case', () => {
  for (const line of ['Total: $1,234.56', 'Due: GBP 99.00', 'Balance: 42.10']) {
    assert.close(parseV1(line).amount, parseV2(line).amount, 1e-9, `disagreed on ${line}`);
  }
});

test('v2 carries a real regression: a bracketed note becomes a negative', () => {
  /* Documented rather than fixed. A page arguing that evals must be able to
     see regressions needs an actual regression to see, and this is the shape
     they really come in — a correct idea (brackets mean negative) applied one
     step too broadly. */
  assert.close(parseV2('Total (revised): $99.00').amount, -99, 1e-9);
  assert.close(parseV1('Total (revised): $99.00').amount, 99, 1e-9);
});

test('a line with no number at all returns null rather than NaN', () => {
  assert.equal(parseV1('Total: see attached'), null);
  assert.equal(parseV2('Total: see attached'), null);
});

test('the graders disagree with each other, and that is the point', () => {
  const gold = { amount: 10, currency: 'EUR' };
  const out = { amount: 10, currency: 'USD' };
  assert.equal(GRADERS.amount.grade(out, gold), 1);
  assert.equal(GRADERS.strict.grade(out, gold), 0);
  assert.equal(GRADERS.partial.grade(out, gold), 0.5);
});

test('a grader scores a missing answer as zero, not as an exception', () => {
  for (const g of Object.values(GRADERS)) {
    assert.equal(g.grade(null, { amount: 1, currency: 'USD' }), 0);
  }
});

test('v2 really is better on the full set', () => {
  const a = runEval(SYSTEMS.v1, GRADERS.strict, items);
  const b = runEval(SYSTEMS.v2, GRADERS.strict, items);
  assert.ok(b.mean > a.mean, 'the improved parser did not improve anything');
  const ci = pairedDiffCI(a.scores, b.scores);
  assert.ok(ci.conclusive, 'at 800 items the difference should be conclusive');
});

test('and at a hundred items you cannot tell', () => {
  /* The claim the page is built on, asserted so that it cannot quietly stop
     being true if the item generator is ever touched. */
  const small = items.slice(0, 100);
  const a = runEval(SYSTEMS.v1, GRADERS.strict, small);
  const b = runEval(SYSTEMS.v2, GRADERS.strict, small);
  const ci = pairedDiffCI(a.scores, b.scores);
  assert.ok(!ci.conclusive,
    `100 items gave a conclusive interval [${ci.low.toFixed(3)}, ${ci.high.toFixed(3)}] — the demonstration has broken`);
});

test('the eval set contains items that both systems fail', () => {
  /* Without these, McNemar's "neither" cell is empty and the set is claiming
     there is no headroom left, which is never true of anything real. */
  const a = runEval(SYSTEMS.v1, GRADERS.strict, items);
  const b = runEval(SYSTEMS.v2, GRADERS.strict, items);
  assert.ok(mcnemar(a.scores, b.scores).neither > 0, 'every item is solved by one system or the other');
});

test('disagreements account for exactly the change in score', () => {
  const a = runEval(SYSTEMS.v1, GRADERS.strict, items);
  const b = runEval(SYSTEMS.v2, GRADERS.strict, items);
  const d = disagreements(items, a, b);
  const fixed = d.filter((x) => x.direction === 'fixed').length;
  const broken = d.filter((x) => x.direction === 'broken').length;
  assert.close((fixed - broken) / items.length, b.mean - a.mean, 1e-12);
});

test('the per-format breakdown covers every item exactly once', () => {
  const a = runEval(SYSTEMS.v1, GRADERS.strict, items);
  const rows = byFormat(items, a);
  assert.equal(rows.reduce((n, r) => n + r.n, 0), items.length);
  assert.close(rows.reduce((s, r) => s + r.score, 0) / items.length, a.mean, 1e-12);
});
