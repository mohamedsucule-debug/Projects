/* ─────────────────────────────────────────────────────────────────────────
   diff-forge/engine.js — the algorithms behind "git diff" and "git merge":

     myers()    shortest edit script (the diff everyone has ever read)
     patience() unique-line anchoring (the diff that reads like a human wrote it)
     merge3()   three-way merge, including how a conflict is actually decided
     words()    intra-line diff, so a changed line shows what changed

   All pure, all line-oriented, no dependencies.
   ───────────────────────────────────────────────────────────────────────── */

export const lines = (text) => text.replace(/\n$/, '').split('\n');

/* ── Myers, O(ND) ──────────────────────────────────────────────────────────
   Walk diagonals of the edit graph, furthest-reaching first; the first
   diagonal to reach the far corner used the fewest edits. `d` at that point
   is the edit distance, and the saved frontiers let us recover the path.
─────────────────────────────────────────────────────────────────────────── */
export function myers(a, b) {
  const N = a.length, M = b.length, MAX = N + M;
  if (MAX === 0) return { ops: [], d: 0, visited: 0 };
  const v = new Map([[1, 0]]);
  const trace = [];
  let visited = 0;

  for (let d = 0; d <= MAX; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x;
      const left = v.get(k - 1) ?? -1, right = v.get(k + 1) ?? -1;
      if (k === -d || (k !== d && left < right)) x = right;
      else x = left + 1;
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) { x++; y++; visited++; }
      v.set(k, x);
      if (x >= N && y >= M) return { ops: backtrack(trace, a, b, d), d, visited };
    }
  }
  return { ops: [], d: MAX, visited };
}

function backtrack(trace, a, b, d) {
  const ops = [];
  let x = a.length, y = b.length;
  for (let depth = d; depth > 0; depth--) {
    const v = trace[depth];
    const k = x - y;
    const left = v.get(k - 1) ?? -1, right = v.get(k + 1) ?? -1;
    const prevK = (k === -depth || (k !== depth && left < right)) ? k + 1 : k - 1;
    const prevX = v.get(prevK) ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push({ type: 'equal', a: --x, b: --y }); }
    if (depth > 0) {
      if (x === prevX) ops.push({ type: 'insert', a: x, b: --y });
      else ops.push({ type: 'delete', a: --x, b: y });
    }
  }
  while (x > 0 && y > 0) ops.push({ type: 'equal', a: --x, b: --y });
  return ops.reverse();
}

/* ── Patience ──────────────────────────────────────────────────────────────
   Match only the lines that appear exactly once on each side, take the
   longest increasing subsequence of those matches as anchors, and recurse
   between them. Slower than Myers, but it refuses to align the `}` on line 12
   with the `}` on line 340 — which is why its output reads like a person's.
─────────────────────────────────────────────────────────────────────────── */
export function patience(a, b) {
  const ops = [];
  let visited = 0;

  const rec = (lo1, hi1, lo2, hi2) => {
    while (lo1 < hi1 && lo2 < hi2 && a[lo1] === b[lo2]) { ops.push({ type: 'equal', a: lo1++, b: lo2++ }); }
    let e1 = hi1, e2 = hi2;
    const tail = [];
    while (e1 > lo1 && e2 > lo2 && a[e1 - 1] === b[e2 - 1]) { tail.push({ type: 'equal', a: --e1, b: --e2 }); }
    if (lo1 === e1 && lo2 === e2) { ops.push(...tail.reverse()); return; }

    const anchors = uniqueMatches(a, b, lo1, e1, lo2, e2);
    visited += anchors.length;
    const lis = longestIncreasing(anchors);
    if (!lis.length) {
      // no unique anchor in this region — fall back to Myers on the slice
      const sub = myers(a.slice(lo1, e1), b.slice(lo2, e2));
      visited += sub.visited;
      for (const op of sub.ops) ops.push({ ...op, a: op.a + lo1, b: op.b + lo2 });
      ops.push(...tail.reverse());
      return;
    }
    let x = lo1, y = lo2;
    for (const [ai, bi] of lis) {
      rec(x, ai, y, bi);
      ops.push({ type: 'equal', a: ai, b: bi });
      x = ai + 1; y = bi + 1;
    }
    rec(x, e1, y, e2);
    ops.push(...tail.reverse());
  };

  rec(0, a.length, 0, b.length);
  return { ops, d: ops.filter((o) => o.type !== 'equal').length, visited };
}

