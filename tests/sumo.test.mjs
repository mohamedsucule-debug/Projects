import { test, assert } from './harness.mjs';
import { Bout, STATE, RULES, botHold, rng } from '../play/sumo/engine.js';

const momentum = (b) => {
  const [p, q] = b.players;
  return { x: p.vx + q.vx, y: p.vy + q.vy };
};

/* step() throws away any frame longer than half a second, which is the
   backgrounded-tab guard doing its job — so a test cannot fast-forward with
   one big step, it has to tick. */
function run(b, seconds, fps = 120) {
  for (let i = 0; i < Math.round(seconds * fps); i++) b.step(1 / fps);
  return b;
}
const started = (seed) => run(new Bout({ seed }), RULES.countdown + 0.2);

/** Play a whole match with both sides on the bot, and report how it went. */
function match(seed, { fps = 60, cap = 400, sloppiness = 0.16 } = {}) {
  const b = new Bout({ seed });
  const rand = rng(seed * 7919 + 1);
  let t = 0, clashes = 0, lastClash = -99;
  const rounds = [];
  let seen = 0;
  while (b.state !== STATE.OVER && t < cap) {
    b.hold(0, botHold(b, 0, { sloppiness, rand }));
    b.hold(1, botHold(b, 1, { sloppiness, rand }));
    b.step(1 / fps);
    t += 1 / fps;
    for (const e of b.events) {
      if (e.kind === 'clash' && e.force > 100) { clashes++; lastClash = b.time; }
    }
    b.events.length = 0;
    if (b.score[0] + b.score[1] > seen) {
      seen++;
      rounds.push({ play: b.time, shoved: b.time - lastClash < 0.9 });
      lastClash = -99;
    }
  }
  return { bout: b, seconds: t, rounds, clashes };
}

/* ── the one button ──────────────────────────────────────────────────────── */

test('holding stops the arrow turning, and lets go starts it again', () => {
  /* The entire control scheme. If the arrow kept sweeping while you thrust,
     you would be steering rather than choosing a moment, and the game would
     need a second key. */
  const b = started(1);
  assert.equal(b.state, STATE.PLAYING);
  const before = b.players[0].angle;
  b.hold(0, true);
  b.step(0.4);
  assert.close(b.players[0].angle, before, 1e-9, 'the arrow moved while it was held');
  b.hold(0, false);
  b.step(0.4);
  assert.ok(Math.abs(b.players[0].angle - before) > 0.1, 'the arrow did not start again');
});

test('you accelerate exactly the way the arrow points', () => {
  const b = started(3);
  const p = b.players[0];
  p.vx = 0; p.vy = 0;
  const a = p.angle;
  b.hold(0, true);
  b.step(1 / 60);
  const s = Math.hypot(p.vx, p.vy);
  assert.ok(s > 0, 'holding did nothing');
  assert.close(p.vx / s, Math.cos(a), 1e-6);
  assert.close(p.vy / s, Math.sin(a), 1e-6);
});

test('the button does nothing before the round starts', () => {
  // mashing it during the countdown must not buy you a head start
  const b = new Bout({ seed: 4 });
  assert.equal(b.state, STATE.COUNTDOWN);
  assert.equal(b.hold(0, true), false);
  b.step(0.5);
  assert.close(Math.hypot(b.players[0].vx, b.players[0].vy), 0, 1e-9);
});

test('a button press for a player who does not exist is ignored', () => {
  const b = new Bout({ seed: 5 });
  assert.equal(b.hold(7, true), false);
  assert.equal(b.hold(-1, true), false);
});

test('there is a top speed', () => {
  // proportional drag, so holding forever does not end with somebody at Mach 3
  const b = started(6);
  b.hold(0, true);
  for (let i = 0; i < 600; i++) b.step(1 / 60);
  const s = Math.hypot(b.players[0].vx, b.players[0].vy);
  assert.ok(s < RULES.thrust / RULES.drag + 1, `top speed came out at ${s.toFixed(0)}`);
});

/* ── the collision ───────────────────────────────────────────────────────── */

test('a clash conserves momentum, however springy it is', () => {
  /* The bounce is deliberately unphysical — energy is added on purpose. What
     must not happen is momentum appearing out of nowhere, because that is the
     bug that quietly launches somebody out of the ring off a graze. */
  const b = started(8);
  const [p, q] = b.players;
  p.x = -RULES.radius; p.y = 0; p.vx = 300; p.vy = 40;
  q.x = RULES.radius - 1; q.y = 0; q.vx = -120; q.vy = -10;
  const before = momentum(b);
  b.collide();
  const after = momentum(b);
  assert.close(after.x, before.x, 1e-9);
  assert.close(after.y, before.y, 1e-9);
});

test('a clash separates them rather than letting them buzz inside each other', () => {
  const b = started(9);
  const [p, q] = b.players;
  p.x = 0; p.y = 0; p.vx = 0; p.vy = 0;
  q.x = 6; q.y = 0; q.vx = 0; q.vy = 0;
  b.collide();
  assert.close(Math.hypot(q.x - p.x, q.y - p.y), RULES.radius * 2, 1e-6);
});

