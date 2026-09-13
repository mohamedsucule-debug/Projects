# Playground

Eleven things I built. All of them run in a browser — no install, no signup,
no video of someone else using it.

**→ [Open the playground](https://mohamedsucule-debug.github.io/Projects/)**
*(or clone it and open `index.html`)*

---

## The toys

Click any of these and they start immediately.

| | |
|---|---|
| **[Sandbox](play/sandbox/)** | Pour sand. Add water. Set it on fire and watch the smoke rise. Ten materials that all behave the way you'd expect — water puts out fire, oil floats, lava turns water to steam, acid eats through stone. |
| **[Beat Lab](play/beats/)** | A drum machine with no sound files in it. Every kick, snare and hat is generated from scratch by the browser. Tap squares, press play, make something. |
| **[Islandsmith](play/island/)** | Press the button and a new world appears: coastline, mountains, forests, rivers, snow and a name. Every island comes from a single random number. |
| **[Flow](play/flow/)** | Twenty thousand particles riding an invisible current. Push them around with your mouse, then save the result as a picture. |
| **[Comet](play/orbit/)** | Move the mouse. Collect the gold. Don't touch the red. Three seconds to learn. |

## The serious ones

Same approach, harder subjects — each one takes something normally invisible and
puts it on screen. These assume you write software.

| | |
|---|---|
| **[Regex Lab](projects/regex-lab/)** | A search pattern compiled into a machine you can watch run, one character at a time — including the kind of pattern that quietly takes a website down. |
| **[Query Planner](projects/query-planner/)** | A database deciding how to answer a question, with its reasoning attached. Drag a table's size and watch it change its mind. |
| **[Raft Lab](projects/raft-lab/)** | Five servers agreeing with each other. Cut the network in half, crash the leader, and watch the safety guarantees hold. |
| **[Trace Explorer](projects/trace-explorer/)** | Where a slow web request actually spent its time, explained in sentences instead of charts. |
| **[Diff Forge](projects/diff-forge/)** | The merge conflict — software's most hated screen — rebuilt as a choice you can actually read. |
| **[OKLCH Studio](projects/oklch-studio/)** | Building a colour palette that still passes when someone runs an accessibility check on it. |

Each of these has its own README covering the design decisions, the algorithms,
and — deliberately — what it does **not** do.

---

## How it's built

**No frameworks. No build step. No dependencies.** Every page here is plain
HTML, CSS and JavaScript. The five toys are each a single self-contained file
you can open by double-clicking it. Clone this in five years and it still runs.

**The serious ones split in two:** a pure `engine.js` (the algorithm — no
screen code, testable from a terminal) and an `index.html` (the interface). The
engine has to be *correct*; the interface has to be *understood*. Different jobs.

```
index.html              the front page, with a live preview on every card
play/<name>/index.html  a toy — one file, no imports
projects/<name>/
  engine.js             the algorithm, pure and DOM-free
  index.html            the interface
  README.md             the design problem, and the limits
tests/run.mjs           77 tests, no framework, no install
```

```bash
npx http-server        # the serious ones use ES modules, so they need a server
node tests/run.mjs     # run the tests
```

## Built with Claude Code

All eleven were built with [Claude Code](https://claude.ai/code) — an AI that
writes and runs code — across a handful of sessions. The interesting part isn't
that AI wrote the code. It's which half of the job it couldn't do.

**What it's brilliant at:** typing. A working falling-sand simulation, a Raft
implementation, a Myers diff — from a description, in minutes, with no typos and
no forgotten edge cases.

**What it can't do:** know that the result is boring. Every screen here was
rendered and *looked at* after each change, and that's where the real work was:

- the hourglass leaked sand out of the sides, because it was drawn as an X
  rather than a funnel
- the forest fire burned one tree and went out, because the match was lit on an
  isolated tree at the edge
- the island came out as a perfectly smooth green ellipse, because the noise
  frequency was so low the whole map sat inside a single noise cell
- the six "serious" links rendered in shouty uppercase, because a heading and a
  list both claimed the same HTML id

Every one of those was *technically working code*. No test would have caught a
single one of them. Two of the tests I wrote were themselves wrong, and two more
found genuine bugs in the engines — telling those apart is the judgement that
doesn't get handed over.

The other half is the writing. "Pour sand. Add water. Then set it on fire"
teaches the sandbox faster than a tutorial would. Deciding what a thing says,
and what it refuses to say, is design work.
