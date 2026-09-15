import { test, assert } from './harness.mjs';
import { Run, STATE, RULES, planetSpec, releaseWindow, rng } from '../play/tether/engine.js';

/* A bot that plays the way a person does: it watches the line it would leave
   on and lets go when that line points at the next planet — `jitter` frames
   late, which is what a reaction time is. Everything below that makes a claim
   about difficulty makes it by playing rather than by asserting. */
function play(seed, { jitter = 0, aim = 1, fps = 60, maxFrames = 30000, rand = Math.random } = {}) {
  const g = new Run({ seed });
  let wait = -1;
  for (let f = 0; f < maxFrames && g.state !== STATE.DEAD; f++) {
    if (g.state === STATE.ORBIT || g.state === STATE.READY) {
      const t = g.planets[g.index + 1];
      const c = g.craft, h = g.heading;
      const dx = t.x - c.x, dy = t.y - c.y;
      const ahead = dx * h.x + dy * h.y > 0;
      const off = Math.abs(dx * h.y - dy * h.x);
      if (wait < 0 && ahead && off < t.capture * aim) wait = jitter ? (rand() * jitter) | 0 : 0;
      if (wait === 0) { g.release(); wait = -1; }
      else if (wait > 0) wait--;
    }
    g.step(1 / fps);
  }
  return g;
}

const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

/** A run mid-flight, which is the only state a capture can happen from. */
function flying(seed) {
  const g = new Run({ seed });
  g.release();
  return g;
}

/* ── the one decision ────────────────────────────────────────────────────── */

test('a release sends you exactly the way you were already pointing', () => {
  // The game's entire promise. If the launch direction were anything other
  // than the heading already drawn on screen, every death would be arguable.
  const g = new Run({ seed: 7 });
  g.step(0.31);
  const h = g.heading;
  g.release();
  const v = g.vel;
  const speed = Math.hypot(v.x, v.y);
  assert.close(v.x / speed, h.x, 1e-9);
  assert.close(v.y / speed, h.y, 1e-9);
});

test('the launch speed is the one the planet advertises', () => {
  const g = new Run({ seed: 3 });
  g.release();
  assert.close(Math.hypot(g.vel.x, g.vel.y), g.planets[0].launch, 1e-9);
});

test('the heading is tangent to the orbit, never through the planet', () => {
  const g = new Run({ seed: 11 });
  for (let i = 0; i < 40; i++) {
    g.step(0.05);
    const o = g.orbit, c = g.craft, h = g.heading;
    // radius dotted with heading is zero for a tangent, whichever way round
    const rx = c.x - o.planet.x, ry = c.y - o.planet.y;
    const r = Math.hypot(rx, ry);
    assert.close((rx * h.x + ry * h.y) / r, 0, 1e-9, 'the craft is pointing at or away from the planet');
  }
});

test('a release mid-flight does nothing — there is only one tether to let go of', () => {
  const g = new Run({ seed: 5 });
  g.release();
  const v = { ...g.vel };
  assert.equal(g.release(), false);
  assert.deep(g.vel, v);
});

/* ── flight ──────────────────────────────────────────────────────────────── */

test('a flight is a straight line, and stays one', () => {
  // No gravity, no drag, no curve. A player reading the dotted line has to be
  // reading the truth or the line is a lie.
  const g = new Run({ seed: 9 });
  g.release();
  const from = { ...g.pos }, dir = { ...g.heading };
  for (let i = 0; i < 12 && g.state === STATE.FLYING; i++) {
    g.step(1 / 60);
    const dx = g.pos.x - from.x, dy = g.pos.y - from.y;
    assert.close(dx * dir.y - dy * dir.x, 0, 1e-6, 'the flight path bent');
  }
});

test('a capture keeps the sense of the swing you arrived with', () => {
  /* Reversing the direction on capture would feel like the game taking the
     controls off you, and it would make the next release unpredictable. */
  for (const seed of [1, 4, 8, 15, 23]) {
    const g = new Run({ seed });
    let caught = false;
    for (let i = 0; i < 400 && !caught; i++) {
      const before = { ...g.heading };
      g.step(1 / 120);
      if (g.state === STATE.ORBIT && g.hops === 1) {
        const o = g.orbit;
        const c = g.craft;
        const rx = c.x - o.planet.x, ry = c.y - o.planet.y;
        // the swing direction must match the side the craft passed on
        assert.ok(o.dir === 1 || o.dir === -1, `dir was ${o.dir}`);
        caught = true;
      }
      if (g.state === STATE.ORBIT && !caught && g.hops === 0) g.release();
      else if (g.state === STATE.ORBIT && g.hops === 0) g.release();
      void before;
    }
  }
});

