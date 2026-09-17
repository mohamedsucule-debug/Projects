/* apps/attention/model.js — an attention-only transformer.

   ATTENTION-ONLY means there are no MLP layers: embedding, then N blocks of
   pure multi-head self-attention with residual connections, then unembedding.
   That is not a simplification made to save work. It is the architecture from
   Elhage et al., "A Mathematical Framework for Transformer Circuits" (2021),
   and it is the right one for the question this page is asking, because in a
   model with no MLPs every single thing the model can do, it does by moving
   information between positions — so the attention patterns you can see on
   screen are the entire computation rather than a fraction of it.

   Two layers, specifically. One layer of attention cannot form an induction
   head: the circuit needs a head in the first layer to write "the token before
   me was X" into a position, and a head in the second layer to read that and
   go looking for it. A 1-layer model plateaus. A 2-layer model drops off a
   cliff partway through training, and that cliff is the whole demonstration.

   Nothing in this file touches the DOM. It runs in node to train and in a
   browser to predict, out of the same file, which is the only way the picture
   on the page is guaranteed to be a picture of the model that was trained. */

import {
  Tensor, matmul, add, scale, transpose, gatherRows, firstRows,
  concatCols, causalSoftmax, layerNorm, crossEntropy, rng,
} from './autograd.js';

export const DEFAULTS = {
  vocab: 64,
  dModel: 64,
  nHeads: 4,
  nLayers: 2,
  ctx: 64,
  seed: 1337,
};

export class Transformer {
  constructor(config = {}) {
    const cfg = { ...DEFAULTS, ...config };
    if (cfg.dModel % cfg.nHeads !== 0) {
      throw new Error(`${cfg.nHeads} heads do not divide a width of ${cfg.dModel}`);
    }
    this.cfg = cfg;
    this.dHead = cfg.dModel / cfg.nHeads;

    const next = rng(cfg.seed);
    /* 1/sqrt(fan-in). Too large and the first softmax saturates before a single
       gradient has been taken — the model starts out certain and wrong, which
       it then has to spend a thousand steps climbing back out of. */
    const s = 1 / Math.sqrt(cfg.dModel);

    this.wEmbed = Tensor.param(cfg.vocab, cfg.dModel, s, next);
    this.wPos = Tensor.param(cfg.ctx, cfg.dModel, s, next);

    this.layers = [];
    for (let l = 0; l < cfg.nLayers; l++) {
      const heads = [];
      for (let h = 0; h < cfg.nHeads; h++) {
        heads.push({
          wQ: Tensor.param(cfg.dModel, this.dHead, s, next),
          wK: Tensor.param(cfg.dModel, this.dHead, s, next),
          wV: Tensor.param(cfg.dModel, this.dHead, s, next),
        });
      }
      this.layers.push({
        heads,
        wO: Tensor.param(cfg.dModel, cfg.dModel, s, next),
        lnGain: ones(1, cfg.dModel),
        lnBias: Tensor.zeros(1, cfg.dModel),
      });
      this.layers[l].lnGain.isParam = true;
      this.layers[l].lnBias.isParam = true;
    }

    this.lnGain = ones(1, cfg.dModel);
    this.lnBias = Tensor.zeros(1, cfg.dModel);
    this.lnGain.isParam = true;
    this.lnBias.isParam = true;
    this.wUnembed = Tensor.param(cfg.dModel, cfg.vocab, s, next);
  }

  /** Every learnable matrix, in a fixed order the optimiser and the saver share. */
  parameters() {
    const out = [this.wEmbed, this.wPos];
    for (const layer of this.layers) {
      for (const h of layer.heads) out.push(h.wQ, h.wK, h.wV);
      out.push(layer.wO, layer.lnGain, layer.lnBias);
    }
    out.push(this.lnGain, this.lnBias, this.wUnembed);
    return out;
  }

  parameterCount() {
    return this.parameters().reduce((n, p) => n + p.data.length, 0);
  }

