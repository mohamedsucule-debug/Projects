#!/usr/bin/env node
/* apps/attention/train.mjs — trains the model and writes it out.
 *
 *   node apps/attention/train.mjs induction [steps]
 *   node apps/attention/train.mjs text [steps]
 *
 * Checkpoints matter as much as the final weights here. The point of the
 * induction run is the MOMENT the circuit appears, so the run keeps snapshots
 * from before, during and after the phase change — the page can then show the
 * same head attending to nothing in particular and then, a few hundred steps
 * later, attending to exactly the right token.
 */

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { Transformer } from './model.js';
import { Adam, clipGradients, schedule } from './optim.js';
import { backward } from './autograd.js';
import { rng, inductionBatch, inductionFloor, buildVocabulary, textBatch } from './data.js';

const here = dirname(fileURLToPath(import.meta.url));
const which = process.argv[2] ?? 'induction';
const steps = Number(process.argv[3] ?? 3000);

/* ── the corpus, for the text run ───────────────────────────────────────────
   This repo's own writing: every README and every commit message. It is about
   230KB, which is small enough that the model will not learn English and is
   the honest size to be working at in a browser. What it does learn — word
   shapes, punctuation, the rhythm of a sentence — is exactly the part the
   attention pictures are about. */
function corpus() {
  const files = execSync(
    "find . -name node_modules -prune -o -name '*.md' -print",
    { cwd: join(here, '../..'), encoding: 'utf8' }
  ).trim().split('\n').filter(Boolean);
  let text = files.map((f) => readFileSync(join(here, '../..', f), 'utf8')).join('\n\n');
  text += '\n\n' + execSync('git log --format=%B', { cwd: join(here, '../..'), encoding: 'utf8' });
  /* Anything that appears fewer than 20 times is one stray character in one
     commit message and would get a whole embedding row to itself. */
  const counts = new Map();
  for (const c of text) counts.set(c, (counts.get(c) ?? 0) + 1);
  return Array.from(text).filter((c) => counts.get(c) >= 20).join('');
}

const setups = {
  induction: () => {
    const half = 32, vocab = 64;
    const next = rng(4242);
    return {
      name: 'induction',
      config: { vocab, dModel: 64, nHeads: 4, nLayers: 2, ctx: half * 2, seed: 1337 },
      lr: 2e-3,
      batch: () => inductionBatch(next, { vocab, half, batch: 24 }),
      floor: inductionFloor(vocab, half),
      uniform: Math.log(vocab),
      extra: { half, vocab },
    };
  },
  text: () => {
    const text = corpus();
    const vocabulary = buildVocabulary(text);
    const ids = Int32Array.from(vocabulary.encode(text));
    const next = rng(99);
    const len = 64;
    process.stdout.write(`corpus: ${text.length.toLocaleString()} characters, ${vocabulary.size} distinct\n`);
    return {
      name: 'text',
      config: { vocab: vocabulary.size, dModel: 96, nHeads: 4, nLayers: 2, ctx: len + 1, seed: 7 },
      lr: 1.5e-3,
      batch: () => textBatch(next, { ids, len, batch: 16 }),
      floor: 0,
      uniform: Math.log(vocabulary.size),
      extra: { chars: vocabulary.chars },
    };
  },
};

const setup = setups[which]?.();
if (!setup) { console.error(`unknown run "${which}" — try induction or text`); process.exit(1); }

const model = new Transformer(setup.config);
const params = model.parameters();
const peak = setup.lr ?? 1e-3;
const opt = new Adam(params, { lr: peak, weightDecay: 0.01 });

console.log(`${setup.name}: ${model.parameterCount().toLocaleString()} parameters, ${steps} steps`);
console.log(`uniform guessing = ${setup.uniform.toFixed(3)}, best possible = ${setup.floor.toFixed(3)}\n`);

const history = [];
const checkpoints = [];
const wantCheckpoint = new Set([0, Math.floor(steps * 0.12), Math.floor(steps * 0.25), steps - 1]);
const started = Date.now();

for (let step = 0; step < steps; step++) {
  const lr = schedule(step, { total: steps, peak });
  opt.zeroGrad();

  let sum = 0;
  const sequences = setup.batch();
  for (const seq of sequences) {
    const { loss } = model.loss(seq);
    sum += loss.data[0];
    /* Parameter gradients accumulate across the batch; opt.zeroGrad() above
       cleared them once for the whole step. */
    backward(loss);
  }
  const mean = sum / sequences.length;
  for (const p of params) if (p.grad) for (let j = 0; j < p.grad.length; j++) p.grad[j] /= sequences.length;

  const norm = clipGradients(params, 1);
  opt.step(lr);
  history.push({ step, loss: mean, lr, norm });

  if (wantCheckpoint.has(step)) {
    checkpoints.push({ step, loss: mean, model: model.toJSON() });
  }
  if (step % Math.max(1, Math.floor(steps / 40)) === 0 || step === steps - 1) {
    const secs = (Date.now() - started) / 1000;
    process.stdout.write(
      `  step ${String(step).padStart(5)}  loss ${mean.toFixed(4)}  ` +
      `|g| ${norm.toFixed(3)}  ${secs.toFixed(0)}s\n`);
  }
}

mkdirSync(join(here, 'weights'), { recursive: true });
const out = {
  name: setup.name,
  trainedAt: new Date().toISOString().slice(0, 10),
  steps,
  floor: setup.floor,
  uniform: setup.uniform,
  parameterCount: model.parameterCount(),
  extra: setup.extra,
  /* Every tenth step. Four thousand points is a smooth line on a chart nobody
     can see four thousand points in, and it triples the file. */
  history: history.filter((h, i) => i % 10 === 0 || i === history.length - 1),
  checkpoints,
};
const path = join(here, 'weights', `${setup.name}.json`);
writeFileSync(path, JSON.stringify(out));
const kb = (Buffer.byteLength(JSON.stringify(out)) / 1024).toFixed(0);
console.log(`\nwrote ${path} (${kb} KB)`);
