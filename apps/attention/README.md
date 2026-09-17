# Attention — watching a circuit form

**[Open it](index.html)** · A transformer trained from scratch with
backpropagation written from nothing, running in your browser. Drag through
training and watch one attention head go from an even smear to a single bright
stripe at the exact step the loss falls off a cliff.

No PyTorch, no JAX, no library of any kind. No API key, no server, nothing
fetched from a service.

## What is actually here

| | |
|---|---|
| [`autograd.js`](autograd.js) | Reverse-mode automatic differentiation over matrices, 420 lines. matmul, layerNorm, causal softmax, cross-entropy, gather, concat — each with a hand-written backward pass. |
| [`model.js`](model.js) | An attention-only transformer, plus the four sampling knobs (temperature, top-k, top-p, min-p) in the order they really apply. |
| [`optim.js`](optim.js) | Adam with decoupled weight decay, gradient clipping by global norm, cosine schedule with warmup. |
| [`data.js`](data.js) | The task. |
| [`analysis.js`](analysis.js) | Finding a circuit by its signature, and scoring it. |
| [`quantise.js`](quantise.js) | int8 symmetric quantisation, which is how the weights ship. |
| [`train.mjs`](train.mjs) / [`pack.mjs`](pack.mjs) | Train it; measure it; pack it. |

[20 gradient checks](../../tests/autograd.test.mjs) and
[48 model tests](../../tests/attention.test.mjs).

## Why the gradient checks came first

A wrong forward pass throws, or produces obvious nonsense. A wrong *backward*
pass does neither — the model still trains, just slightly worse, and there is no
symptom to chase. You end up tuning the learning rate for a week to work around
a sign error.

So every backward pass in `autograd.js` is checked against central finite
differences before anything was built on top of it: nudge one input by ±h, see
how much the output moved, compare that to what the backward pass claims. All
twenty passed on the first run, which I did not expect.

Float64 throughout, not Float32, for exactly this reason: finite-difference
checking in single precision is a coin toss, because the numerical error in
`(f(x+h) − f(x−h)) / 2h` swamps the thing you are trying to measure.

## Attention-only, and two layers, on purpose

There are no MLP blocks. That is not a simplification to save work — it is the
architecture from Elhage et al., *A Mathematical Framework for Transformer
Circuits* (2021), and it is the right one for this question: in a model with no
MLPs, **every single thing the model can do it does by moving information
between positions**, so the attention patterns on screen are the entire
computation rather than a fraction of it.

Two layers, because one cannot do this. To answer *"what followed this token
last time"* you first need each position marked with what came **before** it — so
one head has to write that mark and a head in a **later** layer has to read it.
Two pieces, useless apart. That is why the loss sits flat for hundreds of steps
and then collapses: gradient has to assemble both halves before either one earns
anything.

## The mistake that mattered

The first version of the task repeated a fixed half: 32 random tokens, then the
same 32 again. The model learned it, the loss fell off a cliff exactly as
advertised, and a head reached an induction score of **0.92**. It looked
perfect.

It was not an induction head. It was a **positional copy head**. Because every
sequence repeated at the same place, the model had simply learned to attend from
position *i* to position *i − 31* — a fixed offset, read straight off the
positional embeddings. It never looked at a token in its life.

On screen the two are identical: both draw a clean off-diagonal stripe. The only
tell was that it had appeared in **layer 0**, where the two-layer circuit does
not fit.

The fix is in [`data.js`](data.js): the period is now drawn fresh for every
sequence, so there is no offset to memorise and the only way through is to match
on the tokens themselves. And [`pack.mjs`](pack.mjs) now scores the final model
across the whole range of periods and prints the spread — a positional head
spikes at one offset and collapses away from it; a content-matching head does
not care. That check runs on every pack, so the claim cannot quietly stop being
true.

This is the part of the work worth reading. Getting a beautiful result is easy;
the job is finding out whether it is the result you think it is.

## Shipping the weights

