/* apps/attention/autograd.js — reverse-mode automatic differentiation over
   2-D matrices, in about three hundred lines and with no dependencies.

   This is the part of a machine learning framework that everybody uses and
   almost nobody has read. It is not large. Every operation below does two
   things: computes its output, and remembers how to push a gradient from that
   output back to its inputs. Chain those together and you have backpropagation
   — there is no other trick in it.

   Everything is 2-D. Real frameworks are n-dimensional because real models have
   a batch axis, and the bookkeeping that buys is most of what makes them hard
   to read. A transformer needs matrices, so this has matrices, and the whole
   file fits in your head.

   The one non-negotiable: every backward pass in this file is checked against
   finite differences in tests/autograd.test.mjs. A backward pass that is
   subtly wrong does not crash. It trains slightly worse, and you spend a week
   blaming the learning rate. */

/** A matrix and, once something has asked for it, its gradient. */
export class Tensor {
  constructor(rows, cols, data = null) {
    this.rows = rows;
    this.cols = cols;
    this.data = data ?? new Float64Array(rows * cols);
    /* Float64 rather than Float32. These models are small enough that the
       speed difference does not matter, and finite-difference gradient
       checking in single precision is a coin toss — the numerical error in
       (f(x+h) - f(x-h)) / 2h swamps the thing you are trying to measure. */
    this.grad = null;
    this.parents = [];
    this._backward = null;
    this.isParam = false;
  }

  static zeros(rows, cols) { return new Tensor(rows, cols); }

  static from(rows, cols, values) {
    if (values.length !== rows * cols) {
      throw new Error(`${rows}×${cols} needs ${rows * cols} values, got ${values.length}`);
    }
    return new Tensor(rows, cols, Float64Array.from(values));
  }

  /** A learnable matrix. Initialised small and normal; see randn below. */
  static param(rows, cols, scale, rng) {
    const t = new Tensor(rows, cols);
    for (let i = 0; i < t.data.length; i++) t.data[i] = randn(rng) * scale;
    t.isParam = true;
    return t;
  }

  at(r, c) { return this.data[r * this.cols + c]; }
  put(r, c, v) { this.data[r * this.cols + c] = v; }

  /** Gradient buffer, created on first use so forward-only runs cost nothing. */
  ensureGrad() {
    if (!this.grad) this.grad = new Float64Array(this.rows * this.cols);
    return this.grad;
  }

  zeroGrad() { if (this.grad) this.grad.fill(0); }

  row(r) { return this.data.subarray(r * this.cols, (r + 1) * this.cols); }

  clone() { return new Tensor(this.rows, this.cols, this.data.slice()); }

  toArray() {
    const out = [];
    for (let r = 0; r < this.rows; r++) out.push(Array.from(this.row(r)));
    return out;
  }
}

/* ── the tape ───────────────────────────────────────────────────────────────
   Not a global tape: each tensor remembers its parents, and backward() walks
   the graph from the loss in reverse topological order. A global tape has to
   be reset between steps and silently accumulates garbage when an exception
   skips the reset, which is a bug you find at 2am. */

/**
 * Run the backward pass from a 1×1 loss.
 *
 * Parameters are deliberately NOT zeroed here. A batch is many sequences and
 * one step, so every sequence must add its gradient to the same parameters;
 * zeroing them on each backward pass would train on a batch of one and look
 * only like a noisy run. The optimiser clears them once per step instead,
 * which is also why every op in this file accumulates with += rather than =.
 */
export function backward(loss) {
  if (loss.rows !== 1 || loss.cols !== 1) {
    throw new Error('backward() starts from a scalar; got ' + loss.rows + '×' + loss.cols);
  }
  const order = [];
  const seen = new Set();
  (function visit(t) {
    if (seen.has(t)) return;
    seen.add(t);
    for (const p of t.parents) visit(p);
    order.push(t);
  })(loss);

  for (const t of order) if (!t.isParam) t.zeroGrad();
  loss.ensureGrad()[0] = 1;

  for (let i = order.length - 1; i >= 0; i--) {
    const t = order[i];
    if (t._backward && t.grad) t._backward(t.grad);
  }
}

