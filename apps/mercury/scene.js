/* ───────────────────────────────────────────────────────────────────────────
   mercury/scene.js — the parts of the world that are arithmetic.

   The picture is drawn by a shader on the graphics card, and a shader cannot
   be unit tested from a terminal. Everything the shader needs that ISN'T
   drawing lives here instead: where the camera is, which way a ray leaves it,
   where on the water your finger actually landed, and how hard to push the
   renderer to keep the frame rate up.

   Those are exactly the parts that go subtly wrong — a ripple that appears an
   inch from your finger, or a camera that flips over at the poles — and they
   are all pure functions of numbers, so they can be checked properly.
   ─────────────────────────────────────────────────────────────────────────── */

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** How far across the water the simulation texture reaches, in world units. */
export const WORLD = 9;

/* ── the camera ──────────────────────────────────────────────────────────── */

export const CAMERA = {
  minPitch: 0.06,      // radians above the surface
  maxPitch: 1.15,      // and below straight down
  minDist: 3.2,
  maxDist: 16,
  height: 1.05,        // what it looks at, above the water
};

/**
 * Move the camera by a drag, in pixels.
 *
 * Pitch is clamped rather than wrapped. Letting it pass the top looks like the
 * world flipping over, and letting it reach exactly zero puts the eye in the
 * plane of the water, where a mirror shows nothing at all and the screen goes
 * black for no reason the person dragging could possibly work out.
 */
export function orbit(cam, dx, dy, { speed = 0.005 } = {}) {
  return {
    ...cam,
    yaw: cam.yaw - dx * speed,
    pitch: clamp(cam.pitch - dy * speed, CAMERA.minPitch, CAMERA.maxPitch),
  };
}

/** Zoom, multiplicatively, so a notch feels the same at every distance. */
export function zoom(cam, factor) {
  return { ...cam, dist: clamp(cam.dist * factor, CAMERA.minDist, CAMERA.maxDist) };
}

/** Where the eye is, given the orbit. */
export function eyeOf(cam) {
  const cp = Math.cos(cam.pitch);
  return [
    Math.sin(cam.yaw) * cp * cam.dist,
    Math.sin(cam.pitch) * cam.dist + CAMERA.height,
    Math.cos(cam.yaw) * cp * cam.dist,
  ];
}

export const target = () => [0, CAMERA.height, 0];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * The direction a ray leaves the eye for a point on screen.
 *
 * `x` and `y` are in pixels from the top-left, which is what a pointer event
 * gives you — and the flip in the middle is the bug everybody writes at least
 * once, because screens count downwards and cameras count upwards.
 */
export function rayThrough(cam, x, y, width, height, { fov = 1.0 } = {}) {
  const eye = eyeOf(cam);
  const fwd = norm(sub(target(), eye));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);

  const aspect = width / Math.max(1, height);
  const u = (x / Math.max(1, width)) * 2 - 1;
  const v = 1 - (y / Math.max(1, height)) * 2;     // screens count down, cameras up
  const t = Math.tan(fov * 0.5);

  return norm([
    fwd[0] + right[0] * u * aspect * t + up[0] * v * t,
    fwd[1] + right[1] * u * aspect * t + up[1] * v * t,
    fwd[2] + right[2] * u * aspect * t + up[2] * v * t,
  ]);
}

/**
 * Where a ray meets the water, or null if it never does.
 *
 * Null rather than a number is deliberate: a ray aimed at the sky has no
 * answer, and returning a negative distance quietly puts a ripple *behind* the
 * camera, which looks like the water rippling on its own.
 */
export function hitWater(eye, dir, { y = 0 } = {}) {
  if (Math.abs(dir[1]) < 1e-6) return null;        // parallel to the surface
  const t = (y - eye[1]) / dir[1];
  if (t <= 0) return null;                          // behind the eye
  return [eye[0] + dir[0] * t, y, eye[2] + dir[2] * t];
}

/**
 * The point on the simulation texture a touch corresponds to, 0..1, or null.
 *
 * Also null when the hit is outside the simulated patch of water: pushing a
 * ripple in at the very edge makes it bounce straight back off the boundary,
 * which reads as a glitch rather than as a wave.
 */
