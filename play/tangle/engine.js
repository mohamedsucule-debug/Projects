/* ───────────────────────────────────────────────────────────────────────────
   tangle/engine.js — a daily knot, and the proof it can always be undone.

   Every tile is a piece of pipe with connectors on some of its four sides.
   Tap one and it turns a quarter turn clockwise. The board is solved when
   every connector meets another connector and nothing points at a wall or at
   empty space. There is no timer, no score and nothing to lose.

   THE BOARD IS BUILT BACKWARDS, and that is the whole trick. Rather than
   scatter pipes and hope, it grows a spanning tree over the grid — a set of
   edges that reaches every cell exactly once with no closed circuits — and
   reads the tiles off it. The tree IS a solved board, so the puzzle is
   solvable before it is scrambled. Generating first and checking afterwards
   is the version that ships an impossible board on day 46.

   EVERYBODY GETS THE SAME BOARD. The seed is the day, so the puzzle is the
   same for everyone on the planet, and a result is worth comparing.

   No DOM here. The rules are a state machine a test can drive.
   ─────────────────────────────────────────────────────────────────────────── */

/** mulberry32 — the day's board has to be identical on every machine. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* A tile is four bits: which sides it has a connector on. */
export const N = 1, E = 2, S = 4, W = 8;

export const DIRS = [
  { bit: N, dx: 0, dy: -1, opp: S },
  { bit: E, dx: 1, dy: 0, opp: W },
  { bit: S, dx: 0, dy: 1, opp: N },
  { bit: W, dx: -1, dy: 0, opp: E },
];

/** A quarter turn clockwise, k times. N→E→S→W is one bit left, wrapping. */
export function rotate(mask, k = 1) {
  const n = ((k % 4) + 4) % 4;
  let m = mask & 15;
  for (let i = 0; i < n; i++) m = ((m << 1) | (m >> 3)) & 15;
  return m;
}

/** How many distinct orientations a tile has: 4, 2 for a straight, 1 for a cross. */
export function period(mask) {
  for (let k = 1; k <= 4; k++) if (rotate(mask, k) === (mask & 15)) return k;
  return 4;
}

/** Turns clockwise to get `from` to `to`, or -1 if it cannot be done. */
export function turnsTo(from, to) {
  for (let k = 0; k < 4; k++) if (rotate(from, k) === (to & 15)) return k;
  return -1;
}

/* ── the day ─────────────────────────────────────────────────────────────── */

/** Days since the first puzzle, in UTC so the world turns over together. */
export const EPOCH = Date.UTC(2026, 0, 1);
export function dayNumber(date = new Date()) {
  const d = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.max(1, Math.floor((d - EPOCH) / 86400000) + 1);
}

/* ── building a board that is solvable by construction ───────────────────── */

/**
 * Grow a spanning tree over a cols×rows grid with randomised Prim, and return
 * the tile masks it implies.
 *
 * Prim rather than a depth-first walk on purpose. A depth-first walk produces
 * long winding corridors and almost nothing but elbows and straights; growing
 * from a frontier branches, so the board has stubs, tees and the occasional
 * cross in it, and the tiles are worth looking at.
 */
export function spanningTree(cols, rows, rand) {
  const n = cols * rows;
  const mask = new Uint8Array(n);
  const inTree = new Uint8Array(n);
  const at = (x, y) => y * cols + x;

  const start = Math.floor(rand() * n) % n;
  inTree[start] = 1;

  /* The frontier is every edge from a cell in the tree to one outside it. */
  const frontier = [];
  const pushEdges = (i) => {
    const x = i % cols, y = (i / cols) | 0;
    for (const d of DIRS) {
      const nx = x + d.dx, ny = y + d.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const j = at(nx, ny);
      if (!inTree[j]) frontier.push({ from: i, to: j, bit: d.bit, opp: d.opp });
    }
  };
  pushEdges(start);

  while (frontier.length) {
    const pick = Math.floor(rand() * frontier.length) % frontier.length;
    const e = frontier[pick];
    frontier[pick] = frontier[frontier.length - 1];
    frontier.pop();
    if (inTree[e.to]) continue;          // something else claimed it first
    inTree[e.to] = 1;
    mask[e.from] |= e.bit;
    mask[e.to] |= e.opp;
    pushEdges(e.to);
  }

  return mask;
}

export class Puzzle {
  constructor({ cols = 6, rows = 6, seed = 1 } = {}) {
    this.cols = cols;
    this.rows = rows;
    this.reset(seed);
  }

