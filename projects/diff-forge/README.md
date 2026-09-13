# Diff Forge

Myers diff, patience diff, and a three-way merge — implemented from scratch,
with an interface built around the moment those algorithms hand the decision
back to you.

**Run it:** open `index.html` from the [index](../../index.html), or serve the
repo root and visit `/projects/diff-forge/`.

### The design problem

Merge conflicts are the most-hated interface in software, and the reason is a
design failure rather than a technical one: at the moment you most need
context, the tool gives you the least. Seven lines of `<<<<<<<` markers, no
indication of what the base said, no indication of *why* this region conflicted
when the region above it merged silently, and no way to see the two intents
side by side.

This rebuilds that moment:

- **Auto-merged regions are shown, not hidden.** Every region git would resolve
  silently gets a labelled band: *taken from your branch — only your branch
  touched these lines*. Silent success is still a decision, and reviewing it is
  how you catch a merge that was clean and wrong.
- **Conflicts are a choice, not a text format.** Both intents sit side by side
  with the differing tokens highlighted, the base is quoted underneath, and the
  four real options — ours, theirs, both, revert — are buttons. The merged file
  updates as you decide, and the status bar tracks how many are still open.
- **Unchanged context collapses.** A merge view that makes you scroll through
  forty identical lines is hiding the two that matter.

### Myers vs. patience

The right-hand panel runs both algorithms on every keystroke and reports edit
distance and hunk count for each. Pick either; the merge uses it too.

They produce different *readings* of the same change. Myers finds a shortest
edit script, which is why it happily pairs the `}` on line 12 with the `}` on
line 340 and produces a shredded diff. Patience matches only lines that appear
exactly once on each side, takes the longest increasing subsequence of those as
anchors, and recurses between them — so it tends to produce fewer, fatter
hunks that line up with what a person actually did. The **moved block**
scenario is there to show the gap: same file, same change, very different diff.

### Implementation notes

- `myers()` is the O(ND) greedy algorithm: walk diagonals of the edit graph,
  furthest-reaching first, saving each frontier so the path can be recovered.
  `d` at termination is the edit distance.
- `patience()` recurses on anchors, falling back to Myers on regions with no
  unique line — which is what git's own patience implementation does.
- `merge3()` is diff3: align base→ours and base→theirs, walk to the next point
  where both sides are in sync, and classify the region between. One side
  changed → that side wins. Both changed identically → agreed. Both changed
  differently → conflict, and a human decides.
- `words()` runs the same Myers on a token stream to highlight what changed
  *inside* a line.

The tests assert the property that matters for a diff: applying the edit script
to one side must reconstruct the other, exactly, for both algorithms.

### Known limits

Line-oriented, so a whitespace-only reformat looks like a rewrite. No rename
detection, no binary files, and the merge is diff3 rather than git's default
`ort` strategy — it will not, for example, follow a block that moved *and*
changed.
