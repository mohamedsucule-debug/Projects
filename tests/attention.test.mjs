/* tests/attention.test.mjs — the transformer, the samplers, the quantiser, and
   one end-to-end check that the whole stack can actually learn something.

   The gradient checks in autograd.test.mjs prove each operation's derivative is
   right. They cannot prove the model is wired correctly on top of them — a
   transformer with its keys and queries swapped has perfect gradients and
   learns nothing. So the last test here trains a small one on a task with an
   obvious answer and asserts the loss comes down. It takes about a second and
   it is the only test in this file that would catch that class of mistake. */

import { test, assert } from './harness.mjs';
import { Tensor, backward, rng } from '../apps/attention/autograd.js';
import {
  Transformer, applyTemperature, softmax, topK, topP, minP, sampleFrom, chooseToken,
} from '../apps/attention/model.js';
import { Adam, clipGradients, schedule } from '../apps/attention/optim.js';
import { quantise, dequantise, maxError, toBase64, fromBase64, packParams, unpackParams } from '../apps/attention/quantise.js';
import { inductionSequence, inductionFloor, buildVocabulary, textBatch } from '../apps/attention/data.js';
import { inductionScore, previousTokenScore, uniformBaseline, profile, copyAccuracy } from '../apps/attention/analysis.js';

const tiny = () => new Transformer({ vocab: 12, dModel: 16, nHeads: 2, nLayers: 2, ctx: 10, seed: 3 });

/* ── the model ──────────────────────────────────────────────────────────── */

test('parameter count is the sum of every matrix', () => {
  const m = tiny();
  assert.equal(m.parameterCount(), m.parameters().reduce((n, p) => n + p.data.length, 0));
});

test('forward returns logits per position and a pattern per head', () => {
  const m = tiny();
  const { logits, attention } = m.forward([1, 2, 3, 4]);
  assert.equal(logits.rows, 4);
  assert.equal(logits.cols, 12);
  assert.equal(attention.length, 2);
  assert.equal(attention[0].length, 2);
  assert.equal(attention[0][0].rows, 4);
  assert.equal(attention[0][0].cols, 4);
});

test('no head can see the future', () => {
  const m = tiny();
  const { attention } = m.forward([1, 2, 3, 4, 5]);
  for (const layer of attention) {
    for (const head of layer) {
      for (let i = 0; i < head.rows; i++) {
        for (let j = i + 1; j < head.cols; j++) {
          assert.equal(head.at(i, j), 0, `a head looked forward from ${i} to ${j}`);
        }
      }
    }
  }
});

test('every attention row is a distribution', () => {
  const m = tiny();
  const { attention } = m.forward([3, 1, 4, 1, 5]);
  for (const layer of attention) {
    for (const head of layer) {
      for (let i = 0; i < head.rows; i++) {
        let sum = 0;
        for (let j = 0; j <= i; j++) sum += head.at(i, j);
        assert.close(sum, 1, 1e-12, `row ${i} summed to ${sum}`);
      }
    }
  }
});

test('an untrained model sits at log(vocab)', () => {
  /* Initialisation that starts far from uniform is initialisation that has to
     be undone before anything can be learned. */
  const m = tiny();
  const { loss } = m.loss([1, 2, 3, 4, 5, 6]);
  assert.close(loss.data[0], Math.log(12), 0.25);
});

