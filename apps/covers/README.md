# Covers

A working restaurant floor and booking system.

**→ [Open it](https://mohamedsucule-debug.github.io/Projects/apps/covers/)**

You arrive at **19:42 on a Saturday**. Thirty-one bookings are in the book,
eleven parties are eating, four are due in the next twenty minutes, one is
twenty-five minutes late and not answering their phone, three groups are waiting
at the bar, and there is a double-booking on table 2 that somebody needs to sort
out before half past eight.

Drag a party onto a table and it tells you whether they fit — and when they
don't, why not, and what to do instead.

---

## The one decision that matters

Every table-management demo ever built opens on an empty grid with an **Add your
first booking** button. All of them are boring, and not because the design is
bad: an empty restaurant is not a restaurant, and nobody can tell whether an
empty system is any good.

So this one opens in the middle of service with the job already half done and
going wrong in the ordinary ways. Everything else here follows from that.

The night is hand-written rather than generated, because generated data has no
texture. It produces *"Customer 14, party of 3"* and it never produces:

> Food writer. Do not comp anything, do not fuss.

> Wheelchair — needs the wide approach, not past the pass.

> Twenty-five minutes late. Two calls, no answer.

## The refusal is the product

A table-management system that looks beautiful and lets you double-book table 12
is worth nothing. So the rules live in a module with no DOM in it, every
question goes through them, and the interface never has an opinion of its own
about the room.

The interesting part is what happens when the answer is no. "Cannot seat" is a
dead end. This says:

```
Table 1 seats 2. This is a party of 6.
→ 30 is free at 20:30
```

```
Whitcombe has table 13 until 22:15.
→ Nothing at 20:00 — 21:00 on table 11 (+60 min)
```

Every refusal is a whole sentence a head waiter could say out loud, and it
carries the way forward: another table at the same time if there is one, and a
different time if there is not — which is what a host actually does when the
room is full. There's a test that walks every refusal the case can produce and
fails if any of them is a bare code, or offers something that doesn't work.

**A lateral move applies on release. A move that changes the time does not.**
The system may re-seat you; it may not re-time you without asking, because that
is a decision made with the guest on the phone.

## Turn times, and the fifteen minutes everybody forgets

A booking does not occupy a table for the length of the meal. It occupies it for
the meal **plus the time it takes to clear, wipe and re-lay** — and systems that
skip the turnaround produce books that are perfect on screen and impossible in
the room.

| Party | Turn | Holds the table |
|---|---|---|
| 1–2 | 90 min | 105 |
| 3–4 | 105 min | 120 |
| 5–6 | 120 min | 135 |
| 7–8 | 135 min | 150 |
| 9+  | 150 min | 165 |

Rising with party size, because six people order differently from two and
nobody leaves until the last one has finished. Getting these wrong in the
optimistic direction is what produces a queue at the door at half past eight.

## Two fours is a nine

Tables push together, and the room decides which ones. Adjacency is a property
of the floor plan, not a capacity number in a list: **10 + 11 + 12** is a run
down the middle of The Room and it works; **10 + 12** is not a join, because
table 11 is between them and nobody is carrying a table over another table. The
search walks the adjacency graph rather than taking combinations of a list, so
the impossible arrangement is never even considered.

Pushing two fours together seats **nine**, not eight — you gain the two ends
that were previously nobody's seat. Every host knows this. Most software
doesn't.

The drawing has to agree. A test asserts that every joined run is drawn with
exactly as many chairs as the scheduler will sell, because at one point it
wasn't: eight chairs round a table the system would happily seat nine people at.
Somebody counting chairs on the screen would have been right and the software
would have been wrong.

## The conflict it ships with

There is exactly one double-booking in the night, and it was not planted.

The book was hand-written to look fine. Then `conflicts()` found that Sørensen
sat a party of two on table 2 at 19:00 — ninety minutes plus fifteen to re-lay,
so the table is not free until 20:45 — and Traoré is booked onto it at 20:30.

It stayed in, because a system that only ever shows you a clean night has not
shown you anything. The header says **⚠ 1 conflict**, clicking it explains the
arithmetic in plain English, and the fix is one click. And at 20:30 the room is
genuinely full, so the fix is a different *time*, not a different table — which
is a more honest answer than shuffling tables and a better demonstration of what
the system is for.

## Time runs

Press play and the rest of the night happens in about half a minute. Parties
turn up — a few early, most within ten minutes, one never. They sit when their
table is clear **and not before**, work through their courses, ask for the bill
and leave. Tables come free. Anybody who hasn't arrived twenty minutes after
their slot becomes a no-show and gives their table back, because holding it any
longer costs a cover you could have sold.

All of it is a pure function of the clock, so the whole evening can be played
through in a test in a few milliseconds.

## Bugs worth writing down

**Press play, and the restaurant reset sixty times a second.** The clock stored
whole minutes. At eight service-minutes per real second each frame advanced 0.13
of a minute, rounded back to the minute it started on, failed the *is this
later?* test, and took the rewind path — which rebuilds the night from scratch.
The clock never moved and nothing on screen suggested why.

**A booking with no status clashed with nothing.** `clashes()` checked both
bookings were in a live state; a party being dragged around before it's
committed has no status yet, so `LIVE.has(undefined)` was false and the answer
was always "no conflict". You could have dropped a new party straight onto an
occupied table and the system would have smiled and accepted it.

**The system offered a time it would then refuse.** `nextAvailable()` checked
only that the *start* was before last orders, so it offered a party of six
21:45 — a two-hour sitting ending a quarter of an hour after the doors are
locked — and `canSeat()` refused the slot the system had just recommended. A
rule written in two places is a rule enforced in one. There is one
`fitsInService()` now and everything goes through it.

**It offered to move a booking into the past.** Walking outward from the wanted
time finds earlier slots as well as later ones, which is right when somebody
rings up about tomorrow and absurd at twenty to eight on a Saturday.

**A refusal suggested the table the party was already on.** Taking it applied a
move to nowhere, and the system then announced having moved them — which is
worse than saying nothing, because it is a system reporting work it did not do.

**The first version of the run-the-service control emptied the restaurant.**
Nothing ever made a booked party *arrive*, so every remaining booking aged into
a no-show. The one control whose job is to show the room filling up did the
exact opposite.

## Everything else

**The bar is never bookable.** It's stools, for walk-ins and people waiting.
There's a test.

**Walk-ins get an honest answer.** "About twenty-five minutes, table 11" —
rounded up to five, because *about twenty-five minutes* is an answer and *23
minutes* is a promise.

**Taking a booking offers the times the room can actually do**, worked out by
the same search that validates every drag. A free-text time box invites the
host to promise something the kitchen cannot deliver.

**A phone is the host stand, not a shrunk-down desktop.** It opens on the list
of who's due, because that's what you need standing by a door; the floor plan is
one tap away.

**⌘K** searches every party, table and action. **Space** runs the clock.
**1 2 3** switch views. **← →** move fifteen minutes.

## Tests

```
node tests/run.mjs covers
```

53 of them, over the room, the turn times, the joins, the refusals, the night
itself and the drawing. The ones worth reading:

```
✓ a table is held for the meal and the turnaround, not just the meal
✓ every joined arrangement is one connected run
✓ a joined run is drawn with the seats the model says it has
✓ the night ships with exactly one conflict, on purpose
✓ every refusal explains itself in a sentence
✓ every suggestion a refusal makes is one you could actually take
✓ a time is never offered that the validator would then refuse
✓ nothing is ever offered in the past
✓ a refusal never suggests the table the party is already on
```

## Files

```
floor.js     the room — tables, where they are, what can join what
schedule.js  the rules — turn times, clashes, and why something is a no
book.js      a Saturday night, already half underway
service.js   what the room does while the clock runs
plan.js      geometry — metres to pixels, and where the chairs go
index.html   the only file that has ever heard of a pixel
```

No dependencies, no build step, no backend. About 2,300 lines.
