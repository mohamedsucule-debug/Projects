import { test, assert } from './harness.mjs';
import { Game, STATE, RULES, rng } from '../play/ace/engine.js';

const fresh = (seed = 7) => new Game({ width: 620, height: 620, seed });
const run = (g, seconds, dt = 1 / 60) => { for (let i = 0; i < seconds / dt; i++) g.step(dt); return g; };

/* ── the basics ──────────────────────────────────────────────────────────── */

test('a new game waits for you instead of starting without you', () => {
  const g = fresh();
  assert.equal(g.state, STATE.READY);
  const y = g.plane.y;
  run(g, 1.5);
  assert.equal(g.state, STATE.READY, 'it must not start on its own');
  assert.close(g.plane.y, y, 20, 'the plane should hover, not fall');
  assert.equal(g.score, 0);
});

test('the first tap starts the run', () => {
  const g = fresh();
  g.flap();
  assert.equal(g.state, STATE.FLYING);
  assert.equal(g.plane.vy, RULES.flap);
});

test('gravity pulls it down and a tap pushes it up', () => {
  const g = fresh();
  g.flap();
  const top = g.plane.y;
  // a flap arc takes 2*|flap|/gravity = 0.537s to come back to where it
  // started, so anything shorter than that is still on the way up
  run(g, 0.9);
  assert.ok(g.plane.y > top, 'it should have fallen by now');
  assert.ok(g.plane.vy > 0, 'and be moving downwards');
  g.flap();
  assert.ok(g.plane.vy < 0, 'a tap reverses that immediately');
});

test('falling has a terminal velocity', () => {
  // without one, a long drop makes the plane unrecoverable and the game
  // stops being a game.
  const g = fresh();
  g.flap();
  for (let i = 0; i < 600; i++) { g.step(1 / 60); if (g.state === STATE.DEAD) break; }
  assert.ok(g.plane.vy <= RULES.maxFall + 1e-6, `fell at ${g.plane.vy}`);
});

test('the ceiling and the floor both kill', () => {
  const low = fresh();
  low.flap();
  low.plane.y = low.height - 2;
  assert.ok(low.hits(), 'the floor should be fatal');

  const high = fresh();
  high.flap();
  high.plane.y = 2;
  assert.ok(high.hits(), 'so should the ceiling');
});

/* ── the fixed timestep ──────────────────────────────────────────────────── */

test('the same run plays out the same at 30, 60 and 144 frames a second', () => {
  // Advancing physics by whatever dt arrived makes the game measurably easier
  // on a fast machine. This is the test that keeps that honest.
  //
  // The taps land every 0.5s of simulated time, which is a whole number of
  // frames at all three rates. An earlier version of this test tapped on a
  // schedule that did not divide evenly, so the flap landed a fraction of a
  // frame apart at each rate and the runs diverged — testing the arithmetic
  // of the test rather than anything about the game.
  const play = (dt) => {
    const framesPerTap = Math.round(0.5 / dt);
    assert.close(framesPerTap * dt, 0.5, 1e-12, 'taps must land on a frame boundary');
    const g = fresh(1234);
    g.flap();
    for (let i = 1; i <= Math.round(20 / dt); i++) {
      g.step(dt);
      if (i % framesPerTap === 0) g.flap();
    }
    return { score: g.score, state: g.state, dist: +g.distance.toFixed(6), y: +g.plane.y.toFixed(6) };
  };
  const a = play(1 / 60), b = play(1 / 30), c = play(1 / 144);
  assert.deep(b, a, '30fps diverged from 60fps');
  assert.deep(c, a, '144fps diverged from 60fps');
});

test('and identically with no input at all', () => {
  const play = (dt, n) => {
    const g = fresh(5); g.flap();
    for (let i = 0; i < n; i++) g.step(dt);
    return { y: +g.plane.y.toFixed(6), dist: +g.distance.toFixed(6) };
  };
  const a = play(1 / 60, 120);
  assert.deep(play(1 / 30, 60), a);
  assert.deep(play(1 / 144, 288), a);
});

test('a backgrounded tab does not kill you while you were away', () => {
  const g = fresh();
  g.flap();
  run(g, 0.2);
  const before = g.plane.y;
  g.step(240);                   // four minutes in one frame
  assert.ok(g.state !== STATE.DEAD, 'it should not have simulated four minutes of falling');
  assert.ok(Math.abs(g.plane.y - before) < 40, 'and barely moved');
});

