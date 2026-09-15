/* ───────────────────────────────────────────────────────────────────────────
   ace/engine.js — the rules of the game, and nothing else.

   No canvas, no DOM, no sound, no input handling. This file knows that there
   is a paper plane, that gravity pulls it down, that a tap pushes it up, and
   that hitting a rock ends the run. Everything visible lives in index.html.

   Two things are worth knowing about how it is built.

   FIXED TIMESTEP. The world advances in slices of exactly 1/120th of a second,
   however long the browser actually took between frames. Advancing physics by
   whatever dt happened to arrive makes the game literally easier on a fast
   machine — a 144Hz monitor integrates gravity in smaller pieces and the plane
   falls a little less far. Worse, it makes the whole thing untestable, because
   the same taps at the same moments produce different runs.

   DETERMINISTIC. Same seed, same taps at the same times, same result — exactly
   the same, every time, forever. That is what lets a test play a whole game
   from a script and assert on the final score, and it is why the rock layout
   comes from a seeded generator rather than Math.random.
   ─────────────────────────────────────────────────────────────────────────── */

/** mulberry32 — small, fast, and good enough for where to put a rock. */
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

/* ── the numbers ─────────────────────────────────────────────────────────────
   All of it in one place, in world units per second, so the feel of the game
   can be tuned without reading any code. These were arrived at by playing it,
   not by reasoning about it — which is the only way this kind of thing is ever
   arrived at. */

export const RULES = {
  gravity: 1750,          // world units per second squared
  flap: -470,             // instant upward velocity on a tap
  maxFall: 780,           // terminal velocity, so a long drop stays survivable
  planeX: 0.3,            // how far across the screen the plane sits, 0..1
  planeR: 15,             // collision radius

  speedStart: 205,        // world units per second, scrolling left
  speedMax: 340,
  speedRamp: 70,          // seconds to reach top speed

  spacing: 285,           // distance between one rock pair and the next
  gapStart: 235,          // vertical opening, at the start
  gapMin: 152,            // ...and once it has tightened as far as it goes
  gapRamp: 26,            // rock pairs passed before the gap stops shrinking

  rockW: 70,              // how thick a rock column is
  margin: 74,             // keep openings this far from the ceiling and floor
  starChance: 0.62,       // how often a gap carries a star
  starR: 15,
};

export const STATE = { READY: 'ready', FLYING: 'flying', DEAD: 'dead' };

export class Game {
  constructor({ width = 620, height = 620, seed = 1, rules = RULES } = {}) {
    this.rules = rules;
    this.resize(width, height);
    this.reset(seed);
  }

  resize(width, height) {
    this.width = Math.max(320, width);
    this.height = Math.max(320, height);
    // the plane keeps its place on screen when the window changes shape
    if (this.plane) this.plane.x = this.width * this.rules.planeX;
  }

  reset(seed = (Math.random() * 1e9) | 0) {
    const R = this.rules;
    this.seed = seed >>> 0;
    this.rand = rng(this.seed);
    this.state = STATE.READY;
    this.time = 0;
    this.score = 0;
    this.passed = 0;          // rock pairs cleared — drives the difficulty ramp
    this.stars = 0;
    this.distance = 0;
    this.plane = {
      x: this.width * R.planeX,
      y: this.height * 0.42,
      vy: 0,
      // the nose follows the flight path rather than being set directly, so it
      // swings round after a tap instead of snapping
      rot: 0,
    };
    this.rocks = [];
    this.acc = 0;
    this.deadFor = 0;
    // enough rocks to fill the screen and a little beyond it. The first one
    // sits just off the right edge: any further and the run opens with several
    // seconds of nothing happening.
    let x = this.width + 60;
    while (x < this.width + 60 + R.spacing * 6) {
      this.rocks.push(this.#makeRock(x));
      x += R.spacing;
    }
    return this;
  }

  #makeRock(x) {
    const R = this.rules;
    const gap = this.gapFor(this.rocks.length + this.passed);
    const lo = R.margin + gap / 2;
    const hi = this.height - R.margin - gap / 2;
    const y = lo + this.rand() * Math.max(0, hi - lo);
    return {
      x,
      gapY: y,
      gap,
      scored: false,
      star: this.rand() < R.starChance,
      starTaken: false,
    };
  }

  /** The opening narrows as you go, then stops. It must never reach zero. */
  gapFor(passed) {
    const R = this.rules;
    const t = clamp(passed / R.gapRamp, 0, 1);
    return R.gapStart + (R.gapMin - R.gapStart) * t;
  }

  /** Scroll speed, ramping with elapsed flight time. */
  get speed() {
    const R = this.rules;
    const t = clamp(this.time / R.speedRamp, 0, 1);
    return R.speedStart + (R.speedMax - R.speedStart) * t;
  }

  /** A tap. Starts the run from the ready state; ignored once dead. */
  flap() {
    if (this.state === STATE.DEAD) return false;
    if (this.state === STATE.READY) this.state = STATE.FLYING;
    this.plane.vy = this.rules.flap;
    return true;
  }

