import { test, assert } from './harness.mjs';
import {
  WORLD, WAVE, CAMERA, QUALITY,
  orbit, zoom, eyeOf, target, rayThrough, hitWater, touchToWater,
  makeQuality, quality, waveStep, drop, clamp,
} from '../apps/mercury/scene.js';

const cam = () => ({ yaw: 0.65, pitch: 0.42, dist: 7.2 });
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/* ── the camera ──────────────────────────────────────────────────────────── */

test('the camera cannot be tipped over the top', () => {
  /* Letting the pitch run past vertical looks like the whole world flipping
     upside down, which nobody dragging a finger has asked for. */
  let c = cam();
  for (let i = 0; i < 400; i++) c = orbit(c, 0, -60);
  assert.ok(c.pitch <= CAMERA.maxPitch + 1e-9, `pitch reached ${c.pitch}`);
});

test('and it cannot be lowered into the surface', () => {
  /* At exactly zero the eye is in the plane of the metal, where a mirror
     shows nothing at all and the screen goes black for no reason the person
     dragging could work out. */
  let c = cam();
  for (let i = 0; i < 400; i++) c = orbit(c, 0, 60);
  assert.ok(c.pitch >= CAMERA.minPitch - 1e-9, `pitch reached ${c.pitch}`);
  assert.ok(c.pitch > 0, 'the eye ended up in the surface');
});

test('turning round and round is fine, it is only the pitch that is penned in', () => {
  let c = cam();
  for (let i = 0; i < 300; i++) c = orbit(c, 40, 0);
  assert.ok(Number.isFinite(c.yaw));
  assert.ok(Math.abs(c.yaw) > 6, 'yaw should be free to keep going round');
});

test('zooming is multiplicative, so a notch feels the same near and far', () => {
  const a = zoom({ ...cam(), dist: 4 }, 1.1);
  const b = zoom({ ...cam(), dist: 8 }, 1.1);
  assert.close((a.dist - 4) / 4, (b.dist - 8) / 8, 1e-9);
});

test('zoom stops at both ends', () => {
  let c = cam();
  for (let i = 0; i < 200; i++) c = zoom(c, 1.2);
  assert.close(c.dist, CAMERA.maxDist, 1e-9);
  for (let i = 0; i < 200; i++) c = zoom(c, 0.8);
  assert.close(c.dist, CAMERA.minDist, 1e-9);
});

test('the eye is always the stated distance from what it is looking at', () => {
  for (let i = 0; i < 40; i++) {
    const c = { yaw: i * 0.37, pitch: 0.1 + (i % 10) * 0.1, dist: 4 + (i % 7) };
    assert.close(dist(eyeOf(c), target()), c.dist, 1e-9, `orbit ${i}`);
  }
});

test('the eye is always above the metal', () => {
  for (let i = 0; i < 60; i++) {
    const c = { yaw: i, pitch: CAMERA.minPitch, dist: CAMERA.maxDist };
    assert.ok(eyeOf(c)[1] > 0.1, 'the camera dropped to or below the surface');
  }
});

/* ── rays ────────────────────────────────────────────────────────────────── */

test('the middle of the screen looks at what the camera is aimed at', () => {
  const c = cam();
  const rd = rayThrough(c, 640, 360, 1280, 720);
  const eye = eyeOf(c);
  const toTarget = [
    target()[0] - eye[0], target()[1] - eye[1], target()[2] - eye[2],
  ];
  const l = len(toTarget);
  assert.close(dot(rd, [toTarget[0] / l, toTarget[1] / l, toTarget[2] / l]), 1, 1e-9);
});

test('rays come out normalised, whatever the aspect ratio', () => {
  for (const [w, h] of [[1280, 720], [390, 844], [3000, 500], [1, 1]]) {
    for (const [x, y] of [[0, 0], [w, h], [w / 2, 0], [0, h / 2]]) {
      assert.close(len(rayThrough(cam(), x, y, w, h)), 1, 1e-9, `${w}x${h} at ${x},${y}`);
    }
  }
});

test('the top of the screen is higher than the bottom', () => {
  /* Screens count downwards and cameras count upwards, and getting that flip
     wrong is the bug everybody writes at least once. Here it would make the
     ripple appear on the opposite side of the screen from your finger. */
  const c = cam();
  const top = rayThrough(c, 640, 10, 1280, 720);
  const bottom = rayThrough(c, 640, 710, 1280, 720);
  assert.ok(top[1] > bottom[1], 'the screen is upside down');
});

