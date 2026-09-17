/* apps/tokens/bpe.js — byte-pair encoding, the real thing.

   Every large language model reads tokens, not letters. Almost everything
   people find baffling about what these models can and cannot do — that they
   miscount the letters in a word, that they are worse at arithmetic than a
   calculator from 1974, that the same sentence costs three times as much in
   Japanese — comes out of this file's worth of algorithm, and out of nothing
   deeper than this file.

   BYTE-LEVEL. The base vocabulary is the 256 byte values, not a character set.
   That sounds like an implementation detail and is the reason a model can
   handle an emoji, a Cyrillic name and a corrupt paste from a PDF without any
   of them being "unknown". Nothing is ever out of vocabulary, because every
   possible input is already a sequence of bytes. The cost is that a character
   outside ASCII is several tokens before any merging happens at all, which is
   most of the reason English is cheaper than everything else.

   The training loop is the naive one: count every adjacent pair, merge the
   most common, repeat. Real trainers keep the counts incrementally instead of
   recomputing them, which is perhaps twenty times faster and considerably
   harder to read. Recomputing over unique words weighted by frequency — rather
   than over the raw text — gets most of that speedup for none of the
   complexity, because a corpus of 200,000 characters is usually 8,000
   distinct words. */

/* ── pre-tokenisation ───────────────────────────────────────────────────────
   Before any merging, the text is chopped into chunks that merges are never
   allowed to cross. Without this step BPE learns a token for ". The" and one
   for "s said", and the vocabulary fills up with fragments that span word
   boundaries and generalise to nothing.

   The two patterns below are the actual ones, and the difference between them
   is not cosmetic. */

export const PATTERNS = {
  /* GPT-2. Runs of digits are one chunk however long they are, so BPE is free
     to learn "2020" as a single token and "1234567" as some arbitrary
     splitting that depends on what was common in the training data. */
  gpt2: {
    label: 'GPT-2',
    note: 'Digits run together into chunks of any length, so how a number '
        + 'splits depends on how often that exact number appeared in training.',
    re: /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu,
  },
  /* GPT-4 and everything after it. The `{1,3}` is the whole change: digits are
     capped at three per chunk, so numbers split into predictable groups and a
     model doing arithmetic sees consistent pieces instead of whatever
     tokenisation the training corpus happened to induce. */
  gpt4: {
    label: 'GPT-4',
    note: 'Digits are capped at three per chunk. Numbers split predictably, '
        + 'which is a large part of why later models got better at arithmetic.',
    re: /'(?:[sdmt]|ll|ve|re)| ?\p{L}+| ?\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu,
  },
};

export function pretokenize(text, style = 'gpt4') {
  const spec = PATTERNS[style];
  if (!spec) throw new Error(`no pre-tokeniser called "${style}"`);
  /* A fresh regex per call. A /g regex carries lastIndex between calls, so
     sharing one makes the second call skip the beginning of its input — a bug
     that only shows up on the second thing you tokenise. */
  return text.match(new RegExp(spec.re.source, spec.re.flags)) ?? [];
}

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder('utf-8', { fatal: false });

/* ── training ───────────────────────────────────────────────────────────── */

/**
 * Learn `vocabSize - 256` merges from `text`.
 *
 * `onMerge` is called after each one, which is what lets the page animate the
 * vocabulary being built rather than showing a finished table. Watching "th",
 * then "the", then " the" appear in that order explains BPE better than any
 * description of it does.
 */
export function trainBPE(text, { vocabSize = 512, style = 'gpt4', onMerge = null } = {}) {
  if (vocabSize <= 256) throw new Error('the first 256 tokens are the bytes; ask for more than that');

  /* Unique chunks with counts, not the raw stream. "the" appearing 4,000 times
     is one row of work per merge instead of four thousand. */
  const counts = new Map();
  for (const chunk of pretokenize(text, style)) {
    counts.set(chunk, (counts.get(chunk) ?? 0) + 1);
  }

  const words = [];
  for (const [chunk, n] of counts) {
    words.push({ ids: Array.from(utf8.encode(chunk)), count: n });
  }

  const merges = [];
  const vocab = new Map();
  for (let b = 0; b < 256; b++) vocab.set(b, [b]);

  for (let next = 256; next < vocabSize; next++) {
    /* Count every adjacent pair, weighted by how often its word occurs. */
    const pairs = new Map();
    for (const w of words) {
      for (let i = 0; i + 1 < w.ids.length; i++) {
        const key = w.ids[i] * 0x100000 + w.ids[i + 1];
        pairs.set(key, (pairs.get(key) ?? 0) + w.count);
      }
    }
    if (pairs.size === 0) break;

    let bestKey = -1, bestCount = 0;
    for (const [key, n] of pairs) {
      /* Ties broken by the lower pair id, so the same corpus always gives the
         same vocabulary. Map iteration order in JavaScript is insertion order,
         which depends on which word came first, which depends on the Set — and
         a tokeniser that is not reproducible is not a tokeniser. */
      if (n > bestCount || (n === bestCount && key < bestKey)) { bestCount = n; bestKey = key; }
    }
    if (bestCount < 2) break;

    const a = Math.floor(bestKey / 0x100000), bb = bestKey % 0x100000;
    for (const w of words) w.ids = applyMerge(w.ids, a, bb, next);

    merges.push([a, bb, next]);
    vocab.set(next, vocab.get(a).concat(vocab.get(bb)));
    onMerge?.({
      rank: merges.length - 1, id: next, count: bestCount,
      text: bytesToText(vocab.get(next)),
    });
  }

  return finalise(merges, vocab, style);
}

