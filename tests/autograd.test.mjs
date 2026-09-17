/* tests/autograd.test.mjs — every backward pass, checked against the
   definition of a derivative.

   This is the only test file in this repo that had to exist before the code it
   tests was useful. A wrong forward pass throws or produces obvious nonsense.
   A wrong BACKWARD pass does neither: the model still trains, just worse, and
   there is no symptom to chase — you end up tuning the learning rate for a
   week to work around a sign error.

   The check is the definition: nudge one input up and down by h, see how much
   the output moved, compare that to what the backward pass claims. If they
   disagree by more than rounding, the backward pass is wrong. */

import { test, assert } from './harness.mjs';
import {
  Tensor, backward, matmul, add, scale, transpose, gatherRows, firstRows,
  concatCols, causalSoftmax, softmaxRows, layerNorm, crossEntropy, rng, randn,
} from '../apps/attention/autograd.js';

const r = rng(7);
const rand = (rows, cols) => {
  const t = new Tensor(rows, cols);
  for (let i = 0; i < t.data.length; i++) t.data[i] = randn(r);
  return t;
};

/** Sum every element, so any op can be reduced to a scalar to differentiate. */
function sumAll(t) {
  const out = new Tensor(1, 1);
  for (let i = 0; i < t.data.length; i++) out.data[0] += t.data[i];
  out.parents = [t];
  out._backward = (g) => { const gt = t.ensureGrad(); for (let i = 0; i < gt.length; i++) gt[i] += g[0]; };
  return out;
}

/**
 * Compare the analytic gradient of `f` with respect to each input against
 * central differences. h = 1e-5 with a 1e-6 tolerance is comfortable in double
 * precision and would be hopeless in single.
 */
function gradCheck(name, inputs, f, { h = 1e-5, tol = 1e-6 } = {}) {
  test(name, () => {
    const loss = f();
    backward(loss);
    const analytic = inputs.map((t) => (t.grad ? t.grad.slice() : new Float64Array(t.data.length)));

    for (let n = 0; n < inputs.length; n++) {
      const t = inputs[n];
      for (let i = 0; i < t.data.length; i++) {
        const original = t.data[i];
        t.data[i] = original + h;
        const up = f().data[0];
        t.data[i] = original - h;
        const down = f().data[0];
        t.data[i] = original;

        const numeric = (up - down) / (2 * h);
        const got = analytic[n][i];
        const size = Math.max(1, Math.abs(numeric), Math.abs(got));
        if (Math.abs(numeric - got) / size > tol) {
          throw new Error(
            `input ${n}[${i}]: backward says ${got.toFixed(9)}, ` +
            `finite differences say ${numeric.toFixed(9)}`);
        }
      }
    }
  });
}

/* ── one op at a time ───────────────────────────────────────────────────── */

{
  const a = rand(3, 4), b = rand(4, 2);
  gradCheck('matmul', [a, b], () => sumAll(matmul(a, b)));
}

{
  const a = rand(3, 4), b = rand(3, 4);
  gradCheck('add', [a, b], () => sumAll(add(a, b)));
}

{
  const a = rand(4, 3), bias = rand(1, 3);
  gradCheck('add, broadcasting a bias row down every row', [a, bias],
    () => sumAll(add(a, bias)));
}

{
  const a = rand(3, 3);
  gradCheck('scale', [a], () => sumAll(scale(a, -2.5)));
}

{
  const a = rand(3, 5);
  gradCheck('transpose', [a], () => sumAll(transpose(a)));
}

{
  const table = rand(6, 3);
  /* Token 2 appears twice on purpose: a gather has to ADD the two gradients
     that come back to the same row, not overwrite one with the other. */
  gradCheck('gatherRows, with a row picked twice', [table],
    () => sumAll(gatherRows(table, [2, 0, 2, 5])));
}

{
  const a = rand(6, 3);
  gradCheck('firstRows', [a], () => sumAll(firstRows(a, 4)));
}

{
  const p = rand(3, 2), q = rand(3, 4);
  gradCheck('concatCols', [p, q], () => sumAll(concatCols([p, q])));
}

