# Regex Lab

A regular expression engine — parser, NFA compiler, two matchers and a
determinizer — with a UI wrapped around the parts that are normally invisible.

**Run it:** open `index.html` from the [index](../../index.html), or serve the
repo root (`npx http-server`) and visit `/projects/regex-lab/`.

### The design problem

A regex is a program that people write without ever seeing it run. When one
misbehaves, the feedback is binary — matched, or didn't — so the usual debugging
loop (form a theory, test it, watch what happens) is unavailable. Worse, the
most expensive failure mode has *no* visible symptom at authoring time:
`(a+)+b` looks tidy and takes exponential time on a string of `a`s. That is a
real class of production outage, and no editor warns you.

So the interface shows three things a text box cannot:

1. **The automaton.** The pattern compiled to a Thompson NFA, laid out left to
   right by longest path so it reads like the thing it is: a machine with a
   start, an accept state, and loops you can see looping. Scrub the subject
   string and the live state set lights up. When the set empties, you can point
   at the exact character where the match died.
2. **Two engines, side by side.** The same pattern is run by a parallel
   simulation (Thompson/Pike, linear time) and by a backtracking search (what
   JavaScript, Python and PCRE actually ship). Both report their work. On most
   patterns the bars are similar; on a nested quantifier the backtracker's bar
   turns red and hits the 200,000-step cap while the simulator barely moves.
   The difference is the whole point, and it's one glance wide.
3. **The decision log.** Every `try` / `consume` / `fail` / `backtrack` the
   backtracker made, in order, each tied to the slice of pattern responsible.
   This is the answer to "why did it match *that*?"

### Implementation notes

`engine.js` is pure and has no DOM dependency — it's the same module the
[tests](../../tests) import.

- **Parser** — recursive descent over `alt → cat → rep → atom`. Every AST node
  keeps its `[from, to]` source offsets, which is what lets the trace point back
  at a substring of the pattern. Errors carry an offset, so the message can put
  a caret under the offending character.
- **Compiler** — Thompson construction. Bounded quantifiers `{m,n}` are expanded
  into copies; unbounded ones become a loop. Greediness is encoded as *edge
  order*, which is exactly how a backtracker experiences it.
- **Parallel simulation** — epsilon-closure plus one step per input character.
  Bounded by states × characters, and reports its edge tests so the bar is
  measured, not asserted.
- **Backtracking** — continuation-passing depth-first search over the AST, with
  a step counter, a step cap, and an empty-iteration guard so `(a*)*` terminates
  instead of spinning.
- **Determinizer** — subset construction over representative characters drawn
  from the pattern's own literals and class boundaries, rather than over all of
  Unicode. Zero-width assertions have no home in a position-free DFA state, so
  the table follows them unconditionally and the UI says so rather than quietly
  lying.

### Known limits

Deliberate, and stated rather than hidden: no capture-group *extraction* (groups
are parsed and counted, but the matchers answer yes/no against the whole
subject), no backreferences or lookaround, `{m,n}` capped at 64 to keep
expansion honest, and the DFA table caps at 400 states.
