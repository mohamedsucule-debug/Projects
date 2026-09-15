# Playground

Twenty-three things I built. All of them run in a browser — no install, no signup,
no video of someone else using it.

**→ [Open the playground](https://mohamedsucule-debug.github.io/Projects/)**

---

## The big ones

### [Nightshift](apps/nightshift/) — a horror story that reads you back

A coastal watch log from one night in 1987. Wind speed, visibility, one ship
passing on schedule, and six entries that say *Nothing to report.* It does not
stay there.

**The page is deliberately boring, and that is most of the work.** The reflex
with a horror piece is to announce it — dark page, flickering serif, a heartbeat
under the text — which tells the reader what they are looking at in the first
half second. This one is a photocopy of a government document about the weather.
There is a test whose only job is to keep it that way: it finds the first entry
that is not weather and fails if anything before it is interesting.

The haunting is **twelve beats in a list**, each a trigger and the name of an
effect. Triggers are how far you have read, how long you have been here, and how
many times you have switched tabs and come back. So the order of a haunting is
a pure function, and it is tested: nothing fires twice, nothing fires early, and
somebody who flings the scrollbar to the bottom still gets the build.

None of it is a canvas. **The tab title changes, but only while you are looking
somewhere else** — and it is back to normal before you can turn round. The
favicon becomes an eye, drawn at runtime. An entry you read ten minutes ago has
changed behind you. The scrollbar grows. The page tells you the time in the room
you are sitting in.

Then it puts everything back exactly as you found it, except for one line.

The bug worth reading about: the ending used to be a beat at 98% scrolled, so
anybody who threw the scrollbar to the bottom got the closing address and the
fade to black in the same frame — the payload of the whole piece managed one
character before the veil covered it. Driving it headlessly and printing the
text is what caught it. The ending has no trigger at all now.

[Full write-up](apps/nightshift/README.md) — after you have read it.

### [Morph](play/morph/) — seven layouts, no transitions anywhere

One gallery, seven completely different layouts. Switch and every tile flies to
its new place; switch again before they land and they bend into the new
arrangement carrying the speed they already had. Drag to reorder and the rest
flow around your finger. Click a tile and it grows into the detail view.

**A CSS transition is a promise about the future** — get from here to there over
300ms along this curve. Interrupt it and the browser throws that promise away
and starts a new one from wherever the element is, at zero velocity. Things stop
dead and set off again, and it is the most common single reason an interface
feels cheap.

A spring knows only its position, its velocity, and where it is being pulled.
Change the target and nothing is discarded. That is why every gesture here can
interrupt every other one.

The part that surprised me: **there is no expand animation in the codebase.**
Opening a tile writes one large target rectangle; closing writes the old one
back. The shared-element transition falls out for free once every position is
already a spring. Same for reordering.

[Full write-up, including the stacking-context bug that took the longest to
find](play/morph/README.md).

### [Portrait](play/portrait/) — drop in a photo, watch it get rebuilt

Four ways: thousands of dots, a mesh of triangles, tiles in colours the photo
chose for itself, or one bit per pixel. Each one throws the photograph away and
redraws it from a few thousand primitives, which is why they hold up close and
a filter does not. Your photo never leaves your device.

The dots are the point. Each one owns the patch of picture nearest to it and
moves, every pass, to the darkness-weighted centre of that patch — so they
drift towards dark areas and crowd where the picture needs more ink. They start
at **random**, because starting them roughly where they belong converges in
three passes and looks finished before you can see it happen.

Doing that honestly means asking, for every pixel, which dot is nearest: at
200,000 pixels and 4,000 dots, 800 million comparisons per pass. A uniform grid
of cells about one dot apart brings that to roughly ten comparisons per pixel,
which is the difference between an animation and a progress bar. There is a
test that picks 250 random points and asserts the grid agrees with brute force
exactly, because a fast answer that is occasionally wrong would corrupt the
whole relaxation silently.

[Full write-up, including the two bugs and what it deliberately does not
do](play/portrait/README.md).

### [Loom](play/loom/) — build a picture by wiring boxes together

Every box produces an image. One makes a cloud of random fog, one bends
whatever it is given, one swaps grey for colour. Connect them up and the last
box is the picture. Six worked examples come in the box; anything you make
saves as a PNG or copies as a link that carries the whole recipe inside it.

The one decision everything else follows from: **every box produces the same
thing — an RGB image.** Never a number, never a colour, never a handle. Because
they all speak one language, any output plugs into any input and the result is
always defined. No type system, no compatibility matrix, no "you cannot connect
those".

Each result is cached against a fingerprint of everything that could change it
— its settings, its size, and recursively its inputs' fingerprints — so
dragging a slider recomputes only what follows it. Measured on the Marble
example: 5 boxes of 7 redrawn in 30ms, against 165ms for the whole graph cold.

[Full write-up, including what it deliberately does not do](play/loom/README.md).

---

### [Topple](apps/topple/) — a web page with weight

A perfectly ordinary web page — until you swipe across it, and everything your
finger passes through comes loose and falls. Cut the support out from under a
paragraph and what was standing on it collapses on top. Then hit rebuild and
watch the page assemble itself, one row at a time.

Every element becomes a physics body the moment the page loads, but held in
place: it collides and it holds things up until something releases it. That is
what makes a swipe a cut rather than a button.

**They stay real elements the whole time.** Nothing is drawn on a canvas and
nothing is a picture — each element is moved with a transform, which changes
where the browser paints it without changing where it thinks it is. The text is
still text, still crisp, still selectable, lying in a heap on the floor. Putting
it back is removing one style, and the headline returns to the exact pixel it
started on.

Underneath is a 2D rigid body engine written from scratch: separating-axis
collision, contact points by face clipping, and sequential impulses. Four things
separate a pile that stands from a pile that sags, and each was found by
watching a stack fall over — contacts that remember their impulse between
passes, overlap correction that never becomes real velocity, contacts recognised
between frames (which took stable stacks from four boxes to eight), and sleeping
bodies that look exactly like walls to the solver.

Sleeping has to be done in groups. Stop one body on its own and the one resting
against it gets a different answer, twitches, and wakes it straight back up —
a pile of six oscillates between the two states for ever.

[Full write-up](apps/topple/README.md), including where it gives up.

### [Mercury](apps/mercury/) — liquid metal you can put your finger in

A sheet of liquid metal under a sunset sky. Drag it and it ripples; drag the sky
and you walk around it.

**There is no 3D model in that page.** No mesh, no vertex data, no texture of
anything, no library, no asset of any kind. The floating shape is four moving
spheres blended by a formula, the metal is a flat plane whose height comes out
of a physics simulation, and the sky is a gradient and a bright dot. Everything
is worked out from those descriptions per pixel, sixty times a second.

Nothing draws the distortion in the reflections. One pass solves a wave equation
across a texture; the other fires a ray per pixel, and where it lands on metal it
bounces off whatever tilt the waves left there and goes to see what is in the new
direction. The ripples move the tilts, the tilts move the rays, and the
reflection bends — the same way it does in the real world.

The wave speed is 0.42 because the discrete wave equation is stable only while c²
stays under a half, and past it the surface reaches infinity inside a second.
There is a test that runs it at 0.69 and asserts it holds, then at 0.75 and
asserts it comes apart — a test that only checked the working value would pass
just as well if the number were meaningless.

[Full write-up](apps/mercury/README.md), including the five things that looked
wrong and why.

### [Sift](apps/sift/) — drop a CSV in and see what is actually in it

Every column gets a type, a count of the gaps, a range and a shape. Then sort
and filter a hundred thousand rows without it stuttering. Nothing is uploaded.

**Splitting a line on commas is the single most common data bug in working
software.** It silently truncates any row with a comma inside a quoted field,
the row count still looks about right, and nobody notices until a customer asks
where half their address went. So the parser is a character loop that handles
the whole list — escaped quotes, embedded newlines, CRLF, a byte-order mark,
ragged rows, and a trailing newline that must not invent a record that is not
in the file. There is a test for each, because each is a bug I have seen ship.

It also refuses to guess. `new Date('03/04/2025')` is March in the US and April
almost everywhere else, so anything that is not ISO stays text rather than being
silently wrong by up to eleven months.

A hundred thousand rows across eleven columns is 1.1 million elements, and a
browser handed that allocates for forty seconds and then scrolls at four frames
a second. So it does not make them: a tall empty box keeps the scrollbar honest
and only the ~36 rows actually on screen exist, recycled rather than rebuilt.
Measured: **36 DOM rows at a hundred thousand, and 36 after scrolling to the
bottom.**

[Full write-up](apps/sift/README.md).

## The game

### [Ace](play/ace/) — tap to fly a paper plane through a canyon

Don't hit the rocks. That's the whole game, and there is no menu, no difficulty
select, no settings panel and no tutorial, because a game that has to be
explained has already failed.

The rules live in a DOM-free engine, which is what makes a game testable: a
script can play a whole run and assert on the score. The world advances in
fixed 1/120s slices however long the frame took — advancing by whatever `dt`
arrived makes the game measurably easier on a 144Hz monitor, and a test plays an
identical scripted run at 30, 60 and 144fps and asserts they match to six
decimal places.

That test failed twice before it passed, and **both times the test was wrong,
not the engine** — once because the taps didn't land on a whole frame at all
three rates, once because it checked the plane had fallen 0.5s after a flap when
the arc doesn't come back down until 0.537s.

The difficulty curve is tested by playing it: a bot that aims for the next
opening scores 22–25 before dying at ~27 seconds, right about where the openings
stop narrowing.

[Full write-up](play/ace/README.md).

## The toys

Click any of these and they start immediately.

| | |
|---|---|
| **[Sumo](play/sumo/)** | Two players, one keyboard, one key each — or two thumbs on one phone. Hold your key and your arrow stops turning and you charge that way, so you are choosing a moment rather than steering. Knock the other one out of the ring before it closes under you. The physics was tuned by having two bots play a few thousand rounds and measuring how often a round was decided by a shove rather than by the ring; the first draft scored 9%. |
| **[Tangle](play/tangle/)** | A daily connection puzzle. Turn the tiles until no connector is left dangling. The board is grown as a spanning tree and then scrambled, so it is provably solvable *before* you see it — the alternative is shipping an impossible board on day 46. Same board for everyone, every day, and a spoiler-free line to paste into a group chat at the end. |
| **[Tether](play/tether/)** | You swing round a planet on a tether. Tap and you let go, flying off in a straight line — exactly the way you were already pointing, which is drawn on screen the whole time. If that line passes close enough to another planet it catches you; if it doesn't, you are in deep space. One button, one decision: when. |
| **[Stack](play/stack/)** | A block slides past. Tap. Whatever hangs over the edge of the block below is sliced off and falls away, so every sloppy drop makes the next one harder — the width of the top block *is* your remaining margin for error, drawn in the middle of the screen at all times. Land one dead centre and you lose nothing. |
| **[Sandbox](play/sandbox/)** | Pour sand. Add water. Set it on fire and watch the smoke rise. Ten materials that all behave the way you'd expect — water puts out fire, oil floats, lava turns water to steam, acid eats through stone. |
| **[Beat Lab](play/beats/)** | A drum machine with no sound files in it. Every kick, snare and hat is generated from scratch by the browser. Tap squares, press play, make something. |
| **[Islandsmith](play/island/)** | Press the button and a new world appears: coastline, mountains, forests, rivers, snow and a name. Every island comes from a single random number. |
| **[Flow](play/flow/)** | Twenty thousand particles riding an invisible current. Push them around with your mouse, then save the result as a picture. |
| **[Comet](play/orbit/)** | Move the mouse. Collect the gold. Don't touch the red. Fill the bar to clear a level, then again with mines and a spinning bar in the way. The levels never run out — the curve is authored by hand for the first eight and extrapolated after that, approaching a ceiling rather than climbing for ever. |

## The serious ones

Same approach, harder subjects — each one takes something normally invisible and
puts it on screen.

**You do not need to know the subject.** Every one of these opens with a
plain-English briefing: what it is, what is on screen, why anyone cares, and
how it works underneath. Those briefings live in one file,
[`shared/briefings.js`](shared/briefings.js), which is also what the front page
reads — two copies of an explanation drift apart within a month, one copy
cannot.

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

The front page, Ace, Morph, Portrait, Loom and the six serious tools load ES
modules, which browsers refuse to serve from a `file://` address — run
`npx http-server` for those. The
front page says so itself if you open it the wrong way, rather than rendering
a blank section.

**The serious ones split in two:** a pure `engine.js` (the algorithm — no
screen code, testable from a terminal) and an `index.html` (the interface). The
engine has to be *correct*; the interface has to be *understood*. Different jobs.

```
index.html              the front page, with a live preview on every card
shared/briefings.js     the plain-English explanation of each serious tool
play/<name>/index.html  a toy — one file, no imports
play/ace/
  engine.js             the rules: gravity, rocks, collision, scoring — DOM-free
  index.html            canvas, parallax, particles, synthesised sound
play/orbit/
  levels.js             the difficulty curve, on its own and tested
  index.html            the game
play/morph/
  engine.js             seven layout algorithms + a spring integrator, DOM-free
  index.html            the interface
play/portrait/
  engine.js             stippling, triangulation, dithering, palettes — DOM-free
  index.html            the interface
play/loom/
  engine.js             node types and the evaluator, pure and DOM-free
  presets.js            the six examples, and the auto-layout that places them
  index.html            the editor
apps/nightshift/
  story.js              the log, the beats, and the pure functions that time them
  index.html            the document, and the map from effect name to what it does
projects/<name>/
  engine.js             the algorithm, pure and DOM-free
  index.html            the interface
  README.md             the design problem, and the limits
tests/run.mjs           438 tests, no framework, no install
```

```bash
npx http-server        # the serious ones use ES modules, so they need a server
node tests/run.mjs     # run the tests
```

## How I work

**I build fast and I'm hard to satisfy.** With modern tooling a working version exists in
minutes, so the job stops being typing and becomes judgement: what's worth building, what's
wrong with it, and what it should say. That's where the time goes.

**Looking at it beats testing it.** Every screen here was rendered and inspected after each
change, which is how these got caught:

- the hourglass leaked sand out of its sides — it had been drawn as an X rather than a funnel
- the forest fire burned one tree and went out, because the match was lit on an isolated
  tree at the edge of the map
- the island generator produced a perfectly smooth green ellipse, because the noise
  frequency was so low the entire map sat inside a single noise cell
- the six "serious" links rendered in shouty uppercase, because a heading and a list both
  claimed the same HTML `id`
- Loom's knob labelled "Contrast" was applying a gamma curve, so turning it up brightened
  the image (mean 0.501 → 0.587) instead of spreading it — doing exactly the opposite of
  what its own label promised
- Portrait drew all six thousand of its dots at under one pixel across, because the radius
  was divided by the canvas scale that had already been applied. The data was right the
  whole time; it just could not be seen
- Morph's expanded tile rendered *behind* its own backdrop, because the container carries
  `perspective` for the 3D layouts — and `perspective` creates a stacking context, so no
  `z-index` on a child can ever lift it above an element outside that context

Every one of those was *technically working code*, and no test would have flagged a single
one of them.

**But tests catch what looking can't.** The suite here asserts properties rather than
pixels — the NFA agrees with the platform's own `RegExp`; both diff algorithms' edit scripts
reconstruct both inputs across 800 randomised pairs; Raft's safety invariants hold at every
tick of a scripted chaos run. Two of those tests failed because *the test* was wrong, and
two failed because the *engine* was wrong — including a query planner that keyed its scans
by table name while keying its estimates by alias, so every filter silently fell back to a
default selectivity and produced plans that looked entirely plausible. Telling those two
cases apart is the job.

**The words are half of it.** "Pour sand. Add water. Then set it on fire" teaches the
sandbox faster than a tutorial would. Deciding what a thing says, and what it refuses to
say, is part of building it.

---

Written with [Claude Code](https://claude.ai/code); the commit history is the full record.
