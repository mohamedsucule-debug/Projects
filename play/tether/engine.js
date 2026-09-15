/* ───────────────────────────────────────────────────────────────────────────
   tether/engine.js — the rules of letting go at the right moment.

   You are a craft swinging round a planet on a tether. One button. Press it
   and the tether lets go, and you fly off along the tangent — in a straight
   line, at the speed you were already going, in exactly the direction you were
   already pointing. If that line passes close enough to another planet, its
   gravity catches you and you are swinging again. If it doesn't, you are in
   deep space and the run is over.

   That is the entire game, and every bit of it is visible: the circle you are
   on is drawn, so the direction you will leave in is drawn too. Nothing is
   hidden, and there is only one decision — when.

   No DOM here. The engine is a state machine a test can drive, which is how
   the reachability of a level and the shape of the difficulty get checked
   without anybody playing it a thousand times.
   ─────────────────────────────────────────────────────────────────────────── */

/** mulberry32 — a run has to be reproducible for a test to assert on it. */
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
const TAU = Math.PI * 2;

export const RULES = {
  /* One turn of the tether takes the same time whatever the radius, so a wide
     orbit is a fast one. It means a loose capture punishes you twice — you
     have less time to pick your moment, and you leave faster. */
  omega: 3.1,               // radians per second

  /* Every number below eases towards a floor or a ceiling rather than marching
     linearly into one and then sitting there. A curve that flattens completely
     tells a good player they have finished; one that keeps creeping tells them
     they have not — and because it approaches rather than crosses, it never
     becomes impossible either. The release window this produces runs 229ms at
     the first planet, 106ms at the twenty-fifth, 82ms at the fiftieth and 71ms
     three hundred planets later. */
  captureStart: 104, captureEnd: 62, captureScale: 22,  // how close the line must pass
  coreStart: 26, coreEnd: 16, coreScale: 22,            // the planet you can see
  gapStart: 300, gapEnd: 560, gapScale: 26,             // one planet to the next
  launchStart: 330, launchEnd: 520, launchScale: 24,    // speed on release

  spread: 0.5,              // most a planet may sit above or below the last one,
                            // as a fraction of the gap to it
  recentre: 0.34,           // how strongly the walk is pulled back to the middle
  edge: 110,                // planets stay this far from the top and bottom
  missMargin: 190,          // how far past everything you drift before it's over
  closePass: 26,            // caught this near the core and it counts as a close pass

  /* Points. Reaching the next planet is the job; the other two are for players
     who want more out of it than survival. */
  hopPoints: 100,
  skipPoints: 140,          // per planet jumped clean over
  closePoints: 80,
};

export const STATE = { READY: 'ready', ORBIT: 'orbit', FLYING: 'flying', DEAD: 'dead' };

/** Everything about planet number `n`, counting from zero. Pure. */
export function planetSpec(n, rules = RULES) {
  const i = Math.max(0, Math.floor(n) || 0);
  // eases from `from` towards `to`, arriving in the limit and never overshooting
  const to = (from, end, scale) => from + (end - from) * (1 - Math.exp(-i / scale));
  return {
    capture: to(rules.captureStart, rules.captureEnd, rules.captureScale),
    core: to(rules.coreStart, rules.coreEnd, rules.coreScale),
    gap: to(rules.gapStart, rules.gapEnd, rules.gapScale),
    launch: to(rules.launchStart, rules.launchEnd, rules.launchScale),
  };
}

/** How long the window to let go is, in seconds — what the curve above means. */
export function releaseWindow(n, rules = RULES) {
  const s = planetSpec(n, rules);
  return 2 * Math.asin(Math.min(1, s.capture / s.gap)) / rules.omega;
}

export class Run {
  constructor({ height = 620, seed = 1, rules = RULES } = {}) {
    this.rules = rules;
    this.height = height;
    this.reset(seed);
  }