export function touchToWater(cam, x, y, width, height, opts = {}) {
  const eye = eyeOf(cam);
  const dir = rayThrough(cam, x, y, width, height, opts);
  const hit = hitWater(eye, dir);
  if (!hit) return null;
  const u = hit[0] / (WORLD * 2) + 0.5;
  const v = hit[2] / (WORLD * 2) + 0.5;
  const m = 0.03;
  if (u < m || u > 1 - m || v < m || v > 1 - m) return null;
  return { u, v, world: hit };
}

/* ── keeping the frame rate up ───────────────────────────────────────────────
   The picture is traced per pixel, so the cost is almost exactly the number of
   pixels. Rather than pick a resolution and hope, it watches how long frames
   are taking and changes how many pixels it asks for. */

export const QUALITY = {
  min: 0.42,
  step: 0.08,
  slow: 1000 / 50,     // a frame longer than this is too slow
  fast: 1000 / 58,     // and shorter than this has room to spare
  patience: 26,        // frames of agreement before it moves
};

export function makeQuality(max = 1, q = QUALITY) {
  return { scale: max, max, avg: 16.7, agree: 0, rules: q };
}

/**
 * Feed it a frame time; it returns the scale to render at.
 *
 * Two things stop it oscillating, which is what makes this worth testing: the
 * frame time is smoothed, and it has to disagree with the current setting for
 * a stretch of frames before it moves. Without those it drops the resolution
 * on one slow frame, which makes the next frame fast, which puts it straight
 * back — and the picture visibly breathes.
 */
export function quality(state, ms) {
  const q = state.rules;
  const dt = Number.isFinite(ms) ? clamp(ms, 0, 200) : state.avg;
  const avg = state.avg * 0.9 + dt * 0.1;
  let { scale, agree } = state;

  const tooSlow = avg > q.slow && scale > q.min;
  const roomToSpare = avg < q.fast && scale < state.max;

  if (tooSlow) agree = agree > 0 ? agree + 1 : 1;
  else if (roomToSpare) agree = agree < 0 ? agree - 1 : -1;
  else agree = 0;

  if (agree >= q.patience) { scale = Math.max(q.min, scale - q.step); agree = 0; }
  if (agree <= -q.patience) { scale = Math.min(state.max, scale + q.step); agree = 0; }

  return { ...state, avg, scale, agree };
}

/* ── the waves ───────────────────────────────────────────────────────────────
   The shader solves this on the graphics card across a whole texture at once.
   This is the same rule written out one cell at a time, which is the only way
   to check that the numbers it is built on are stable — a wave simulation that
   is fractionally too energetic does not look slightly wrong, it explodes. */

export const WAVE = { speed: 0.42, damping: 0.996 };

/**
 * One step of the discrete wave equation on a square grid.
 *
 * `h` is the current height, `prev` the height one step ago. The edges are
 * held at zero, so a wave that reaches the boundary is absorbed rather than
 * reflected back through the middle of the picture.
 */
export function waveStep(h, prev, size, { speed = WAVE.speed, damping = WAVE.damping } = {}) {
  const out = new Float32Array(size * size);
  const c2 = speed * speed;
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x;
      const lap = h[i - 1] + h[i + 1] + h[i - size] + h[i + size] - 4 * h[i];
      out[i] = (2 * h[i] - prev[i] + c2 * lap) * damping;
    }
  }
  return out;
}

/** Push the surface down at a point, with a soft edge so it reads as a drop. */
export function drop(h, size, u, v, { radius = 0.045, strength = 1 } = {}) {
  const cx = u * size, cy = v * size;
  const r = radius * size;
  for (let y = Math.max(0, (cy - r) | 0); y < Math.min(size, cy + r + 1); y++) {
    for (let x = Math.max(0, (cx - r) | 0); x < Math.min(size, cx + r + 1); x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d > 1) continue;
      const falloff = 0.5 + 0.5 * Math.cos(d * Math.PI);
      h[y * size + x] -= strength * falloff;
    }
  }
  return h;
}