{
  const s = rand(5, 5);
  /* Squaring first: the sum of a softmax row is 1 by construction, so summing
     it straight gives a constant and a zero gradient, which any backward pass
     would pass. */
  gradCheck('causalSoftmax', [s], () => {
    const y = causalSoftmax(s);
    const sq = new Tensor(y.rows, y.cols);
    for (let i = 0; i < y.data.length; i++) sq.data[i] = y.data[i] * y.data[i];
    sq.parents = [y];
    sq._backward = (g) => { const gy = y.ensureGrad(); for (let i = 0; i < g.length; i++) gy[i] += 2 * y.data[i] * g[i]; };
    return sumAll(sq);
  });
}

{
  const s = rand(4, 4);
  gradCheck('softmaxRows', [s], () => {
    const y = softmaxRows(s);
    const sq = new Tensor(y.rows, y.cols);
    for (let i = 0; i < y.data.length; i++) sq.data[i] = y.data[i] * y.data[i];
    sq.parents = [y];
    sq._backward = (g) => { const gy = y.ensureGrad(); for (let i = 0; i < g.length; i++) gy[i] += 2 * y.data[i] * g[i]; };
    return sumAll(sq);
  });
}

{
  const x = rand(4, 5), gain = rand(1, 5), bias = rand(1, 5);
  gradCheck('layerNorm, including through the mean and the variance', [x, gain, bias],
    () => sumAll(layerNorm(x, gain, bias)), { tol: 1e-5 });
}

{
  const logits = rand(4, 6);
  gradCheck('crossEntropy', [logits], () => crossEntropy(logits, [3, 0, 5, 1]));
}

/* ── the properties, not just the derivatives ───────────────────────────── */

test('causalSoftmax lets no position see the future', () => {
  const y = causalSoftmax(rand(6, 6));
  for (let i = 0; i < 6; i++) {
    for (let j = i + 1; j < 6; j++) assert.equal(y.at(i, j), 0, `position ${i} could see ${j}`);
  }
});

test('every attention row sums to one', () => {
  const y = causalSoftmax(rand(6, 6));
  for (let i = 0; i < 6; i++) {
    let s = 0;
    for (let j = 0; j < 6; j++) s += y.at(i, j);
    assert.close(s, 1, 1e-12);
  }
});

test('softmax survives logits large enough to overflow exp()', () => {
  const s = Tensor.from(1, 3, [900, 901, 899]);
  const y = softmaxRows(s);
  assert.ok(Number.isFinite(y.at(0, 0)), 'exp(900) overflowed into the result');
  let sum = 0;
  for (let j = 0; j < 3; j++) sum += y.at(0, j);
  assert.close(sum, 1, 1e-12);
  assert.ok(y.at(0, 1) > y.at(0, 0), 'the largest logit should carry the most mass');
});

test('cross-entropy of a confident correct answer is near zero', () => {
  const loss = crossEntropy(Tensor.from(1, 3, [20, 0, 0]), [0]);
  assert.ok(loss.data[0] < 1e-8, `expected ~0, got ${loss.data[0]}`);
});

test('cross-entropy of a uniform guess is log(vocab)', () => {
  const loss = crossEntropy(Tensor.from(1, 4, [0, 0, 0, 0]), [2]);
  assert.close(loss.data[0], Math.log(4), 1e-12);
});

test('a gradient reaching one tensor by two paths accumulates', () => {
  /* x + x has derivative 2, not 1. Every framework that gets this wrong does
     so by assigning where it should add, and residual connections are exactly
     this shape — so it would be wrong in every transformer block. */
  const x = Tensor.from(1, 1, [3]);
  backward(sumAll(add(x, x)));
  assert.close(x.grad[0], 2, 1e-12);
});

test('backward refuses to start anywhere but a scalar', () => {
  assert.throws(() => backward(rand(2, 2)));
});

test('the same seed gives the same numbers', () => {
  const a = rng(42), b = rng(42);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
});