/** Wire an output to its inputs. */
function node(out, parents, back) {
  out.parents = parents;
  out._backward = back;
  return out;
}

/* ── operations ─────────────────────────────────────────────────────────── */

/** [m,k] @ [k,n] → [m,n]. The one that dominates the flop count. */
export function matmul(a, b) {
  if (a.cols !== b.rows) throw new Error(`cannot multiply ${a.rows}×${a.cols} by ${b.rows}×${b.cols}`);
  const m = a.rows, k = a.cols, n = b.cols;
  const out = new Tensor(m, n);
  const A = a.data, B = b.data, O = out.data;
  /* i-k-j rather than i-j-k: the inner loop then walks both B and O along
     their rows, which is the order they are laid out in. Same arithmetic,
     several times the speed, entirely because of the cache. */
  for (let i = 0; i < m; i++) {
    const ao = i * k, oo = i * n;
    for (let p = 0; p < k; p++) {
      const av = A[ao + p];
      if (av === 0) continue;
      const bo = p * n;
      for (let j = 0; j < n; j++) O[oo + j] += av * B[bo + j];
    }
  }
  return node(out, [a, b], (g) => {
    const ga = a.ensureGrad(), gb = b.ensureGrad(), A2 = a.data, B2 = b.data;
    for (let i = 0; i < m; i++) {
      const go = i * n, ao = i * k;
      for (let p = 0; p < k; p++) {
        let s = 0;
        const bo = p * n;
        for (let j = 0; j < n; j++) s += g[go + j] * B2[bo + j];
        ga[ao + p] += s;
      }
    }
    for (let p = 0; p < k; p++) {
      const bo = p * n;
      for (let i = 0; i < m; i++) {
        const av = A2[i * k + p];
        if (av === 0) continue;
        const go = i * n;
        for (let j = 0; j < n; j++) gb[bo + j] += av * g[go + j];
      }
    }
  });
}

/** Elementwise add. A 1×n operand broadcasts down every row (that is a bias). */
export function add(a, b) {
  const broadcast = b.rows === 1 && a.rows !== 1;
  if (a.cols !== b.cols || (!broadcast && a.rows !== b.rows)) {
    throw new Error(`cannot add ${b.rows}×${b.cols} to ${a.rows}×${a.cols}`);
  }
  const out = new Tensor(a.rows, a.cols);
  for (let r = 0; r < a.rows; r++) {
    for (let c = 0; c < a.cols; c++) {
      out.data[r * a.cols + c] = a.at(r, c) + b.at(broadcast ? 0 : r, c);
    }
  }
  return node(out, [a, b], (g) => {
    const ga = a.ensureGrad(), gb = b.ensureGrad();
    for (let i = 0; i < g.length; i++) ga[i] += g[i];
    /* A broadcast sums its gradient back down. Forgetting this is the classic
       silent bias bug: the bias learns at 1/rows the rate it should and the
       model trains, just worse. */
    for (let r = 0; r < a.rows; r++) {
      for (let c = 0; c < a.cols; c++) {
        gb[(broadcast ? 0 : r) * a.cols + c] += g[r * a.cols + c];
      }
    }
  });
}

/** Multiply by a constant. */
export function scale(a, k) {
  const out = new Tensor(a.rows, a.cols);
  for (let i = 0; i < a.data.length; i++) out.data[i] = a.data[i] * k;
  return node(out, [a], (g) => {
    const ga = a.ensureGrad();
    for (let i = 0; i < g.length; i++) ga[i] += g[i] * k;
  });
}

export function transpose(a) {
  const out = new Tensor(a.cols, a.rows);
  for (let r = 0; r < a.rows; r++) {
    for (let c = 0; c < a.cols; c++) out.data[c * a.rows + r] = a.at(r, c);
  }
  return node(out, [a], (g) => {
    const ga = a.ensureGrad();
    for (let r = 0; r < a.rows; r++) {
      for (let c = 0; c < a.cols; c++) ga[r * a.cols + c] += g[c * a.rows + r];
    }
  });
}

/** Pick rows out of a table. This is what an embedding lookup actually is:
    not a multiplication by a one-hot vector, just an array index. */