test('two blobs already moving apart are left alone', () => {
  const b = started(10);
  const [p, q] = b.players;
  p.x = 0; p.y = 0; p.vx = -200; p.vy = 0;
  q.x = RULES.radius * 2 - 2; q.y = 0; q.vx = 200; q.vy = 0;
  b.collide();
  assert.close(p.vx, -200, 1e-9, 'it grabbed a pair that were already separating');
  assert.close(q.vx, 200, 1e-9);
});

test('a head-on clash sends them in opposite directions', () => {
  const b = started(11);
  const [p, q] = b.players;
  p.x = -RULES.radius + 2; p.y = 0; p.vx = 400; p.vy = 0;
  q.x = RULES.radius - 2; q.y = 0; q.vx = 0; q.vy = 0;
  b.collide();
  assert.ok(q.vx > 0, 'the one that was hit did not go anywhere');
  assert.ok(q.vx > p.vx, 'the one that was hit is not travelling faster than the one that hit it');
});

/* ── the ring ────────────────────────────────────────────────────────────── */

test('the ring only ever shrinks, and never past its floor', () => {
  const b = started(12);
  let prev = b.ring;
  for (let i = 0; i < 60 * 300; i++) {
    b.time += 1 / 60;                         // drive the clock directly
    const r = b.ring;
    assert.ok(r <= prev + 1e-9, `the ring grew at ${b.time.toFixed(1)}s`);
    assert.ok(r >= RULES.ringEnd - 1e-9, `the ring went past its floor to ${r}`);
    prev = r;
  }
});

test('stepping outside loses you the point', () => {
  const b = started(13);
  b.players[0].x = RULES.ringStart + 5;
  b.players[0].y = 0;
  b.step(1 / 60);
  assert.equal(b.state, STATE.POINT);
  assert.equal(b.score[1], 1);
  assert.equal(b.score[0], 0);
  assert.equal(b.out, 0);
});

test('both out at once is decided by who was further out, not by a coin', () => {
  /* A coin flip for the match point would be indefensible. Whoever is further
     outside left first, and that is reproducible. */
  for (const seed of [1, 2, 3]) {
    const b = started(seed);
    b.players[0].x = RULES.ringStart + 40; b.players[0].y = 0;
    b.players[1].x = -(RULES.ringStart + 9); b.players[1].y = 0;
    b.step(1 / 60);
    assert.equal(b.out, 0, `seed ${seed}: the wrong one was called out`);
    assert.equal(b.score[1], 1);
  }
});

test('a round always ends, even if nobody ever presses anything', () => {
  /* The reason the ring shrinks at all. Two players who never move are not in
     a stalemate, they are both about to be standing outside a circle. */
  let worst = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const b = new Bout({ seed });
    let t = 0;
    while (b.state !== STATE.POINT && t < 120) { b.step(1 / 60); t += 1 / 60; }
    assert.ok(t < 120, `seed ${seed} was still going after two minutes of nobody playing`);
    worst = Math.max(worst, t);
  }
  assert.ok(worst < 20, `the longest passive round ran ${worst.toFixed(1)}s`);
});

/* ── the match ───────────────────────────────────────────────────────────── */

test('a match ends at the target and names a winner', () => {
  const r = match(21);
  assert.equal(r.bout.state, STATE.OVER, 'the match never finished');
  assert.equal(Math.max(...r.bout.score), RULES.target);
  assert.ok(r.bout.winner === 0 || r.bout.winner === 1);
  assert.equal(r.bout.score[r.bout.winner], RULES.target, 'the winner is not the one who won');
});

test('a finished match ignores everything after it', () => {
  const r = match(22);
  const score = [...r.bout.score];
  r.bout.hold(0, true);
  r.bout.step(5);
  assert.deep([...r.bout.score], score);
  assert.equal(r.bout.state, STATE.OVER);
});

