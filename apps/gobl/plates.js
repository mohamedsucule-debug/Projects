/* ───────────────────────────────────────────────────────────────────────────
   gobl/plates.js — the photographs, except there are no photographs.

   A food app is mostly pictures of food, and there are exactly three ways to
   get them: take them, take somebody else's, or draw them. The first is not
   available to a browser tab with no backend, the second is theft, and the
   third is what this is — every plate on screen is drawn on a canvas from a
   seed, so the repository contains no image files at all and the app works
   with the network switched off.

   They are not photographs and are not trying to fool anyone into thinking
   they are. What they have to do is be *legible at 180 pixels* — you should
   know at a glance that this one is a bowl of ramen and that one is a slice of
   pizza — and be warm rather than flat, because a grid of hard-edged vector
   icons looks like a menu system and not like dinner.

   Three things do most of the warmth:
     · nothing is a perfect circle. Every plate, every piece of food goes
       through `blob`, which pushes the radius around slightly as it draws.
     · everything is lit from the top left, with a soft highlight on the
       vessel and a contact shadow underneath it.
     · a fine grain and a vignette go over the whole thing at the end, which is
       the difference between "drawn in a browser" and "photographed badly".

   The seed is the dish id, so a dish looks the same every time you see it —
   which matters more than it sounds, because a picture that reshuffles on
   every render reads as broken.
   ─────────────────────────────────────────────────────────────────────────── */

/** Deterministic, cheap, and good enough that no two plates rhyme. */
export function rng(seed) {
  let a = typeof seed === 'string'
    ? [...seed].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0, 0x9e3779b9)
    : seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;

/** An almost-circle. `wobble` is how far the radius is allowed to wander. */
function blob(c, x, y, r, wobble, R, points = 14) {
  c.beginPath();
  const offs = Array.from({ length: points }, () => 1 + (R() - 0.5) * wobble);
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * TAU;
    const rr = r * offs[i % points];
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (i === 0) c.moveTo(px, py);
    else {
      const pa = ((i - 1) / points) * TAU;
      const pr = r * offs[(i - 1) % points];
      const cx = x + Math.cos((a + pa) / 2) * pr * 1.06;
      const cy = y + Math.sin((a + pa) / 2) * pr * 1.06;
      c.quadraticCurveTo(cx, cy, px, py);
    }
  }
  c.closePath();
}

const fillBlob = (c, x, y, r, wobble, R, colour, points) => {
  blob(c, x, y, r, wobble, R, points);
  c.fillStyle = colour;
  c.fill();
};

/* ── surfaces ──────────────────────────────────────────────────────────── */

const SURFACES = [
  { id: 'walnut', base: '#4a3526', grain: 'rgba(28,18,10,.5)',  light: 'rgba(255,220,170,.07)' },
  { id: 'slate',  base: '#2f3336', grain: 'rgba(12,14,16,.55)', light: 'rgba(220,235,255,.05)' },
  { id: 'linen',  base: '#d9cfbd', grain: 'rgba(150,135,112,.3)', light: 'rgba(255,255,255,.25)' },
  { id: 'marble', base: '#e5e2dc', grain: 'rgba(120,120,125,.22)', light: 'rgba(255,255,255,.4)' },
  { id: 'steel',  base: '#5a5f63', grain: 'rgba(24,26,28,.4)', light: 'rgba(230,240,255,.08)' },
];

function surface(c, w, h, R) {
  const s = SURFACES[Math.floor(R() * SURFACES.length)];
  c.fillStyle = s.base;
  c.fillRect(0, 0, w, h);

  if (s.id === 'walnut') {
    for (let y = 0; y < h; y += h / 5) {
      c.strokeStyle = s.grain; c.lineWidth = 1.4;
      c.beginPath();
      for (let x = 0; x <= w; x += 8) c.lineTo(x, y + Math.sin(x * 0.04 + y) * 2.2);
      c.stroke();
    }
    for (let i = 0; i < 140; i++) {
      c.fillStyle = R() > 0.5 ? s.grain : s.light;
      c.fillRect(R() * w, R() * h, 18 + R() * 40, 0.8);
    }
  } else if (s.id === 'marble') {
    for (let i = 0; i < 7; i++) {
      c.strokeStyle = s.grain; c.lineWidth = 0.6 + R() * 1.6;
      c.beginPath();
      let x = R() * w, y = -10;
      c.moveTo(x, y);
      while (y < h + 10) { x += (R() - 0.5) * 34; y += 12; c.lineTo(x, y); }
      c.stroke();
    }
  } else {
    for (let i = 0; i < 900; i++) {
      c.fillStyle = R() > 0.5 ? s.grain : s.light;
      c.fillRect(R() * w, R() * h, 1.6, 1.6);
    }
  }
  return s;
}

