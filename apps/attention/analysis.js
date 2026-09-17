/* apps/attention/analysis.js — finding a circuit by its signature.

   The claim this page makes is that a specific mechanism appears in training,
   at a specific moment. That is a claim you can either assert over a picture or
   MEASURE, and the difference between those two things is the difference
   between an illustration and a result.

   So: an induction head has a shape. On a sequence that repeats with period p,
   a head performing induction, when it is at position i inside the repeat,
   attends to the position immediately AFTER the previous occurrence of the
   token it is currently looking at — which on a cleanly repeating sequence is
   exactly i − p + 1. The pattern is a straight off-diagonal stripe, and the
   score below is the mean attention weight sitting on it.

   The period is drawn fresh for every sequence, so the stripe is in a different
   place each time and there is no fixed offset a model could memorise instead.
   That matters: an earlier version of the task repeated at a fixed point, and
   what appeared was a head scoring 0.92 by attending to position i − 31 without
   ever reading a token. It looked exactly like the real thing on the screen.

   A head that has learned nothing spreads its attention over everything it can
   see; at position i that is i + 1 positions, so the expected weight on any one
   of them is about 1/(i+1). The score is reported against that baseline, so
   "0.9" means the head is putting nine tenths of its attention on one specific
   earlier position — which is not something that happens by accident. */

/**
 * How strongly `pattern` performs induction on a sequence with the given period.
 *
 * Averaged over the repeated part only, because the first `period` tokens are
 * noise and there is nothing there to copy from. The period is passed in rather
 * than assumed, because it is drawn fresh for every sequence — a score that
 * assumed a fixed offset would be measuring the wrong diagonal.
 */
export function inductionScore(pattern, period) {
  const T = pattern.rows;
  let total = 0, n = 0;
  for (let i = period; i < T; i++) {
    /* EVERY valid previous occurrence, not just the most recent one.
       A sequence of length 64 with period 12 contains the block five times
       over, so the token that follows a previous occurrence of the current
       token sits at i+1−12, and at i+1−24, and at i+1−36. All of them are
       correct places to copy from and a head is free to prefer any of them.

       Scoring only the nearest one was a bug in the measurement, not in the
       model, and it produced a beautifully misleading result: the score rose
       smoothly from 0.17 at period 12 to 0.60 at period 36, which looks
       exactly like a head that works better at long range. It was the same
       head all along, having its attention counted once out of five times. */
    for (let target = i - period + 1; target >= 0; target -= period) {
      total += pattern.at(i, target);
    }
    n++;
  }
  return n === 0 ? 0 : total / n;
}

/**
 * How strongly `pattern` is a previous-token head: does position i look at i−1?
 *
 * This is the other half of the circuit and the reason a single layer cannot do
 * induction. A previous-token head in layer 0 writes "the token before me was
 * X" into each position; a head in layer 1 can then match on that. Neither is
 * useful alone, which is why the loss curve sits flat for a long time and then
 * falls off a cliff — two pieces have to arrive before either pays.
 */
export function previousTokenScore(pattern) {
  const T = pattern.rows;
  let total = 0, n = 0;
  for (let i = 1; i < T; i++) { total += pattern.at(i, i - 1); n++; }
  return n === 0 ? 0 : total / n;
}

/**
 * What a head that had learned nothing would score, given causal masking.
 *
 * Counts the same set of targets the score does — all the valid previous
 * occurrences — so that the two numbers are comparable. A short period offers
 * more places to be right by accident, and the baseline has to say so or the
 * comparison flatters the model exactly where the task is easiest.
 */
export function uniformBaseline(T, period) {
  let total = 0, n = 0;
  for (let i = period; i < T; i++) {
    let targets = 0;
    for (let target = i - period + 1; target >= 0; target -= period) targets++;
    total += targets / (i + 1);
    n++;
  }
  return n === 0 ? 0 : total / n;
}

/**
 * Score every head in a model on one sequence, and name the best of each kind.
 *
 * Returns the whole grid rather than only the winner, because "head 1.2 is the
 * induction head" is only interesting next to the other seven heads scoring
 * nothing — otherwise the reader has to take on trust that it was not simply
 * the best of eight equally good candidates.
 */
export function profile(model, tokens, period = tokens.period) {
  if (!period) throw new Error('scoring induction needs the sequence period');
  const { attention } = model.forward(tokens);
  const baseline = uniformBaseline(tokens.length, period);
  const heads = [];
  for (let l = 0; l < attention.length; l++) {
    for (let h = 0; h < attention[l].length; h++) {
      const pattern = attention[l][h];
      heads.push({
        layer: l,
        head: h,
        label: `${l}.${h}`,
        pattern,
        induction: inductionScore(pattern, period),
        previous: previousTokenScore(pattern),
      });
    }
  }
  const best = (key) => heads.reduce((a, b) => (b[key] > a[key] ? b : a));
  return {
    heads,
    baseline,
    inductionHead: best('induction'),
    previousTokenHead: best('previous'),
  };
}

/**
 * The fraction of the repeated part the model gets right, greedily.
 *
 * The loss is the honest measure and this is the legible one — a percentage
 * anybody can read without knowing what a nat is. They agree: when this passes
 * 99%, the loss is at its floor.
 */
export function copyAccuracy(model, tokens, period = tokens.period) {
  const { logits } = model.forward(tokens.slice(0, -1));
  let right = 0, n = 0;
  /* From period onward: position `period` is the last one that cannot be known,
     because up to there the model has seen nothing but noise. */
  for (let i = period; i < logits.rows; i++) {
    let best = 0;
    for (let c = 1; c < logits.cols; c++) if (logits.at(i, c) > logits.at(i, best)) best = c;
    if (best === tokens[i + 1]) right++;
    n++;
  }
  return n === 0 ? 0 : right / n;
}