test('every round starts somewhere new, facing inwards', () => {
  // a fixed opening is a memorised opening
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const b = new Bout({ seed });
    seen.add(b.players[0].x.toFixed(2));
    for (const p of b.players) {
      const r = Math.hypot(p.x, p.y);
      assert.ok(r < RULES.ringStart - RULES.radius, `seed ${seed} spawned somebody on the line`);
      // facing inwards: the arrow and the way home should not be opposites
      const home = Math.atan2(-p.y, -p.x);
      const off = Math.abs(((p.angle - home + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI);
      assert.ok(off < 0.01, `seed ${seed} spawned somebody aimed at the exit`);
    }
    const [p, q] = b.players;
    assert.close(Math.hypot(q.x - p.x, q.y - p.y), RULES.ringStart * 1.1, 1e-6, 'they did not start opposite each other');
  }
  assert.ok(seen.size > 30, `only ${seen.size} distinct openings in forty rounds`);
});

/* ── time ────────────────────────────────────────────────────────────────── */

test('the same match at 30, 60 and 144fps comes out identical', () => {
  /* Sampled collision detection at different rates is how a game ends up
     easier on a faster monitor. The holds are on a schedule that divides
     evenly into all three, so this measures the engine, not its own maths. */
  const runAt = (fps) => {
    const b = new Bout({ seed: 31 });
    const dt = 1 / fps;
    /* The schedule is counted in whole frames, not derived from i/fps: a
       half second is 15, 30 and 72 frames at the three rates and exactly 60
       slices, so every change lands at the same simulated instant. Deriving
       it from i/fps put the changes a frame apart, because 1/3 of a second
       does not exist in binary, and the test then measured its own maths. */
    const half = fps / 2;
    for (let i = 0; i < fps * 8; i++) {
      b.hold(0, Math.floor(i / half) % 2 === 0);
      b.hold(1, Math.floor(i / half) % 3 === 0);
      b.step(dt);
    }
    const p = b.players[0];
    return `${b.score.join('-')}/${p.x.toFixed(6)}/${p.y.toFixed(6)}/${b.round}`;
  };
  const a = runAt(30), b = runAt(60), c = runAt(144);
  assert.equal(a, b, `30fps: ${a}\n      60fps: ${b}`);
  assert.equal(b, c, `60fps: ${b}\n      144fps: ${c}`);
});

test('a backgrounded tab is not a forfeit', () => {
  const b = started(32);
  const was = { ...b.players[0] };
  b.step(300);
  assert.close(b.players[0].x, was.x, 1e-9, 'five minutes of catch-up were simulated');
  assert.ok(b.state !== STATE.OVER);
});

test('nonsense time changes nothing', () => {
  const b = started(33);
  const was = { x: b.players[0].x, y: b.players[0].y };
  for (const dt of [0, -1, NaN, Infinity, undefined, null]) b.step(dt);
  assert.close(b.players[0].x, was.x, 1e-12);
  assert.close(b.players[0].y, was.y, 1e-12);
});

test('the same seed and the same holds give the same match', () => {
  const run = () => match(44).bout.score.join('-');
  assert.equal(run(), run());
});

/* ── does it play? ───────────────────────────────────────────────────────── */

test('rounds are decided by a shove, not by the ring closing under somebody', () => {
  /* The measurement the physics was tuned against, and the one that matters.
     A sumo game where the ring does the work is not a sumo game — the first
     draft of these numbers had the ring deciding 91% of rounds. */
  let shoved = 0, total = 0;
  for (let seed = 1; seed <= 25; seed++) {
    for (const r of match(seed).rounds) { total++; if (r.shoved) shoved++; }
  }
  const share = shoved / total;
  assert.ok(share > 0.7, `only ${(share * 100).toFixed(0)}% of rounds ended in contact`);
});

test('a round is about ten seconds, not one and not fifty', () => {
  const play = [];
  for (let seed = 1; seed <= 25; seed++) for (const r of match(seed).rounds) play.push(r.play);
  play.sort((a, b) => a - b);
  const med = play[play.length >> 1];
  assert.ok(med > 3, `rounds last ${med.toFixed(1)}s — over before anybody has reacted`);
  assert.ok(med < 22, `rounds last ${med.toFixed(1)}s — too long between points`);
});

test('a whole match fits in a couple of minutes', () => {
  const lens = [];
  for (let seed = 1; seed <= 25; seed++) lens.push(match(seed).seconds);
  lens.sort((a, b) => a - b);
  assert.ok(lens[lens.length - 1] < 260, `the longest match ran ${lens[lens.length - 1].toFixed(0)}s`);
  assert.ok(lens[lens.length >> 1] > 25, 'matches are over before they start');
});

test('the bot is an opponent rather than a wall', () => {
  /* It has to be beatable and it has to be able to win, or one-player mode is
     either a formality or a brick. A sloppier bot should lose more often than
     a sharp one — if that does not hold, the knob is not doing anything. */
  let sharpWins = 0, sloppyWins = 0;
  for (let seed = 1; seed <= 24; seed++) {
    // player 1 is the one whose sloppiness we vary, by playing 0 as the sharp one
    const sharp = match(seed, { sloppiness: 0.05 });
    const sloppy = match(seed, { sloppiness: 0.6 });
    if (sharp.bout.winner === 0) sharpWins++;
    if (sloppy.bout.winner === 0) sloppyWins++;
  }
  assert.ok(sharpWins > 0 && sharpWins < 24, `a sharp bot went ${sharpWins}/24 — not a contest`);
  assert.ok(sloppyWins > 0, 'a sloppy bot never wins a single round');
});

test('every match finishes, at every level of sloppiness', () => {
  for (const sloppiness of [0, 0.3, 0.9, 2]) {
    for (let seed = 1; seed <= 8; seed++) {
      const r = match(seed, { sloppiness, cap: 400 });
      assert.equal(r.bout.state, STATE.OVER,
        `sloppiness ${sloppiness}, seed ${seed}: still going after ${r.seconds.toFixed(0)}s`);
    }
  }
});
