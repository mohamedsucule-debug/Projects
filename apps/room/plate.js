/* ───────────────────────────────────────────────────────────────────────────
   room/plate.js — the illustration.

   A pen-and-ink plate of the study, of the sort that used to sit opposite the
   title page of a crime novel. Ink on laid paper, one-point perspective, and
   cross-hatching where it is dark.

   Line art rather than a rendering, and that is a decision rather than a dodge:
   an interior is furniture, and furniture drawn as shaded solids either needs a
   modelling pipeline or looks like a pile of boxes. Ink describes a chair with
   six lines and lets the reader do the rest — which is also why every
   illustrator in 1935 was drawing rooms and nobody was painting them.

   THE IMPORTANT PART is `at()`. Nothing here is positioned in screen
   coordinates. Everything is placed in the room — across, back, and up — and
   projected. The first version of this file put furniture straight onto the
   canvas at eyeballed positions, and the result was a convincing empty room
   with a desk hovering in the middle of it and a fireplace flat against a wall
   it was not on. Perspective is not something you can approximate by moving
   things around until they look right; either every object shares one
   projection or none of them do.
   ─────────────────────────────────────────────────────────────────────────── */

export const INK = '#2b2219';
export const PAPER = '#e9e1d0';

const INK_RGB = [43, 34, 25];
const PAPER_RGB = [233, 225, 208];

/**
 * A flat opaque tone: the paper, `k` of the way towards the ink.
 *
 * Opaque, and that is the point. Every fill here was a translucent tint at
 * first, which looks like a perfectly reasonable way to suggest ink wash — and
 * it means nothing can ever hide anything. The desk showed the fireplace
 * through it, the pedestals showed the rug through them, and the whole plate
 * read as a wireframe. A 2D canvas has no depth buffer; the only thing that
 * puts one object in front of another is drawing it later, in something you
 * cannot see through.
 */
