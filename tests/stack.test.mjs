import { test, assert } from './harness.mjs';
import { Tower, STATE, RULES, rng } from '../play/stack/engine.js';

const fresh = (seed = 3) => new Tower({ width: 420, height: 640, seed });

/** Drop the current block exactly where `x` says, ignoring where it slid to. */
const dropAt = (t, x) => { t.current.x = x; return t.drop(); };

/* ── the slicing arithmetic ──────────────────────────────────────────────── */

test('a drop keeps exactly the part that was over the block below', () => {
  const t = fresh();
  const prev = t.top;
  const r = dropAt(t, prev.x + 40);           // 40 units of overhang
  assert.ok(r.landed);
  assert.close(r.width, prev.w - 40, 1e-9, 'the overlap is what survives');
  assert.close(t.top.x, prev.x + 40, 1e-9, 'and it sits where the overlap was');
});

test('the offcut is exactly the part that was not', () => {
  const t = fresh();
  const prev = t.top;
  const r = dropAt(t, prev.x + 40);
  assert.ok(r.slice, 'a sloppy drop has to produce an offcut');
  assert.close(r.slice.w, 40, 1e-9);
  assert.close(r.width + r.slice.w, prev.w, 1e-9, 'kept + sliced must equal what you dropped');
});

test('it slices the correct end, whichever way you miss', () => {
  const right = fresh();
  const pr = right.top;
  const a = dropAt(right, pr.x + 30);
  assert.close(a.slice.x, pr.x + pr.w, 1e-9, 'missing right slices off the right');

  const left = fresh();
  const pl = left.top;
  const b = dropAt(left, pl.x - 30);
  assert.close(b.slice.x, pl.x - 30, 1e-9, 'missing left slices off the left');
  assert.close(b.slice.w, 30, 1e-9);
});

test('the tower can only ever get narrower, unless you are perfect', () => {
  const t = fresh(11);
  let prev = t.top.w;
  for (let i = 0; i < 25 && t.state !== STATE.DEAD; i++) {
    const r = dropAt(t, t.top.x + 6);         // always a little sloppy
    if (!r.landed) break;
    assert.ok(t.top.w <= prev + 1e-9, `width grew from ${prev} to ${t.top.w} on a missed drop`);
    prev = t.top.w;
  }
});

test('a block is never wider than the one holding it up', () => {
  const t = fresh(7);
  for (let i = 0; i < 40 && t.state !== STATE.DEAD; i++) {
    const below = t.top;
    const r = dropAt(t, below.x + (i % 2 ? 4 : -9));
    if (!r.landed) break;
    // perfect drops hand a little width back, which is the one exception
    if (!r.perfect) assert.ok(t.top.w <= below.w + 1e-9, `row ${i} overhangs its support`);
  }
});

/* ── perfect drops ───────────────────────────────────────────────────────── */

test('landing dead centre snaps flush and costs nothing', () => {
  const t = fresh();
  const prev = t.top;
  const r = dropAt(t, prev.x);
  assert.ok(r.perfect);
  assert.equal(r.slice, null, 'a perfect drop must not produce an offcut');
  assert.close(t.top.x, prev.x, 1e-9, 'and it must line up exactly');
  assert.ok(t.top.w >= prev.w, 'a perfect drop should not shrink the tower');
});

test('nearly perfect still counts, and just outside does not', () => {
  const inside = fresh();
  assert.ok(dropAt(inside, inside.top.x + RULES.perfectTol - 0.01).perfect);

  const outside = fresh();
  const r = dropAt(outside, outside.top.x + RULES.perfectTol + 1);
  assert.ok(!r.perfect, 'the tolerance has to have an edge');
  assert.ok(r.slice, 'and past it you lose something');
});

test('a perfect streak hands width back but cannot build a runway', () => {
  // Without the regain the tower only ever shrinks and every run ends the same
  // way. With an uncapped regain a good player builds a motorway and the game
  // stops being a game.
  const t = fresh();
  for (let i = 0; i < 80; i++) dropAt(t, t.top.x);
  assert.equal(t.state, STATE.PLAYING, 'eighty perfect drops should not have killed anyone');
  assert.ok(t.top.w <= RULES.startW + 1e-9, `the tower grew to ${t.top.w}, wider than it started`);
  assert.equal(t.perfects, 80);
  assert.equal(t.combo, 80);
});

