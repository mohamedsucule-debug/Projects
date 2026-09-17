/* apps/evals/stats.js — the statistics an eval needs and usually does not have.

   The single most common mistake in evaluating a language model is running 100
   examples, getting 89% for the old prompt and 92% for the new one, and
   shipping the new one. Three points on a hundred items is not a result. It is
   inside the noise, and you can prove that in about fifteen lines of
   resampling, which is what this file is.

   Three ideas, in the order they matter:

   1. A score is an ESTIMATE. 92% on 100 items means "somewhere around 92%",
      and how wide "around" is depends only on the number of items. Report the
      interval or you have not reported anything.

   2. Compare PAIRED. Both systems should see the same items, and what you
      resample is the per-item DIFFERENCE, not the two scores separately. Item
      difficulty then cancels out, and the interval is typically half as wide
      for free — often the difference between a conclusive run and an
      inconclusive one at the same cost.

   3. Decide the sample size BEFORE looking. If you need to detect three
      points, ask how many items that takes, and if the answer is more than you
      are willing to run, you have learned something important before spending
      anything.

   Nothing here is novel. All of it is routinely skipped. */

/* ── the basics ─────────────────────────────────────────────────────────── */

export const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  /* n−1, not n. With n in the denominator this underestimates the spread, and
     it does so worst exactly when the sample is small — which is when you were
     most in danger of over-reading the result. */
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** mulberry32. Seeded, so a confidence interval is the same one twice. */
export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── the bootstrap ──────────────────────────────────────────────────────────
   Resample the results you have, with replacement, a few thousand times; the
   spread of the resampled means is the sampling distribution of the mean. It
   needs no assumption about the shape of the data, which matters because eval
   scores are rarely normal — they are usually 0/1, or a rubric with three
   levels, or something bimodal where the model either nails it or falls over. */

export function bootstrapMeanCI(xs, { iters = 4000, alpha = 0.05, seed = 12345 } = {}) {
  if (xs.length === 0) throw new Error('nothing to bootstrap');
  const next = rng(seed);
  const n = xs.length;
  const means = new Float64Array(iters);
  for (let i = 0; i < iters; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += xs[(next() * n) | 0];
    means[i] = sum / n;
  }
  const sorted = Float64Array.from(means).sort();
  return {
    estimate: mean(xs),
    low: quantile(sorted, alpha / 2),
    high: quantile(sorted, 1 - alpha / 2),
    n,
  };
}

/**
 * The confidence interval on the DIFFERENCE, resampling items rather than
 * scores.
 *
 * This is the one that decides whether you ship. Both systems answered the same
 * items, so the unit being resampled is the item — carrying both outcomes with
 * it. An item that is hard for everyone contributes nothing to the difference
 * and therefore nothing to the uncertainty about the difference, which is
 * exactly right and is what comparing two separate intervals throws away.
 */
export function pairedDiffCI(a, b, { iters = 4000, alpha = 0.05, seed = 999 } = {}) {
  if (a.length !== b.length) throw new Error('paired comparison needs the same items on both sides');
  if (a.length === 0) throw new Error('nothing to compare');
  const n = a.length;
  const d = a.map((v, i) => b[i] - v);
  const next = rng(seed);
  const diffs = new Float64Array(iters);
  for (let i = 0; i < iters; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += d[(next() * n) | 0];
    diffs[i] = sum / n;
  }
  const sorted = Float64Array.from(diffs).sort();
  const low = quantile(sorted, alpha / 2);
  const high = quantile(sorted, 1 - alpha / 2);
  /* The fraction of resamples on the wrong side of zero: a bootstrap p-value,
     doubled for a two-sided question. Reported because "the interval contains
     zero" and "it is 3% likely to be the other way round" are different
     amounts of nervous. */
  let wrongSide = 0;
  const observed = mean(d);
  for (const v of diffs) if (observed >= 0 ? v <= 0 : v >= 0) wrongSide++;
  return {
    estimate: observed,
    low, high, n,
    conclusive: low > 0 || high < 0,
    p: Math.min(1, (2 * wrongSide) / iters),
  };
}

/**
 * The same comparison done WRONG, for contrast: two independent intervals,
 * pretending the two systems saw unrelated items.
 *
 * Kept because the page's whole argument is that it is noticeably wider, and
 * an argument like that should be demonstrated rather than asserted.
 */
