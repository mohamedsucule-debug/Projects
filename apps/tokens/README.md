# Tokens — what a language model actually reads

**[Open it](index.html)** · A byte-level byte-pair encoder, trained in the page
on 64,000 characters of this repository's own prose, in about 380ms. Then three
demonstrations of things people have run into and rarely had shown to them: why
a model cannot count the letters in a word, why arithmetic was hard and then got
easier, and why the same sentence costs three times as much in Japanese.

No API key, no server, nothing uploaded. The algorithm is 240 lines in
[`bpe.js`](bpe.js) and has [40 tests](../../tests/tokens.test.mjs).

## Why build the tokeniser rather than call one

Because the interesting part is not the output, it is the *order*. Watching " the"
appear as the fifth merge, after "he" and "in" and before "ing", explains what
BPE is in a way that a finished vocabulary table cannot. And because a tokeniser
you trained is a tokeniser you can interrogate: this page can show you what
GPT-2's pre-tokenisation rule does to a corpus full of dates versus what GPT-4's
does, on the same data, in the same second.

## What it actually implements

**Byte-level.** The base vocabulary is the 256 byte values, not a character set.
That is why `decode(encode(x)) === x` holds for emoji, for Arabic, for a lone
control character and for every byte value from 0 to 255 — all of which are in
the test suite. Nothing is ever out of vocabulary, because every possible input
is already a sequence of bytes. The cost is that a character outside ASCII is
several tokens before merging starts, which is most of the language tax.

**Both pre-tokenisers.** The regular expressions that decide what BPE is allowed
to merge, from GPT-2 and from GPT-4. They are in
[`bpe.js`](bpe.js) as `PATTERNS`, and the only meaningful difference between them
is `\p{N}+` becoming `\p{N}{1,3}` — digits capped at three per chunk.

**Trained over unique chunks weighted by frequency**, not over the raw stream.
A 64,000-character corpus is about 8,000 distinct words, so a merge costs 8,000
rows of work instead of 64,000. Real trainers also keep the pair counts
incrementally, which is perhaps twenty times faster again and considerably
harder to read; this does not.

## The three consequences

**Spelling.** `strawberry` is ten characters and six tokens: `st·ra·w·ber·r·y`.
The model is holding six numbers. The answer to "how many r's" is not present in
any of them — it is a fact about the *spelling* of a token, which the model can
only have learned from having read people discuss spelling. That is why the
failure is unreliable rather than total.

**Arithmetic.** The page trains both pre-tokenisers twice: once on this repo's
prose, where no number is frequent enough to be worth a token and the two agree
exactly, and once on a thousand dated log lines, where GPT-2 immediately spends a
token on `2024` as a whole unit and splits `1999` into `1·99·9`. That middle
token is the *99* out of the middle of a year and means nothing arithmetically.
GPT-4 is not immune — it learns `202` and splits 2024 as `202·4` — but it has a
ceiling of three digits, so the alignment is forced by the regular expression
rather than by whatever happened to be popular. Bounded beats optimal.

**The language tax.** The same sentence in six languages, measured. Everyone pays
per token; not everyone is charged the same amount for the same meaning. It is a
longer wait, a smaller usable context window and a larger bill, imposed on
whoever does not write in the language the vocabulary was fitted to.

## Bugs worth recording

**The escaper corrupted its own markup.** `escapeShow` escaped the HTML, then
inserted `<span style="opacity:.42">` for newlines, then replaced every space
with a non-breaking space — including the spaces inside the tags it had just
written. The browser got `<span style=...>`, gave up on the tag, and the
vocabulary chips rendered with their counts hanging outside their own borders.
An escaping function has to finish escaping before it emits any markup.

**A demonstration that demonstrated nothing.** The first version of the numbers
section compared GPT-2 and GPT-4 on `1234567` and asserted they would differ.
They did not, and a test caught it. The reason is the actual mechanism: the
pre-tokeniser does not split numbers, it decides what BPE is *allowed* to merge —
and with no numbers in the corpus there was nothing to merge, so both fell back
to one token per digit. The section now shows both corpora, and says so.

**Copy that overclaimed.** Having got the dated corpus working, the page said
GPT-4's numbers "tokenise identically here and above". They do not: it learns
`202` from the dates and splits 2024 differently. The true invariant is the
three-digit ceiling, and that is what it says now.

**A promise the page ignored.** The spelling section was hardcoded to
`strawberry` while the text under it invited you to type `Mississippi` into the
box. It now takes the most repeat-heavy word in whatever is in the box.