test('a miss breaks the streak, a perfect starts a new one', () => {
  const t = fresh();
  dropAt(t, t.top.x);
  dropAt(t, t.top.x);
  assert.equal(t.combo, 2);
  dropAt(t, t.top.x + 30);
  assert.equal(t.combo, 0, 'a miss has to break it');
  dropAt(t, t.top.x);
  assert.equal(t.combo, 1);
  assert.equal(t.bestCombo, 2, 'the best streak of the run is remembered');
});

/* ── dying ───────────────────────────────────────────────────────────────── */

test('missing completely ends the run', () => {
  const t = fresh();
  const r = dropAt(t, t.top.x + t.top.w + 40);     // no overlap at all
  assert.ok(r.dead);
  assert.equal(t.state, STATE.DEAD);
  assert.ok(!r.landed, 'a block with nothing under it cannot land');
});

test('a sliver too thin to stand on also ends it', () => {
  const t = fresh();
  const prev = t.top;
  const r = dropAt(t, prev.x + prev.w - RULES.deadW / 2);
  assert.ok(r.dead, `a ${RULES.deadW / 2}-unit ledge should not be survivable`);
});

test('a dead tower ignores everything after', () => {
  const t = fresh();
  dropAt(t, t.top.x + t.top.w + 100);
  assert.equal(t.state, STATE.DEAD);
  const before = t.score;
  assert.ok(t.drop().dead);
  t.step(1);
  assert.equal(t.score, before, 'a dead run must not keep scoring');
});

test('the run cannot end on the very first drop by accident', () => {
  // The foundation is the full width, so a drop anywhere the block can legally
  // be must leave something behind.
  for (let seed = 1; seed <= 40; seed++) {
    const t = fresh(seed);
    t.step(0.05);
    const r = t.drop();
    assert.ok(!r.dead, `seed ${seed} died on the opening drop from x=${t.blocks[0].x}`);
  }
});

/* ── the sliding block ───────────────────────────────────────────────────── */

test('the block stays entirely on screen and turns around at the edges', () => {
  // Half a block hanging off the side reads as a rendering bug, and hides the
  // thing you are trying to line up.
  const t = fresh(5);
  for (let i = 0; i < 4000; i++) {
    t.step(1 / 60);
    const c = t.current;
    assert.ok(c.x >= -1e-6, `it slid off the left to x=${c.x}`);
    assert.ok(c.x + c.w <= t.width + 1e-6, `it slid off the right to x=${c.x + c.w}`);
  }
});

test('a narrower block has further to travel', () => {
  // Falls out of edge-to-edge travel: the tighter your tower, the faster the
  // block crosses it. The game tightens as you improve, with no extra rule.
  const wide = fresh(); const narrow = fresh();
  narrow.blocks[0].w = 80;
  narrow.spawn();
  const travel = (t) => t.width - t.current.w;
  assert.ok(travel(narrow) > travel(wide) * 1.5,
    `narrow travels ${travel(narrow)}, wide travels ${travel(wide)}`);
});

test('a dropped frame does not teleport the block across the screen', () => {
  const t = fresh();
  const before = t.current.x;
  t.step(30);                    // the tab was in the background for half a minute
  assert.ok(Math.abs(t.current.x - before) <= t.speed * 0.1 + 1e-6,
    'a long frame must be clamped, or you come back to a block somewhere random');
});

test('the slide speeds up and then holds', () => {
  const t = fresh();
  const at = (n) => { t.score = n; return t.speed; };
  assert.close(at(0), RULES.speedStart, 1e-9);
  assert.ok(at(15) > at(0));
  assert.close(at(RULES.speedRamp), RULES.speedMax, 1e-9);
  assert.close(at(RULES.speedRamp * 20), RULES.speedMax, 1e-9, 'it must not accelerate for ever');
});

test('each new block starts off one edge, matching the width below it', () => {
  const t = fresh(9);
  for (let i = 0; i < 12 && t.state !== STATE.DEAD; i++) {
    assert.close(t.current.w, t.top.w, 1e-9, 'a new block must match what it will land on');
    assert.ok(t.current.dir === 1 || t.current.dir === -1);
    dropAt(t, t.top.x + 3);
  }
});