test('a sequence longer than the context window is refused', () => {
  assert.throws(() => tiny().forward([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
});

test('an empty sequence is refused', () => {
  assert.throws(() => tiny().forward([]));
});

test('heads that do not divide the width are refused', () => {
  assert.throws(() => new Transformer({ dModel: 10, nHeads: 3 }));
});

test('a model round-trips through JSON exactly', () => {
  const m = tiny();
  const before = m.forward([1, 2, 3]).logits.toArray();
  const copy = Transformer.fromJSON(JSON.parse(JSON.stringify(m.toJSON())));
  const after = copy.forward([1, 2, 3]).logits.toArray();
  for (let i = 0; i < before.length; i++) {
    for (let j = 0; j < before[i].length; j++) assert.close(after[i][j], before[i][j], 1e-4);
  }
});

test('loading weights of the wrong shape is refused rather than reinterpreted', () => {
  const json = tiny().toJSON();
  json.params[0].rows += 1;
  assert.throws(() => Transformer.fromJSON(json));
});

test('predict returns the distribution after the last token', () => {
  const m = tiny();
  const { logits } = m.predict([1, 2, 3]);
  assert.equal(logits.length, 12);
  assert.ok(logits.every(Number.isFinite));
});

/* ── sampling ───────────────────────────────────────────────────────────── */

test('temperature zero is the argmax, not a division by zero', () => {
  const out = applyTemperature([1, 5, 3], 0);
  assert.deep(out, [-Infinity, 0, -Infinity]);
  assert.deep(softmax(out), [0, 1, 0]);
});

test('low temperature sharpens, high temperature flattens', () => {
  const logits = [2, 1, 0];
  const sharp = softmax(applyTemperature(logits, 0.5));
  const flat = softmax(applyTemperature(logits, 2));
  assert.ok(sharp[0] > flat[0], 'cooling should concentrate mass on the best token');
  assert.ok(flat[2] > sharp[2], 'heating should lift the worst token');
});

test('a negative temperature is refused', () => {
  assert.throws(() => applyTemperature([1, 2], -1));
});

test('top-k keeps exactly k tokens and renormalises', () => {
  const probs = topK([0.4, 0.3, 0.2, 0.1], 2);
  assert.equal(probs.filter((p) => p > 0).length, 2);
  assert.close(probs.reduce((a, b) => a + b, 0), 1, 1e-12);
  assert.close(probs[0], 0.4 / 0.7, 1e-12);
});

test('top-k wider than the vocabulary changes nothing', () => {
  assert.deep(topK([0.5, 0.5], 9), [0.5, 0.5]);
});

test('top-p keeps the token that crosses the threshold', () => {
  /* The subtlety everybody gets wrong. The top token here has 0.95 of the
     mass, and p = 0.9. Dropping the token that crosses the line would leave
     nothing at all. */
  const probs = topP([0.95, 0.03, 0.02], 0.9);
  assert.ok(probs[0] > 0, 'top-p threw away the only likely token');
  assert.equal(probs.filter((p) => p > 0).length, 1);
  assert.close(probs[0], 1, 1e-12);
});

test('top-p keeps adding until it reaches the mass', () => {
  const probs = topP([0.4, 0.3, 0.2, 0.1], 0.9);
  assert.equal(probs.filter((p) => p > 0).length, 3);
});

test('top-p of one changes nothing', () => {
  assert.deep(topP([0.6, 0.4], 1), [0.6, 0.4]);
});

test('min-p cuts relative to the best token, not to a fixed mass', () => {
  /* The property that makes it behave at high temperature: when the model is
     confident the cut is aggressive, when it is unsure the cut is generous. */
  const confident = minP([0.9, 0.06, 0.04], 0.1);
  assert.equal(confident.filter((p) => p > 0).length, 1);
  const unsure = minP([0.3, 0.28, 0.25, 0.17], 0.1);
  assert.equal(unsure.filter((p) => p > 0).length, 4);
});

test('sampling picks the bucket the number falls in', () => {
  const probs = [0.25, 0.25, 0.5];
  assert.equal(sampleFrom(probs, 0.1), 0);
  assert.equal(sampleFrom(probs, 0.3), 1);
  assert.equal(sampleFrom(probs, 0.9), 2);
});

test('sampling survives a draw that falls off the end of a rounded sum', () => {
  /* Floating-point sums do not always reach exactly 1, so a draw of
     0.9999999 can walk off the end. Returning the last live token is correct;
     the alternative is a crash nobody can reproduce. */
  assert.equal(sampleFrom([0.5, 0.5], 0.99999999999), 1);
  assert.equal(sampleFrom([0.5, 0.5, 0], 0.99999999999), 1);
});

test('filtering everything out is an error, not a silent zero', () => {
  assert.throws(() => topK([0, 0, 0], 2));
});

test('chooseToken applies temperature before the cutoffs', () => {
  /* Order matters and is not arbitrary: top-k on a heated distribution keeps a
     different set than heating a truncated one. Cooling to nothing and then
     taking the top 2 must still leave exactly one live token. */
  const { probs } = chooseToken([1, 2, 3], { temperature: 0, k: 2 }, 0.5);
  assert.equal(probs.filter((p) => p > 0).length, 1);
  assert.close(probs[2], 1, 1e-12);
});

/* ── quantisation ───────────────────────────────────────────────────────── */

test('int8 round-trip stays within half a step', () => {
  const data = Float64Array.from({ length: 500 }, (_, i) => Math.sin(i) * 0.4);
  const { scale, q } = quantise(data);
  assert.ok(maxError(data, q, scale) <= scale / 2 + 1e-12,
    'a rounded value should never be more than half a step from the original');
});

test('the largest weight lands on the end of the range', () => {
  const { scale, q } = quantise(Float64Array.from([0.5, -0.25, 0.1]));
  assert.equal(Math.max(...q), 127);
  assert.close(0.5, 127 * scale, 1e-12);
});

test('an all-zero matrix survives quantisation', () => {
  /* The bias vectors start like this, and dividing by a zero scale gives a
     matrix of NaN that then poisons every logit. */
  const { scale, q } = quantise(new Float64Array(20));
  assert.ok(Number.isFinite(scale) && scale > 0);
  assert.ok(Array.from(dequantise(q, scale)).every((v) => v === 0));
});

test('quantisation rounds rather than truncates', () => {
  /* Truncation biases every weight towards zero, and a bias applied to forty
     thousand parameters at once is a systematic shrink of the model. */
  const data = Float64Array.from([1, 0.999, -0.999]);
  const { scale, q } = quantise(data);
  assert.equal(q[1], Math.round(0.999 / scale));
});

test('base64 round-trips signed bytes, including the negatives', () => {
  const int8 = Int8Array.from([-128, -127, -1, 0, 1, 126, 127]);
  assert.deep(Array.from(fromBase64(toBase64(int8))), Array.from(int8));
});

test('base64 round-trips an array too big for one function call', () => {
  /* String.fromCharCode.apply throws on about a hundred thousand arguments,
     which is comfortably past anything you would try by hand and comfortably
     under the size of a real weight matrix. */
  const big = Int8Array.from({ length: 200000 }, (_, i) => (i % 255) - 127);
  const back = fromBase64(toBase64(big));
  assert.equal(back.length, big.length);
  assert.equal(back[0], big[0]);
  assert.equal(back[199999], big[199999]);
});

test('a packed model still computes almost the same logits', () => {
  const m = tiny();
  const before = m.predict([1, 2, 3]).logits;
  const copy = Transformer.fromJSON({ config: m.cfg, params: unpackParams(packParams(m.parameters())) });
  const after = copy.predict([1, 2, 3]).logits;
  for (let i = 0; i < before.length; i++) assert.close(after[i], before[i], 0.05);
});

/* ── the task ───────────────────────────────────────────────────────────── */

test('a generated sequence really does repeat at its stated period', () => {
  const next = rng(11);
  for (let t = 0; t < 40; t++) {
    const s = inductionSequence(next, { vocab: 32, length: 64 });
    assert.equal(s.length, 64);
    for (let i = s.period; i < s.length; i++) {
      assert.equal(s[i], s[i - s.period], `token ${i} does not match ${i - s.period}`);
    }
  }
});

test('the period varies from sequence to sequence', () => {
  /* The whole reason this generator was rewritten. With a fixed period the
     model solves the task from positional embeddings alone — it attends to a
     memorised offset and never looks at a token. */
  const next = rng(12);
  const periods = new Set();
  for (let i = 0; i < 60; i++) periods.add(inductionSequence(next, { vocab: 32, length: 64 }).period);
  assert.ok(periods.size > 8, `only ${periods.size} distinct periods in 60 sequences`);
});

test('the loss floor is between perfect and uniform', () => {
  const floor = inductionFloor(64, 64);
  assert.ok(floor > 0 && floor < Math.log(64), `floor ${floor} is not a sane target`);
  assert.close(floor, 1.7164, 1e-3);
});

test('a character vocabulary round-trips its own corpus', () => {
  const v = buildVocabulary('the keeper watched');
  assert.equal(v.decode(v.encode('the keeper watched')), 'the keeper watched');
  assert.equal(v.size, new Set('the keeper watched').size);
});

test('text batches are one longer than the window, for the targets', () => {
  const ids = Int32Array.from({ length: 200 }, (_, i) => i % 7);
  const batch = textBatch(rng(1), { ids, len: 16, batch: 4 });
  assert.equal(batch.length, 4);
  for (const b of batch) assert.equal(b.length, 17);
});

test('a corpus shorter than one window is refused', () => {
  assert.throws(() => textBatch(rng(1), { ids: Int32Array.from([1, 2]), len: 16, batch: 1 }));
});

/* ── the analysis ───────────────────────────────────────────────────────── */

test('a perfect induction pattern scores one', () => {
  /* Built by hand: every position in the repeat attends entirely to the token
     after the previous occurrence. If the score is not 1 on this, it is
     measuring the wrong diagonal. */
  const T = 20, period = 7;
  const p = Tensor.zeros(T, T);
  for (let i = 0; i < T; i++) {
    const target = i >= period ? i - period + 1 : 0;
    p.put(i, target, 1);
  }
  assert.close(inductionScore(p, period), 1, 1e-12);
});

test('copying from an older occurrence counts too', () => {
  /* A 20-long sequence with period 7 contains the block nearly three times, so
     the token following a previous occurrence sits at i+1−7 AND at i+1−14. Both
     are correct places to copy from and a head may prefer either.

     The first version of this score only counted the nearest one, and the
     result was beautifully misleading: it rose smoothly from 0.17 at period 12
     to 0.60 at period 36, which reads exactly like a head that works better at
     long range. It was one head all along, having its attention counted once
     out of five times. */
  const T = 20, period = 7;
  const far = Tensor.zeros(T, T);
  for (let i = 0; i < T; i++) {
    const nearest = i - period + 1;
    const older = nearest - period;
    far.put(i, older >= 0 ? older : Math.max(0, nearest), 1);
  }
  assert.ok(inductionScore(far, period) > 0.9,
    'a head copying from an older occurrence is still doing induction');
});

test('the chance baseline counts the same targets the score does', () => {
  /* A short period offers more places to be right by accident. If the baseline
     did not say so, the comparison would flatter the model exactly where the
     task is easiest. */
  assert.ok(uniformBaseline(64, 12) > uniformBaseline(64, 40),
    'a shorter period should have a higher chance level');
});

test('a head attending only to the previous token scores nothing for induction', () => {
  const T = 20, period = 7;
  const p = Tensor.zeros(T, T);
  for (let i = 1; i < T; i++) p.put(i, i - 1, 1);
  p.put(0, 0, 1);
  assert.close(previousTokenScore(p), 1, 1e-12);
  assert.ok(inductionScore(p, period) < 0.01, 'a previous-token head is not an induction head');
});

test('the uniform baseline is what spreading your attention evenly gets you', () => {
  const b = uniformBaseline(64, 30);
  assert.ok(b > 0 && b < 0.05, `baseline ${b} is not a plausible chance level`);
});

test('profiling refuses a sequence with no period attached', () => {
  assert.throws(() => profile(tiny(), [1, 2, 3]));
});

/* ── end to end ─────────────────────────────────────────────────────────── */

test('the whole stack can learn something', () => {
  /* A task with one obvious answer: whatever token you see, predict the next
     one round a fixed cycle. Every gradient in this repo is verified against
     finite differences, but a model with its keys and queries transposed has
     perfect gradients and learns nothing — this is the test that would catch
     that, and nothing in autograd.test.mjs can. */
  const m = new Transformer({ vocab: 6, dModel: 24, nHeads: 2, nLayers: 1, ctx: 13, seed: 5 });
  const params = m.parameters();
  const opt = new Adam(params, { lr: 0.05 });
  const seq = Array.from({ length: 13 }, (_, i) => i % 6);

  const before = m.loss(seq).loss.data[0];
  for (let step = 0; step < 60; step++) {
    opt.zeroGrad();
    const { loss } = m.loss(seq);
    backward(loss);
    clipGradients(params, 1);
    opt.step(schedule(step, { total: 60, peak: 0.05 }));
  }
  const after = m.loss(seq).loss.data[0];

  assert.ok(before > 1.5, `expected to start near log(6) = 1.79, got ${before}`);
  assert.ok(after < before * 0.35,
    `loss went from ${before.toFixed(3)} to ${after.toFixed(3)} — the model is not learning`);
});

test('Adam finds the bottom of a bowl', () => {
  /* The optimiser on its own, away from any model: minimise (x−3)² + (y+2)².
     If this does not converge, nothing built on it will. */
  const x = Tensor.from(1, 2, [0, 0]);
  x.isParam = true;
  const opt = new Adam([x], { lr: 0.2 });
  for (let i = 0; i < 400; i++) {
    x.zeroGrad();
    const g = x.ensureGrad();
    g[0] = 2 * (x.data[0] - 3);
    g[1] = 2 * (x.data[1] + 2);
    opt.step();
  }
  assert.close(x.data[0], 3, 1e-3);
  assert.close(x.data[1], -2, 1e-3);
});

test('gradient clipping scales the whole vector, preserving its direction', () => {
  /* Clipping each parameter separately changes the DIRECTION of the step, not
     just its size, and a direction that depends on step size is not a
     gradient any more. */
  const a = Tensor.from(1, 2, [0, 0]), b = Tensor.from(1, 1, [0]);
  a.ensureGrad().set([3, 4]);
  b.ensureGrad()[0] = 12;
  const norm = clipGradients([a, b], 6.5);
  assert.close(norm, 13, 1e-9);
  assert.close(a.grad[0] / a.grad[1], 3 / 4, 1e-9);
  assert.close(Math.hypot(a.grad[0], a.grad[1], b.grad[0]), 6.5, 1e-3);
});

test('gradients under the threshold are left alone', () => {
  const a = Tensor.from(1, 2, [0, 0]);
  a.ensureGrad().set([0.3, 0.4]);
  clipGradients([a], 10);
  assert.close(a.grad[0], 0.3, 1e-12);
});

test('the schedule warms up and then decays', () => {
  const at = (t) => schedule(t, { total: 1000, peak: 1e-3 });
  assert.ok(at(0) < at(20), 'the first steps should be smaller than the peak');
  assert.close(at(49), 1e-3, 1e-9);
  assert.ok(at(999) < at(500), 'it should be decaying by the end');
  assert.ok(at(999) >= 1e-4 - 1e-9, 'it should not decay past the floor');
});