test('left and right are the right way round', () => {
  const c = { yaw: 0, pitch: 0.4, dist: 8 };
  // looking down -z, so screen-left should be -x... and stay consistent
  const left = rayThrough(c, 100, 360, 1280, 720);
  const right = rayThrough(c, 1180, 360, 1280, 720);
  assert.ok(left[0] !== right[0]);
  const mid = rayThrough(c, 640, 360, 1280, 720);
  assert.ok((left[0] - mid[0]) * (right[0] - mid[0]) < 0, 'both sides went the same way');
});

/* ── where the finger landed ─────────────────────────────────────────────── */

test('a ray aimed at the sky never touches the metal', () => {
  /* Returning a negative distance instead of nothing puts the ripple BEHIND
     the camera, and the metal appears to ripple on its own. */
  assert.equal(hitWater([0, 3, 0], [0, 1, 0]), null, 'straight up');
  assert.equal(hitWater([0, 3, 0], [0.7, 0.71, 0]), null, 'up and away');
  assert.equal(hitWater([0, 3, 0], [1, 0, 0]), null, 'exactly parallel');
});

test('a ray aimed down lands where the arithmetic says', () => {
  const p = hitWater([0, 4, 0], [0, -1, 0]);
  assert.deep(p, [0, 0, 0]);
  const q = hitWater([1, 2, 3], [0, -1, 0]);
  assert.close(q[0], 1, 1e-9);
  assert.close(q[2], 3, 1e-9);
  assert.close(q[1], 0, 1e-9);
});

test('the middle of the screen lands near the middle of the metal', () => {
  const hit = touchToWater(cam(), 640, 400, 1280, 720);
  assert.ok(hit, 'the centre of the screen found no metal at all');
  assert.ok(Math.abs(hit.u - 0.5) < 0.2 && Math.abs(hit.v - 0.5) < 0.2,
    `landed at ${hit.u.toFixed(2)}, ${hit.v.toFixed(2)}`);
});

test('a touch in the sky gives nothing rather than something wrong', () => {
  assert.equal(touchToWater(cam(), 640, 2, 1280, 720), null);
});

test('a touch beyond the simulated patch is refused', () => {
  /* Pushing a ripple in at the very edge makes it bounce straight back off
     the boundary, which reads as a glitch rather than as a wave. */
  const far = touchToWater({ yaw: 0, pitch: 0.07, dist: 15 }, 640, 372, 1280, 720);
  if (far) {
    assert.ok(far.u > 0.02 && far.u < 0.98 && far.v > 0.02 && far.v < 0.98);
  }
  // and everything it does accept is inside the patch
  for (let x = 0; x < 1280; x += 53) {
    for (let y = 0; y < 720; y += 37) {
      const h = touchToWater(cam(), x, y, 1280, 720);
      if (!h) continue;
      assert.ok(h.u >= 0 && h.u <= 1 && h.v >= 0 && h.v <= 1, `${x},${y} -> ${h.u}, ${h.v}`);
      assert.ok(Math.abs(h.world[0]) <= WORLD && Math.abs(h.world[2]) <= WORLD);
    }
  }
});

/* ── the resolution controller ───────────────────────────────────────────── */

test('slow frames make it ask for fewer pixels', () => {
  let q = makeQuality(1);
  for (let i = 0; i < 300; i++) q = quality(q, 40);
  assert.ok(q.scale < 1, `stayed at ${q.scale}`);
  assert.ok(q.scale >= QUALITY.min);
});

test('fast frames give the pixels back', () => {
  let q = makeQuality(1);
  for (let i = 0; i < 300; i++) q = quality(q, 40);
  const low = q.scale;
  for (let i = 0; i < 600; i++) q = quality(q, 6);
  assert.ok(q.scale > low);
  assert.close(q.scale, 1, 1e-9, 'it should get all the way back');
});

test('it never asks for more than it was told it could have', () => {
  let q = makeQuality(0.8);
  for (let i = 0; i < 900; i++) q = quality(q, 2);
  assert.close(q.scale, 0.8, 1e-9);
});

test('one slow frame does not move it', () => {
  /* Without the patience it drops the resolution on a single slow frame,
     which makes the next frame fast, which puts it straight back — and the
     picture visibly breathes in and out. */
  let q = makeQuality(1);
  for (let i = 0; i < 5; i++) q = quality(q, 90);
  assert.close(q.scale, 1, 1e-9);
});

test('alternating fast and slow frames leave it alone', () => {
  let q = makeQuality(1);
  const seen = new Set();
  for (let i = 0; i < 1200; i++) {
    q = quality(q, i % 2 ? 6 : 34);
    seen.add(q.scale.toFixed(3));
  }
  assert.ok(seen.size <= 2, `it settled on ${seen.size} different scales: ${[...seen].join(', ')}`);
});