function uniqueMatches(a, b, lo1, hi1, lo2, hi2) {
  const countA = new Map(), countB = new Map();
  for (let i = lo1; i < hi1; i++) countA.set(a[i], (countA.get(a[i]) || 0) + 1);
  for (let i = lo2; i < hi2; i++) countB.set(b[i], (countB.get(b[i]) || 0) + 1);
  const posB = new Map();
  for (let i = lo2; i < hi2; i++) if (countB.get(b[i]) === 1) posB.set(b[i], i);
  const out = [];
  for (let i = lo1; i < hi1; i++) {
    if (countA.get(a[i]) !== 1) continue;
    const j = posB.get(a[i]);
    if (j !== undefined) out.push([i, j]);
  }
  return out;
}

/** Patience sort: longest increasing subsequence by second coordinate. */
function longestIncreasing(pairs) {
  if (!pairs.length) return [];
  const piles = [], back = [];
  for (let i = 0; i < pairs.length; i++) {
    let lo = 0, hi = piles.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[piles[mid]][1] < pairs[i][1]) lo = mid + 1; else hi = mid;
    }
    back[i] = lo > 0 ? piles[lo - 1] : -1;
    piles[lo] = i;
  }
  const out = [];
  let k = piles[piles.length - 1];
  while (k >= 0) { out.push(pairs[k]); k = back[k]; }
  return out.reverse();
}

/* ── hunks ─────────────────────────────────────────────────────────────── */
/** Group an edit script into hunks with `context` unchanged lines around. */
export function hunks(ops, context = 3) {
  const changed = ops.map((o) => o.type !== 'equal');
  const keep = new Array(ops.length).fill(false);
  for (let i = 0; i < ops.length; i++) {
    if (!changed[i]) continue;
    for (let j = Math.max(0, i - context); j <= Math.min(ops.length - 1, i + context); j++) keep[j] = true;
  }
  const out = [];
  let cur = null;
  for (let i = 0; i < ops.length; i++) {
    if (keep[i]) {
      if (!cur) cur = { ops: [], skipped: 0 };
      cur.ops.push(ops[i]);
    } else {
      if (cur) { out.push(cur); cur = null; }
      const last = out[out.length - 1];
      if (last) last.skipped = (last.skipped || 0) + 1;
      else out.push({ ops: [], skipped: 1, leading: true });
    }
  }
  if (cur) out.push(cur);
  return out;
}

export const stats = (ops) => ({
  added: ops.filter((o) => o.type === 'insert').length,
  removed: ops.filter((o) => o.type === 'delete').length,
  unchanged: ops.filter((o) => o.type === 'equal').length,
});

/* ── intra-line diff ───────────────────────────────────────────────────── */
const tokenize = (s) => s.match(/\s+|[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$]/g) || [];

/** Word-level diff of two lines, as runs ready to render. */
export function words(before, after) {
  const A = tokenize(before), B = tokenize(after);
  const { ops } = myers(A, B);
  const left = [], right = [];
  for (const op of ops) {
    if (op.type === 'equal') { left.push({ t: A[op.a], eq: true }); right.push({ t: B[op.b], eq: true }); }
    else if (op.type === 'delete') left.push({ t: A[op.a], eq: false });
    else right.push({ t: B[op.b], eq: false });
  }
  return { left: coalesce(left), right: coalesce(right) };
}

const coalesce = (runs) => runs.reduce((acc, r) => {
  const last = acc[acc.length - 1];
  if (last && last.eq === r.eq) last.t += r.t; else acc.push({ ...r });
  return acc;
}, []);

/* ── three-way merge ───────────────────────────────────────────────────── */
/** For each base line, the line it maps to on the other side (or -1). */
function alignment(base, other, algo = myers) {
  const map = new Array(base.length).fill(-1);
  for (const op of algo(base, other).ops) if (op.type === 'equal') map[op.a] = op.b;
  return map;
}

const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);

/**
 * diff3. Walk the base with both sides in step. Where all three agree, the
 * region is stable. Where exactly one side moved, that side wins silently —
 * this is the part people forget is a *decision*, not an absence of one.
 * Where both moved differently, it is a conflict and a human has to choose.
 */