/* ── vessels ───────────────────────────────────────────────────────────── */

function contactShadow(c, x, y, r) {
  const g = c.createRadialGradient(x, y + r * 0.16, r * 0.3, x, y + r * 0.16, r * 1.3);
  g.addColorStop(0, 'rgba(0,0,0,.42)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.beginPath(); c.ellipse(x, y + r * 0.14, r * 1.24, r * 1.1, 0, 0, TAU); c.fill();
}

function ceramic(c, x, y, r, R, { tone = '#f3efe7', rim = 0.82, inner = '#e8e2d6' } = {}) {
  contactShadow(c, x, y, r);
  fillBlob(c, x, y, r, 0.02, R, tone, 22);
  /* The rim is where a drawn plate stops looking like a white circle. */
  fillBlob(c, x, y, r * rim, 0.02, R, inner, 22);
  const g = c.createLinearGradient(x - r, y - r, x + r, y + r);
  g.addColorStop(0, 'rgba(255,255,255,.4)');
  g.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,.12)');
  blob(c, x, y, r, 0.02, rng('rimlight' + r), 22);
  c.fillStyle = g; c.fill();
}

function bowl(c, x, y, r, R, { outer = '#20242b', inner = '#171a20' } = {}) {
  contactShadow(c, x, y, r);
  fillBlob(c, x, y, r, 0.015, R, outer, 24);
  fillBlob(c, x, y, r * 0.88, 0.015, R, inner, 24);
  const g = c.createLinearGradient(x - r, y - r, x + r * 0.4, y + r);
  g.addColorStop(0, 'rgba(255,255,255,.22)');
  g.addColorStop(0.5, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  blob(c, x, y, r, 0.015, rng('bowllight'), 24); c.fill();
}

function board(c, x, y, r, R) {
  contactShadow(c, x, y, r);
  c.save();
  c.translate(x, y); c.rotate((R() - 0.5) * 0.14);
  c.fillStyle = '#8a6440';
  c.beginPath(); c.roundRect(-r * 1.1, -r * 0.88, r * 2.2, r * 1.76, r * 0.12); c.fill();
  c.fillStyle = 'rgba(60,38,20,.25)';
  for (let i = -3; i <= 3; i++) c.fillRect(-r * 1.1, i * r * 0.25, r * 2.2, 1.2);
  c.restore();
}

/* ── food ──────────────────────────────────────────────────────────────────
   One function per archetype. They are deliberately short and deliberately
   specific: the difference between "brown circle" and "a bowl of ramen" is
   about nine lines of noodles, an egg cut in half, and a nori rectangle. */

const speckle = (c, x, y, r, R, colours, n = 40, size = 2.4) => {
  for (let i = 0; i < n; i++) {
    const a = R() * TAU, d = Math.sqrt(R()) * r;
    c.fillStyle = colours[Math.floor(R() * colours.length)];
    c.beginPath();
    c.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d, size * (0.6 + R()), size * (0.6 + R()), R() * TAU, 0, TAU);
    c.fill();
  }
};

const noodles = (c, x, y, r, R, colour) => {
  c.strokeStyle = colour; c.lineCap = 'round';
  for (let i = 0; i < 16; i++) {
    c.lineWidth = 2.6 + R() * 1.4;
    const a = R() * TAU, d = R() * r * 0.6;
    const sx = x + Math.cos(a) * d, sy = y + Math.sin(a) * d;
    c.beginPath(); c.moveTo(sx, sy);
    c.bezierCurveTo(sx + (R() - 0.5) * r, sy + (R() - 0.5) * r,
      sx + (R() - 0.5) * r, sy + (R() - 0.5) * r,
      x + (R() - 0.5) * r * 1.2, y + (R() - 0.5) * r * 1.2);
    c.stroke();
  }
};

const eggHalf = (c, x, y, r, R) => {
  fillBlob(c, x, y, r, 0.06, R, '#f7f1e2', 16);
  fillBlob(c, x, y, r * 0.52, 0.08, R, '#f0a324', 14);
  c.fillStyle = 'rgba(255,255,255,.35)';
  c.beginPath(); c.ellipse(x - r * 0.2, y - r * 0.24, r * 0.16, r * 0.1, -0.5, 0, TAU); c.fill();
};

