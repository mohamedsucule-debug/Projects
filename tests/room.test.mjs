import { test, assert } from './harness.mjs';
import { SETTING, SUSPECTS, OBJECTS, STATEMENTS, CLAIMS, SOLUTION } from '../apps/room/case.js';
import { Investigation, audit, countContradictions } from '../apps/room/engine.js';
import { anchors, at, scaleAt, ANCHORS } from '../apps/room/plate.js';

const all = () => new Investigation();
const everything = () => {
  const g = all();
  for (const o of OBJECTS) g.examine(o.id);
  for (const s of STATEMENTS) g.question(s.who);
  return g;
};

/* ── the case has to hold together ───────────────────────────────────────── */

test('the case file is consistent', () => {
  /* audit() is the same check the page runs on load. A clue that has quietly
     stopped pointing anywhere is not a crash — the player just finds the
     mystery thin — so it is worth failing loudly. */
  assert.deep(audit(), []);
});

test('every fact gives a claim a value that claim actually takes', () => {
  for (const src of [...OBJECTS, ...STATEMENTS]) {
    for (const f of src.facts) {
      assert.ok(CLAIMS[f.claim], `unknown claim ${f.claim}`);
      assert.ok(f.value in CLAIMS[f.claim], `${f.claim} does not take ${f.value}`);
    }
  }
});

test('nothing in the case file marks which fact is the lie', () => {
  /* The moment a fact can say "and this one is false", the game stops
     reasoning and starts reading out answers. */
  const text = JSON.stringify([OBJECTS, STATEMENTS]);
  for (const word of ['"lie"', '"false"', '"guilty"', '"truth"', 'contradicts']) {
    assert.ok(!text.includes(word), `the case file contains ${word}`);
  }
});

/* ── looking at things ───────────────────────────────────────────────────── */

test('a fresh investigation knows nothing', () => {
  const g = all();
  assert.equal(g.facts().length, 0);
  assert.deep(g.contradictions(), []);
  assert.equal(g.progress().examined, 0);
});

test('hidden things stay hidden until what hides them is found', () => {
  const g = all();
  assert.equal(g.state('will'), 'hidden');
  assert.equal(g.examine('will').ok, false, 'you cannot read a will inside a locked drawer');
  g.examine('desk');
  assert.equal(g.state('drawer'), 'new');
  g.examine('drawer');
  assert.equal(g.state('will'), 'new');
  assert.ok(g.examine('will').ok);
});

test('examining tells you what it opened up', () => {
  const g = all();
  const r = g.examine('body');
  assert.deep(r.opened, ['hands', 'pocket']);
  assert.ok(r.fresh);
  assert.equal(g.examine('body').fresh, false, 'looking twice is not a second discovery');
  assert.equal(g.examined.size, 1);
});

test('everything hidden is reachable from something', () => {
  /* Otherwise a clue is written, tested, and never once seen by a player. */
  const g = all();
  let changed = true;
  while (changed) {
    changed = false;
    for (const o of OBJECTS) if (g.state(o.id) === 'new') { g.examine(o.id); changed = true; }
  }
  assert.equal(g.examined.size, OBJECTS.length,
    `unreachable: ${OBJECTS.filter((o) => !g.examined.has(o.id)).map((o) => o.id).join(', ')}`);
});

/* ── the reasoning ───────────────────────────────────────────────────────── */

test('one fact on a claim is not a contradiction', () => {
  const g = all();
  g.examine('clock');
  assert.deep(g.contradictions(), []);
});

test('two facts disagreeing about the same thing is', () => {
  const g = all();
  g.examine('clock');
  g.examine('clock-back');
  const found = g.contradictions();
  assert.equal(found.length, 1);
  assert.equal(found[0].claim, 'clock-honest');
  assert.equal(found[0].sides.length, 2, 'both sides should be shown, not just the true one');
  for (const side of found[0].sides) assert.ok(side.facts.length > 0);
});

test('two facts agreeing about the same thing is not', () => {
  const g = all();
  g.examine('blotter');
  g.examine('hands');          // both say Edmund was writing
  assert.deep(g.contradictions(), []);
});

test('a statement clashes with the room by exactly the same rule', () => {
  const g = all();
  g.question('victor');
  assert.deep(g.contradictions(), [], 'a statement on its own contradicts nothing');
  g.examine('coat');           // an unused ticket in a coat still in the room
  const found = g.contradictions().map((c) => c.claim);
  assert.ok(found.includes('victor-in-town'));
});

test('the full case contains five contradictions and the player can find them all', () => {
  assert.equal(countContradictions(), 5);
  assert.equal(everything().contradictions().length, 5);
});

test('contradictions carry where each side came from', () => {
  const g = everything();
  for (const c of g.contradictions()) {
    for (const side of c.sides) {
      for (const f of side.facts) {
        assert.ok(f.from && f.from.length > 2, `a fact on ${c.claim} has no source`);
        assert.ok(f.says.length > 10);
      }
    }
  }
});

test('the boot print under the window leads nowhere, on purpose', () => {
  /* Every case needs one dead end, or the player learns that anything the game
     bothered to draw is evidence, and stops thinking. */
  const bed = OBJECTS.find((o) => o.id === 'flowerbed');
  assert.deep(bed.facts, []);
  const g = all();
  g.examine('window');
  g.examine('flowerbed');
  assert.deep(g.contradictions(), [], 'the most sinister thing in the room proves nothing');
});