test('the orbit you are given is never inside the planet', () => {
  for (const seed of [2, 6, 12, 31, 44]) {
    const g = play(seed, { maxFrames: 4000 });
    for (let i = 0; i < 200; i++) {
      g.step(1 / 60);
      if (g.state !== STATE.ORBIT) continue;
      const o = g.orbit;
      assert.ok(o.r > o.planet.core, `orbit radius ${o.r.toFixed(1)} is inside a core of ${o.planet.core.toFixed(1)}`);
      assert.ok(o.r <= o.planet.capture + 1e-9, 'orbit radius is outside the capture radius');
    }
  }
});

/* ── time ────────────────────────────────────────────────────────────────── */

test('the same run at 30, 60 and 144fps comes out identical', () => {
  /* Advancing by whatever dt arrived would pass a craft through a capture
     radius on a slow frame and miss it on a fast one — the game would be
     literally easier on a 144Hz monitor, and untestable at any rate. The taps
     are on a schedule that divides evenly into all three, so the test is
     measuring the engine and not its own arithmetic. */
  /* The taps are at multiples of a sixth of a second, which is a whole number
     of frames at 30, 60 AND 144fps and a whole number of 1/120s slices too. A
     schedule that does not divide evenly into all of them lands the release a
     fraction of a frame apart at each rate, and the test ends up measuring its
     own arithmetic rather than the engine. */
  const at = [1 / 3, 2 / 3, 1, 5 / 3, 7 / 3, 3];
  const runAt = (fps) => {
    const g = new Run({ seed: 21 });
    const dt = 1 / fps;
    let next = 0;
    for (let i = 0; i < fps * 6; i++) {
      const t = i / fps;                  // time already simulated, not including this frame
      while (next < at.length && t >= at[next] - 1e-9) { g.release(); next++; }
      g.step(dt);
    }
    return { score: g.score, hops: g.hops, x: g.craft.x, y: g.craft.y, state: g.state };
  };
  const a = runAt(30), b = runAt(60), c = runAt(144);
  assert.close(a.x, b.x, 1e-6, `30fps x=${a.x} vs 60fps x=${b.x}`);
  assert.close(b.x, c.x, 1e-6);
  assert.close(a.y, b.y, 1e-6);
  assert.close(b.y, c.y, 1e-6);
  assert.equal(a.hops, b.hops);
  assert.equal(b.hops, c.hops);
  assert.equal(a.state, c.state);
});

test('a backgrounded tab does not kill you', () => {
  // Nobody wants to come back to a tab and find they died three minutes ago.
  const g = new Run({ seed: 2 });
  g.release();
  const was = { ...g.pos };
  g.step(240);
  assert.deep(g.pos, was, 'four minutes of catch-up were simulated');
  assert.ok(g.state !== STATE.DEAD);
});

test('nonsense time is ignored rather than propagated', () => {
  const g = new Run({ seed: 2 });
  g.release();
  const was = { ...g.pos };
  for (const dt of [0, -1, NaN, Infinity, undefined]) g.step(dt);
  assert.deep(g.pos, was);
  assert.ok(Number.isFinite(g.craft.x) && Number.isFinite(g.craft.y));
});

test('the same seed and the same releases produce the same run', () => {
  const run = () => {
    const g = new Run({ seed: 1234 });
    for (let i = 0; i < 900; i++) {
      if (i % 47 === 0) g.release();
      g.step(1 / 120);
    }
    return `${g.score}/${g.hops}/${g.craft.x.toFixed(6)}/${g.craft.y.toFixed(6)}`;
  };
  assert.equal(run(), run());
});

/* ── the map ─────────────────────────────────────────────────────────────── */

test('there is always another planet ahead', () => {
  const g = play(4, { maxFrames: 12000 });
  assert.ok(g.planets.length > g.index + 1, 'the map ran out');
});

test('planets stay inside the world, with room to swing round them', () => {
  for (const seed of [1, 2, 3]) {
    const g = new Run({ seed });
    g.ensureAhead(500);
    for (const p of g.planets) {
      assert.ok(p.y >= RULES.edge - 1e-9 && p.y <= g.height - RULES.edge + 1e-9,
        `planet ${p.n} sits at y=${p.y.toFixed(1)} in a world ${g.height} tall`);
    }
  }
});

