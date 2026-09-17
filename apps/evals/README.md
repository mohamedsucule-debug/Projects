# Evals — 92% versus 89% is not a result

**[Open it](index.html)** · Two real parsers, eight hundred real inputs, graded
live in the page. Drag the sample size and watch the confidence interval on the
difference cross zero. At a hundred items the better parser scores **worse**.

This is the part of shipping an LLM product that nobody demos. It is also the
part that separates people who have shipped one from people who have built a
demo, so it is here in full: percentile bootstrap, paired and unpaired; Wilson
intervals; McNemar's exact test; two-proportion power analysis.
[44 tests](../../tests/evals.test.mjs).

## Why the systems are real

Every "how to run an eval" write-up I have found fakes the model, which skips
the hard half — if the scores come out of a random number generator then of
course the statistics behave. Here both systems are actual programs and every
number on the page is computed from their real output:

- **v1** finds a number, strips the commas, looks for a currency symbol.
- **v2** works out what the separators mean before trusting them.

The task is pulling the total off a line of a receipt. It looks trivial and is
not, because of the long tail: a hundred lines are `$1,234.56` and then one is
`1.234,56 EUR`, which is the same amount written by someone in Germany, and v1
reads it as one euro twenty-three.

v2 also ships with a **real regression**, deliberately: it treats brackets as
accountants' notation for a negative, which is correct for `($146.70)` and turns
`Total (revised): $99.00` into minus ninety-nine. Real improvements arrive with
real breakage attached, and an eval that cannot see the breakage is not doing
its job.

## What the page shows

**The sample-size slider.** The systems do not change and the items do not
change — only how many you looked at. At 100 items: v1 94.0%, v2 93.0%,
difference −1.0 points, interval −5.0 to +3.0. The better parser is losing, and
the interval says you cannot tell. The band first clears zero at **300 items**.

**Pairing.** Both systems saw the same inputs, so the thing to resample is the
*item*, carrying both outcomes with it. Item difficulty then cancels. It is
typically around twice as narrow for free, and every report that shows two
intervals side by side and invites you to compare them by eye has thrown that
away.

**McNemar.** Items both systems get right, and items both get wrong, carry no
information about which is better. At 100 items, 95 of them carry none: the
comparison rests on 5 disagreements, and the exact test gives p = 1.0. Your
hundred-item eval is deciding on five observations.

**The per-format breakdown.** v2 is better overall and strictly worse on one
input shape. No summary number will ever tell you that.

**Power.** Detecting a three-point move from a 90% baseline needs about 1,400
items per side. A hundred-item eval can only resolve about ten points. That is
worth knowing before you spend the week, not after.

## The statistics, and why these ones

**Percentile bootstrap** rather than a t-interval, because eval scores are
rarely normal — they are 0/1, or a three-level rubric, or bimodal where the
model either nails it or falls over. Resampling assumes nothing about the shape.
There is a test that the 95% interval really does contain the truth about 95% of
the time, because an interval that does not do that is decoration.

**Wilson**, not `p ± 1.96·sqrt(p(1−p)/n)`. The textbook one is actively wrong
near the edges: at 20/20 it returns [1, 1], claiming certainty from twenty
observations. Wilson gives [0.839, 1].

**McNemar exact**, not chi-squared. The discordant count is routinely under 25,
which is exactly where the approximation stops being trustworthy.

## Bugs worth recording

**Two labels that did not guarantee what they named.** Found by reading the
sample table on the rendered page, not from any failing test.

The `spaced` format is defined by having a space where the thousands separator
goes — and more than half its items were under a thousand, so they had no
separator at all and were ordinary `euro-comma` items wearing the wrong label.
The `scanned` format picked one of five OCR substitutions at random, three of
which are conditional (there is not always a `1` or a `0` or a `.` to replace),
so items came out labelled as corrupted and were pristine.

Neither would ever throw. Both would quietly make the per-format breakdown —
the analysis this page exists to demonstrate — report accuracy for a category
against items that were never in it. There is now a test that every item
actually exhibits the format it is labelled with.

**A test that asserted the wrong arithmetic.** The McNemar padding test claimed
`both` would be 1010 after adding a thousand both-correct items. It is 1000: the
two original arrays are exact opposites, so none of the first eighteen items is
one both systems got right. The code was right and the expectation was wrong.

**An unreadable assertion.** The first version of the format-honesty test
checked for corruption with a pile of alternatives about stray letters and
missing decimal points. An uncorrupted line has exactly one shape, so the test
now states that shape and negates it.