  reset(seed = (Math.random() * 1e9) | 0) {
    this.seed = seed >>> 0;
    this.rand = rng(this.seed);
    this.state = STATE.READY;
    this.acc = 0;
    this.score = 0;
    this.hops = 0;
    this.closes = 0;
    this.skips = 0;
    this.best = 0;          // furthest planet index reached
    this.time = 0;
    this.deadFor = 0;
    this.planets = [];
    this.trail = [];
    this.events = [];       // what just happened, for the interface to celebrate

    // the first planet is always in the middle, so every run starts the same
    this.pushPlanet(360, this.height / 2);
    this.index = 0;
    this.grab(this.planets[0], { r: 78, dir: 1, angle: Math.PI });
    this.state = STATE.READY;
    this.ensureAhead();
    return this;
  }

  /* ── the map ─────────────────────────────────────────────────────────────
     Planets are generated to the right for ever, from the seeded source, so a
     run is reproducible and nobody has to author a level. */

  pushPlanet(x, y) {
    const n = this.planets.length;
    const spec = planetSpec(n, this.rules);
    this.planets.push({ n, x, y, core: spec.core, capture: spec.capture, launch: spec.launch });
    return this.planets[n];
  }

  ensureAhead(count = 4) {
    while (this.planets.length < this.index + count + 1) {
      const last = this.planets[this.planets.length - 1];
      const gap = planetSpec(last.n, this.rules).gap;
      const spread = gap * this.rules.spread;
      /* A pure random walk is the obvious way to place these and it is wrong:
         it has no memory, so within a dozen planets it has wandered into the
         top or the bottom of the world and stayed there, and the game is
         played in a strip with two thirds of the screen empty above it.
         A pull back towards the middle, proportional to how far out it has
         drifted, keeps the walk wandering without letting it settle. */
      const centre = this.height / 2;
      const pull = (centre - last.y) * this.rules.recentre;
      const y = clamp(
        last.y + pull + (this.rand() * 2 - 1) * spread,
        this.rules.edge,
        this.height - this.rules.edge,
      );
      this.pushPlanet(last.x + gap, y);
    }
  }

  /* ── the two states you can be in ────────────────────────────────────────── */

  /** Latch onto a planet. `dir` is +1 or -1: which way round you swing. */
  grab(planet, { r, dir, angle }) {
    this.index = planet.n;
    this.best = Math.max(this.best, planet.n);
    this.orbit = { planet, r, dir, angle };
    this.state = STATE.ORBIT;
    this.vel = null;
    this.ensureAhead();
  }

  /** Where the craft is, whichever state it is in. */
  get craft() {
    if (this.state === STATE.FLYING || this.state === STATE.DEAD) return this.pos;
    const o = this.orbit;
    return { x: o.planet.x + Math.cos(o.angle) * o.r, y: o.planet.y + Math.sin(o.angle) * o.r };
  }

  /** The way it is travelling right now — the direction release would send it. */
  get heading() {
    if (this.state === STATE.FLYING) {
      const s = Math.hypot(this.vel.x, this.vel.y) || 1;
      return { x: this.vel.x / s, y: this.vel.y / s };
    }
    const o = this.orbit;
    return { x: -Math.sin(o.angle) * o.dir, y: Math.cos(o.angle) * o.dir };
  }

  /** The one button. Lets go of the tether. Does nothing mid-flight. */
  release() {
    if (this.state === STATE.READY) this.state = STATE.ORBIT;
    if (this.state !== STATE.ORBIT) return false;
    const o = this.orbit;
    const h = this.heading;
    const speed = o.planet.launch;
    this.pos = this.craft;
    this.vel = { x: h.x * speed, y: h.y * speed };
    this.state = STATE.FLYING;
    this.events.push({ kind: 'release' });
    return true;
  }

  /* ── time ────────────────────────────────────────────────────────────────
     Sliced into fixed pieces, however long the browser actually took. A flight
     advanced by whatever `dt` arrived would pass through a capture radius on a
     slow frame and miss it on a fast one, which would make the game literally
     easier on a 144Hz monitor and impossible to test. */