const herbs = (c, x, y, r, R, n = 16) => {
  for (let i = 0; i < n; i++) {
    const a = R() * TAU, d = Math.sqrt(R()) * r;
    c.save();
    c.translate(x + Math.cos(a) * d, y + Math.sin(a) * d);
    c.rotate(R() * TAU);
    c.fillStyle = ['#4e7a33', '#6f9a44', '#3d6128'][Math.floor(R() * 3)];
    c.beginPath(); c.ellipse(0, 0, 3.4 + R() * 2.6, 1.5 + R(), 0, 0, TAU); c.fill();
    c.restore();
  }
};

const DISHES = {
  ramen(c, x, y, r, R) {
    bowl(c, x, y, r, R, { outer: '#2b1f1c', inner: '#7a4a22' });
    fillBlob(c, x, y, r * 0.84, 0.02, R, '#c98b3e', 20);
    noodles(c, x, y, r * 0.78, R, '#f2d79a');
    eggHalf(c, x - r * 0.34, y + r * 0.22, r * 0.24, R);
    c.save(); c.translate(x + r * 0.3, y - r * 0.3); c.rotate(-0.4);
    c.fillStyle = '#1b1f24'; c.fillRect(-r * 0.22, -r * 0.3, r * 0.44, r * 0.6); c.restore();
    fillBlob(c, x + r * 0.26, y + r * 0.34, r * 0.2, 0.2, R, '#d8b28c', 12);
    herbs(c, x, y, r * 0.7, R, 12);
    speckle(c, x, y, r * 0.8, R, ['rgba(255,220,150,.5)', 'rgba(120,60,20,.4)'], 26, 1.6);
  },
  noodles(c, x, y, r, R) {
    bowl(c, x, y, r, R, { outer: '#242a2e', inner: '#39413f' });
    noodles(c, x, y, r * 0.74, R, '#e8cf94');
    fillBlob(c, x + r * 0.3, y + r * 0.26, r * 0.22, 0.25, R, '#7a3f2a', 12);
    herbs(c, x, y, r * 0.66, R, 14);
  },
  stew(c, x, y, r, R) {
    bowl(c, x, y, r, R, { outer: '#e8e3d8', inner: '#c8c1b2' });
    fillBlob(c, x, y, r * 0.8, 0.03, R, '#2f5c2c', 20);
    speckle(c, x, y, r * 0.7, R, ['#3f7a34', '#7a3b1e', '#d8c07a'], 40, 3.4);
    c.fillStyle = 'rgba(255,240,180,.22)';
    c.beginPath(); c.ellipse(x - r * 0.2, y - r * 0.2, r * 0.3, r * 0.16, -0.5, 0, TAU); c.fill();
  },
  curry(c, x, y, r, R) {
    bowl(c, x, y, r, R, { outer: '#eae5d9', inner: '#cfc7b6' });
    fillBlob(c, x, y, r * 0.8, 0.04, R, '#c4611d', 20);
    speckle(c, x, y, r * 0.66, R, ['#8c3c10', '#e08a33', '#f3e3c0'], 34, 3.6);
    herbs(c, x, y, r * 0.6, R, 10);
  },
  'rice-bowl'(c, x, y, r, R) {
    bowl(c, x, y, r, R, { outer: '#f0ece1', inner: '#ded7c6' });
    fillBlob(c, x, y, r * 0.8, 0.03, R, '#e9d9a8', 20);
    speckle(c, x, y, r * 0.72, R, ['#c94f28', '#e8dcc0', '#7c9a3c'], 60, 2.6);
    fillBlob(c, x + r * 0.28, y - r * 0.24, r * 0.24, 0.2, R, '#b8451f', 12);
    herbs(c, x, y, r * 0.68, R, 12);
  },
  dosa(c, x, y, r, R) {
    ceramic(c, x, y, r, R, { tone: '#f0ece2', inner: '#e6dfd0' });
    c.save(); c.translate(x, y); c.rotate((R() - 0.5) * 0.5);
    const g = c.createLinearGradient(-r, 0, r, 0);
    g.addColorStop(0, '#d9a535');
    g.addColorStop(0.5, '#e8bf6a'); g.addColorStop(1, '#c98a2e');
    c.fillStyle = g;
    c.beginPath(); c.ellipse(0, 0, r * 0.92, r * 0.34, 0, 0, TAU); c.fill();
    c.fillStyle = 'rgba(120,70,20,.35)';
    for (let i = 0; i < 26; i++) {
      c.beginPath(); c.ellipse((R() - 0.5) * r * 1.7, (R() - 0.5) * r * 0.55, 2 + R() * 3, 1.4 + R() * 2, 0, 0, TAU); c.fill();
    }
    c.restore();
    fillBlob(c, x - r * 0.62, y + r * 0.5, r * 0.18, 0.12, R, '#f4f1e6', 12);
    fillBlob(c, x + r * 0.6, y + r * 0.52, r * 0.18, 0.12, R, '#d9832c', 12);
  },
  eggs(c, x, y, r, R) {
    ceramic(c, x, y, r, R);
    fillBlob(c, x - r * 0.1, y + r * 0.1, r * 0.62, 0.08, R, '#c9a267', 16);
    for (const [dx, dy] of [[-0.24, -0.1], [0.22, 0.16]]) {
      fillBlob(c, x + r * dx, y + r * dy, r * 0.3, 0.06, R, '#fbf7ec', 16);
      fillBlob(c, x + r * dx, y + r * dy, r * 0.13, 0.08, R, '#f2a81f', 12);
    }
    herbs(c, x, y, r * 0.62, R, 8);
  },
  pancakes(c, x, y, r, R) {
    ceramic(c, x, y, r, R);
    for (let i = 3; i >= 0; i--) {
      const yy = y + r * 0.22 - i * r * 0.17;
      c.fillStyle = ['#c98a3d', '#d89b46', '#e0a850'][i % 3];
      blob(c, x, yy, r * 0.6, 0.05, R, 18); c.fill();
      c.fillStyle = 'rgba(90,50,15,.18)';
      c.beginPath(); c.ellipse(x, yy + r * 0.07, r * 0.58, r * 0.1, 0, 0, TAU); c.fill();
    }
    c.fillStyle = 'rgba(190,120,30,.75)';
    c.beginPath();
    c.moveTo(x - r * 0.3, y - r * 0.3);
    c.bezierCurveTo(x - r * 0.1, y + r * 0.1, x + r * 0.25, y - r * 0.05, x + r * 0.35, y + r * 0.3);
    c.lineWidth = 5; c.strokeStyle = 'rgba(190,120,30,.8)'; c.stroke();
    speckle(c, x, y - r * 0.2, r * 0.5, R, ['#3a2a55', '#6b4a8a'], 12, 3);
  },
  toast(c, x, y, r, R) {
    ceramic(c, x, y, r, R, { tone: '#efe9dc', inner: '#e3dbcb' });
    c.save(); c.translate(x, y); c.rotate((R() - 0.5) * 0.3);
    c.fillStyle = '#d2a35e';
    c.beginPath(); c.roundRect(-r * 0.62, -r * 0.46, r * 1.24, r * 0.92, r * 0.14); c.fill();
    c.fillStyle = '#e8c88c';
    c.beginPath(); c.roundRect(-r * 0.54, -r * 0.38, r * 1.08, r * 0.76, r * 0.1); c.fill();
    c.restore();
    speckle(c, x, y, r * 0.5, R, ['#b04b2a', '#7c3d1c', '#cf7e3a'], 22, 3.2);
    herbs(c, x, y, r * 0.5, R, 8);
  },
  pastry(c, x, y, r, R) {
    ceramic(c, x, y, r, R, { tone: '#f5f1e8', inner: '#ece5d6' });
    fillBlob(c, x, y, r * 0.56, 0.05, R, '#dda555', 18);
    fillBlob(c, x, y, r * 0.4, 0.07, R, '#f2cf7d', 16);
    c.strokeStyle = 'rgba(150,95,30,.5)'; c.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      c.beginPath();
      c.moveTo(x + Math.cos(a) * r * 0.28, y + Math.sin(a) * r * 0.28);
      c.lineTo(x + Math.cos(a) * r * 0.56, y + Math.sin(a) * r * 0.56);
      c.stroke();
    }
    speckle(c, x, y, r * 0.34, R, ['rgba(80,40,10,.5)', 'rgba(40,20,5,.6)'], 14, 2.2);
  },
  pizza(c, x, y, r, R) {
    board(c, x, y, r, R);
    c.save(); c.translate(x, y); c.rotate((R() - 0.5) * 0.6);
    c.fillStyle = '#e3b96d';
    c.beginPath(); c.moveTo(0, -r * 0.82); c.lineTo(r * 0.7, r * 0.66); c.lineTo(-r * 0.7, r * 0.66); c.closePath(); c.fill();
    c.fillStyle = '#c4361f';
    c.beginPath(); c.moveTo(0, -r * 0.6); c.lineTo(r * 0.55, r * 0.5); c.lineTo(-r * 0.55, r * 0.5); c.closePath(); c.fill();
    c.fillStyle = 'rgba(248,240,210,.85)';
    for (let i = 0; i < 7; i++) {
      const t = R();
      c.beginPath(); c.ellipse((R() - 0.5) * r * 0.8 * t, lerp(-r * 0.4, r * 0.4, R()), r * 0.12, r * 0.09, R(), 0, TAU); c.fill();
    }
    c.restore();
    herbs(c, x, y, r * 0.4, R, 7);
  },
  burger(c, x, y, r, R) {
    board(c, x, y, r, R);
    fillBlob(c, x, y - r * 0.3, r * 0.62, 0.03, R, '#d9a45b', 18);          // top bun
    c.fillStyle = 'rgba(255,255,255,.35)';
    speckle(c, x, y - r * 0.38, r * 0.4, R, ['rgba(255,250,235,.7)'], 16, 1.4);
    fillBlob(c, x, y + r * 0.02, r * 0.66, 0.06, R, '#3f2a1c', 18);          // patty
    fillBlob(c, x, y + r * 0.1, r * 0.6, 0.08, R, '#e8a92e', 16);            // cheese
    fillBlob(c, x, y + r * 0.26, r * 0.62, 0.1, R, '#4e7a33', 16);           // lettuce
    fillBlob(c, x, y + r * 0.42, r * 0.58, 0.03, R, '#c98f4c', 18);          // base bun
  },
  sandwich(c, x, y, r, R) {
    board(c, x, y, r, R);
    c.save(); c.translate(x, y); c.rotate((R() - 0.5) * 0.3);
    for (const dx of [-r * 0.36, r * 0.36]) {
      c.fillStyle = '#e0bd7e';
      c.beginPath(); c.moveTo(dx - r * 0.34, r * 0.5); c.lineTo(dx + r * 0.34, r * 0.5); c.lineTo(dx, -r * 0.55); c.closePath(); c.fill();
      c.fillStyle = '#7d4a2a';
      c.beginPath(); c.moveTo(dx - r * 0.26, r * 0.16); c.lineTo(dx + r * 0.26, r * 0.16); c.lineTo(dx, -r * 0.2); c.closePath(); c.fill();
    }
    c.restore();
  },
  taco(c, x, y, r, R) {
    ceramic(c, x, y, r, R, { tone: '#efe7d6', inner: '#e2d7c0' });
    for (const dx of [-0.42, 0.06, 0.5]) {
      c.save(); c.translate(x + r * dx, y + (R() - 0.5) * r * 0.2); c.rotate((R() - 0.5) * 0.5);
      c.fillStyle = '#e9d09a';
      c.beginPath(); c.ellipse(0, 0, r * 0.26, r * 0.46, 0, 0, TAU); c.fill();
      c.fillStyle = '#a8431f';
      c.beginPath(); c.ellipse(0, -r * 0.04, r * 0.18, r * 0.34, 0, 0, TAU); c.fill();
      c.fillStyle = '#e8c14a';
      for (let i = 0; i < 5; i++) { c.beginPath(); c.ellipse((R() - 0.5) * r * 0.3, (R() - 0.5) * r * 0.5, 2.6, 2, 0, 0, TAU); c.fill(); }
      c.restore();
    }
    herbs(c, x, y, r * 0.6, R, 12);
  },
  dumplings(c, x, y, r, R) {
    contactShadow(c, x, y, r);
    c.fillStyle = '#c99a58'; blob(c, x, y, r, 0.01, R, 26); c.fill();
    c.fillStyle = '#e3bc7e'; blob(c, x, y, r * 0.9, 0.01, R, 26); c.fill();
    c.strokeStyle = 'rgba(120,80,30,.35)'; c.lineWidth = 2;
    c.beginPath(); c.arc(x, y, r * 0.95, 0, TAU); c.stroke();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.3;
      const px = x + Math.cos(a) * r * 0.46, py = y + Math.sin(a) * r * 0.46;
      fillBlob(c, px, py, r * 0.27, 0.07, R, '#f2ead6', 14);
      c.strokeStyle = 'rgba(180,160,120,.8)'; c.lineWidth = 1.6;
      c.beginPath();
      for (let k = -2; k <= 2; k++) {
        c.moveTo(px + k * 4, py - r * 0.16);
        c.lineTo(px + k * 4 + 2, py + r * 0.02);
      }
      c.stroke();
    }
  },
  grill(c, x, y, r, R) {
    ceramic(c, x, y, r, R, { tone: '#e9e3d5', inner: '#ddd5c3' });
    for (let i = 0; i < 4; i++) {
      c.save();
      c.translate(x, y + (i - 1.5) * r * 0.26);
      c.rotate((R() - 0.5) * 0.24);
      c.strokeStyle = '#b08a5c'; c.lineWidth = 3;
      c.beginPath(); c.moveTo(-r * 0.86, 0); c.lineTo(r * 0.86, 0); c.stroke();
      for (let k = 0; k < 3; k++) {
        fillBlob(c, (k - 1) * r * 0.36, 0, r * 0.15, 0.12, R, ['#6d3a20', '#874726', '#5a2e18'][k % 3], 12);
        c.strokeStyle = 'rgba(30,15,5,.55)'; c.lineWidth = 2;
        c.beginPath(); c.moveTo((k - 1) * r * 0.36 - r * 0.1, -r * 0.06); c.lineTo((k - 1) * r * 0.36 + r * 0.1, -r * 0.06); c.stroke();
      }
      c.restore();
    }
    herbs(c, x, y, r * 0.7, R, 8);
  },
  roast(c, x, y, r, R) {
    ceramic(c, x, y, r, R, { tone: '#efe9dc', inner: '#e4dbc9' });
    fillBlob(c, x, y, r * 0.66, 0.12, R, '#7a4321', 16);
    fillBlob(c, x - r * 0.1, y - r * 0.06, r * 0.4, 0.16, R, '#9c5b2c', 14);
    c.fillStyle = 'rgba(40,18,8,.5)';
    for (let i = 0; i < 6; i++) { c.fillRect(x - r * 0.5 + i * r * 0.18, y - r * 0.5 + R() * r * 0.8, 2.4, r * 0.3); }
    herbs(c, x, y, r * 0.66, R, 12);
    speckle(c, x, y, r * 0.7, R, ['rgba(230,200,140,.5)'], 16, 2);
  },
  steak(c, x, y, r, R) {
    ceramic(c, x, y, r, R, { tone: '#e8e2d4', inner: '#dcd3c0' });
    c.save(); c.translate(x, y); c.rotate((R() - 0.5) * 0.5);
    fillBlob(c, 0, 0, r * 0.6, 0.1, R, '#4a2418', 16);
    fillBlob(c, 0, 0, r * 0.42, 0.14, R, '#9e3a30', 14);
    c.restore();
    c.fillStyle = 'rgba(20,10,5,.55)';
    for (let i = 0; i < 4; i++) c.fillRect(x - r * 0.5, y - r * 0.3 + i * r * 0.18, r, 2.6);
    herbs(c, x, y, r * 0.6, R, 6);
  },
  fried(c, x, y, r, R) {
    ceramic(c, x, y, r, R, { tone: '#f1ece0', inner: '#e6ddca' });
    for (let i = 0; i < 7; i++) {
      const a = R() * TAU, d = Math.sqrt(R()) * r * 0.55;
      fillBlob(c, x + Math.cos(a) * d, y + Math.sin(a) * d, r * 0.24, 0.3, R,
        ['#c98429', '#d99a3c', '#b56f20'][i % 3], 12);
    }
    speckle(c, x, y, r * 0.7, R, ['rgba(255,220,150,.5)', 'rgba(120,70,20,.45)'], 40, 2);
  },
  fish(c, x, y, r, R) {
    ceramic(c, x, y, r, R, { tone: '#f2efe6', inner: '#e7e1d2' });
    c.save(); c.translate(x, y); c.rotate((R() - 0.5) * 0.6);
    c.fillStyle = '#b9c2c4';
    c.beginPath(); c.ellipse(0, 0, r * 0.72, r * 0.3, 0, 0, TAU); c.fill();
    c.fillStyle = '#8f9ca0';
    c.beginPath(); c.moveTo(r * 0.68, 0); c.lineTo(r * 0.92, -r * 0.22); c.lineTo(r * 0.92, r * 0.22); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(60,70,75,.5)'; c.lineWidth = 1.6;
    for (let i = -3; i <= 3; i++) {
      c.beginPath(); c.moveTo(i * r * 0.16, -r * 0.24); c.lineTo(i * r * 0.16, r * 0.24); c.stroke();
    }
    c.restore();
    fillBlob(c, x - r * 0.5, y + r * 0.5, r * 0.14, 0.1, R, '#e8d44a', 12);
    herbs(c, x, y, r * 0.6, R, 8);
  },
  oysters(c, x, y, r, R) {
    contactShadow(c, x, y, r);
    fillBlob(c, x, y, r, 0.02, R, '#cfd6da', 24);
    fillBlob(c, x, y, r * 0.9, 0.04, R, '#eef3f6', 26);       // crushed ice
    speckle(c, x, y, r * 0.85, R, ['rgba(255,255,255,.9)', 'rgba(200,220,235,.8)'], 60, 3.4);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.6, d = r * 0.48;
      const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
      fillBlob(c, px, py, r * 0.24, 0.1, R, '#8e857a', 14);
      fillBlob(c, px, py, r * 0.17, 0.14, R, '#d8cfc0', 12);
      fillBlob(c, px, py, r * 0.12, 0.2, R, '#b9b09c', 12);
    }
  },
  bake(c, x, y, r, R) {
    contactShadow(c, x, y, r);
    c.fillStyle = '#7d5b8f';
    c.beginPath(); c.roundRect(x - r * 0.95, y - r * 0.7, r * 1.9, r * 1.4, r * 0.14); c.fill();
    c.fillStyle = '#e8b64a';
    c.beginPath(); c.roundRect(x - r * 0.84, y - r * 0.6, r * 1.68, r * 1.2, r * 0.1); c.fill();
    speckle(c, x, y, r * 0.7, R, ['#c98a2a', '#f2d98a', '#a5651a'], 50, 3.6);
  },
  bread(c, x, y, r, R) {
    board(c, x, y, r, R);
    fillBlob(c, x, y, r * 0.7, 0.14, R, '#d9ab63', 18);
    speckle(c, x, y, r * 0.6, R, ['rgba(90,50,15,.5)', 'rgba(255,235,190,.6)'], 40, 2.6);
    c.strokeStyle = 'rgba(120,70,20,.4)'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(x - r * 0.4, y - r * 0.2); c.quadraticCurveTo(x, y, x + r * 0.4, y + r * 0.2); c.stroke();
  },
  fine(c, x, y, r, R) {
    ceramic(c, x, y, r, R, { tone: '#fbf9f4', rim: 0.7, inner: '#f2efe7' });
    fillBlob(c, x, y, r * 0.2, 0.2, R, '#7a3b52', 12);
    fillBlob(c, x + r * 0.16, y - r * 0.1, r * 0.1, 0.3, R, '#dfe7d0', 10);
    c.strokeStyle = 'rgba(60,40,20,.5)'; c.lineWidth = 2;
    c.beginPath(); c.arc(x, y, r * 0.34, 0.6, 2.4); c.stroke();
    speckle(c, x, y, r * 0.3, R, ['#3d5a2a', '#c9a227'], 10, 1.8);
  },
  shake(c, x, y, r, R) {
    contactShadow(c, x, y * 1.02, r * 0.7);
    c.save(); c.translate(x, y);
    c.fillStyle = 'rgba(255,255,255,.5)';
    c.beginPath(); c.moveTo(-r * 0.42, -r * 0.7); c.lineTo(r * 0.42, -r * 0.7);
    c.lineTo(r * 0.3, r * 0.8); c.lineTo(-r * 0.3, r * 0.8); c.closePath(); c.fill();
    c.fillStyle = '#e8d9c4';
    c.beginPath(); c.moveTo(-r * 0.38, -r * 0.5); c.lineTo(r * 0.38, -r * 0.5);
    c.lineTo(r * 0.28, r * 0.76); c.lineTo(-r * 0.28, r * 0.76); c.closePath(); c.fill();
    fillBlob(c, 0, -r * 0.56, r * 0.36, 0.1, R, '#fdf6ea', 14);
    c.strokeStyle = '#c4384f'; c.lineWidth = 6; c.lineCap = 'round';
    c.beginPath(); c.moveTo(r * 0.1, -r * 0.62); c.lineTo(r * 0.34, -r * 1.06); c.stroke();
    c.restore();
  },
  coffee(c, x, y, r, R) {
    ceramic(c, x, y, r * 0.92, R, { tone: '#f6f3ec', rim: 0.74, inner: '#efe9dd' });
    fillBlob(c, x, y, r * 0.6, 0.02, R, '#6b4326', 18);
    c.save();
    c.globalAlpha = 0.85;
    fillBlob(c, x, y, r * 0.34, 0.16, R, '#e8ddc8', 14);
    c.restore();
    c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 2;
    c.beginPath(); c.arc(x, y, r * 0.52, 0.4, 2.2); c.stroke();
  },
  wine(c, x, y, r, R) {
    contactShadow(c, x, y + r * 0.4, r * 0.5);
    c.save(); c.translate(x, y);
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(0, r * 0.1); c.lineTo(0, r * 0.7); c.stroke();
    c.beginPath(); c.ellipse(0, r * 0.74, r * 0.3, r * 0.08, 0, 0, TAU); c.stroke();
    c.fillStyle = 'rgba(255,255,255,.35)';
    c.beginPath(); c.moveTo(-r * 0.42, -r * 0.6); c.quadraticCurveTo(0, r * 0.4, r * 0.42, -r * 0.6); c.closePath(); c.fill();
    c.fillStyle = '#8c2036';
    c.beginPath(); c.moveTo(-r * 0.33, -r * 0.24); c.quadraticCurveTo(0, r * 0.32, r * 0.33, -r * 0.24); c.closePath(); c.fill();
    c.restore();
  },
};

