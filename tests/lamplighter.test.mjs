import { test, assert } from './harness.mjs';
import {
  CHAPTERS, chapterAt, chapterOpacity, sky, sun, storm, rain, wave,
  beam, flash, ROTATION, smooth, band, clamp, lerp, mix,
} from '../apps/lamplighter/scene.js';

/* ── the shape of a night ─────────────────────────────────────────────────
   Every one of these is a claim the picture makes, and every one of them was
   wrong at some point while building it. */

test('the sun is up at both ends of the night and down in the middle', () => {
  /* The first version put the peak at t=0.5, so the story opened at dusk, got
     brighter until midnight, and ended in the dark. It looked fine in a still
     and was nonsense the moment you scrolled. */
  assert.ok(sun(0) > 0, 'the story opens just before sunset');
  assert.ok(sun(1) > 0, 'and ends just after sunrise');
  assert.ok(sun(0.5) < -0.8, `midnight should be deep, got ${sun(0.5)}`);
  for (const t of [0.2, 0.35, 0.65, 0.8]) assert.ok(sun(t) < 0, `sun is up at ${t}`);
});

test('the sun is only just above the horizon at either end', () => {
  /* It is a night, not a day. A sun near the top of its arc at t=0 is noon
     with the wrong colours. */
  assert.ok(sun(0) < 0.2, `too high at the start: ${sun(0)}`);
  assert.ok(sun(1) < 0.2, `too high at the end: ${sun(1)}`);
});

test('the gale gets up in the evening, peaks in the small hours, and is gone by dawn', () => {
  assert.ok(storm(0) < 0.01, 'calm at sunset');
  assert.ok(storm(0.25) < 0.1, 'still quiet at nine');
  assert.ok(storm(1) < 0.01, 'calm again by morning');
  let peak = 0, at = 0;
  for (let t = 0; t <= 1; t += 0.005) if (storm(t) > peak) { peak = storm(t); at = t; }
  assert.ok(peak > 0.9, `the worst of it never really arrives: ${peak}`);
  assert.ok(at > 0.6 && at < 0.8, `the worst of it lands at ${at.toFixed(2)}, not in the small hours`);
});

test('the sky is at its darkest when the storm is at its worst', () => {
  /* These two used to drift apart: the sky started lifting towards grey at
     0.62 while storm() was still climbing to its peak at 0.72, so the weather
     appeared to clear and then get loud again. */
  let darkest = Infinity, at = 0;
  for (let t = 0; t <= 1; t += 0.005) {
    const l = sky(t).lo.reduce((a, b) => a + b, 0);
    if (l < darkest) { darkest = l; at = t; }
  }
  let peak = 0, stormAt = 0;
  for (let t = 0; t <= 1; t += 0.005) if (storm(t) > peak) { peak = storm(t); stormAt = t; }
  assert.ok(Math.abs(at - stormAt) < 0.12, `darkest at ${at.toFixed(2)}, worst weather at ${stormAt.toFixed(2)}`);
});

test('the sky never jumps', () => {
  /* Keyframed colour is where a seam shows: one bad boundary and the sky
     changes hue in a single frame halfway down somebody's scroll. */
  let prev = sky(0);
  for (let t = 0.002; t <= 1; t += 0.002) {
    const now = sky(t);
    for (const key of ['lo', 'hi']) {
      for (let c = 0; c < 3; c++) {
        const jump = Math.abs(now[key][c] - prev[key][c]);
        assert.ok(jump <= 4, `${key}[${c}] jumped ${jump} at t=${t.toFixed(3)}`);
      }
    }
    prev = now;
  }
});

test('sky colours stay inside the range a screen can show', () => {
  for (let t = 0; t <= 1; t += 0.01) {
    for (const v of [...sky(t).lo, ...sky(t).hi]) {
      assert.ok(v >= 0 && v <= 255, `${v} at t=${t}`);
    }
  }
});

test('rain arrives with the weather and not before', () => {
  assert.equal(rain(0).amount, 0);
  assert.ok(rain(0.7).amount > 0.8, 'it should be sheeting down at the worst of it');
  assert.ok(rain(0.7).slant > rain(0.3).slant, 'a gale drives rain further sideways');
  assert.ok(rain(1).amount < 0.01, 'dry at dawn');
});

/* ── the light keeps its own time ────────────────────────────────────────── */

test('the beam turns on wall time, not on how fast you scroll', () => {
  /* This is the whole feel of the piece. A beam wired to scroll position is a
     beam attached to the reader; this one turns whether or not anybody is
     there. It takes seconds, and there is no way to pass it a scroll value. */
  assert.equal(beam.length, 1);
  const a = beam(3), b = beam(3);
  assert.equal(a, b, 'same second, same angle');
  assert.ok(Math.abs(beam(ROTATION) - beam(0)) < 1e-9, 'one revolution should land back where it started');
  assert.ok(beam(ROTATION / 2) > 3.14 && beam(ROTATION / 2) < 3.15, 'half a turn is half a circle');
});

test('the light flashes once a revolution, and briefly', () => {
  let lit = 0, peak = 0;
  const steps = 2000;
  for (let i = 0; i < steps; i++) {
    const f = flash(i / steps * ROTATION);
    if (f > 0.5) lit++;
    peak = Math.max(peak, f);
  }
  assert.ok(peak > 0.99, `it never reaches full brightness: ${peak}`);
  const share = lit / steps;
  assert.ok(share > 0.02 && share < 0.16, `it is bright for ${(share * 100).toFixed(0)}% of the turn — a lighthouse blinks, it does not glow`);
});