export function gatherRows(table, indices) {
  const out = new Tensor(indices.length, table.cols);
  for (let i = 0; i < indices.length; i++) {
    const src = indices[i];
    if (src < 0 || src >= table.rows) throw new Error(`row ${src} is outside a ${table.rows}-row table`);
    out.data.set(table.row(src), i * table.cols);
  }
  return node(out, [table], (g) => {
    const gt = table.ensureGrad();
    /* Scatter-add, not scatter-assign: the same token can appear twice in one
       sequence and both occurrences owe it a gradient. */
    for (let i = 0; i < indices.length; i++) {
      const off = indices[i] * table.cols, go = i * table.cols;
      for (let c = 0; c < table.cols; c++) gt[off + c] += g[go + c];
    }
  });
}

/** The first `n` rows — used to take the first T positional embeddings. */
export function firstRows(a, n) {
  const out = new Tensor(n, a.cols, a.data.slice(0, n * a.cols));
  return node(out, [a], (g) => {
    const ga = a.ensureGrad();
    for (let i = 0; i < g.length; i++) ga[i] += g[i];
  });
}

/** Lay matrices side by side: [T,dh] × h → [T, dh·h]. Joining the heads. */
export function concatCols(parts) {
  const rows = parts[0].rows;
  let cols = 0;
  for (const p of parts) {
    if (p.rows !== rows) throw new Error('concatCols needs matching row counts');
    cols += p.cols;
  }
  const out = new Tensor(rows, cols);
  let off = 0;
  for (const p of parts) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < p.cols; c++) out.data[r * cols + off + c] = p.at(r, c);
    }
    off += p.cols;
  }
  return node(out, parts, (g) => {
    let o = 0;
    for (const p of parts) {
      const gp = p.ensureGrad();
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < p.cols; c++) gp[r * p.cols + c] += g[r * cols + o + c];
      }
      o += p.cols;
    }
  });
}

/** Causal masking and row-wise softmax, fused.

    Fused because they belong together and because separating them means
    representing −∞ as a number. exp(−1e9) underflows to zero, which is the
    right answer, but −1e9 also propagates through the backward pass as a real
    value and multiplies by gradients. Masking inside the softmax means the
    masked positions are never numbers at all. */
export function causalSoftmax(scores) {
  const n = scores.rows, m = scores.cols;
  const out = new Tensor(n, m);
  for (let i = 0; i < n; i++) {
    /* Position i may look at positions 0..i and no further: this is the whole
       reason a language model can be trained on every position of a sequence
       at once instead of one at a time. */
    const last = Math.min(i, m - 1);
    let max = -Infinity;
    for (let j = 0; j <= last; j++) max = Math.max(max, scores.at(i, j));
    let sum = 0;
    for (let j = 0; j <= last; j++) {
      /* Subtracting the row max before exponentiating. Mathematically a no-op;
         without it, scores in the twenties overflow to Infinity and the whole
         row becomes NaN. */
      const e = Math.exp(scores.at(i, j) - max);
      out.data[i * m + j] = e;
      sum += e;
    }
    for (let j = 0; j <= last; j++) out.data[i * m + j] /= sum;
  }
  return node(out, [scores], (g) => {
    const gs = scores.ensureGrad();
    for (let i = 0; i < n; i++) {
      const last = Math.min(i, m - 1);
      let dot = 0;
      for (let j = 0; j <= last; j++) dot += g[i * m + j] * out.data[i * m + j];
      for (let j = 0; j <= last; j++) {
        const y = out.data[i * m + j];
        gs[i * m + j] += y * (g[i * m + j] - dot);
      }
    }
  });
}

/** Row-wise softmax with nothing masked. */
export function softmaxRows(scores) {
  const n = scores.rows, m = scores.cols;
  const out = new Tensor(n, m);
  for (let i = 0; i < n; i++) {
    let max = -Infinity;
    for (let j = 0; j < m; j++) max = Math.max(max, scores.at(i, j));
    let sum = 0;
    for (let j = 0; j < m; j++) { const e = Math.exp(scores.at(i, j) - max); out.data[i * m + j] = e; sum += e; }
    for (let j = 0; j < m; j++) out.data[i * m + j] /= sum;
  }
  return node(out, [scores], (g) => {
    const gs = scores.ensureGrad();
    for (let i = 0; i < n; i++) {
      let dot = 0;
      for (let j = 0; j < m; j++) dot += g[i * m + j] * out.data[i * m + j];
      for (let j = 0; j < m; j++) {
        const y = out.data[i * m + j];
        gs[i * m + j] += y * (g[i * m + j] - dot);
      }
    }
  });
}

