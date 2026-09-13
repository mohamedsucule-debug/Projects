# Trace Explorer

A distributed-tracing frontend over synthetic telemetry: 260 traces across ten
services, a span waterfall, critical-path analysis, and findings written in
sentences instead of dashboards.

**Run it:** open `index.html` from the [index](../../index.html), or serve the
repo root and visit `/projects/trace-explorer/`.

### The design problem

Tracing tools are usually built for the person who already knows what they are
looking for. You get a list of traces, a waterfall, and a wall of attributes —
and the actual skill, the part that takes years, is looking at forty coloured
bars and recognising *the shape of the problem*. That expertise should be in
the product, not in the operator.

Three decisions follow from that:

**It opens on something worth looking at.** Not trace #1. The app scores every
trace for high-severity findings and duration, and opens the worst one. A tool
whose empty state is "here is a list, good luck" has pushed its hardest problem
onto the user.

**The analysis is in prose, with a denominator.** Not "p99 elevated" but *"30
sequential calls to postgres.SELECT stock, issued one after another from
inventory.reserve_items, totalling 129.9ms — 22% of the trace. A single batched
query would collapse this to roughly one round trip."* Every finding names the
share of the trace it accounts for, because "this is slow" without a
denominator is a feeling, not a finding. Clicking one jumps to the spans that
caused it.

**The critical path is a first-class object.** The spans in white outline are
the ones that actually set the total; everything else is running in parallel or
too small to matter. The right-hand panel breaks that path down by service —
which is the answer to "where do I spend my week?", and it is routinely *not*
the service with the biggest bar.

### The findings, and how they are derived

The generator injects pathologies with a probability. The analyser never sees
that — it only sees spans, exactly as it would against real telemetry:

| Finding | How it is detected |
|---|---|
| N+1 query loop | ≥5 sibling spans on one operation, non-overlapping in time |
| Fan-out (benign) | the same shape, but overlapping — so it is priced at the slowest branch, not the sum |
| Retry after failure | an errored span followed by a sibling repeating the same operation |
| Unaccounted time | a span's children explain less than 80% of its duration |
| Single-service dominance | one service holds >45% of the critical path's self time |
| Cache miss cost | a miss attribute on a cache span, plus the datastore read that followed |

Sorting is by severity, then by share of the trace.

### Implementation notes

- `criticalPath()` walks backwards from the end of the root span: take the child
  that was still running at the cursor, recurse into it, then keep filling the
  gap before it started. A child that *overlaps* the cursor is clipped rather
  than skipped — without that, concurrent children leave holes in the
  accounting. It returns segments, and the test asserts the property that makes
  them correct: **the segments tile the trace exactly**, edge to edge, with no
  gaps and nothing counted twice.
- `selfTime()` subtracts the *union* of child intervals, not their sum, so
  parallel children don't over-subtract.
- The latency histogram is log-scaled (latency distributions are not normal, and
  a linear axis renders the interesting tail as one pixel). Drag across it to
  filter the trace list to a latency band.
- Generation is seeded, so the sample is reproducible; "new sample" re-rolls it.

### Known limits

The data is synthetic — realistic in shape, invented in substance. There is no
OTLP ingestion, no service map, no trace comparison view, and spans carry a
handful of attributes rather than a full resource/scope model.
