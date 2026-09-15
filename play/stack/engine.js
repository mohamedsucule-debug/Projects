/* ───────────────────────────────────────────────────────────────────────────
   stack/engine.js — the rules of a tower that gets harder to build.

   A block slides back and forth above the tower. You tap. It drops. Whatever
   hangs over the edge of the block below is sliced off and falls away, so the
   tower gets narrower every time you are sloppy and stays exactly as wide as
   it is when you are not.

   That single rule is the whole game, and it is why the game is honest: you
   never lose to something you could not see coming. The width of the top block
   IS your remaining margin for error, drawn at all times, in the middle of the
   screen.

   No DOM here. The engine is a state machine you can drive from a test, which
   is how the difficulty curve and the slicing arithmetic get checked without
   anybody having to play it a thousand times.
   ─────────────────────────────────────────────────────────────────────────── */

/** mulberry32 — the tower has to be reproducible for a test to assert on it. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const RULES = {
  blockH: 32,          // how tall one layer is, in world units
  startW: 250,         // the first block
  deadW: 8,            // narrower than this and there is nothing left to land on

  speedStart: 210,     // world units per second, sliding sideways
  speedMax: 620,
  speedRamp: 38,       // blocks placed before the slide is at full speed

  /* A drop within this many units of perfect is treated as perfect: no slice,
     and a little width handed back. Without it the tower only ever shrinks and
     every run ends the same way — a game you can only lose slowly is a chore.
     With it, a good player can hold a width forever, and that is the skill. */
  perfectTol: 5,
  perfectRegain: 5,
};

export const STATE = { READY: 'ready', PLAYING: 'playing', DEAD: 'dead' };

export class Tower {
  constructor({ width = 420, height = 640, seed = 1, rules = RULES } = {}) {
    this.rules = rules;
    this.width = width;
    this.height = height;
    this.reset(seed);
  }

  reset(seed = (Math.random() * 1e9) | 0) {
    const R = this.rules;
    this.seed = seed >>> 0;
    this.rand = rng(this.seed);
    this.state = STATE.READY;
    this.score = 0;          // blocks landed
    this.perfects = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.slices = [];        // the offcuts, for the interface to animate
    // the foundation is centred and is never sliced
    this.blocks = [{ x: (this.width - R.startW) / 2, w: R.startW, row: 0, perfect: true }];
    this.spawn();
    return this;
  }

  get top() { return this.blocks[this.blocks.length - 1]; }

  /** How fast the block slides, ramping with how far you have got. */
  get speed() {
    const R = this.rules;
    const t = clamp(this.score / R.speedRamp, 0, 1);
    return R.speedStart + (R.speedMax - R.speedStart) * t;
  }

  /** Put a new block at one edge, heading towards the other. */
  spawn() {
    const w = this.top.w;
    // alternating sides would be predictable; a coin flip keeps you reading it
    const fromLeft = this.rand() < 0.5;
    /* It travels edge to edge and stays entirely on screen. Letting it slide
       half off, as the arcade original does, reads as a rendering bug rather
       than as a design — and it hides the thing you are trying to aim.

       It also produces a property worth having for free: a narrow block has
       further to travel, so the game tightens as you get better without any
       extra rule. */
    this.current = {
      x: fromLeft ? 0 : this.width - w,
      w,
      dir: fromLeft ? 1 : -1,
      row: this.blocks.length,
    };
  }

  /**
   * Slide the block. It turns around at the edges rather than wrapping, so it
   * is always somewhere you could plausibly drop it.
   */
  step(dt) {
    if (this.state === STATE.DEAD) return this;
    const d = Math.min(0.1, Math.max(0, dt));   // a long frame must not teleport it
    const c = this.current;
    if (!c) return this;
    c.x += this.speed * c.dir * d;
    const lo = 0, hi = Math.max(0, this.width - c.w);
    if (c.x < lo) { c.x = lo; c.dir = 1; }
    if (c.x > hi) { c.x = hi; c.dir = -1; }
    return this;
  }

  /**
   * Drop it.
   *
   * Returns what happened, so the interface can decide what to celebrate:
   *   { landed, perfect, slice, width, dead }
   * `slice` is the offcut rectangle, or null if there wasn't one.
   */
  drop() {
    if (this.state === STATE.DEAD) return { landed: false, dead: true };
    if (this.state === STATE.READY) this.state = STATE.PLAYING;

    const R = this.rules;
    const prev = this.top;
    const cur = this.current;

    const offset = cur.x - prev.x;
    const perfect = Math.abs(offset) <= R.perfectTol;

    if (perfect) {
      /* Snapped flush. The width is handed back a little, capped at the
         starting width so a long perfect streak cannot grow a runway. */
      const w = Math.min(R.startW, prev.w + R.perfectRegain);
      const x = prev.x - (w - prev.w) / 2;
      this.blocks.push({ x, w, row: cur.row, perfect: true });
      this.perfects++;
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.score++;
      this.spawn();
      return { landed: true, perfect: true, slice: null, width: w, dead: false };
    }

    const left = Math.max(cur.x, prev.x);
    const right = Math.min(cur.x + cur.w, prev.x + prev.w);
    const w = right - left;

    if (w < R.deadW) {
      // nothing left to stand on
      this.state = STATE.DEAD;
      this.combo = 0;
      return { landed: false, perfect: false, slice: { x: cur.x, w: cur.w, row: cur.row }, width: 0, dead: true };
    }

    // the offcut is whichever end hung over, and there is only ever one
    const slice = offset > 0
      ? { x: right, w: cur.x + cur.w - right, row: cur.row }
      : { x: cur.x, w: left - cur.x, row: cur.row };

    this.blocks.push({ x: left, w, row: cur.row, perfect: false });
    this.slices.push(slice);
    this.combo = 0;
    this.score++;
    this.spawn();
    return { landed: true, perfect: false, slice, width: w, dead: false };
  }

  /** How much room for error is left, 0..1. The interface draws this. */
  get margin() {
    return clamp(this.top.w / this.rules.startW, 0, 1);
  }
}

/* ── remembering ─────────────────────────────────────────────────────────────
   localStorage throws outright in a private window with site data blocked, so
   every access is wrapped. A high score is never worth taking the game down
   for. */

export const store = {
  get(key, fallback = 0) {
    try { return Number(localStorage.getItem(key)) || fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, String(value)); } catch { /* nothing to do */ }
  },
  best() { return { score: this.get('stack.best', 0), combo: this.get('stack.combo', 0) }; },
  record(score, combo) {
    const b = this.best();
    if (score > b.score) this.set('stack.best', score);
    if (combo > b.combo) this.set('stack.combo', combo);
    return { score: score > b.score, combo: combo > b.combo };
  },
};