Thirteen checkpoints at 45,440 double-precision parameters is about five
megabytes of JSON. They ship the way real weights ship: **int8, symmetric, one
scale per matrix**. Each number becomes a signed byte and is reconstructed as
`byte × scale` on load.

And the cost is measured rather than assumed — `pack.mjs` runs each checkpoint
at full precision and again quantised, on the same batch, and reports the
difference. Worst case across all thirteen: **about 0.0016 nats**. A compression
step you have not measured the cost of is a compression step you are hoping
about.

## A second, sneakier version of the same mistake

With the period varying, `pack.mjs` scores the final model across the whole
range and prints the spread. The first time it ran it said this:

```
  period 12  0.167   period 24  0.425   period 36  0.604
  period 16  0.235   period 28  0.495   period 40  0.577
  period 20  0.318   period 32  0.597
  spread across periods: 0.437 — UNEVEN
```

A smooth rise with period. It reads exactly like a head that works better at
long range, and I spent a while working out what would cause that.

Nothing did. **The measurement was wrong.** A 64-token sequence with period 12
contains the block five times over, so the token following a previous occurrence
of the current token sits at `i+1−12`, and at `i+1−24`, and at `i+1−36` — all
of them correct places to copy from, and a head is free to prefer any. The score
was only counting the nearest one, so at period 12 it was seeing about a fifth
of the head's attention and at period 40 nearly all of it.

Counting every valid target instead:

```
  period 12  0.708   period 24  0.611   period 36  0.604
  period 16  0.645   period 28  0.593   period 40  0.577
  period 20  0.596   period 32  0.597
  spread across periods: 0.132 — flat, so it is matching on content
```

Flat, at roughly 0.6, against a chance level of 0.02–0.07. And you can see it on
the page: the layer-1 heads draw *several* parallel stripes, one per previous
occurrence, which is what the corrected metric is now counting.

Two bugs, the same shape: the first made a positional head look like induction,
the second made one induction head look like eight different ones. Both produced
a plausible picture. Neither would have thrown.

## Where the circuit ended up

With the task fixed, the heads land exactly where the theory says they should:

| | head | layer | score | chance |
|---|---|---|---|---|
| previous-token head | **0.3** | 0 | 0.271 | — |
| induction head | **1.2** | **1** | **0.766** | 0.070 |

Layer 0 marks each position with its predecessor; layer 1 matches on that mark
and copies. On the page the layer-0 heads visibly hug the diagonal and the
layer-1 heads visibly stripe. In the first, broken version the "induction head"
was in layer 0 — which was the only clue that anything was wrong.

## Other bugs worth recording

**Top-p kept one token too many.** `0.4 + 0.3 + 0.2` is `0.8999999999999999` in
binary floating point, so a nucleus that reaches exactly 0.9 in real arithmetic
misses the threshold and admits one more token — and the token it admits is the
low-probability tail that nucleus sampling exists to remove. A test caught it; it
would have been close to invisible in output.

**Backward was zeroing parameter gradients.** A batch is many sequences and one
step, so every sequence must *add* its gradient to the same parameters. The
first version zeroed everything it walked, which meant the optimiser was
training on a batch of one and it looked only like a noisy run. The first fix
was to copy 45,000 gradients out and back around every sequence, which worked
and was absurd; the right fix was for `backward()` to leave parameters alone and
let the optimiser clear them once per step.

**The checkpoints straddled the interesting part.** The first run spread its
snapshots evenly, so it caught "random" and then "solved" with the 120 steps in
between missing entirely. Checkpoint steps are now passed in explicitly and
clustered through the transition.

## What this is not

It is not a language model. It is trained on random tokens and does exactly one
thing. It has no MLP layers, which real transformers rely on heavily. The
induction head here is a clean textbook instance *because the task was built to
isolate it* — in a model trained on text the same circuit exists but is tangled
up with everything else.

What it is: a real transformer, with real backpropagation, trained until a
specific named mechanism appeared, and then measured rather than asserted.
