# Raft Lab

A five-node Raft cluster — real leader election, real log replication — running
on a deterministic virtual clock, with a network you are invited to break.

**Run it:** open `index.html` from the [index](../../index.html), or serve the
repo root and visit `/projects/raft-lab/`.

### The design problem

Consensus is the canonical example of a system that is impossible to reason
about from its logs. Everything interesting is *distributed in time*: a leader
that still believes it is the leader, a write that is accepted but not
committed, two servers both correct and both disagreeing. Prose explains this
badly and a static diagram explains it worse, because the whole subject is
what happens between the diagrams.

So the cluster runs in front of you, and the three views answer three different
questions:

- **The cluster** — who is talking to whom, right now. Messages are dots in
  flight; a dropped one dies visibly at the partition line instead of silently
  never arriving. Each follower carries a countdown ring: that ring is the
  election timeout, so you can see an election coming before it happens.
- **The replicated log** — one row per server, one column per index, coloured by
  the term that created the entry. Dashed cells are replicated but not yet
  committed. This is the only view that makes "the same index means different
  things on different servers" visible at a glance.
- **The invariants** — the four safety properties from the Raft paper, re-checked
  against live state every frame. They are the claim the whole protocol exists
  to make, so they are on screen permanently rather than asserted in a footnote.
  Break the cluster however you like; they should never go red.

### The story worth clicking

`split brain` isolates the current leader with one follower, then hands *that
leader* a client write. Watch what follows:

1. The isolated leader accepts the write. It has no idea it is isolated.
2. It replicates to its one reachable peer — two of five, short of a quorum —
   so the entry stays dashed. It never commits. A client that got an
   acknowledgement here would be lied to; this is why acknowledgement waits for
   commit.
3. The majority side elects a new leader in a higher term and carries on.
   Two leaders now exist. Election Safety stays green, because they are leaders
   of *different terms* — which is exactly the guarantee, and exactly the thing
   people misremember as "Raft prevents two leaders".
4. `heal + write` reconnects everyone. The old leader learns about the higher
   term and steps down within one message.

Depending on whose log is longer, that orphaned entry either gets overwritten
(watch for `discarded 1 uncommitted entry`) or gets adopted and finally
committed by a later leader. Both outcomes are correct, and seeing the coin
land both ways across runs teaches more than either outcome alone.

### Implementation notes

`engine.js` implements the protocol from the paper's Figure 2: persistent state
(`currentTerm`, `votedFor`, `log`), volatile leader state (`nextIndex`,
`matchIndex`), the up-to-date check in `RequestVote`, the consistency check and
truncation in `AppendEntries`, and — easy to miss, load-bearing — the rule that
a leader may only advance its commit index onto an entry **from its own term**.

Time is virtual and the RNG is seeded, so a run is reproducible: the same seed
and the same interventions produce the same history. That is what makes the
invariant checker meaningful rather than decorative, and it is why the engine
can be driven headlessly in [the tests](../../tests).

The election timeout is stretched to 1.5–3s (Raft would use 150–300ms) purely so
a human can watch. Everything else is at protocol scale.

### Known limits

No log compaction or snapshots, no membership changes, no persistence across a
`restart` beyond the log itself (which is the right model: volatile state is
meant to be lost), and client requests are fire-and-forget rather than retried
with a session id.
