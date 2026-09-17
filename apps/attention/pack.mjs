#!/usr/bin/env node
/* apps/attention/pack.mjs — turn a raw training checkpoint into something a
 * web page can reasonably download.
 *
 *   node apps/attention/pack.mjs induction.transition induction
 *
 * The raw file is double-precision JSON: about 400KB per checkpoint, times
 * thirteen checkpoints, which is five megabytes. Quantised to int8 and
 * base64'd it is about 59KB per checkpoint.
 *
 * And then it MEASURES what that cost. Quantisation is lossy; the question is
 * never whether there is error but whether the error matters, and the only way
 * to know is to run the model both ways on the same data and compare. That
 * number goes on the page.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transformer } from './model.js';
import { packParams, unpackParams, quantise, maxError } from './quantise.js';
import { rng, inductionBatch, inductionSequence } from './data.js';
import { profile } from './analysis.js';

const here = dirname(fileURLToPath(import.meta.url));
const from = process.argv[2] ?? 'induction.transition';
const to = process.argv[3] ?? 'induction';

const raw = JSON.parse(readFileSync(join(here, 'weights', `${from}.json`), 'utf8'));
console.log(`${from}: ${raw.checkpoints.length} checkpoints, ${raw.steps} steps`);

/* One fixed batch, used to score every checkpoint both ways. Fixed because the
   comparison is between two versions of the same model — if the data moved as
   well, the difference would be meaningless. */
const evalBatch = inductionBatch(rng(555), { ...raw.extra, batch: 24 });

const lossOf = (model) =>
  evalBatch.reduce((s, seq) => s + model.loss(seq).loss.data[0], 0) / evalBatch.length;

const checkpoints = [];
let worstDelta = 0, worstWeight = 0;
let out_generalisation = null;

for (const cp of raw.checkpoints) {
  const exact = Transformer.fromJSON(cp.model);
  const before = lossOf(exact);

  const packed = packParams(exact.parameters());
  const approx = Transformer.fromJSON({ config: cp.model.config, params: unpackParams(packed) });
  const after = lossOf(approx);

  for (const p of exact.parameters()) {
    const { scale, q } = quantise(p.data);
    worstWeight = Math.max(worstWeight, maxError(p.data, q, scale));
  }
  worstDelta = Math.max(worstDelta, Math.abs(after - before));

  checkpoints.push({ step: cp.step, loss: cp.loss, lossExact: before, lossInt8: after, params: packed });
  console.log(
    `  step ${String(cp.step).padStart(4)}  loss ${before.toFixed(4)} → ${after.toFixed(4)} ` +
    `(${after - before >= 0 ? '+' : ''}${(after - before).toFixed(5)})`);
}

/* ── the check that decides whether any of this means anything ──────────────
   A head that scores well on induction might be matching on CONTENT ("where
   have I seen this token before") or it might have memorised an OFFSET ("look
   back 31 places"). On the screen those are identical: both draw a clean
   off-diagonal stripe.

   The first version of this task repeated at a fixed point, and what turned up
   was the second thing wearing the first thing's clothes — a head scoring 0.92
   without ever reading a token. So the final model is scored across the whole
   range of periods it might see. A positional head is tuned to one offset and
   collapses away from it; a content-matching head does not care. */
{
  const final = Transformer.fromJSON({
    config: raw.checkpoints.at(-1).model.config,
    params: unpackParams(checkpoints.at(-1).params),
  });
  const scores = [];
  for (let p = raw.extra.minPeriod; p <= raw.extra.maxPeriod; p += 4) {
    /* Sequences forced to exactly this period, several of them, so the number
       is about the period and not about one lucky draw. */
    let sum = 0, chance = 0;
    for (let t = 0; t < 6; t++) {
      const seq = inductionSequence(rng(1000 + p * 31 + t), {
        vocab: raw.extra.vocab, length: raw.extra.length, minPeriod: p, maxPeriod: p,
      });
      sum += profile(final, seq).inductionHead.induction;
      chance += profile(final, seq).baseline;
    }
    scores.push({ period: p, score: sum / 6, chance: chance / 6 });
  }
  const lo = Math.min(...scores.map((s) => s.score));
  const hi = Math.max(...scores.map((s) => s.score));
  out_generalisation = { scores, min: lo, max: hi, spread: hi - lo };
  console.log('\ninduction score by period (a positional head would spike at one and collapse elsewhere):');
  for (const s of scores) {
    console.log(`  period ${String(s.period).padStart(2)}  ${s.score.toFixed(3)}  (chance ${s.chance.toFixed(3)})  ${'█'.repeat(Math.round(s.score * 40))}`);
  }
  console.log(`  spread across periods: ${(hi - lo).toFixed(3)} — ` +
    (hi - lo < 0.25 ? 'flat, so it is matching on content' : 'UNEVEN — check whether this is positional'));
}