export function tone(k) {
  const c = INK_RGB.map((ink, i) => Math.round(PAPER_RGB[i] + (ink - PAPER_RGB[i]) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** The same, towards white — glass, paper, a lampshade seen from inside. */
export function pale(k) {
  const c = PAPER_RGB.map((p) => Math.round(p + (255 - p) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/* ── the projection ──────────────────────────────────────────────────────────
   One-point perspective, with the camera in the doorway.

     u  across the room, 0 at the left wall and 1 at the right
     d  away from the camera, 0 at the near edge and 1 at the back wall
     h  up, 0 on the floor and 1 at the ceiling

   Everything shrinks by 1/(1 + Q·d), which is what perspective is; the room's
   whole geometry falls out of that one number, including where the vanishing
   point has to be for the walls to meet the back wall in the right place. */

const Q = 1.538;                 // the back wall ends up 0.394 the size of the near edge
const NEAR = { w: 1.04, floor: 1.06, ceil: -0.02 };
const VY = 0.3504;               // the horizon, derived from the above, not chosen

export function scaleAt(d) { return 1 / (1 + Q * d); }

/** A point in the room → a point on the page. */
export function at(u, d, h) {
  const s = scaleAt(d);
  const floor = VY + (NEAR.floor - VY) * s;
  const ceil = VY + (NEAR.ceil - VY) * s;
  return [0.5 + (u - 0.5) * NEAR.w * s, floor + h * (ceil - floor)];
}

/* Where each clue sits, in room coordinates. This lives with the drawing
   rather than with the story: the case file says what a thing means, and the
   plate says where it is, so a clue and the thing you click can never drift
   apart by being written down twice. */
export const ANCHORS = {
  door:       [0.005, 0.46, 0.34],
  coat:       [0.02, 0.90, 0.60],
  fire:       [0.235, 1.00, 0.20],
  scrap:      [0.240, 1.00, 0.045],
  clock:      [0.240, 1.00, 0.63],
  'clock-back': [0.335, 1.00, 0.60],
  window:     [0.995, 0.64, 0.58],
  flowerbed:  [0.995, 0.50, 0.30],
  desk:       [0.700, 0.42, 0.24],
  drawer:     [0.375, 0.42, 0.155],
  will:       [0.335, 0.30, 0.10],
  blotter:    [0.525, 0.53, 0.285],
  diary:      [0.690, 0.565, 0.29],
  glass:      [0.598, 0.44, 0.315],
  decanter:   [0.880, 0.56, 0.31],
  body:       [0.520, 0.66, 0.40],
  hands:      [0.425, 0.56, 0.285],
  pocket:     [0.640, 0.735, 0.40],
  rug:        [0.470, 0.26, 0.005],
};

/** The clue anchors, in page coordinates. */
export function anchors() {
  const out = {};
  for (const [id, [u, d, h]] of Object.entries(ANCHORS)) {
    const [x, y] = at(u, d, h);
    out[id] = { x, y };
  }
  return out;
}

/* ── the pen ─────────────────────────────────────────────────────────────── */

function make(ctx, W, H) {
  const S = Math.min(W, H);
  const P = (p) => [p[0] * W, p[1] * H];

  let seed = 1;
  const wob = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };

  const pen = (w, a) => {
    ctx.strokeStyle = a >= 1 ? INK : `rgba(43,34,25,${a})`;
    ctx.lineWidth = Math.max(0.4, w * (S / 620));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };

  /* Ink drawn by a hand wobbles, and a page of geometrically perfect lines
     reads as a CAD plot rather than an illustration. Each segment is broken up
     and nudged from a fixed seed, so the room does not shiver between frames. */
  function seg(a, b, w = 1, alpha = 1) {
    pen(w, alpha);
    const [x0, y0] = P(a), [x1, y1] = P(b);
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(2, Math.min(8, Math.round(len / 30)));
    const j = Math.min(1.4, len / 170) * (S / 620);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, n = i === steps ? 0 : j;
      ctx.lineTo(x0 + (x1 - x0) * t + wob() * n, y0 + (y1 - y0) * t + wob() * n);
    }
    ctx.stroke();
  }

  const outline = (pts, w = 1, a = 1) => { for (let i = 0; i < pts.length - 1; i++) seg(pts[i], pts[i + 1], w, a); };
  const loop = (pts, w = 1, a = 1) => outline([...pts, pts[0]], w, a);

  function trace(pts) {
    ctx.beginPath();
    ctx.moveTo(...P(pts[0]));
    for (const p of pts.slice(1)) ctx.lineTo(...P(p));
    ctx.closePath();
  }
  const fill = (pts, style) => { trace(pts); ctx.fillStyle = style; ctx.fill(); };

  /** Cross-hatching clipped to a shape — how ink gets darker with one colour. */
  function hatch(pts, angle, density = 0.012, a = 0.45, cross = false) {
    ctx.save();
    trace(pts); ctx.clip();
    const step = density * S, diag = Math.hypot(W, H);
    const pass = (ang) => {
      pen(0.65, a);
      const dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx;
      ctx.beginPath();
      for (let k = -diag; k < diag; k += step) {
        const cx = W / 2 + nx * k, cy = H / 2 + ny * k;
        ctx.moveTo(cx - dx * diag, cy - dy * diag);
        ctx.lineTo(cx + dx * diag, cy + dy * diag);
      }
      ctx.stroke();
    };
    pass(angle);
    if (cross) pass(angle + Math.PI / 2.4);
    ctx.restore();
  }

  function dot(p, r, style = INK) {
    const [x, y] = P(p);
    ctx.fillStyle = style;
    ctx.beginPath(); ctx.arc(x, y, r * S, 0, 6.2832); ctx.fill();
  }

  function ring(p, rx, ry, a = 0.45) {
    const [x, y] = P(p);
    ctx.strokeStyle = `rgba(43,34,25,${a})`;
    ctx.lineWidth = 0.7 * (S / 620);
    ctx.beginPath(); ctx.ellipse(x, y, rx * S, ry * S, 0, 0, 6.2832); ctx.stroke();
  }

  return { S, seg, outline, loop, fill, hatch, dot, ring, pen, P, reset: () => { seed = 1; } };
}

/**
 * A rectangular slab lying flat in the room — a desk top, a rug, a table.
 * Four corners at the same height, projected.
 */
const slab = (u0, u1, d0, d1, h) => [at(u0, d1, h), at(u1, d1, h), at(u1, d0, h), at(u0, d0, h)];

/** The front face of a box: its near top edge down to the floor. */
const face = (u0, u1, d, hTop, hBot = 0) => [at(u0, d, hTop), at(u1, d, hTop), at(u1, d, hBot), at(u0, d, hBot)];

/** A panel flat against a side wall, between two depths. */
const wallPanel = (u, d0, d1, h0, h1) => [at(u, d0, h1), at(u, d1, h1), at(u, d1, h0), at(u, d0, h0)];

/** A panel flat against the back wall. */
const backPanel = (u0, u1, h0, h1) => [at(u0, 1, h1), at(u1, 1, h1), at(u1, 1, h0), at(u0, 1, h0)];

export function drawRoom(ctx, W, H) {
  const g = make(ctx, W, H);
  const { seg, outline, loop, fill, hatch, dot, ring } = g;
  g.reset();

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);

  /* Desk height, hoisted: the arms lie on the desk but the body is drawn
     before it, so both need the number before either is reached. */
  const DT = 0.285;

  /* ── the shell ────────────────────────────────────────────────────────── */
  const bTL = at(0, 1, 1), bTR = at(1, 1, 1), bBR = at(1, 1, 0), bBL = at(0, 1, 0);
  const nTL = at(0, 0, 1), nTR = at(1, 0, 1), nBR = at(1, 0, 0), nBL = at(0, 0, 0);

  fill([bBL, bBR, nBR, nBL], tone(0.055));   // floor
  fill([bTL, bBL, nBL, nTL], tone(0.085));   // left wall
  fill([bTR, bBR, nBR, nTR], tone(0.035));   // right wall
  fill([bTL, bTR, nTR, nTL], tone(0.022));   // ceiling

  seg(bTL, nTL, 1.1); seg(bTR, nTR, 1.1); seg(bBR, nBR, 1.1); seg(bBL, nBL, 1.1);
  loop([bTL, bTR, bBR, bBL], 1.3);

  // floorboards running away from the camera, and the joins across them
  for (let i = 1; i < 10; i++) {
    const u = i / 10;
    seg(at(u, 1, 0), at(u, -0.08, 0), 0.6, 0.34);
  }
  for (const d of [0.22, 0.46, 0.72]) seg(at(-0.06, d, 0), at(1.06, d, 0), 0.6, 0.22);

  // a dado rail all the way round, which is what tells you it is one room
  const RAIL = 0.42;
  seg(at(0, 1, RAIL), at(1, 1, RAIL), 0.8, 0.5);
  seg(at(0, 1, RAIL), at(0, -0.05, RAIL), 0.8, 0.4);
  seg(at(1, 1, RAIL), at(1, -0.05, RAIL), 0.8, 0.4);
  for (let i = 1; i < 6; i++) seg(at(i / 6, 1, RAIL), at(i / 6, 1, 0), 0.6, 0.26);
  for (const d of [0.25, 0.55, 0.85]) {
    seg(at(0, d, RAIL), at(0, d, 0), 0.6, 0.24);
    seg(at(1, d, RAIL), at(1, d, 0), 0.6, 0.2);
  }

  /* Everything from here on is drawn back to front. There is no z-buffer in a
     2D context: the only thing that decides what is in front of what is the
     order the calls go in. Drawing the desk before the chair behind it put a
     dead man in front of his own furniture — and it looked, at a glance, like
     a slightly odd drawing rather than a bug, which is how it survived a
     first look. */

  /* ── the rug ──────────────────────────────────────────────────────────── */
  const rug = slab(0.14, 0.86, 0.08, 0.46, 0.002);
  fill(rug, tone(0.075)); loop(rug, 1.1);
  const inner = slab(0.19, 0.81, 0.13, 0.41, 0.003);
  loop(inner, 0.7, 0.4);
  hatch(inner, 0.5, 0.016, 0.24);
  // the folded corner, and the drag mark going to the door
  outline([at(0.14, 0.46, 0.002), at(0.21, 0.455, 0.002), at(0.175, 0.40, 0.002)], 1);
  seg(at(0.30, 0.30, 0.003), at(0.06, 0.40, 0.003), 0.8, 0.35);

  /* ── the door, on the left wall ───────────────────────────────────────── */
  const door = wallPanel(0.004, 0.30, 0.64, 0, 0.72);
  fill(door, tone(0.06));
  loop(door, 1.2);
  loop(wallPanel(0.006, 0.335, 0.605, 0.40, 0.68), 0.7, 0.45);
  loop(wallPanel(0.006, 0.335, 0.605, 0.055, 0.36), 0.7, 0.45);
  dot(at(0.008, 0.335, 0.37), 0.006);
  // the gap underneath, which is a clue and wants to be visible
  seg(at(0.004, 0.30, 0.012), at(0.004, 0.64, 0.012), 1.4);

  /* ── the fireplace, back wall left ────────────────────────────────────── */
  const chimney = backPanel(0.13, 0.40, 0, 0.56);
  fill(chimney, tone(0.05));
  loop(chimney, 1.1);
  // the mantel shelf, standing a little proud
  const mantel = [at(0.12, 1, 0.575), at(0.415, 1, 0.575), at(0.415, 0.955, 0.565), at(0.12, 0.955, 0.565)];
  fill(mantel, tone(0.10)); loop(mantel, 1.1);
  seg(at(0.12, 1, 0.545), at(0.415, 1, 0.545), 0.8, 0.6);
  // the opening, swept and cold
  const grate = backPanel(0.185, 0.345, 0.03, 0.375);
  fill(grate, tone(0.42));
  hatch(grate, 1.15, 0.008, 0.5, true);
  loop(grate, 1);
  seg(at(0.195, 1, 0.055), at(0.335, 1, 0.055), 0.8, 0.75);
  // the scorched corner of paper at the back of it
  outline([at(0.225, 1, 0.045), at(0.252, 1, 0.062), at(0.246, 1, 0.032)], 0.9, 0.85);

  /* the clock on the mantel */
  const clock = backPanel(0.205, 0.275, 0.585, 0.675);
  fill(clock, pale(0.35)); loop(clock, 1);
  outline([at(0.198, 1, 0.675), at(0.24, 1, 0.712), at(0.282, 1, 0.675)], 1);
  const [cx, cy] = at(0.24, 1, 0.628);
  ctx.strokeStyle = INK; ctx.lineWidth = 0.9 * (g.S / 620);
  ctx.beginPath(); ctx.arc(cx * W, cy * H, g.S * 0.0145, 0, 6.2832); ctx.stroke();
  seg(at(0.24, 1, 0.628), at(0.24, 1, 0.652), 0.9);       // ten past
  seg(at(0.24, 1, 0.628), at(0.218, 1, 0.636), 0.9);

  /* ── the window, right wall ───────────────────────────────────────────── */
  const win = wallPanel(0.996, 0.46, 0.88, 0.34, 0.80);
  fill(win, pale(0.62));
  hatch(win, 1.25, 0.011, 0.26);
  loop(win, 1.2);
  seg(at(0.996, 0.67, 0.34), at(0.996, 0.67, 0.80), 0.8, 0.65);
  seg(at(0.996, 0.46, 0.57), at(0.996, 0.88, 0.57), 0.8, 0.65);
  // the sill
  const sill = [at(0.996, 0.44, 0.34), at(0.996, 0.90, 0.34), at(0.93, 0.90, 0.325), at(0.93, 0.44, 0.325)];
  fill(sill, tone(0.10)); loop(sill, 1.1);
  // a curtain at the near edge
  const curt = wallPanel(0.985, 0.36, 0.47, 0.30, 0.84);
  fill(curt, tone(0.07));
  hatch(curt, 1.5, 0.009, 0.4);
  loop(curt, 1);

  /* ── the chair, and Edmund forward in it ───────────────────────────────
     A man slumped over a desk is his head on the blotter and his shoulders
     behind and above it. The first attempt put the head at the desk's far
     edge and *below* the shoulders, which drew something between a filing
     cabinet and a hot-air balloon. */
  const back = face(0.455, 0.615, 0.80, 0.62, 0.30);
  fill(back, tone(0.10)); loop(back, 1.1);
  for (const u of [0.494, 0.535, 0.576]) seg(at(u, 0.80, 0.605), at(u, 0.80, 0.315), 0.7, 0.4);
  seg(at(0.468, 0.80, 0.30), at(0.468, 0.80, 0.02), 1);
  seg(at(0.602, 0.80, 0.30), at(0.602, 0.80, 0.02), 1);

  // shoulders: behind the desk's far edge, and higher than the head
  const torso = [at(0.455, 0.72, 0.50), at(0.612, 0.72, 0.50), at(0.596, 0.63, 0.355), at(0.470, 0.63, 0.355)];
  fill(torso, tone(0.34));
  hatch(torso, 1.3, 0.009, 0.45, true);
  loop(torso, 1.2);

  /* ── the side table, right, with the decanter on it ───────────────────── */
  const T = 0.30;
  const tTop = slab(0.80, 0.97, 0.50, 0.63, T);
  fill(tTop, tone(0.11)); loop(tTop, 1.1);
  for (const [u, d] of [[0.805, 0.50], [0.965, 0.50], [0.965, 0.63]]) seg(at(u, d, T), at(u, d, 0), 1);
  // two rings in the dust, only one glass
  ring(at(0.855, 0.545, T), 0.011, 0.004);
  ring(at(0.915, 0.60, T), 0.011, 0.004, 0.32);
  // the decanter
  outline([
    at(0.865, 0.56, T), at(0.862, 0.56, T + 0.055), at(0.872, 0.56, T + 0.075),
    at(0.890, 0.56, T + 0.075), at(0.898, 0.56, T + 0.055), at(0.895, 0.56, T),
  ], 1.1);
  seg(at(0.865, 0.56, T + 0.028), at(0.895, 0.56, T + 0.028), 0.7, 0.45);
  outline([at(0.873, 0.56, T + 0.075), at(0.874, 0.56, T + 0.093), at(0.886, 0.56, T + 0.093), at(0.887, 0.56, T + 0.075)], 1);

  /* ── the desk ─────────────────────────────────────────────────────────── */
  const dTop = slab(0.28, 0.75, 0.40, 0.62, DT);
  fill(dTop, tone(0.13)); loop(dTop, 1.2);
  /* A shallow apron under the top, and two pedestals with daylight between
     them. Running the front face all the way to the floor made a solid crate
     the width of the room that hid the rug, the chair legs and half the
     floorboards — which is what a desk is not. */
  const APRON = DT - 0.055;
  const apron = face(0.28, 0.75, 0.40, DT, APRON);
  fill(apron, tone(0.20));
  loop(apron, 1.1);

  for (const [pu0, pu1] of [[0.295, 0.435], [0.595, 0.735]]) {
    const ped = face(pu0, pu1, 0.40, APRON, 0);
    fill(ped, tone(0.24));
    hatch(ped, 1.35, 0.013, 0.30);
    loop(ped, 1.05);
    // the side of each pedestal, receding
    const side = [at(pu1, 0.40, APRON), at(pu1, 0.60, APRON), at(pu1, 0.60, 0), at(pu1, 0.40, 0)];
    fill(side, tone(0.14));
    loop(side, 0.8, 0.5);
  }
  // the locked drawer in the left pedestal
  loop(face(0.312, 0.418, 0.398, APRON - 0.022, APRON - 0.092), 0.9, 0.85);
  dot(at(0.365, 0.396, APRON - 0.057), 0.0045);

  /* things on the desk */
  const blot = slab(0.44, 0.62, 0.47, 0.59, DT + 0.002);
  fill(blot, pale(0.68)); loop(blot, 0.9);
  const diary = slab(0.635, 0.735, 0.49, 0.60, DT + 0.003);
  fill(diary, pale(0.82)); loop(diary, 0.9);
  seg(at(0.685, 0.49, DT + 0.004), at(0.685, 0.60, DT + 0.004), 0.7, 0.55);
  // the pen, on his left
  seg(at(0.375, 0.50, DT + 0.002), at(0.425, 0.545, DT + 0.002), 1);
  // the glass, on his right — which is the whole case
  outline([
    at(0.598, 0.465, DT), at(0.597, 0.465, DT + 0.042),
    at(0.623, 0.465, DT + 0.042), at(0.622, 0.465, DT),
  ], 1);
  fill([at(0.598, 0.465, DT), at(0.622, 0.465, DT), at(0.6215, 0.465, DT + 0.016), at(0.5985, 0.465, DT + 0.016)], tone(0.28));
  ring(at(0.610, 0.465, DT + 0.042), 0.0125, 0.0035, 0.55);

  /* His head and his arms rest ON the desk, so they are drawn after it. The
     chair and his shoulders are behind it and were drawn before. Splitting one
     figure across the thing it is lying on is the whole of painter's-order
     drawing, and it is also exactly how it looks from here. */
  // the back of his head, down on the blotter, turned away from us
  const [hx, hy] = at(0.533, 0.545, 0.322);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(hx * W, hy * H, g.S * 0.027, g.S * 0.019, -0.22, 0, 6.2832);
  ctx.fillStyle = tone(0.42); ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 1.2 * (g.S / 620); ctx.stroke();
  ctx.restore();
  // a collar between the two, so the head belongs to the shoulders
  outline([at(0.487, 0.625, 0.370), at(0.533, 0.585, 0.335), at(0.582, 0.625, 0.366)], 1);
  // both arms out along the desk, the left one nearer the pen
  const armL = [at(0.466, 0.685, 0.395), at(0.415, 0.60, DT + 0.014), at(0.400, 0.535, DT + 0.012), at(0.440, 0.512, DT + 0.012), at(0.478, 0.605, DT + 0.06)];
  fill(armL, tone(0.30)); loop(armL, 1.2);
  const armR = [at(0.602, 0.685, 0.395), at(0.652, 0.60, DT + 0.014), at(0.664, 0.545, DT + 0.012), at(0.626, 0.522, DT + 0.012), at(0.590, 0.605, DT + 0.06)];
  fill(armR, tone(0.30)); loop(armR, 1.2);


  /* the lamp */
  const LH = DT + 0.10;
  outline([at(0.325, 0.55, DT), at(0.335, 0.55, DT + 0.05), at(0.348, 0.55, DT + 0.05), at(0.358, 0.55, DT)], 1.1);
  const shade = [at(0.305, 0.55, DT + 0.05), at(0.378, 0.55, DT + 0.05), at(0.362, 0.55, LH), at(0.321, 0.55, LH)];
  fill(shade, tone(0.15)); loop(shade, 1.2);

  /* ── the coat stand, near left ────────────────────────────────────────── */
  /* Further back and narrower than it was. At d = 0.14 the perspective made it
     nearly as tall as the room and it covered the door, which is another
     clickable thing — two clues cannot share the same few pixels. */
  /* Near right. It stood in the doorway at first, on top of another thing the
     player has to be able to click — and two clues cannot share the same few
     pixels however good the drawing is. */
  /* Back-left corner, beside the chimney breast. It has now been in three
     places: the doorway, the near-right corner in front of the window, and
     here. The test the others failed is not how it looked — it is that its
     hotspot landed within a few pixels of another clue's, and two things a
     player has to be able to click cannot sit on top of each other. */
  const CD = 0.90, CU = 0.02;
  seg(at(CU, CD, 0), at(CU, CD, 0.88), 1.3);
  outline([at(CU - 0.066, CD, 0.015), at(CU, CD, 0.045), at(CU + 0.066, CD, 0.015)], 1.1);
  seg(at(CU - 0.060, CD, 0.862), at(CU + 0.060, CD, 0.862), 1.1);
  dot(at(CU - 0.060, CD, 0.868), 0.0045);
  dot(at(CU + 0.060, CD, 0.868), 0.0045);
  // Edmund's coat, and under it one that is not his
  const coatA = [
    at(CU - 0.020, CD, 0.845), at(CU - 0.066, CD, 0.775), at(CU - 0.055, CD, 0.58),
    at(CU - 0.050, CD, 0.34), at(CU + 0.020, CD, 0.335), at(CU + 0.022, CD, 0.58),
    at(CU + 0.024, CD, 0.78),
  ];
  fill(coatA, tone(0.10));
  hatch(coatA, 1.4, 0.010, 0.44);
  loop(coatA, 1.1);
  const coatB = [
    at(CU + 0.024, CD, 0.835), at(CU + 0.024, CD, 0.76), at(CU + 0.024, CD, 0.60),
    at(CU + 0.020, CD, 0.44), at(CU + 0.068, CD, 0.445), at(CU + 0.066, CD, 0.60),
    at(CU + 0.058, CD, 0.775),
  ];
  fill(coatB, tone(0.055));
  hatch(coatB, 0.9, 0.013, 0.28);
  loop(coatB, 1.1);

  /* ── one lamp, and what it does to a room ─────────────────────────────── */
  const [lx, ly] = at(0.341, 0.55, LH - 0.02);
  const glow = ctx.createRadialGradient(lx * W, ly * H, 0, lx * W, ly * H, g.S * 0.46);
  glow.addColorStop(0, 'rgba(255,226,154,.42)');
  glow.addColorStop(0.32, 'rgba(255,214,140,.15)');
  glow.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const vig = ctx.createRadialGradient(W * 0.45, H * 0.52, g.S * 0.24, W * 0.45, H * 0.52, g.S * 1.0);
  vig.addColorStop(0, 'rgba(43,34,25,0)');
  vig.addColorStop(1, 'rgba(43,34,25,.36)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  /* ── laid paper ───────────────────────────────────────────────────────── */
  ctx.save();
  ctx.globalAlpha = 0.045;
  ctx.strokeStyle = '#6b5a42'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = 0; y < H; y += 3) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  ctx.restore();
}