  step(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return this;
    if (dt > 0.5) return this;            // a backgrounded tab must not kill you
    const SLICE = 1 / 120;
    /* The leftover is CARRIED, not simulated. Chopping each frame into pieces
       of at most a slice is the obvious version and it is wrong: at 144fps
       every frame is shorter than a slice, so the world advances in 1/144s
       steps and the capture check samples the flight at different points than
       it does at 60. The craft then clips a capture radius at one frame rate
       and misses it at another — the game is literally different on a faster
       monitor, and no test of it can hold. */
    this.acc = (this.acc || 0) + dt;
    let guard = 0;
    /* The epsilon matters. Adding 1/144 to itself forty-eight times lands a
       hair under 40 slices rather than on it, so without it one slice fires a
       frame late at 144fps and nowhere else — and the run diverges from the
       same run at 60. It is a rounding error, not a rule, so it is rounded
       away rather than simulated. */
    while (this.acc >= SLICE - 1e-9 && guard++ < 240) {
      this.acc -= SLICE;
      this.advance(SLICE);
    }
    return this;
  }

  advance(d) {
    if (this.state === STATE.DEAD) { this.deadFor += d; return; }
    if (this.state === STATE.READY || this.state === STATE.ORBIT) {
      this.time += d;
      const o = this.orbit;
      o.angle = (o.angle + o.dir * this.rules.omega * d) % TAU;
      return;
    }

    // flying: a straight line, and nothing else
    this.time += d;
    const p = this.pos, v = this.vel;
    p.x += v.x * d;
    p.y += v.y * d;

    // caught by anything ahead of the planet you left
    for (let i = this.index + 1; i < this.planets.length; i++) {
      const pl = this.planets[i];
      const dx = p.x - pl.x, dy = p.y - pl.y;
      const dist = Math.hypot(dx, dy);
      if (dist > pl.capture) continue;
      this.capture(pl, dist, dx, dy);
      return;
    }

    // or not caught by anything
    const last = this.planets[this.planets.length - 1];
    const from = this.planets[this.index];
    const R = this.rules;
    if (p.y < -R.missMargin || p.y > this.height + R.missMargin
        || p.x > last.x + R.missMargin || p.x < from.x - R.missMargin) {
      this.state = STATE.DEAD;
      this.events.push({ kind: 'lost' });
    }
  }

  capture(pl, dist, dx, dy) {
    const R = this.rules;
    const v = this.vel;
    /* Keep the sense of the swing you arrived with: the cross product of where
       you are relative to the planet and where you are going says whether you
       are passing it clockwise or anticlockwise. Flipping it instead would feel
       like the game grabbed the controls off you. */
    const dir = (dx * v.y - dy * v.x) >= 0 ? 1 : -1;
    const r = clamp(dist, pl.core + 12, pl.capture);
    const skipped = pl.n - this.index - 1;
    const close = dist <= pl.core + R.closePass;

    this.hops++;
    this.skips += skipped;
    this.score += R.hopPoints + skipped * R.skipPoints + (close ? R.closePoints : 0);
    if (close) this.closes++;
    this.events.push({ kind: 'caught', planet: pl.n, skipped, close, dist });

    this.grab(pl, { r, dir, angle: Math.atan2(dy, dx) });
  }

  /* How far along you are, in the units the interface puts on screen. */
  get distance() { return Math.max(0, Math.round((this.craft.x - this.planets[0].x) / 10)); }
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
  best() { return { score: this.get('tether.best', 0), hops: this.get('tether.hops', 0) }; },
  record(score, hops) {
    const b = this.best();
    if (score > b.score) this.set('tether.best', score);
    if (hops > b.hops) this.set('tether.hops', hops);
    return { score: score > b.score, hops: hops > b.hops };
  },
};