test('no time is lost between frames', () => {
  // The leftover of each frame is carried, not discarded.
  const a = fresh(99); a.flap();
  for (let i = 0; i < 100; i++) a.step(1 / 60);
  const b = fresh(99); b.flap();
  for (let i = 0; i < 200; i++) b.step(1 / 120);
  assert.close(a.time, b.time, 1e-9);
  assert.close(a.distance, b.distance, 0.5);
});

/* ── determinism ─────────────────────────────────────────────────────────── */

test('the same seed and the same taps give exactly the same run', () => {
  const play = () => {
    const g = fresh(4242);
    g.flap();
    for (let i = 0; i < 1400; i++) {
      g.step(1 / 60);
      if (i % 26 === 0) g.flap();
    }
    return { score: g.score, state: g.state, y: g.plane.y, rocks: g.rocks.map((r) => Math.round(r.gapY)) };
  };
  assert.deep(play(), play());
});

test('a different seed lays the rocks out differently', () => {
  const layout = (seed) => fresh(seed).rocks.map((r) => Math.round(r.gapY)).join(',');
  assert.ok(layout(1) !== layout(2), 'two seeds produced identical rocks');
});

/* ── scoring ─────────────────────────────────────────────────────────────── */

test('each rock pair scores exactly once, however long you linger', () => {
  const g = fresh();
  g.flap();
  const rock = g.rocks[0];
  rock.x = g.plane.x + 10;
  rock.gapY = g.plane.y;          // line the opening up so we survive it
  rock.gap = 400;
  for (let i = 0; i < 90; i++) { g.step(1 / 60); g.flap(); }
  assert.equal(g.score - g.stars, 1, 'the same rock was counted more than once');
  assert.ok(rock.scored);
});

test('a star is worth a point and can only be taken once', () => {
  const g = fresh();
  g.flap();
  for (const r of g.rocks) { r.star = false; r.x = 5000; }
  const rock = g.rocks[0];
  Object.assign(rock, { x: g.plane.x - 23, gapY: g.plane.y, gap: 420, star: true, starTaken: false, scored: true });
  g.step(1 / 60);
  assert.equal(g.stars, 1);
  const after = g.score;
  for (let i = 0; i < 30; i++) g.step(1 / 60);
  assert.equal(g.stars, 1, 'the same star was collected twice');
  assert.ok(g.score >= after);
});

test('flying clean through a wide opening does not kill you', () => {
  const g = fresh();
  g.flap();
  for (const r of g.rocks) { r.gap = 520; r.gapY = g.height / 2; r.star = false; }
  for (let i = 0; i < 400; i++) {
    g.step(1 / 60);
    if (g.plane.y > g.height / 2) g.flap();     // crude autopilot
  }
  assert.equal(g.state, STATE.FLYING, 'the autopilot crashed on an open course');
  assert.ok(g.score > 0, 'and it should have scored');
});

test('flying into solid rock kills you', () => {
  const g = fresh();
  g.flap();
  const rock = g.rocks[0];
  Object.assign(rock, { x: g.plane.x - 10, gapY: -400, gap: 40 });   // gap is off-screen
  g.step(1 / 60);
  assert.equal(g.state, STATE.DEAD);
});

/* ── difficulty ──────────────────────────────────────────────────────────── */

test('the opening narrows as you go, and then stops', () => {
  const g = fresh();
  assert.ok(g.gapFor(5) > g.gapFor(15), 'it should get harder');
  assert.close(g.gapFor(RULES.gapRamp), RULES.gapMin, 1e-9);
  assert.close(g.gapFor(RULES.gapRamp * 40), RULES.gapMin, 1e-9, 'and then stop, not keep closing');
  assert.ok(RULES.gapMin > RULES.planeR * 4, 'the smallest opening has to stay flyable');
});

test('the scroll speeds up and then holds', () => {
  const g = fresh();
  const at = (t) => { g.time = t; return g.speed; };
  assert.close(at(0), RULES.speedStart, 1e-9);
  assert.ok(at(20) > at(0));
  assert.close(at(RULES.speedRamp), RULES.speedMax, 1e-9);
  assert.close(at(RULES.speedRamp * 10), RULES.speedMax, 1e-9, 'it must not accelerate for ever');
});

test('every opening is reachable — none is jammed against an edge', () => {
  // A rock placed with its gap half off-screen is an unavoidable death, and
  // the player has no way of knowing it was not their fault.
  for (let seed = 1; seed <= 60; seed++) {
    const g = new Game({ width: 620, height: 620, seed });
    g.flap();
    for (let i = 0; i < 1800; i++) {
      g.step(1 / 60);
      for (const r of g.rocks) {
        assert.ok(r.gapY - r.gap / 2 >= 0, `seed ${seed}: an opening ran off the top`);
        assert.ok(r.gapY + r.gap / 2 <= g.height, `seed ${seed}: an opening ran off the bottom`);
      }
      if (g.state === STATE.DEAD) g.reset(seed + 1000);
    }
  }
});