function applyMerge(ids, a, b, into) {
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    if (i + 1 < ids.length && ids[i] === a && ids[i + 1] === b) { out.push(into); i++; }
    else out.push(ids[i]);
  }
  return out;
}

function finalise(merges, vocab, style) {
  const rank = new Map();
  merges.forEach(([a, b], i) => rank.set(a * 0x100000 + b, i));
  return { merges, vocab, rank, style, size: vocab.size };
}

/* ── encoding ───────────────────────────────────────────────────────────── */

/**
 * Text → token ids.
 *
 * The merges are applied in the order they were LEARNED, not greedily
 * longest-first. That ordering is the entire content of a trained tokeniser:
 * the same vocabulary applied in a different order gives different tokens for
 * the same string.
 */
export function encode(text, model) {
  const out = [];
  for (const chunk of pretokenize(text, model.style)) {
    out.push(...encodeChunk(Array.from(utf8.encode(chunk)), model));
  }
  return out;
}

function encodeChunk(ids, model) {
  while (ids.length > 1) {
    /* The lowest-ranked merge present anywhere in the word, applied everywhere
       it occurs, then look again. */
    let bestRank = Infinity, bestAt = -1;
    for (let i = 0; i + 1 < ids.length; i++) {
      const r = model.rank.get(ids[i] * 0x100000 + ids[i + 1]);
      if (r !== undefined && r < bestRank) { bestRank = r; bestAt = i; }
    }
    if (bestAt < 0) break;
    const [a, b, into] = model.merges[bestRank];
    ids = applyMerge(ids, a, b, into);
  }
  return ids;
}

/** Text → the chunks and their tokens, for showing the work. */
export function encodeDetailed(text, model) {
  const out = [];
  for (const chunk of pretokenize(text, model.style)) {
    const ids = encodeChunk(Array.from(utf8.encode(chunk)), model);
    out.push({ chunk, ids, pieces: ids.map((id) => bytesToText(model.vocab.get(id))) });
  }
  return out;
}

export function decode(ids, model) {
  const bytes = [];
  for (const id of ids) {
    const b = model.vocab.get(id);
    if (!b) throw new Error(`token ${id} is not in this vocabulary`);
    bytes.push(...b);
  }
  return fromUtf8.decode(Uint8Array.from(bytes));
}

/**
 * Bytes → something printable.
 *
 * A single token is very often NOT valid UTF-8 on its own — half of a
 * multi-byte character, because the merges were learned over bytes and have no
 * idea where characters begin. Those bytes are shown as ␦ boxes rather than as
 * the replacement character, so that "this token is a fragment of a character"
 * is visibly different from "this text contains U+FFFD".
 */
export function bytesToText(bytes) {
  const s = new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(bytes));
  return s.includes('�')
    ? bytes.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : `⟨${b.toString(16).padStart(2, '0')}⟩`)).join('')
    : s;
}

/* ── the things people actually want to know ────────────────────────────── */

/**
 * Why a model cannot reliably count the letters in a word.
 *
 * Nothing in the model ever sees "strawberry" as ten characters. It sees two
 * or three opaque ids. Asking it how many r's are in there is asking it to
 * recall a fact about the spelling of a token it only knows as a number —
 * which it can sometimes do, from having read spelling discussions, and
 * therefore does unreliably rather than never.
 */
export function spellingView(word, model) {
  const ids = encode(word, model);
  const pieces = ids.map((id) => bytesToText(model.vocab.get(id)));
  const letters = Array.from(word.toLowerCase());
  const tally = new Map();
  for (const ch of letters) if (/\p{L}/u.test(ch)) tally.set(ch, (tally.get(ch) ?? 0) + 1);
  const repeated = [...tally.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
  return { ids, pieces, characters: letters.length, tokens: ids.length, repeated };
}

/** Tokens per character, per script. The cost of not being English. */
export function costBySample(samples, model) {
  return samples.map((s) => {
    const ids = encode(s.text, model);
    return {
      ...s,
      characters: Array.from(s.text).length,
      bytes: utf8.encode(s.text).length,
      tokens: ids.length,
      perCharacter: ids.length / Array.from(s.text).length,
    };
  });
}

/** How a number splits — the thing that decides whether arithmetic is learnable. */
export function numberView(digits, model) {
  return encodeDetailed(digits, model).flatMap((c) => c.pieces);
}
