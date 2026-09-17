/* apps/attention/data.js — the two things the model is trained on.

   THE INDUCTION TASK is a sequence of random tokens with its first half
   repeated exactly. There is no pattern to learn inside the first half — it is
   noise, and the best any model can do there is guess uniformly. The second
   half is completely determined by the first, and the only way to get it is to
   look back: "I am seeing token X; where did I see X before; what came after
   it that time; say that."

   That is a strange task to train on until you notice what it isolates. A
   model cannot memorise its way through it, because every sequence is fresh
   random noise. It cannot use token statistics, because the tokens are
   uniform. The ONLY thing that helps is the copying circuit, so if loss falls,
   the circuit is what fell it. The loss curve becomes a measurement of one
   specific mechanism appearing, which is not a thing you can usually say about
   a loss curve. */

import { rng } from './autograd.js';

/**
 * One induction sequence: `half` random tokens, then the same `half` again.
 *
 * Perfect loss on this is not zero. The first half is unpredictable by
 * construction, so a perfect model still pays log(vocab) on every token of it
 * and zero on the second half — roughly half of log(vocab) overall. A run that
 * reports a loss below that has a bug, usually a target that is off by one and
 * lets the model see the answer.
 */
export function inductionSequence(next, { vocab, half }) {
  const first = [];
  for (let i = 0; i < half; i++) first.push(Math.floor(next() * vocab));
  return first.concat(first);
}

export function inductionBatch(next, { vocab, half, batch }) {
  const out = [];
  for (let i = 0; i < batch; i++) out.push(inductionSequence(next, { vocab, half }));
  return out;
}

/** The loss a perfect model still pays, given that half the sequence is noise. */
export function inductionFloor(vocab, half) {
  /* Predicting position t from positions < t. The first token of the second
     half is the last one that cannot be known — at that point the model has
     seen the whole first half but has no way to know the repeat starts here...
     except that it does, because position is part of the input. So: the first
     `half - 1` predictions are pure noise, the rest are knowable. */
  const noisy = half - 1;
  const total = 2 * half - 1;
  return (noisy * Math.log(vocab)) / total;
}

/* ── the text side ──────────────────────────────────────────────────────────
   A character-level vocabulary built from whatever corpus it is handed. Not
   BPE: the tokeniser has a page of its own, and mixing the two would mean the
   attention pictures are partly about the tokeniser instead of about
   attention. */

export function buildVocabulary(text) {
  const chars = Array.from(new Set(text)).sort();
  const toId = new Map(chars.map((c, i) => [c, i]));
  return {
    size: chars.length,
    chars,
    encode: (s) => Array.from(s, (c) => toId.get(c)).filter((v) => v !== undefined),
    decode: (ids) => ids.map((i) => chars[i] ?? '').join(''),
  };
}

/** Random windows of `len + 1` characters — len inputs and their len targets. */
export function textBatch(next, { ids, len, batch }) {
  if (ids.length < len + 1) throw new Error('corpus is shorter than one window');
  const out = [];
  for (let i = 0; i < batch; i++) {
    const at = Math.floor(next() * (ids.length - len - 1));
    out.push(Array.from(ids.slice(at, at + len + 1)));
  }
  return out;
}

export { rng };