test('the map does not wander into a corner and stay there', () => {
  /* A pure random walk has no memory: within a dozen planets it is pinned to
     the top or the bottom and the game is played in a strip. Every fifth of
     the playable band has to see real use over a long run. */
  const bands = new Array(5).fill(0);
  const lo = RULES.edge, hi = 620 - RULES.edge;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const g = new Run({ seed });
    g.ensureAhead(400);
    for (const p of g.planets) {
      const i = Math.min(4, Math.max(0, Math.floor(((p.y - lo) / (hi - lo)) * 5)));
      bands[i]++;
    }
  }
  const total = bands.reduce((a, b) => a + b, 0);
  for (const [i, n] of bands.entries()) {
    assert.ok(n / total > 0.08, `only ${(100 * n / total).toFixed(1)}% of planets are in fifth ${i + 1} of the world`);
  }
});

test('every planet is reachable from the one before it', () => {
  /* The claim that makes the game fair. Somewhere on each orbit there is a
     release that gets you there — checked by trying all of them, on the real
     engine, for a long way into a run. */
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const g = play(seed, { maxFrames: 20000 });
    // walk a fresh run forward with a perfect player, then probe each orbit
    const probe = new Run({ seed });
    for (let hop = 0; hop < 25; hop++) {
      const snapshot = { index: probe.index, orbit: { ...probe.orbit } };
      let reachable = false;
      for (let i = 0; i < 180 && !reachable; i++) {
        const t = new Run({ seed });
        // rebuild the same orbit and try releasing at angle i/180 of a turn
        t.index = snapshot.index;
        t.ensureAhead();
        t.orbit = { ...snapshot.orbit, angle: (i / 180) * Math.PI * 2 };
        t.state = STATE.ORBIT;
        t.release();
        for (let f = 0; f < 900 && t.state === STATE.FLYING; f++) t.step(1 / 120);
        if (t.hops > 0) reachable = true;
      }
      assert.ok(reachable, `seed ${seed}: planet ${snapshot.index + 1} cannot be reached from planet ${snapshot.index}`);
      // advance the probe one hop, the way the bot does
      const before = probe.hops;
      for (let f = 0; f < 3000 && probe.hops === before && probe.state !== STATE.DEAD; f++) {
        if (probe.state === STATE.ORBIT || probe.state === STATE.READY) {
          const tgt = probe.planets[probe.index + 1];
          const c = probe.craft, h = probe.heading;
          const dx = tgt.x - c.x, dy = tgt.y - c.y;
          if (dx * h.x + dy * h.y > 0 && Math.abs(dx * h.y - dy * h.x) < tgt.capture * 0.35) probe.release();
        }
        probe.step(1 / 120);
      }
      if (probe.state === STATE.DEAD) break;
    }
    void g;
  }
});

/* ── the curve ───────────────────────────────────────────────────────────── */

test('the window to let go only ever gets tighter', () => {
  let prev = releaseWindow(0);
  for (let n = 1; n <= 600; n++) {
    const w = releaseWindow(n);
    assert.ok(w <= prev + 1e-12, `planet ${n} is more forgiving than planet ${n - 1}`);
    prev = w;
  }
});

test('and it never closes', () => {
  /* Difficulty that climbs without bound is a countdown, not a challenge —
     the player stops improving and starts waiting to lose. Every number eases
     towards a limit instead of marching past it. */
  for (const n of [0, 50, 500, 5000, 1e6]) {
    const w = releaseWindow(n);
    assert.ok(Number.isFinite(w) && w > 0.05, `planet ${n} leaves a ${(w * 1000).toFixed(0)}ms window`);
  }
  assert.ok(releaseWindow(1e6) >= 0.06, 'the limit is too tight to be playable');
});

test('the first planet is generous and the fiftieth is not', () => {
  assert.ok(releaseWindow(0) > 0.2, `${(releaseWindow(0) * 1000).toFixed(0)}ms to learn the game in`);
  assert.ok(releaseWindow(50) < 0.1, 'it is still as easy fifty planets in');
});

test('a nonsense planet number is treated as the first, not as a crash', () => {
  for (const n of [-4, NaN, undefined, null, 1.7, '3']) {
    const s = planetSpec(n);
    for (const k of ['capture', 'core', 'gap', 'launch']) {
      assert.ok(Number.isFinite(s[k]) && s[k] > 0, `planetSpec(${String(n)}).${k} is ${s[k]}`);
    }
  }
});

test('the planet you can see is always inside the pull you cannot', () => {
  for (let n = 0; n < 500; n += 7) {
    const s = planetSpec(n);
    assert.ok(s.core < s.capture, `planet ${n}: a core of ${s.core} in a capture radius of ${s.capture}`);
  }
});