  /**
   * Run the model over one sequence of token ids.
   *
   * Returns the logits and — the reason this file exists — every attention
   * pattern on the way through, so the page can draw what the model actually
   * looked at rather than an illustration of what attention is like.
   */
  forward(tokens) {
    const T = tokens.length;
    if (T === 0) throw new Error('nothing to run the model on');
    if (T > this.cfg.ctx) {
      throw new Error(`${T} tokens is past this model's context window of ${this.cfg.ctx}`);
    }

    /* Token identity plus position, added. A transformer has no idea what
       order anything is in otherwise — attention is a sum over positions and a
       sum does not care about order. */
    let x = add(gatherRows(this.wEmbed, tokens), firstRows(this.wPos, T));

    const attention = [];
    for (const layer of this.layers) {
      const normed = layerNorm(x, layer.lnGain, layer.lnBias);
      const perLayer = [];
      const outputs = [];
      for (const head of layer.heads) {
        const q = matmul(normed, head.wQ);
        const k = matmul(normed, head.wK);
        const v = matmul(normed, head.wV);
        /* Divided by sqrt(dHead): the dot product of two random dHead-vectors
           grows with dHead, so without this the softmax gets sharper purely as
           a function of how wide you made the head. */
        const scores = scale(matmul(q, transpose(k)), 1 / Math.sqrt(this.dHead));
        const pattern = causalSoftmax(scores);
        perLayer.push(pattern);
        outputs.push(matmul(pattern, v));
      }
      attention.push(perLayer);
      /* The residual stream. Each block ADDS to it rather than replacing it,
         which is what lets a later head read something an earlier head wrote. */
      x = add(x, matmul(concatCols(outputs), layer.wO));
    }

    const final = layerNorm(x, this.lnGain, this.lnBias);
    return { logits: matmul(final, this.wUnembed), attention, residual: x };
  }

  /** Mean cross-entropy of predicting each token from the ones before it. */
  loss(tokens) {
    const { logits, attention } = this.forward(tokens.slice(0, -1));
    return { loss: crossEntropy(logits, tokens.slice(1)), attention };
  }

  /** The next-token distribution after a prompt. */
  predict(tokens) {
    const { logits, attention } = this.forward(tokens);
    const last = logits.rows - 1;
    const row = new Float64Array(logits.cols);
    for (let c = 0; c < logits.cols; c++) row[c] = logits.at(last, c);
    return { logits: row, attention };
  }

  toJSON() {
    return {
      config: this.cfg,
      /* Rounded to five decimals. Full double precision triples the file for
         a difference no picture on the page can show. */
      params: this.parameters().map((p) => ({
        rows: p.rows, cols: p.cols,
        data: Array.from(p.data, (v) => Math.round(v * 1e5) / 1e5),
      })),
    };
  }

  static fromJSON(json) {
    const m = new Transformer(json.config);
    const ps = m.parameters();
    if (ps.length !== json.params.length) {
      throw new Error(`this file has ${json.params.length} matrices, the model wants ${ps.length}`);
    }
    ps.forEach((p, i) => {
      const s = json.params[i];
      if (s.rows !== p.rows || s.cols !== p.cols) {
        throw new Error(`matrix ${i} is ${s.rows}×${s.cols}, expected ${p.rows}×${p.cols}`);
      }
      p.data.set(s.data);
    });
    return m;
  }
}

function ones(rows, cols) {
  const t = new Tensor(rows, cols);
  t.data.fill(1);
  return t;
}

/* ── turning logits into a token ────────────────────────────────────────────
   Four knobs that every chat interface exposes and almost no explanation of
   them is honest about the order they apply in — which matters, because top-k
   then top-p is a different filter from top-p then top-k.

   They apply here in the order below, which is the order llama.cpp and the
   OpenAI and Anthropic APIs use: temperature first, then the cutoffs, then
   renormalise, then draw. */

