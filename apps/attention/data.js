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
 * One sequence: `period` random tokens, then that block repeating to `length`.
 *
 * THE PERIOD VARIES FROM SEQUENCE TO SEQUENCE, and that is the entire point of
 * this function. The first version of it repeated a fixed half, and the model
 * duly learned to solve it — by attending, from position i, to position
 * i − 31. Always 31. It never looked at a single token; it had memorised an
 * offset from the positional embeddings, and since every sequence repeated at
 * the same place, that worked perfectly.
 *
 * It scored 0.92 and it was not an induction head. It was a positional copy
 * head wearing one, and the only reason to notice is that it turned up in
 * layer 0, where the circuit is not supposed to fit.
 *
 * With the period drawn fresh per sequence there is no offset to memorise. To
 * predict anything the model has to find where the CURRENT token appeared
 * before and read off what followed it — which is induction, and which needs a
 * head in one layer to mark each position with its predecessor and a head in
 * the next to match on that mark.
 */
export function inductionSequence(next, { vocab, length, minPeriod = 12, maxPeriod = 40 }) {
  const period = minPeriod + Math.floor(next() * (maxPeriod - minPeriod + 1));
  const seq = [];
  for (let i = 0; i < period; i++) seq.push(Math.floor(next() * vocab));
  for (let i = period; i < length; i++) seq.push(seq[i - period]);
  seq.period = period;
  return seq;
}

export function inductionBatch(next, opts) {
  const out = [];
  for (let i = 0; i < opts.batch; i++) out.push(inductionSequence(next, opts));
  return out;
}

/**
 * The loss a perfect model still pays.
 *
 * Predicting token t from tokens 0…t−1. Tokens 1…p are unguessable: up to and
 * including the first repeated token the model has seen nothing but noise and
 * has no way to know where the block ends. From t = p+1 onwards it has seen
 * token p equal token 0, so it knows the period and everything after is
 * determined. So p of the length−1 predictions cost log(vocab) and the rest
 * cost nothing — averaged over the periods the generator actually draws.
 */
export function inductionFloor(vocab, length, minPeriod = 12, maxPeriod = 40) {
  let total = 0;
  for (let p = minPeriod; p <= maxPeriod; p++) total += (p * Math.log(vocab)) / (length - 1);
  return total / (maxPeriod - minPeriod + 1);
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
