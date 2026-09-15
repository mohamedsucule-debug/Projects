import { test, assert } from './harness.mjs';
import { levelFor, AUTHORED, CEILING, clearBonus, progress } from '../play/orbit/levels.js';

const KNOBS = ['quota', 'drones', 'chase', 'speed', 'mines', 'spinners'];

/* ── the shape of the curve ──────────────────────────────────────────────── */

test('level one is gentle enough to learn on', () => {
  // Somebody who has never played this has to survive long enough to find out
  // what the rules are.
  const l = levelFor(1);
  assert.ok(l.quota <= 8, `asking for ${l.quota} orbs before anything else happens`);
  assert.ok(l.drones <= 2, `${l.drones} hunters on the very first level`);
  assert.equal(l.mines, 0, 'a hazard you cannot dash through has no business in level 1');
  assert.equal(l.spinners, 0);
});

test('nothing new is introduced while something else is still new', () => {
  // mines appear before spinners, and never in the same level as their debut
  const firstMine = AUTHORED.findIndex((l) => l.mines > 0);
  const firstSpinner = AUTHORED.findIndex((l) => l.spinners > 0);
  assert.ok(firstMine > 0, 'mines should not be in level 1');
  assert.ok(firstSpinner > firstMine + 1, 'spinners arrive too soon after mines');
});

/* Overall pressure, not any single knob. Asserting every knob rises forever
   forbids the thing good difficulty design actually does: when a new hazard is
   introduced, the old pressure is eased so the player has room to learn it.
   Level 5 drops from four hunters to three precisely because it is the level
   that introduces the spinner. */
const weight = (l) =>
  l.drones * 1 + l.mines * 0.8 + l.spinners * 1.6 +
  l.chase * 30 + l.speed * 0.6 + l.quota * 0.1;

test('overall difficulty only ever goes up', () => {
  let prev = levelFor(1);
  for (let n = 2; n <= 300; n++) {
    const cur = levelFor(n);
    assert.ok(weight(cur) >= weight(prev) - 1e-9,
      `level ${n} is easier overall than ${n - 1}: ${weight(prev).toFixed(2)} -> ${weight(cur).toFixed(2)}`);
    prev = cur;
  }
});

test('a knob only ever eases off on a level that teaches something new', () => {
  // The exception above, pinned down: any individual drop has to be paid for
  // by a hazard type that was not on the previous level.
  for (let n = 2; n <= 300; n++) {
    const prev = levelFor(n - 1), cur = levelFor(n);
    const eased = KNOBS.filter((k) => cur[k] < prev[k] - 1e-9);
    if (!eased.length) continue;
    const newHazard = (prev.mines === 0 && cur.mines > 0) || (prev.spinners === 0 && cur.spinners > 0);
    assert.ok(newHazard,
      `level ${n} eased ${eased.join(', ')} without introducing anything new`);
  }
});

test('and it never runs away', () => {
  // Difficulty that climbs without bound is a countdown, not a challenge.
  for (const n of [1, 9, 20, 50, 200, 1000, 100000]) {
    const l = levelFor(n);
    for (const k of KNOBS) {
      assert.ok(Number.isFinite(l[k]), `level ${n}: ${k} is ${l[k]}`);
      assert.ok(l[k] <= CEILING[k] + 1e-9, `level ${n}: ${k} = ${l[k]} broke its ceiling of ${CEILING[k]}`);
    }
  }
});

test('a level is always finishable and never a chore', () => {
  for (let n = 1; n <= 500; n++) {
    const l = levelFor(n);
    assert.ok(l.quota >= 4, `level ${n} wants only ${l.quota} orbs`);
    assert.ok(l.quota <= CEILING.quota, `level ${n} wants ${l.quota} orbs`);
    assert.ok(l.drones >= 1, `level ${n} has no hunters at all, which is not a level`);
  }
});

test('there is always a next level', () => {
  // The whole point: no screen that says "you have completed the game".
  const deep = levelFor(AUTHORED.length + 400);
  assert.equal(deep.level, AUTHORED.length + 400);
  assert.ok(deep.name, 'a level with no name has nothing to put on the banner');
  assert.ok(deep.quota > 0);
});

test('the authored levels come back exactly as written', () => {
  AUTHORED.forEach((spec, i) => {
    const l = levelFor(i + 1);
    assert.equal(l.level, i + 1);
    assert.equal(l.name, spec.name);
    for (const k of KNOBS) assert.equal(l[k], spec[k], `level ${i + 1} ${k}`);
  });
});

test('every authored level has its own name', () => {
  const names = AUTHORED.map((l) => l.name);
  assert.equal(new Set(names).size, names.length, 'two levels share a name');
});

test('the extrapolated levels get harder than every authored one', () => {
  const last = AUTHORED[AUTHORED.length - 1];
  const beyond = levelFor(AUTHORED.length + 30);
  assert.ok(beyond.drones >= last.drones, 'the curve should not soften after the table runs out');
  assert.ok(beyond.speed > last.speed);
  assert.ok(beyond.chase > last.chase);
});

/* ── the awkward inputs ──────────────────────────────────────────────────── */

test('a nonsense level number is treated as level one, not as a crash', () => {
  for (const n of [0, -5, NaN, undefined, null, 0.4, '3']) {
    const l = levelFor(n);
    assert.ok(Number.isFinite(l.quota) && l.quota > 0, `levelFor(${String(n)}) produced ${l.quota}`);
    assert.ok(l.level >= 1, `levelFor(${String(n)}) gave level ${l.level}`);
  }
  assert.equal(levelFor(0).level, 1);
  assert.equal(levelFor(-99).level, 1);
});

/* ── scoring ─────────────────────────────────────────────────────────────── */

test('clearing a later level is worth more, up to a point', () => {
  assert.ok(clearBonus(5) > clearBonus(1), 'later levels should pay better');
  assert.ok(clearBonus(200) === clearBonus(500), 'the bonus has to stop somewhere');
  assert.ok(clearBonus(1) > 0);
  assert.ok(clearBonus(0) > 0, 'a defensive call should not produce a negative bonus');
});

test('progress stays inside the ring', () => {
  assert.close(progress(0, 10), 0, 1e-9);
  assert.close(progress(5, 10), 0.5, 1e-9);
  assert.close(progress(10, 10), 1, 1e-9);
  assert.close(progress(99, 10), 1, 1e-9, 'over-collecting must not overflow the ring');
  assert.close(progress(3, 0), 1, 1e-9, 'a zero quota must not divide by zero');
});

/* ── a sanity check on the pacing ────────────────────────────────────────── */

test('the first few levels are short enough to keep pulling you forward', () => {
  // "one more go" depends on the next level starting before you get bored of
  // this one. The first three together should be a couple of minutes at most.
  const firstThree = [1, 2, 3].reduce((s, n) => s + levelFor(n).quota, 0);
  assert.ok(firstThree <= 30, `${firstThree} orbs to see three levels is too long a runway`);
});