/* ── naming somebody ─────────────────────────────────────────────────────── */

test('the right man, with the proof, is earned', () => {
  const v = everything().accuse(SOLUTION.guilty);
  assert.ok(v.right);
  assert.ok(v.earned);
  assert.deep(v.missing, []);
});

test('the right man on a hunch is right, and told so', () => {
  /* A case that congratulates a guess teaches the player that looking was
     optional, which is the only thing this has to sell. */
  const g = all();
  const v = g.accuse(SOLUTION.guilty);
  assert.ok(v.right, 'still the right man');
  assert.ok(!v.earned, 'but not earned');
  assert.ok(v.missing.length > 0);
  for (const o of v.missing) assert.ok(o.name, 'it should name what was never looked at');
});

test('the wrong man gets told why it is not him, specifically', () => {
  for (const s of SUSPECTS) {
    if (s.id === SOLUTION.guilty) continue;
    const v = everything().accuse(s.id);
    assert.ok(!v.right);
    assert.ok(v.missed && v.missed.length > 60, `${s.id} has no proper answer`);
    assert.equal(v.guilty.id, SOLUTION.guilty);
  }
});

test('every suspect can be accused, and nobody else can', () => {
  for (const s of SUSPECTS) assert.ok(everything().accuse(s.id).ok);
  assert.equal(all().accuse('the-vicar').ok, false);
});

test('the proof is four things you can actually find', () => {
  const g = all();
  for (const id of SOLUTION.proof) {
    assert.ok(OBJECTS.some((o) => o.id === id), `${id} is not in the room`);
  }
  assert.equal(new Set(SOLUTION.proof).size, SOLUTION.proof.length, 'the proof lists something twice');
  assert.ok(SOLUTION.proof.length >= 3, 'three things is the least that is not a guess');
});

/* ── the drawing ─────────────────────────────────────────────────────────── */

test('the projection shrinks with distance and never divides by zero', () => {
  assert.equal(scaleAt(0), 1);
  assert.ok(scaleAt(1) < scaleAt(0.5) && scaleAt(0.5) < scaleAt(0));
  for (const d of [-1, 0, 0.5, 1, 4]) assert.ok(Number.isFinite(scaleAt(d)), `broke at d=${d}`);
});

test('the back wall is where the projection says it is, not where it was eyeballed', () => {
  /* The first version of the plate drew the shell at hand-picked coordinates
     and then placed furniture at other hand-picked coordinates, and the two
     had no reason to agree — a desk hovered mid-room and a fireplace sat flat
     against a wall it was not on. */
  const [lx] = at(0, 1, 0);
  const [rx] = at(1, 1, 0);
  assert.ok(Math.abs((rx - lx) - 0.41) < 0.02, `back wall is ${(rx - lx).toFixed(3)} wide`);
  const [, floorNear] = at(0.5, 0, 0);
  const [, floorBack] = at(0.5, 1, 0);
  assert.ok(floorBack < floorNear, 'the far floor must be higher up the page than the near floor');
});

test('parallel lines going away from the camera meet at one point', () => {
  const left = [at(0.2, 0, 0), at(0.2, 0.9, 0)];
  const right = [at(0.8, 0, 0), at(0.8, 0.9, 0)];
  const cross = (a, b) => {
    const [x1, y1] = a[0], [x2, y2] = a[1], [x3, y3] = b[0], [x4, y4] = b[1];
    const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
    return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
  };
  const [vx, vy] = cross(left, right);
  assert.ok(Math.abs(vx - 0.5) < 0.005, `the vanishing point drifted to x=${vx.toFixed(3)}`);
  assert.ok(Math.abs(vy - 0.3504) < 0.005, `and to y=${vy.toFixed(3)}`);
});

test('every clue has somewhere to be clicked, and it is on the plate', () => {
  const A = anchors();
  for (const o of OBJECTS) {
    const p = A[o.id];
    assert.ok(p, `${o.id} has no anchor, so it can never be clicked`);
    assert.ok(p.x > 0.02 && p.x < 0.98, `${o.id} is off the side of the plate at x=${p.x.toFixed(2)}`);
    assert.ok(p.y > 0.02 && p.y < 0.98, `${o.id} is off the top or bottom at y=${p.y.toFixed(2)}`);
  }
  for (const id of Object.keys(ANCHORS)) {
    assert.ok(OBJECTS.some((o) => o.id === id), `the plate anchors ${id}, which is not a clue`);
  }
});

test('no two clues sit on top of each other', () => {
  /* Three things have been moved for exactly this reason and no other: the
     coat stand twice and the desk once. A hotspot that is unreachable because
     another one is over it looks, to a player, like a clue that does not
     exist. */
  const A = anchors();
  const ids = Object.keys(A);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = A[ids[i]], b = A[ids[j]];
      const d = Math.hypot((a.x - b.x) * 1.52, a.y - b.y);   // the plate is 1.52:1
      assert.ok(d > 0.05, `${ids[i]} and ${ids[j]} are ${d.toFixed(3)} apart`);
    }
  }
});

test('the brief tells you what you need and not what you are looking for', () => {
  assert.ok(SETTING.brief.length > 100);
  for (const word of ['Victor', 'murder', 'killer', 'suspect']) {
    assert.ok(!SETTING.brief.includes(word), `the brief gives away "${word}"`);
  }
});