  /**
   * Advance by `dt` seconds, in fixed slices.
   *
   * The leftover is carried, so no time is lost or double-counted across
   * frames. A very long dt — a backgrounded tab — is discarded rather than
   * simulated, because nobody wants to return to a tab and find they died
   * four minutes ago.
   */
  step(dt) {
    const H = 1 / 120;
    if (dt > 0.5) dt = H;
    this.acc += Math.max(0, dt);
    let guard = 0;
    /* The epsilon: adding 1/144 to itself forty-eight times lands a hair under
       40 slices rather than on it, so without it a slice fires a frame late at
       some frame rates and not at others. A rounding error is not a rule. */
    while (this.acc >= H - 1e-9 && guard++ < 240) {
      this.acc -= H;
      this.#tick(H);
    }
    return this;
  }

  #tick(h) {
    const R = this.rules;
    const p = this.plane;

    if (this.state === STATE.READY) {
      // a gentle hover, so the screen is alive before the first tap
      this.time += h;
      p.y = this.height * 0.42 + Math.sin(this.time * 2.6) * 11;
      p.rot = Math.sin(this.time * 2.6 + Math.PI / 2) * 0.12;
      return;
    }

    if (this.state === STATE.DEAD) {
      this.deadFor += h;
      // it keeps falling after the crash, and stops at the floor
      p.vy = Math.min(R.maxFall, p.vy + R.gravity * h);
      p.y = Math.min(this.height + 40, p.y + p.vy * h);
      p.rot = Math.min(1.5, p.rot + 3.4 * h);
      return;
    }

    this.time += h;
    p.vy = clamp(p.vy + R.gravity * h, -R.maxFall, R.maxFall);
    p.y += p.vy * h;

    /* The nose eases towards the direction of travel instead of being set from
       velocity directly. Setting it directly reads as a twitch on every tap;
       chasing it looks like a paper plane swinging round. */
    const want = clamp(p.vy / 620, -0.62, 1.25);
    p.rot += (want - p.rot) * Math.min(1, h * 9);

    const dx = this.speed * h;
    this.distance += dx;
    for (const rock of this.rocks) rock.x -= dx;

    // recycle: anything off the left edge goes back on the right
    const last = this.rocks.reduce((m, r) => Math.max(m, r.x), 0);
    for (const rock of this.rocks) {
      if (rock.x < -120) Object.assign(rock, this.#makeRock(last + R.spacing));
    }

    for (const rock of this.rocks) {
      if (!rock.scored && rock.x + R.rockW < p.x) {
        rock.scored = true;
        this.passed++;
        this.score++;
      }
      if (rock.star && !rock.starTaken) {
        const d = Math.hypot(rock.x + R.rockW / 2 - p.x, rock.gapY - p.y);
        if (d < R.starR + R.planeR) {
          rock.starTaken = true;
          this.stars++;
          this.score++;
        }
      }
    }

    if (this.hits()) this.die();
  }

  /** Rock columns as rectangles, for drawing and for collision alike. */
  bars(rock, w = this.rules.rockW) {
    return [
      { x: rock.x, y: 0, w, h: rock.gapY - rock.gap / 2 },
      { x: rock.x, y: rock.gapY + rock.gap / 2, w, h: this.height - (rock.gapY + rock.gap / 2) },
    ];
  }

  /** Is the plane touching anything it should not be? */
  hits() {
    const p = this.plane, r = this.rules.planeR;
    if (p.y - r <= 0 || p.y + r >= this.height) return true;
    for (const rock of this.rocks) {
      if (rock.x > p.x + r || rock.x + this.rules.rockW < p.x - r) continue;
      for (const b of this.bars(rock)) {
        // closest point on the rectangle to the plane's centre
        const cx = clamp(p.x, b.x, b.x + b.w);
        const cy = clamp(p.y, b.y, b.y + b.h);
        if ((p.x - cx) ** 2 + (p.y - cy) ** 2 < r * r) return true;
      }
    }
    return false;
  }

  die() {
    if (this.state === STATE.DEAD) return false;
    this.state = STATE.DEAD;
    this.deadFor = 0;
    if (this.plane.vy < 0) this.plane.vy = 0;
    return true;
  }
}

/* ── best score ──────────────────────────────────────────────────────────────
   localStorage throws outright in a few real situations — a private window
   with site data blocked, an iframe with third-party storage off, a locked
   down browser. An unguarded read here takes the whole game down before the
   first frame, which is a lot of nothing in exchange for remembering a number. */

export const best = {
  key: 'ace.best',
  get() {
    try { return Number(localStorage.getItem(this.key)) || 0; } catch { return 0; }
  },
  set(v) {
    try {
      if (v > this.get()) { localStorage.setItem(this.key, String(v)); return true; }
    } catch { /* nothing worth doing about it */ }
    return false;
  },
};