test('the sea moves, and is rougher in a gale', () => {
  const calm = [], rough = [];
  for (let x = 0; x < 40; x += 0.3) { calm.push(wave(x, 4, 0)); rough.push(wave(x, 4, 1)); }
  const spread = (a) => Math.max(...a) - Math.min(...a);
  assert.ok(spread(rough) > spread(calm) * 2, 'a gale should more than double the sea');
  assert.ok(wave(3, 0, 0) !== wave(3, 1.4, 0), 'the sea at one second is not the sea at another');
});

/* ── the words ───────────────────────────────────────────────────────────── */

test('chapters are in order and start at the top', () => {
  assert.equal(CHAPTERS[0].at, 0);
  for (let i = 1; i < CHAPTERS.length; i++) {
    assert.ok(CHAPTERS[i].at > CHAPTERS[i - 1].at, `chapter ${i} is out of order`);
  }
  assert.ok(CHAPTERS[CHAPTERS.length - 1].at < 1, 'the last chapter must start before the end');
});

test('every chapter has something to say', () => {
  for (const [i, c] of CHAPTERS.entries()) {
    assert.ok(c.lines.length > 0, `chapter ${i} is empty`);
    for (const l of c.lines) assert.ok(l.trim().length > 20, `a line in chapter ${i} is a fragment`);
  }
});

test('emphasis markers are balanced', () => {
  /* *word* becomes an <em>. An odd number of asterisks in a line would put a
     literal one on the page. */
  for (const c of CHAPTERS) {
    for (const l of c.lines) {
      assert.equal((l.match(/\*/g) || []).length % 2, 0, `unbalanced emphasis: ${l}`);
    }
  }
});

test('the opening chapter is on screen before anybody scrolls', () => {
  /* It faded in from zero at first, so the page loaded to a beautiful picture
     with no words on it and nothing to say that scrolling was the point. */
  assert.equal(chapterOpacity(0, 0), 1);
});

test('the closing line does not scroll away at the bottom', () => {
  const last = CHAPTERS.length - 1;
  assert.equal(chapterOpacity(last, 1), 1);
  assert.ok(chapterOpacity(last, 0.999) > 0.99);
});

test('exactly one chapter is readable at any moment', () => {
  /* Two chapters at half opacity on top of each other is unreadable, and a
     gap where none is visible looks like the page has broken. */
  for (let t = 0; t <= 1; t += 0.004) {
    const os = CHAPTERS.map((_, i) => chapterOpacity(i, t));
    const total = os.reduce((a, b) => a + b, 0);
    assert.ok(total > 0.55, `nothing readable at t=${t.toFixed(3)} (total ${total.toFixed(2)})`);
    assert.ok(total < 1.45, `${os.filter((o) => o > 0.2).length} chapters at once at t=${t.toFixed(3)}`);
    const strong = os.filter((o) => o > 0.55).length;
    assert.ok(strong <= 1, `two chapters both readable at t=${t.toFixed(3)}`);
  }
});

test('chapterAt finds the chapter whose text is showing', () => {
  assert.equal(chapterAt(0).index, 0);
  assert.equal(chapterAt(1).index, CHAPTERS.length - 1);
  for (const [i, c] of CHAPTERS.entries()) {
    assert.equal(chapterAt(c.at + 0.001).index, i, `at the top of chapter ${i}`);
  }
  assert.ok(chapterAt(-5).into >= 0 && chapterAt(9).into <= 1, 'clamped either side');
});

/* ── the arithmetic underneath ───────────────────────────────────────────── */

test('smooth is smooth, and flat outside its edges', () => {
  assert.equal(smooth(0, 1, -1), 0);
  assert.equal(smooth(0, 1, 2), 1);
  assert.equal(smooth(0, 1, 0.5), 0.5);
  assert.ok(smooth(0, 1, 0.1) < 0.1, 'it should ease in, not run straight');
  assert.ok(smooth(0, 1, 0.9) > 0.9, 'and ease out');
});

test('smooth survives a zero-width edge', () => {
  /* Two keyframes at the same t would otherwise divide by zero and put NaN
     into a colour, which paints nothing at all and is invisible in review. */
  assert.equal(smooth(0.5, 0.5, 0.4), 0);
  assert.equal(smooth(0.5, 0.5, 0.6), 1);
  assert.ok(Number.isFinite(smooth(0.5, 0.5, 0.5)));
});

test('band is one in the middle and nothing outside', () => {
  assert.ok(band(0.3, 0.7, 0.5) > 0.99);
  assert.ok(band(0.3, 0.7, 0.05) < 0.01);
  assert.ok(band(0.3, 0.7, 0.95) < 0.01);
});

test('clamp, lerp and mix do what they say', () => {
  assert.equal(clamp(-1), 0);
  assert.equal(clamp(5), 1);
  assert.equal(lerp(10, 20, 0.5), 15);
  assert.deep(mix([0, 0, 0], [10, 20, 30], 0.5), [5, 10, 15]);
  assert.deep(mix([1, 1, 1], [2, 2, 2], 0.5), [2, 2, 2], 'colours are whole numbers');
});
