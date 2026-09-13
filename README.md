# Design Engineering Lab

Six working tools for systems that refuse to be simple.

Each project starts with the hard part — a regex compiler, a cost-based query
optimiser, the Raft protocol, a critical-path analyser, Myers diff, OKLab colour
maths — implemented from scratch, and then asks the design question that
usually goes unasked: **what does a person need to see to understand this?**

They are not mockups. Every number on screen is computed live by the engine
beside it, every algorithm is the real one, and the parts that are
approximations say so on screen.

```
open index.html          # the gallery
npx http-server          # ES modules need a server; nothing else does
node tests/run.mjs       # 77 tests, no framework, no install
```

---

## The projects

| | What it is | The design problem it solves |
|---|---|---|
| **[Regex Lab](projects/regex-lab)** | A regex engine: parser, Thompson NFA, subset construction, and two matchers racing | A regex is a program you never see run. This shows the automaton, the live state set as you scrub the input, and the backtracker's step counter — the number that explains production outages nobody can reproduce. |
| **[Query Planner](projects/query-planner)** | A cost-based SQL optimiser with statistics, access paths and Selinger join enumeration | `EXPLAIN` tells you what the database decided, never why. Every row estimate here shows its arithmetic. Drag a table's row count and watch the plan flip from hash join to index probe. |
| **[Raft Lab](projects/raft-lab)** | Five nodes running real Raft on a deterministic clock | Consensus is impossible to read from logs, because everything interesting happens *between* the log lines. Partition the network, crash the leader, then watch the four safety invariants from the paper hold anyway. |
| **[Trace Explorer](projects/trace-explorer)** | Distributed tracing with critical-path analysis and automated findings | Tracing tools are built for people who already know what they're looking for. This one opens on the worst trace and explains it in sentences — with a denominator. |
| **[Diff Forge](projects/diff-forge)** | Myers diff, patience diff, and a three-way merge | Merge conflicts are the most-hated interface in software: at the moment you need the most context, you get seven lines of `<<<<<<<`. Rebuilt as a choice, with both intents side by side and the base quoted underneath. |
| **[OKLCH Studio](projects/oklch-studio)** | Perceptual palette generation, gamut mapping, and an APCA contrast matrix | Most palette tools generate in HSL, which lies about lightness — so your "500" step passes contrast on one accent and fails on the next. Generate where lightness means lightness, then audit every pair. |

Each project has its own README covering the design decisions, the algorithms,
and — deliberately — what it does **not** do.

---

## How it is built

**Engine and interface are separate.** Every project is a pure `engine.js` —
no DOM, deterministic, unit-tested — plus an `index.html` that renders it. The
engine is the part that must be *correct*; the interface is the part that must
be *understood*. Keeping them apart means the hard logic can be tested from
Node, and the interface can be rewritten without touching it.

```
index.html                  the gallery
shared/lab.css              the design system — every token lives here
shared/lab.js               60 lines of runtime: element factory, ticker,
                            HiDPI canvas, seeded PRNG
projects/<name>/
  engine.js                 the algorithm — pure, no DOM
  index.html                the interface
  README.md                 the design problem, and the limits
tests/
  run.mjs                   the runner
  *.test.mjs                property tests over each engine
```

**No framework, on purpose.** These are interfaces about data, not about state
management. The whole shared runtime is 60 lines. No build step, no
`node_modules`, no lockfile — clone it in five years and it still runs.

**One design system.** `shared/lab.css` holds every colour, size and control.
One accent, hairline structure, monospace for anything a machine produced and
sans for anything a human reads. Light and dark are both first-class, and every
project inherits both for free.

**Tests assert properties, not pixels.** The suite checks the things that make
each engine *correct*, and several of them caught real bugs during the build:

- the NFA simulation agrees with the platform's own `RegExp` across 32 cases;
- both diff algorithms' edit scripts reconstruct both inputs, over 800
  randomised pairs;
- Raft's safety invariants hold at **every tick** of a scripted chaos run;
- the critical path's segments tile a trace exactly — no gaps, no double
  counting — across 200 generated traces;
- APCA matches its published reference values (black on white is Lc 106).

```
node tests/run.mjs          # everything
node tests/run.mjs raft     # one file
```

**Honest about limits.** Every project README ends with what it doesn't do:
no capture-group extraction, no log compaction, no rename detection, sRGB only.
A demo that hides its edges teaches the wrong lesson about the system it models.

---

## Built with Claude Code

The whole repo was written in a single session with [Claude Code](https://claude.ai/code),
which is the point: the work was directed, not delegated. The loop that
produced it, and the parts that needed a human judgement call:

1. **Engine first, in Node.** Get the algorithm right against an oracle — the
   platform `RegExp`, published APCA values, reconstruction properties — before
   any pixel exists. A beautiful interface over a wrong engine is worse than no
   interface.
2. **Screenshot in the loop.** Every interface was rendered headlessly and
   *looked at* after each change. That is how the overlapping duration labels,
   the stray `null` in a status bar, the un-arrowed automaton edges and a diff
   pane that clipped its own code got caught — none of which any test would
   have flagged.
3. **Distrust the green check.** Two tests failed because *the test* was wrong
   (the greedy/lazy assertion, the self-time-equals-wall-time assumption), and
   two failed because the *engine* was wrong (the critical path leaked time on
   overlapping spans; the planner's scans were keyed by table name while its
   estimates were keyed by alias, so every filter silently fell back to a
   default selectivity). Telling those apart is the judgement that cannot be
   handed over.
4. **Write the copy last, out loud.** "22% of the trace, a single batched query
   would collapse this to one round trip" is a different product from "p99
   elevated", and the difference is entirely in the writing.