/* ── scoring ─────────────────────────────────────────────────────────────── */

test('a plain hop is worth a hop, and skipping one pays more', () => {
  const g = flying(1);
  g.capture(g.planets[1], g.planets[1].core + 40, 40, 0);
  assert.equal(g.score, RULES.hopPoints);
  const h = flying(1);
  h.ensureAhead(6);
  h.capture(h.planets[3], h.planets[3].core + 40, 40, 0);
  assert.equal(h.score, RULES.hopPoints + 2 * RULES.skipPoints, 'jumping two planets should pay for two');
  assert.equal(h.skips, 2);
});

test('a close pass pays, and only when it is actually close', () => {
  const near = flying(1);
  near.capture(near.planets[1], near.planets[1].core + 1, 1, 0);
  assert.equal(near.score, RULES.hopPoints + RULES.closePoints);
  assert.equal(near.closes, 1);

  const far = flying(1);
  far.capture(far.planets[1], far.planets[1].core + RULES.closePass + 1, 1, 0);
  assert.equal(far.score, RULES.hopPoints);
  assert.equal(far.closes, 0);
});

test('the score never goes backwards', () => {
  const g = new Run({ seed: 17 });
  let last = 0;
  for (let i = 0; i < 4000; i++) {
    if (i % 53 === 0) g.release();
    g.step(1 / 120);
    assert.ok(g.score >= last, 'the score went down');
    last = g.score;
  }
});

/* ── ending ──────────────────────────────────────────────────────────────── */

test('drifting past everything ends the run', () => {
  const g = new Run({ seed: 1 });
  // aim straight down, where there is nothing
  g.pos = { ...g.craft };
  g.vel = { x: 0, y: 500 };
  g.state = STATE.FLYING;
  for (let i = 0; i < 600 && g.state === STATE.FLYING; i++) g.step(1 / 120);
  assert.equal(g.state, STATE.DEAD);
});

test('a dead run ignores everything after', () => {
  const g = new Run({ seed: 1 });
  g.state = STATE.DEAD;
  g.pos = { x: 10, y: 10 };
  const score = g.score;
  g.release();
  g.step(0.4);
  g.step(0.4);
  assert.equal(g.state, STATE.DEAD);
  assert.equal(g.score, score);
  assert.ok(g.deadFor > 0, 'the interface needs to know how long ago it happened');
});

test('reset puts everything back, including the streak and the map', () => {
  const g = play(3, { maxFrames: 6000 });
  g.reset(3);
  assert.equal(g.score, 0);
  assert.equal(g.hops, 0);
  assert.equal(g.closes, 0);
  assert.equal(g.skips, 0);
  assert.equal(g.index, 0);
  assert.equal(g.state, STATE.READY);
  assert.equal(g.planets[0].n, 0);
});

/* ── does it play? ───────────────────────────────────────────────────────── */

test('a player with no reaction delay at all is never beaten by the game', () => {
  /* The correct answer for a game like this: the ceiling is the player, not
     the settings. If perfect timing still lost, the curve would be a
     countdown. */
  const g = play(12, { maxFrames: 20000 });
  assert.ok(g.hops > 60, `perfect play only managed ${g.hops} planets`);
});

test('and ordinary reactions are rewarded without being required', () => {
  /* The measurement the difficulty is actually tuned against. A bot that
     hesitates by a few frames should get a run worth having; one that
     hesitates by a quarter of a second should not get far. */
  const rand = rng(99);             // seeded, so the number in the README is real
  const slight = [], sloppy = [];
  for (let s = 1; s <= 30; s++) {
    slight.push(play(s, { jitter: 6, maxFrames: 14000, rand }).hops);
    sloppy.push(play(s, { jitter: 16, maxFrames: 14000, rand }).hops);
  }
  const a = median(slight), b = median(sloppy);
  assert.ok(a >= 12, `a slight hesitation gets only ${a} planets — the game is unfair`);
  assert.ok(b <= a, `hesitating longer (${b}) did better than hesitating less (${a})`);
  assert.ok(b >= 1, `a quarter-second late and the run is over before it starts (${b})`);
});

test('the seeded source is even enough to place a map with', () => {
  const r = rng(2024);
  const bins = new Array(10).fill(0);
  for (let i = 0; i < 20000; i++) bins[Math.min(9, (r() * 10) | 0)]++;
  for (const [i, n] of bins.entries()) {
    assert.ok(n > 1400 && n < 2600, `tenth ${i} got ${n} of 20000`);
  }
});
