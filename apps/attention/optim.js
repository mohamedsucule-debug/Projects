/* apps/attention/optim.js — Adam, and the two pieces of hygiene that stop a
   training run falling over.

   Adam in one sentence: keep a running average of the gradient and a running
   average of its square, and step in the direction of the first divided by the
   root of the second — so a parameter with a small but consistent gradient
   moves as fast as one with a large erratic gradient. That is the whole idea.
   The rest is the bias correction, which exists because both averages start at
   zero and are therefore wrong for the first few dozen steps in a way that
   would otherwise make the opening of training crawl. */

export class Adam {
  constructor(params, { lr = 1e-3, beta1 = 0.9, beta2 = 0.999, eps = 1e-8, weightDecay = 0 } = {}) {
    this.params = params;
    this.lr = lr;
    this.beta1 = beta1;
    this.beta2 = beta2;
    this.eps = eps;
    this.weightDecay = weightDecay;
    this.t = 0;
    this.m = params.map((p) => new Float64Array(p.data.length));
    this.v = params.map((p) => new Float64Array(p.data.length));
  }

  step(lr = this.lr) {
    this.t++;
    /* Computed once per step rather than once per parameter. With 45,000
       parameters that is 45,000 calls to Math.pow saved per step, which is not
       nothing when the whole run is single-threaded JavaScript. */
    const c1 = 1 - Math.pow(this.beta1, this.t);
    const c2 = 1 - Math.pow(this.beta2, this.t);

    for (let i = 0; i < this.params.length; i++) {
      const p = this.params[i], m = this.m[i], v = this.v[i];
      const g = p.grad;
      if (!g) continue;
      for (let j = 0; j < p.data.length; j++) {
        /* Decoupled weight decay (AdamW): applied to the parameter, not folded
           into the gradient. Folded in, it goes through the same 1/sqrt(v)
           scaling as everything else, which means the amount of decay a weight
           gets depends on how noisy its gradient has been — which is not what
           anybody means by weight decay. */
        if (this.weightDecay) p.data[j] -= lr * this.weightDecay * p.data[j];
        const gj = g[j];
        m[j] = this.beta1 * m[j] + (1 - this.beta1) * gj;
        v[j] = this.beta2 * v[j] + (1 - this.beta2) * gj * gj;
        p.data[j] -= lr * (m[j] / c1) / (Math.sqrt(v[j] / c2) + this.eps);
      }
    }
  }

  zeroGrad() { for (const p of this.params) p.zeroGrad(); }
}

/**
 * Scale every gradient down together if their combined length exceeds `max`.
 *
 * TOGETHER is the point. Clipping each parameter separately would change the
 * DIRECTION of the step, not just its size, and a direction that depends on
 * how big the step happened to be is not a gradient any more. Returns the norm
 * before clipping, which is worth plotting: a spike in it is the first sign of
 * a run that is about to diverge.
 */
export function clipGradients(params, max) {
  let total = 0;
  for (const p of params) {
    if (!p.grad) continue;
    for (let i = 0; i < p.grad.length; i++) total += p.grad[i] * p.grad[i];
  }
  const norm = Math.sqrt(total);
  if (norm > max) {
    const k = max / (norm + 1e-6);
    for (const p of params) {
      if (!p.grad) continue;
      for (let i = 0; i < p.grad.length; i++) p.grad[i] *= k;
    }
  }
  return norm;
}

/**
 * Learning rate at step `t`: linear warmup, then cosine decay to a floor.
 *
 * The warmup is not decoration. Adam's second-moment estimate is close to
 * meaningless for the first few hundred steps — it is an average of almost no
 * samples — so a full-size step taken on that estimate is a step in a fairly
 * arbitrary direction, at a moment when the model is least able to recover
 * from one.
 */
export function schedule(t, { total, peak, warmup = Math.floor(total * 0.05), floor = peak * 0.1 }) {
  if (t < warmup) return peak * (t + 1) / warmup;
  const progress = Math.min(1, (t - warmup) / Math.max(1, total - warmup));
  return floor + (peak - floor) * 0.5 * (1 + Math.cos(Math.PI * progress));
}