/** Normalise each row to mean 0 and variance 1, then scale and shift.

    The gradient is the least obvious one here, and it is not optional to get
    right: every row's output depends on every element of that row through the
    mean and the variance, so the naive "just scale by gain/σ" is wrong in a
    way that still trains. */
export function layerNorm(x, gain, bias, eps = 1e-5) {
  const n = x.rows, d = x.cols;
  const out = new Tensor(n, d);
  const mean = new Float64Array(n), inv = new Float64Array(n);
  const norm = new Float64Array(n * d);
  for (let i = 0; i < n; i++) {
    let mu = 0;
    for (let c = 0; c < d; c++) mu += x.at(i, c);
    mu /= d;
    let v = 0;
    for (let c = 0; c < d; c++) { const t = x.at(i, c) - mu; v += t * t; }
    v /= d;
    const is = 1 / Math.sqrt(v + eps);
    mean[i] = mu; inv[i] = is;
    for (let c = 0; c < d; c++) {
      const nh = (x.at(i, c) - mu) * is;
      norm[i * d + c] = nh;
      out.data[i * d + c] = nh * gain.at(0, c) + bias.at(0, c);
    }
  }
  return node(out, [x, gain, bias], (g) => {
    const gx = x.ensureGrad(), gg = gain.ensureGrad(), gb = bias.ensureGrad();
    for (let i = 0; i < n; i++) {
      const is = inv[i];
      let sumDy = 0, sumDyN = 0;
      for (let c = 0; c < d; c++) {
        const go = g[i * d + c];
        const dn = go * gain.at(0, c);
        gg[c] += go * norm[i * d + c];
        gb[c] += go;
        sumDy += dn;
        sumDyN += dn * norm[i * d + c];
      }
      for (let c = 0; c < d; c++) {
        const dn = g[i * d + c] * gain.at(0, c);
        gx[i * d + c] += (is / d) * (d * dn - sumDy - norm[i * d + c] * sumDyN);
      }
    }
  });
}

/** Mean cross-entropy of `logits` against integer `targets`, one per row.

    Fused with the softmax it needs, for the usual reason: softmax then log is
    two chances to overflow, and the gradient of the pair together is the
    famously clean (p − onehot). */
export function crossEntropy(logits, targets) {
  const n = logits.rows, v = logits.cols;
  if (targets.length !== n) throw new Error(`${n} rows of logits but ${targets.length} targets`);
  const probs = new Float64Array(n * v);
  let total = 0;
  for (let i = 0; i < n; i++) {
    let max = -Infinity;
    for (let c = 0; c < v; c++) max = Math.max(max, logits.at(i, c));
    let sum = 0;
    for (let c = 0; c < v; c++) { const e = Math.exp(logits.at(i, c) - max); probs[i * v + c] = e; sum += e; }
    for (let c = 0; c < v; c++) probs[i * v + c] /= sum;
    total += -Math.log(Math.max(probs[i * v + targets[i]], 1e-300));
  }
  const out = new Tensor(1, 1, Float64Array.of(total / n));
  out.probs = probs;
  return node(out, [logits], (g) => {
    const gl = logits.ensureGrad(), k = g[0] / n;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < v; c++) {
        gl[i * v + c] += k * (probs[i * v + c] - (c === targets[i] ? 1 : 0));
      }
    }
  });
}

/* ── random numbers ─────────────────────────────────────────────────────────
   Seeded, because "it trained well that time" is not a result you can show
   anybody unless they can run it and get the same number. */

/** mulberry32 — small, fast, and good enough for initialisation and shuffling. */
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

/** Box–Muller: two uniforms in, one standard normal out. */
export function randn(next) {
  let u = 0;
  while (u === 0) u = next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
}