/* ── recycling ───────────────────────────────────────────────────────────── */

test('rocks are reused, never accumulated', () => {
  const g = fresh();
  g.flap();
  const count = g.rocks.length;
  run(g, 60, 1 / 120);
  assert.equal(g.rocks.length, count, 'the rock list grew — this would leak for ever');
});

test('recycled rocks keep their spacing and arrive as fresh obstacles', () => {
  const g = fresh(11);
  g.flap();
  for (const r of g.rocks) { r.gap = 520; r.gapY = g.height / 2; }
  for (let i = 0; i < 3000; i++) {
    g.step(1 / 120);
    if (g.state === STATE.DEAD) break;
    if (g.plane.y > g.height / 2) g.flap();
  }
  const xs = g.rocks.map((r) => r.x).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) {
    assert.close(xs[i] - xs[i - 1], RULES.spacing, 1.5, 'a gap opened up in the course');
  }
  for (const r of g.rocks) {
    assert.ok(!r.scored || r.x + RULES.rockW < g.plane.x, 'a recycled rock came back already scored');
  }
});

/* ── dying ───────────────────────────────────────────────────────────────── */

test('a dead plane stops responding and settles on the floor', () => {
  const g = fresh();
  g.flap();
  g.die();
  assert.equal(g.state, STATE.DEAD);
  assert.equal(g.flap(), false, 'tapping after a crash must do nothing');
  run(g, 4);
  assert.ok(g.plane.y >= g.height, 'it should have come to rest at the bottom');
});

test('dying twice is not two deaths', () => {
  const g = fresh();
  g.flap();
  assert.equal(g.die(), true);
  assert.equal(g.die(), false);
});

test('resetting gives you a clean run', () => {
  const g = fresh();
  g.flap();
  run(g, 3);
  g.die();
  g.reset(5);
  assert.equal(g.state, STATE.READY);
  assert.equal(g.score, 0);
  assert.equal(g.stars, 0);
  assert.equal(g.passed, 0);
  assert.equal(g.plane.vy, 0);
  assert.ok(g.rocks.every((r) => r.x > g.width), 'the course should start off-screen');
});

/* ── resizing ────────────────────────────────────────────────────────────── */

test('resizing mid-flight keeps the plane where it is on screen', () => {
  const g = fresh();
  g.flap();
  run(g, 1);
  g.resize(900, 620);
  assert.close(g.plane.x / g.width, RULES.planeX, 1e-9);
  assert.equal(g.state, STATE.FLYING, 'a resize must not end the run');
});

/* ── the generator ───────────────────────────────────────────────────────── */

test('the game is winnable, and then stops being winnable', () => {
  /* A difficulty curve is a claim about play, so it gets tested by playing.
     A crude bot that aims for the next opening should get a decent way in and
     then die — if it scores 3 the game is unfair, and if it scores 500 there
     is no game. It dies right around where the openings stop narrowing, which
     is exactly where the ramp was aimed. */
  const play = (seed) => {
    const g = new Game({ width: 760, height: 620, seed });
    g.flap();
    for (let i = 0; i < 60 * 120 && g.state !== STATE.DEAD; i++) {
      const ahead = g.rocks
        .filter((r) => r.x + RULES.rockW > g.plane.x - 10)
        .sort((a, b) => a.x - b.x)[0];
      const aim = ahead ? ahead.gapY - 14 : g.height / 2;
      if (g.plane.y > aim && g.plane.vy > -80) g.flap();
      g.step(1 / 60);
    }
    return g.score;
  };
  const scores = [1, 2, 3, 4, 5].map(play).sort((a, b) => a - b);
  const median = scores[2];
  assert.ok(median >= 12, `too hard — a bot aiming at the gaps only managed ${median}`);
  assert.ok(median <= 120, `too easy — the bot scored ${median} and showed no sign of stopping`);
});

test('a rock is thick enough to read as an obstacle', () => {
  // thin poles look like scenery; the player has to see instantly what will
  // kill them
  assert.ok(RULES.rockW >= RULES.planeR * 3, `rocks are only ${RULES.rockW} units thick`);
});

test('the random source is uniform enough to place rocks with', () => {
  const r = rng(12345);
  const buckets = new Array(10).fill(0);
  for (let i = 0; i < 20000; i++) buckets[Math.floor(r() * 10)]++;
  for (const b of buckets) assert.ok(b > 1600 && b < 2400, `lopsided bucket: ${b}`);
});