/* Anything without a hand-drawn routine gets the generic plate rather than a
   blank square. There is a test that no dish in the data lands here. */
function generic(c, x, y, r, R) {
  ceramic(c, x, y, r, R);
  fillBlob(c, x, y, r * 0.55, 0.14, R, '#c08a4a', 16);
  herbs(c, x, y, r * 0.5, R, 10);
}

export const ARCHETYPES = Object.keys(DISHES);
export const hasArchetype = (a) => Object.hasOwn(DISHES, a);

/* ── the whole picture ─────────────────────────────────────────────────── */

/**
 * Draw one dish, filling the given canvas context.
 *
 * `seed` decides the surface, the wobble on every shape and where the garnish
 * lands, so the same dish is the same picture forever and two dishes never
 * come out identical.
 */
export function drawDish(c, w, h, { archetype = 'fine', seed = 'x' } = {}) {
  const R = rng(seed);
  c.save();
  c.clearRect(0, 0, w, h);
  surface(c, w, h, R);

  const r = Math.min(w, h) * 0.37;
  const cx = w / 2 + (R() - 0.5) * w * 0.05;
  const cy = h / 2 + (R() - 0.5) * h * 0.04;
  (DISHES[archetype] ?? generic)(c, cx, cy, r, R);

  /* Crumbs and drips on the surface itself, outside the plate. Without them
     the plate reads as pasted on rather than sitting there. */
  for (let i = 0; i < 18; i++) {
    const a = R() * TAU, d = r * (1.15 + R() * 0.5);
    c.fillStyle = `rgba(${200 - R() * 90 | 0},${170 - R() * 90 | 0},${120 - R() * 70 | 0},${0.25 + R() * 0.4})`;
    c.beginPath(); c.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1 + R() * 2.4, 1 + R() * 2, R() * TAU, 0, TAU); c.fill();
  }

  /* Light from the top left, then a vignette, then grain. In that order —
     grain under the vignette looks like a dirty screen. */
  const light = c.createRadialGradient(w * 0.22, h * 0.14, 0, w * 0.22, h * 0.14, Math.max(w, h) * 1.05);
  light.addColorStop(0, 'rgba(255,246,225,.22)');
  light.addColorStop(1, 'rgba(255,246,225,0)');
  c.fillStyle = light; c.fillRect(0, 0, w, h);

  const vig = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.78);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,.4)');
  c.fillStyle = vig; c.fillRect(0, 0, w, h);

  c.globalAlpha = 0.05;
  for (let i = 0; i < (w * h) / 260; i++) {
    c.fillStyle = R() > 0.5 ? '#fff' : '#000';
    c.fillRect(R() * w, R() * h, 1, 1);
  }
  c.globalAlpha = 1;
  c.restore();
}