export function merge3(base, ours, theirs, algo = myers) {
  const mo = alignment(base, ours, algo);
  const mt = alignment(base, theirs, algo);
  const chunks = [];
  let i = 0, o = 0, t = 0;

  while (i < base.length) {
    if (mo[i] === o && mt[i] === t) {
      const start = i;
      while (i < base.length && mo[i] === o && mt[i] === t) { i++; o++; t++; }
      chunks.push({ type: 'stable', lines: base.slice(start, i) });
      continue;
    }
    let ni = i;
    while (ni < base.length && !(mo[ni] >= 0 && mt[ni] >= 0 && mo[ni] >= o && mt[ni] >= t)) ni++;
    const no = ni < base.length ? mo[ni] : ours.length;
    const nt = ni < base.length ? mt[ni] : theirs.length;
    chunks.push(classify(base.slice(i, ni), ours.slice(o, no), theirs.slice(t, nt)));
    i = ni; o = no; t = nt;
  }
  if (o < ours.length || t < theirs.length) {
    chunks.push(classify(base.slice(i), ours.slice(o), theirs.slice(t)));
  }
  // a zero-length chunk can fall out of the walk at a boundary; it has
  // nothing to show and nothing to decide
  return chunks.filter((c) => c.type === 'conflict' || c.lines.length > 0);
}

function classify(b, o, t) {
  if (same(o, b) && same(t, b)) return { type: 'stable', lines: b };
  if (same(o, b)) return { type: 'theirs', base: b, ours: o, theirs: t, lines: t, why: 'only the incoming branch touched these lines' };
  if (same(t, b)) return { type: 'ours', base: b, ours: o, theirs: t, lines: o, why: 'only your branch touched these lines' };
  if (same(o, t)) return { type: 'agreed', base: b, ours: o, theirs: t, lines: o, why: 'both branches made the same edit — no conflict, though it looks like one' };
  return {
    type: 'conflict', base: b, ours: o, theirs: t,
    why: 'both branches changed the same lines in different ways',
    resolution: null,
  };
}

/** Apply the current choices and produce the merged file. */
export function resolve(chunks) {
  const out = [];
  let unresolved = 0;
  for (const c of chunks) {
    if (c.type !== 'conflict') { out.push(...c.lines); continue; }
    switch (c.resolution) {
      case 'ours': out.push(...c.ours); break;
      case 'theirs': out.push(...c.theirs); break;
      case 'both': out.push(...c.ours, ...c.theirs); break;
      case 'base': out.push(...c.base); break;
      default:
        unresolved++;
        out.push('<<<<<<< ours', ...c.ours, '=======', ...c.theirs, '>>>>>>> theirs');
    }
  }
  return { text: out.join('\n'), unresolved };
}

/* ── scenarios ─────────────────────────────────────────────────────────── */
export const SCENARIOS = [
  {
    name: 'rename vs. retype',
    note: 'Two people improved the same function. Neither is wrong; the merge cannot pick.',
    base: `export function getUser(id) {
  const row = db.query('SELECT * FROM users WHERE id = ?', id);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
  };
}`,
    ours: `export function getUser(userId) {
  const row = db.query('SELECT * FROM users WHERE id = ?', userId);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
  };
}`,
    theirs: `export function getUser(id: string): User | null {
  const row = db.query('SELECT * FROM users WHERE id = ?', id);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
  };
}`,
  },
  {
    name: 'clean merge',
    note: 'Both sides edited, but in different places. Git merges this silently — and that silence is a decision worth seeing.',
    base: `server:
  host: localhost
  port: 8080
  timeout: 30

database:
  url: postgres://localhost/app
  pool: 10`,
    ours: `server:
  host: 0.0.0.0
  port: 8080
  timeout: 30

database:
  url: postgres://localhost/app
  pool: 10`,
    theirs: `server:
  host: localhost
  port: 8080
  timeout: 30

database:
  url: postgres://localhost/app
  pool: 25
  ssl: true`,
  },
  {
    name: 'moved block',
    note: 'A block moved and a line changed. Myers aligns the braces; patience finds the block. Toggle the algorithm and watch the diff get shorter.',
    base: `function setup() {
  init();
}

function teardown() {
  cleanup();
}

function run() {
  work();
}`,
    ours: `function run() {
  work();
  log('done');
}

function setup() {
  init();
}

function teardown() {
  cleanup();
}`,
    theirs: `function setup() {
  init();
  configure();
}

function teardown() {
  cleanup();
}

function run() {
  work();
}`,
  },
];