export function unpairedDiffCI(a, b, { iters = 4000, alpha = 0.05, seed = 777 } = {}) {
  const next = rng(seed);
  const diffs = new Float64Array(iters);
  for (let i = 0; i < iters; i++) {
    let sa = 0, sb = 0;
    for (let j = 0; j < a.length; j++) sa += a[(next() * a.length) | 0];
    for (let j = 0; j < b.length; j++) sb += b[(next() * b.length) | 0];
    diffs[i] = sb / b.length - sa / a.length;
  }
  const sorted = Float64Array.from(diffs).sort();
  const low = quantile(sorted, alpha / 2);
  const high = quantile(sorted, 1 - alpha / 2);
  return { estimate: mean(b) - mean(a), low, high, conclusive: low > 0 || high < 0 };
}

/** Linear-interpolated quantile of an already-sorted array. */
export function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/* ── proportions, in closed form ────────────────────────────────────────── */

/**
 * Wilson score interval for a proportion.
 *
 * Not `p ± 1.96·sqrt(p(1−p)/n)`, which is the one everybody writes and which
 * is actively wrong near 0 and 1 — at 20/20 it gives [1, 1], claiming certainty
 * from twenty observations, and at 0/30 it gives [0, 0]. Wilson gives
 * [0.839, 1] and [0, 0.113], which are the honest answers.
 */
export function wilson(successes, n, z = 1.959964) {
  if (n === 0) return { estimate: NaN, low: 0, high: 1 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { estimate: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/**
 * McNemar's test: the right test for "did this change help", on paired
 * pass/fail data.
 *
 * Its insight is that items both systems got right, and items both got wrong,
 * carry NO information about which is better — only the disagreements do. So a
 * change that fixes 8 items and breaks 5 is judged on 13 observations, not on
 * 400, and the honest verdict is usually "we cannot tell yet".
 *
 * Exact binomial rather than the chi-squared approximation, because the
 * discordant count is routinely under 25, which is exactly where the
 * approximation stops being trustworthy.
 */
export function mcnemar(a, b) {
  if (a.length !== b.length) throw new Error('McNemar needs paired outcomes');
  let onlyA = 0, onlyB = 0, both = 0, neither = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] > 0.5, y = b[i] > 0.5;
    if (x && y) both++;
    else if (x && !y) onlyA++;
    else if (!x && y) onlyB++;
    else neither++;
  }
  const discordant = onlyA + onlyB;
  const k = Math.min(onlyA, onlyB);
  let p = 1;
  if (discordant > 0) {
    let tail = 0;
    for (let i = 0; i <= k; i++) tail += Math.exp(logChoose(discordant, i) - discordant * Math.LN2);
    p = Math.min(1, 2 * tail);
  }
  return { both, neither, onlyA, onlyB, discordant, p };
}

function logChoose(n, k) {
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

/** Lanczos approximation. Accurate to about 15 digits, which is ample here. */
function logGamma(x) {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < g.length; i++) a += g[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/* ── how many items do you actually need ────────────────────────────────── */

/**
 * Items needed to detect a change from `p1` to `p2` with the given power.
 *
 * The number this returns is the thing worth knowing before a run rather than
 * after one. Detecting a move from 85% to 88% at 80% power takes roughly two
 * thousand items PER SIDE — so a 100-item eval was never going to see it, and
 * the 92-versus-89 you got was going to be noise whatever it said.
 *
 * This is the unpaired formula, which is the conservative one. Pairing usually
 * does better, by an amount that depends on how correlated the two systems are
 * — which you do not know in advance, which is why you plan with this.
 */
export function requiredN(p1, p2, { alpha = 0.05, power = 0.8 } = {}) {
  if (p1 === p2) return Infinity;
  const zA = normalQuantile(1 - alpha / 2);
  const zB = normalQuantile(power);
  const pBar = (p1 + p2) / 2;
  const numerator =
    zA * Math.sqrt(2 * pBar * (1 - pBar)) +
    zB * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  return Math.ceil((numerator * numerator) / ((p1 - p2) * (p1 - p2)));
}

/** Inverse normal CDF — Acklam's rational approximation, |error| < 1.15e-9. */
export function normalQuantile(p) {
  if (p <= 0 || p >= 1) throw new Error('normalQuantile needs a probability strictly between 0 and 1');
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];
  const plow = 0.02425, phigh = 1 - plow;
  let q, r;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > phigh) return -normalQuantile(1 - p);
  q = p - 0.5;
  r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
         (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * The smallest true difference this many items could reliably detect.
 *
 * The inverse question, and the more useful one when the eval set is fixed:
 * you have 200 items, so what size of change is even visible? Anything smaller
 * than what comes back cannot be measured with what you have, and no amount of
 * staring at the number will change that.
 */
export function detectableEffect(n, baseline, { alpha = 0.05, power = 0.8 } = {}) {
  let lo = 0, hi = Math.min(baseline, 1 - baseline);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (requiredN(baseline, baseline + mid, { alpha, power }) <= n) hi = mid; else lo = mid;
  }
  return hi;
}