const out = {
  name: raw.name,
  generalisation: out_generalisation,
  trainedAt: raw.trainedAt,
  steps: raw.steps,
  floor: raw.floor,
  uniform: raw.uniform,
  parameterCount: raw.parameterCount,
  config: raw.checkpoints[0].model.config,
  extra: raw.extra,
  history: raw.history.map((h) => ({ step: h.step, loss: Number(h.loss.toFixed(4)) })),
  quantisation: {
    bits: 8,
    scheme: 'symmetric, one scale per matrix',
    worstWeightError: worstWeight,
    worstLossDelta: worstDelta,
  },
  checkpoints,
};

const path = join(here, 'weights', `${to}.pack.json`);
const text = JSON.stringify(out);
writeFileSync(path, text);

/* ── and a much smaller file, for the card on the landing page ──────────────
   The landing page promises that every card on it is the real thing running.
   Honouring that for this one would otherwise mean the front page downloading
   eight hundred kilobytes of weights to draw a 180px square, so what ships for
   the card is the OUTPUT rather than the model: the attention pattern of the
   best induction head, at six checkpoints, on one fixed sequence. Still real
   numbers out of the real model — just already evaluated. */
{
  const seq = inductionSequence(rng(7), raw.extra);
  const want = [0, 2, 5, 8, 10, checkpoints.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  const frames = want.map((i) => {
    const model = Transformer.fromJSON({ config: raw.config ?? raw.checkpoints[0].model.config, params: unpackParams(checkpoints[i].params) });
    const prof = profile(model, seq);
    const pat = prof.inductionHead.pattern;
    /* 0-255 rather than int8: an attention weight is never negative, so the
       sign bit would be a wasted eighth of the range. */
    const bytes = new Uint8Array(pat.rows * pat.cols);
    for (let r = 0; r < pat.rows; r++) {
      for (let c = 0; c < pat.cols; c++) {
        bytes[r * pat.cols + c] = Math.round(Math.min(1, pat.at(r, c)) * 255);
      }
    }
    return {
      step: checkpoints[i].step,
      loss: Number(checkpoints[i].lossInt8.toFixed(3)),
      head: prof.inductionHead.label,
      score: Number(prof.inductionHead.induction.toFixed(3)),
      b64: Buffer.from(bytes).toString('base64'),
    };
  });
  const card = { size: seq.length, period: seq.period, floor: raw.floor, uniform: raw.uniform, frames };
  const cardPath = join(here, 'weights', 'card.json');
  writeFileSync(cardPath, JSON.stringify(card));
  console.log(`  card: ${frames.length} frames, ${(JSON.stringify(card).length / 1024).toFixed(0)} KB`);
}

const rawKB = readFileSync(join(here, 'weights', `${from}.json`)).length / 1024;
console.log(
  `\nwrote ${path}\n` +
  `  ${(rawKB / 1024).toFixed(2)} MB → ${(text.length / 1024).toFixed(0)} KB ` +
  `(${(rawKB * 1024 / text.length).toFixed(1)}× smaller)\n` +
  `  worst single weight moved by ${worstWeight.toExponential(2)}\n` +
  `  worst loss change across all checkpoints: ${worstDelta.toFixed(6)} nats`);