export function applyTemperature(logits, temperature) {
  if (temperature < 0) throw new Error('temperature cannot be negative');
  /* Zero is not a temperature, it is a limit: as T → 0 the distribution
     concentrates on the argmax. Dividing by zero would give NaN, so it is
     handled as the limit it stands for. */
  if (temperature === 0) {
    let best = 0;
    for (let i = 1; i < logits.length; i++) if (logits[i] > logits[best]) best = i;
    return logits.map((_, i) => (i === best ? 0 : -Infinity));
  }
  return Array.from(logits, (v) => v / temperature);
}

export function softmax(logits) {
  let max = -Infinity;
  for (const v of logits) if (v > max) max = v;
  const out = logits.map((v) => (v === -Infinity ? 0 : Math.exp(v - max)));
  const sum = out.reduce((a, b) => a + b, 0);
  return out.map((v) => v / sum);
}

/** Keep the k most likely and throw the rest away. */
export function topK(probs, k) {
  if (k <= 0 || k >= probs.length) return probs.slice();
  const cutoff = probs.slice().sort((a, b) => b - a)[k - 1];
  const kept = probs.map((p) => (p >= cutoff ? p : 0));
  return renormalise(kept);
}

/** Keep the most likely tokens until their mass reaches p — nucleus sampling.

    The subtlety everybody gets wrong: the token that CROSSES the threshold is
    kept, not dropped. Otherwise p = 0.9 on a distribution whose top token has
    0.95 keeps nothing at all. */
export function topP(probs, p) {
  if (p >= 1) return probs.slice();
  if (p <= 0) return topK(probs, 1);
  const order = probs.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
  const kept = new Array(probs.length).fill(0);
  let mass = 0;
  for (const [v, i] of order) {
    kept[i] = v;
    mass += v;
    /* The epsilon is not defensive padding, it is load-bearing. Accumulating
       0.4 + 0.3 + 0.2 in binary floating point gives 0.8999999999999999, so a
       nucleus that reaches exactly 0.9 in real arithmetic misses the threshold
       and admits one more token — and the token it admits is the low-probability
       tail that nucleus sampling exists to remove. A test caught this; it would
       have been close to invisible in output. */
    if (mass >= p - 1e-9) break;
  }
  return renormalise(kept);
}

/** Keep everything at least `floor` times as likely as the best token.

    Min-p is newer than the other three and better behaved than top-p at high
    temperature: the cutoff is relative to how confident the model actually is,
    so a distribution with one obvious answer stays narrow and a genuinely
    uncertain one stays wide, instead of both being forced to the same mass. */
export function minP(probs, floor) {
  if (floor <= 0) return probs.slice();
  const max = Math.max(...probs);
  return renormalise(probs.map((v) => (v >= floor * max ? v : 0)));
}

function renormalise(probs) {
  const sum = probs.reduce((a, b) => a + b, 0);
  if (sum === 0) throw new Error('every token was filtered out');
  return probs.map((v) => v / sum);
}

/** Draw one index from a distribution. */
export function sampleFrom(probs, u) {
  let acc = 0;
  for (let i = 0; i < probs.length; i++) {
    acc += probs[i];
    if (u < acc) return i;
  }
  /* Floating-point sums do not always reach exactly 1, so a u of 0.9999999
     can fall off the end. Returning the last non-zero token is correct and
     the alternative is a once-in-a-million crash nobody can reproduce. */
  for (let i = probs.length - 1; i >= 0; i--) if (probs[i] > 0) return i;
  throw new Error('nothing to sample from');
}

/** The whole pipeline, in the order the knobs actually apply. */
export function chooseToken(logits, opts = {}, u = Math.random()) {
  const { temperature = 1, k = 0, p = 1, min = 0 } = opts;
  let probs = softmax(applyTemperature(logits, temperature));
  if (k > 0) probs = topK(probs, k);
  if (p < 1) probs = topP(probs, p);
  if (min > 0) probs = minP(probs, min);
  return { index: sampleFrom(probs, u), probs };
}