  reset(seed = (Math.random() * 1e9) | 0) {
    this.seed = seed >>> 0;
    const rand = rng(this.seed);
    this.solution = spanningTree(this.cols, this.rows, rand);
    this.tiles = new Uint8Array(this.solution);
    this.moves = 0;
    this.par = 0;

    /* Scramble, and count the turns it took. A tile with rotational symmetry
       cannot always be moved, so the count is of turns that did something. */
    for (let i = 0; i < this.tiles.length; i++) {
      const k = Math.floor(rand() * 4) % 4;
      this.tiles[i] = rotate(this.tiles[i], k);
      this.par += turnsTo(this.tiles[i], this.solution[i]);
    }

    /* A board that is already solved is not a puzzle. Turn the least
       symmetric tile until it is not, rather than rerolling the whole thing —
       a reroll changes the day's board, and the day's board is the point. */
    if (this.solved) {
      let worst = 0;
      for (let i = 1; i < this.tiles.length; i++) {
        if (period(this.tiles[i]) > period(this.tiles[worst])) worst = i;
      }
      if (period(this.tiles[worst]) > 1) {
        this.tiles[worst] = rotate(this.tiles[worst], 1);
        this.par += turnsTo(this.tiles[worst], this.solution[worst]);
      }
    }

    return this;
  }

  at(x, y) { return this.tiles[y * this.cols + x]; }

  /** Turn one tile a quarter turn clockwise. Returns whether it changed. */
  turn(i) {
    /* Number.isInteger, not just a range check: NaN fails every comparison,
       so `i < 0 || i >= length` waves it through, and the move counter then
       charges somebody a turn for a tile that does not exist. */
    if (!Number.isInteger(i) || i < 0 || i >= this.tiles.length || this.solved) return false;
    const was = this.tiles[i];
    this.tiles[i] = rotate(was, 1);
    this.moves++;
    return this.tiles[i] !== was;
  }

  /**
   * Solved when every connector meets another one.
   *
   * Deliberately NOT "the board matches the tree it was grown from". Other
   * arrangements can also leave nothing dangling, and a player who finds one
   * has solved the puzzle in front of them — telling them otherwise would be
   * the game marking its own homework.
   */
  get solved() {
    const { cols, rows, tiles } = this;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const m = tiles[y * cols + x];
        for (const d of DIRS) {
          if (!(m & d.bit)) continue;
          const nx = x + d.dx, ny = y + d.dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return false;
          if (!(tiles[ny * cols + nx] & d.opp)) return false;
        }
      }
    }
    return true;
  }

  /** How many connectors are still dangling — what the interface counts down. */
  get loose() {
    const { cols, rows, tiles } = this;
    let n = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const m = tiles[y * cols + x];
        for (const d of DIRS) {
          if (!(m & d.bit)) continue;
          const nx = x + d.dx, ny = y + d.dy;
          const out = nx < 0 || ny < 0 || nx >= cols || ny >= rows;
          if (out || !(tiles[ny * cols + nx] & d.opp)) n++;
        }
      }
    }
    return n;
  }

}

/* ── the line you paste into a group chat ────────────────────────────────── */

const clock = (s) => {
  const t = Math.max(0, Math.round(s));
  return `${(t / 60) | 0}:${String(t % 60).padStart(2, '0')}`;
};

/**
 * Spoiler-free on purpose. A grid of coloured squares — the format everybody
 * copies — would be a picture of the finished board, and the whole point of a
 * daily puzzle is that the person you send it to has not done it yet.
 */
export function share({ day, moves, par, seconds, url = '' }) {
  const ratio = par > 0 ? moves / par : 1;
  const filled = Math.max(1, Math.min(10, Math.round(10 / Math.max(1, ratio))));
  const bar = '▰'.repeat(filled) + '▱'.repeat(10 - filled);
  const lines = [
    `Tangle #${day} — ${moves} turns (par ${par}) in ${clock(seconds)}`,
    bar,
  ];
  if (url) lines.push(url);
  return lines.join('\n');
}

/* ── remembering ─────────────────────────────────────────────────────────────
   localStorage throws outright in a private window with site data blocked, so
   every access is wrapped. A streak is never worth taking the puzzle down
   for. */

export const store = {
  read() {
    try { return JSON.parse(localStorage.getItem('tangle.v1') || '{}') || {}; }
    catch { return {}; }
  },
  write(data) {
    try { localStorage.setItem('tangle.v1', JSON.stringify(data)); } catch { /* nothing to do */ }
  },
  /** Record a finished day and return the streak it leaves behind. */
  finish(day, result) {
    const data = this.read();
    data.days = data.days || {};
    if (!data.days[day]) data.days[day] = result;
    this.write(data);
    return this.streak(day);
  },
  done(day) { return this.read().days?.[day] || null; },
  /** Consecutive days finished, counting back from `day`. */
  streak(day) {
    const days = this.read().days || {};
    let n = 0;
    for (let d = day; d >= 1 && days[d]; d--) n++;
    return n;
  },
};