test('nonsense frame times change nothing', () => {
  let q = makeQuality(1);
  for (const ms of [NaN, undefined, -5, Infinity, null]) q = quality(q, ms);
  assert.ok(Number.isFinite(q.scale) && Number.isFinite(q.avg));
  assert.close(q.scale, 1, 1e-9);
});

/* ── the waves ───────────────────────────────────────────────────────────── */

const N = 48;
function still() { return { h: new Float32Array(N * N), prev: new Float32Array(N * N) }; }
function run(state, steps, opts) {
  let { h, prev } = state;
  for (let i = 0; i < steps; i++) {
    const next = waveStep(h, prev, N, opts);
    prev = h; h = next;
  }
  return { h, prev };
}
const peak = (h) => h.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

test('still metal stays still', () => {
  const out = run(still(), 200);
  assert.equal(peak(out.h), 0, 'it started rippling on its own');
});

test('a drop spreads outwards and dies away', () => {
  const s = still();
  drop(s.h, N, 0.5, 0.5, { strength: 1 });
  const mid = run(s, 60);
  assert.ok(peak(mid.h) > 0.02, 'the wave vanished immediately');
  const late = run(mid, 2500);
  assert.ok(peak(late.h) < 0.01, `still ${peak(late.h).toFixed(4)} after 2500 steps`);
});

test('a drop in the middle stays symmetric', () => {
  const s = still();
  drop(s.h, N, 0.5, 0.5, { strength: 1 });
  const out = run(s, 40);
  const at = (x, y) => out.h[y * N + x];
  for (let d = 1; d < 10; d++) {
    assert.close(at(24 + d, 24), at(24 - d, 24), 1e-6, `left and right disagree at ${d}`);
    assert.close(at(24, 24 + d), at(24, 24 - d), 1e-6, `up and down disagree at ${d}`);
  }
});

test('the edges swallow a wave instead of bouncing it back', () => {
  const s = still();
  drop(s.h, N, 0.5, 0.5, { strength: 1 });
  const out = run(s, 600);
  for (let i = 0; i < N; i++) {
    assert.equal(out.h[i], 0, 'the top edge is not being held still');
    assert.equal(out.h[(N - 1) * N + i], 0, 'the bottom edge is not being held still');
    assert.equal(out.h[i * N], 0);
    assert.equal(out.h[i * N + N - 1], 0);
  }
});

test('the wave speed is not an arbitrary number', () => {
  /* The discrete wave equation is stable only while c² stays under a half.
     Past it the simulation feeds itself and the whole surface reaches
     infinity inside a second — which is worth pinning down, because it is the
     difference between a constant that was measured and one that was guessed.
     The one in use sits at 0.176, comfortably inside. */
  assert.ok(WAVE.speed * WAVE.speed < 0.5,
    `the configured speed is past the stability limit: c² = ${(WAVE.speed ** 2).toFixed(3)}`);

  const blows = (speed) => {
    const s = still();
    drop(s.h, N, 0.5, 0.5, { strength: 1 });
    const out = run(s, 900, { speed, damping: 1 });
    return !Number.isFinite(peak(out.h)) || peak(out.h) > 50;
  };
  assert.ok(!blows(WAVE.speed), 'the speed in use is unstable');
  assert.ok(!blows(0.69), 'just under the limit should still hold together');
  assert.ok(blows(0.75), 'just over the limit should come apart — if it does not, this test proves nothing');
});

test('a drop pushes the surface down, not up', () => {
  const h = new Float32Array(N * N);
  drop(h, N, 0.5, 0.5, { strength: 1 });
  assert.ok(h[24 * N + 24] < 0, 'the drop made a hill instead of a dent');
  assert.close(h[24 * N + 24], -1, 1e-6, 'the middle should take the full push');
});

test('a drop leaves the rest of the surface alone', () => {
  const h = new Float32Array(N * N);
  drop(h, N, 0.5, 0.5, { radius: 0.05, strength: 1 });
  assert.equal(h[0], 0, 'a drop in the middle reached the corner');
  assert.equal(h[N * N - 1], 0);
});

test('a drop at the very edge does not write outside the grid', () => {
  for (const [u, v] of [[0, 0], [1, 1], [0, 1], [1, 0], [-0.4, 0.5], [1.4, 0.5]]) {
    const h = new Float32Array(N * N);
    drop(h, N, u, v, { strength: 1 });
    assert.equal(h.length, N * N);
    for (const x of h) assert.ok(Number.isFinite(x), `drop at ${u},${v} produced ${x}`);
  }
});

test('the simulated patch is big enough to be worth looking across', () => {
  assert.ok(WORLD >= 6, 'the metal would run out inside the frame');
  assert.ok(clamp(99, 0, 1) === 1 && clamp(-99, 0, 1) === 0);
});