/* ── reproducibility ─────────────────────────────────────────────────────── */

test('the same seed and the same drops build the same tower', () => {
  const build = () => {
    const t = fresh(4242);
    for (let i = 0; i < 30 && t.state !== STATE.DEAD; i++) {
      t.step(0.1);
      t.drop();
    }
    return { score: t.score, perfects: t.perfects, blocks: t.blocks.map((b) => Math.round(b.x * 100)) };
  };
  assert.deep(build(), build());
});

test('a different seed sends the blocks in from different sides', () => {
  const sides = (seed) => {
    const t = fresh(seed);
    const out = [];
    for (let i = 0; i < 20 && t.state !== STATE.DEAD; i++) { out.push(t.current.dir); dropAt(t, t.top.x); }
    return out.join('');
  };
  assert.ok(sides(1) !== sides(2), 'two seeds produced the same sequence of sides');
});

/* ── the readout ─────────────────────────────────────────────────────────── */

test('the margin readout tracks the width you have left', () => {
  const t = fresh();
  assert.close(t.margin, 1, 1e-9, 'a fresh tower has all of its margin');
  dropAt(t, t.top.x + RULES.startW / 2);
  assert.close(t.margin, 0.5, 0.01, 'half the width is half the margin');
  assert.ok(t.margin >= 0 && t.margin <= 1);
});

test('reset clears everything, including the streak', () => {
  const t = fresh();
  for (let i = 0; i < 5; i++) dropAt(t, t.top.x);
  dropAt(t, t.top.x + 999);
  t.reset(1);
  assert.equal(t.state, STATE.READY);
  assert.equal(t.score, 0);
  assert.equal(t.combo, 0);
  assert.equal(t.perfects, 0);
  assert.equal(t.blocks.length, 1);
  assert.close(t.top.w, RULES.startW, 1e-9);
});

/* ── is it actually playable ─────────────────────────────────────────────── */

test('it rewards precision without punishing ordinary reactions', () => {
  /* A difficulty curve is a claim about play, so it gets tested by playing.
     The bot aims for dead centre and is then late by a random few
     milliseconds, which is what a human is. The spread across jitter levels is
     the whole design: a casual player should get somewhere, a sharp one should
     get several times further, and perfect timing should never run out. */
  const play = (jitterMs, seed) => {
    const t = fresh(seed);
    const dt = 1 / 60;
    let ticks = 0;
    while (t.state !== STATE.DEAD && ticks++ < 8000) {
      t.step(dt);
      const c = t.current, top = t.top;
      const now = Math.abs(c.x - top.x);
      const next = Math.abs(c.x + t.speed * c.dir * dt - top.x);
      if (now <= next) {
        // the block keeps sliding while the player reacts
        c.x += t.speed * c.dir * (rng(seed * 31 + ticks)() * jitterMs) / 1000;
        t.drop();
      }
    }
    return t.score;
  };
  const median = (j) => [1, 2, 3, 4, 5].map((s) => play(j, s)).sort((a, b) => a - b)[2];

  const sloppy = median(70), decent = median(40), sharp = median(20);
  assert.ok(sloppy >= 8, `a casual player only reached ${sloppy} — that is discouraging`);
  assert.ok(sharp > sloppy * 1.8,
    `precision is barely rewarded: sloppy ${sloppy} vs sharp ${sharp}`);
  assert.ok(decent >= sloppy && sharp >= decent, 'better timing must not score worse');
});

test('perfect timing never runs out of game', () => {
  // The skill ceiling has to be out of reach, or the best players finish it.
  const t = fresh(2);
  for (let i = 0; i < 600; i++) {
    t.step(1 / 60);
    t.current.x = t.top.x;          // flawless every time
    t.drop();
  }
  assert.equal(t.state, STATE.PLAYING, 'six hundred flawless drops should not end a run');
  assert.equal(t.score, 600);
});

test('the random source is even enough to pick a side with', () => {
  const r = rng(77);
  let left = 0;
  for (let i = 0; i < 6000; i++) if (r() < 0.5) left++;
  assert.ok(left > 2700 && left < 3300, `lopsided coin: ${left}/6000`);
});
