/* ───────────────────────────────────────────────────────────────────────────
   lamplighter/scene.js — the story, and the maths that draws it.

   Scrolling is not a camera here. It is time. The reader's scroll position is
   a clock hand over one night, and everything on the page — the height of the
   sun, the state of the sea, the rain, the sweep of the beam, which words are
   on screen — is a function of that one number.

   Which means none of this needs a canvas to test. Every function below takes
   a time between 0 and 1 and returns numbers. What the page does with them is
   the page's business.
   ─────────────────────────────────────────────────────────────────────────── */

export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const mix = (a, b, t) => [
  Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t)),
];

/** Smooth 0→1 over [edge0, edge1]. The workhorse: every fade here is one. */
export function smooth(edge0, edge1, x) {
  if (edge1 === edge0) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** 1 inside [a, b] with soft shoulders of width `fade`, 0 outside. */
export function band(a, b, x, fade = 0.04) {
  return smooth(a - fade, a, x) * (1 - smooth(b, b + fade, x));
}

/* ── the night ───────────────────────────────────────────────────────────────
   Nine chapters. `at` is when the text arrives; the scene is continuous and
   does not care where the chapter boundaries are, which is the point — the
   words land on a night that is already happening. */

export const CHAPTERS = [
  {
    at: 0.00,
    title: 'The Lamplighter',
    lines: [
      'Forty-one years my father climbed these stairs, and his father before him, and nobody has ever asked us why.',
      'Scroll. The night is long and it goes at your pace.',
    ],
  },
  {
    at: 0.10,
    lines: [
      'Sunset at six. Two hundred and eleven steps, and the lamp lit before the last of it goes.',
      'I have never been late. Not in thirty-two years.',
    ],
  },
  {
    at: 0.22,
    lines: [
      'The letter came in August. The light is to be automated in the spring.',
      'They were kind about it. They used the word *redundant* only once, and then only in the third paragraph.',
    ],
  },
  {
    at: 0.34,
    lines: [
      'There is a machine coming that will do this without being asked, and without being thanked, and it will never once be late.',
      'It will also never look at the water.',
    ],
  },
  {
    at: 0.46,
    lines: [
      'Weather at nine. Southwest, rising. By midnight it will be a gale and I will be the only thing standing between forty men and the rocks at Carrick Point.',
      'The machine will be that too. I do not doubt it.',
    ],
  },
  {
    at: 0.58,
    lines: [
      'A fishing boat, north-north-east, running late and running hard.',
      'He has seen me. He always sees me. He alters two degrees and goes by in the dark, and he will never know my name, and I will never know his.',
      'That is the whole arrangement, and it has held for four hundred years.',
    ],
  },
  {
    at: 0.70,
    lines: [
      'The worst of it comes at two. The glass shakes in the frame and the rain goes sideways and the beam cuts through it like it is not there at all.',
      'I trim the wick. I wind the mechanism. I write the hour in the book.',
      'Nobody is watching. That has never been the point.',
    ],
  },
  {
    at: 0.82,
    lines: [
      'It eases before dawn. It always does.',
      'Grey at five, and the sea goes from black to the colour of an old coin, and the boats come back in ones and twos, and every one of them is accounted for.',
    ],
  },
  {
    at: 0.93,
    lines: [
      'Sunrise at seven. I put the lamp out and go down two hundred and eleven steps.',
      'In the spring a machine will do all of this, and it will do it perfectly, and the men on the boats will get home just the same.',
      'I am not sure that I mind.',
      'I would only like somebody to have seen it.',
    ],
    last: true,
  },
];

/* ── what the night looks like at time t ─────────────────────────────────── */

/** How high the sun is: 1 at noon, 0 at the horizon, negative below it. */
export function sun(t) {
  /* The story opens just before sunset and ends just after sunrise, so the
     curve is highest at both ends and deepest in the middle. Offsetting by
     0.92 puts t=0 a hair above the horizon rather than at noon: this is a
     night, and it starts with the sun already going. */
  return Math.cos(clamp(t) * Math.PI * 2) * 0.5 + 0.5 - 0.92;
}

/** Storm strength, 0..1. Builds from the ninth hour, worst at two, gone by dawn. */
export function storm(t) {
  return band(0.42, 0.80, t, 0.16) * (0.55 + 0.45 * smooth(0.5, 0.7, t) * (1 - smooth(0.74, 0.86, t)));
}

/**
 * The sky, bottom colour and top colour, as [r,g,b].
 *
 * Four keyframes with the transitions between them, rather than a formula: a
 * sunset is not a hue rotation, and the colours it actually goes through are
 * the entire reason anyone looks at one.
 */
/* The horizon colours are deliberately duller than a sunset looks, because
   the sun's own glow is painted over them and adds the heat where the sun
   actually is. Baking full 255,176,92 into the whole width of the sky instead
   gives a band that is uniformly on fire from edge to edge, and a sun drawn on
   top of it has nothing to be brighter than. */
const SKY = [
  { t: 0.00, lo: [196, 126, 84], hi: [58, 78, 136] },   // the last of it
  { t: 0.14, lo: [150, 76, 78], hi: [26, 34, 72] },     // the red going out
  { t: 0.30, lo: [26, 32, 58], hi: [6, 8, 20] },        // night
  /* The darkest keyframe sits on the peak of storm(), not before it. An
     earlier ordering had the sky already lifting towards grey while the gale
     was at its worst, which reads as the weather clearing and then getting
     loud again. */
  { t: 0.74, lo: [14, 16, 28], hi: [3, 4, 10] },        // the worst of it
  { t: 0.90, lo: [92, 104, 126], hi: [26, 34, 58] },    // grey at five
  { t: 1.00, lo: [198, 142, 104], hi: [84, 124, 172] }, // sunrise
];

export function sky(t) {
  const x = clamp(t);
  let i = 0;
  while (i < SKY.length - 2 && x > SKY[i + 1].t) i++;
  const a = SKY[i], b = SKY[i + 1];
  const k = smooth(a.t, b.t, x);
  return { lo: mix(a.lo, b.lo, k), hi: mix(a.hi, b.hi, k) };
}

/**
 * Where the beam is pointing, in radians.
 *
 * A real light turns at a constant rate — the flash pattern is how you tell one
 * lighthouse from another, and a light that sped up when you scrolled faster
 * would be a light attached to the reader rather than to the coast. So this
 * takes wall-clock seconds, not scroll. It is the one thing on the page the
 * reader has no control over, which is most of what makes the place feel like
 * it is there whether or not anybody is looking at it.
 */
export const ROTATION = 11.2;   // seconds per revolution — Carrick Point, Fl(1) 11s
export function beam(seconds) {
  return (seconds / ROTATION) * Math.PI * 2 % (Math.PI * 2);
}

/** Is the beam pointing at the reader? 1 dead on, 0 away. Sharp, like a real one. */
export function flash(seconds) {
  const a = beam(seconds);
  const face = Math.cos(a - Math.PI / 2);
  return Math.pow(clamp(face), 22);
}

/**
 * The sea: a sum of sine waves, sampled at x.
 *
 * Three scales — swell, chop, and ripple — because one is a cartoon and two
 * still reads as a pattern. The storm raises all three but raises the chop
 * most, which is what a sea actually does when the wind gets up.
 */
export function wave(x, seconds, s = 0) {
  const swell = Math.sin(x * 0.9 + seconds * 0.55) * (1 + s * 2.6);
  const chop = Math.sin(x * 2.7 - seconds * 1.15) * (0.45 + s * 2.3);
  const ripple = Math.sin(x * 6.1 + seconds * 2.2) * (0.16 + s * 0.5);
  return swell + chop + ripple;
}

/** How much rain is falling, and how hard the wind is driving it sideways. */
export function rain(t) {
  const s = storm(t);
  return { amount: smooth(0.04, 0.34, s), slant: 0.35 + s * 1.5, speed: 1 + s * 2.2 };
}

/**
 * Which chapter is showing, and how far into it we are.
 *
 * The last chapter has to stay on screen rather than fading out at t=1, or the
 * final line — the one the whole piece is for — scrolls away from anybody who
 * overshoots the bottom by a pixel.
 */
export function chapterAt(t) {
  const x = clamp(t);
  let i = 0;
  while (i < CHAPTERS.length - 1 && x >= CHAPTERS[i + 1].at) i++;
  const a = CHAPTERS[i];
  const next = CHAPTERS[i + 1];
  const span = (next ? next.at : 1.02) - a.at;
  return { index: i, chapter: a, into: span > 0 ? clamp((x - a.at) / span) : 1 };
}

/** Opacity of chapter `i` at time t: it arrives, it holds, it goes. */
/** How long a chapter takes to arrive, in scroll. */
const FADE = 0.045;

/** The window over which chapter `i` arrives: [start, start + its fade]. */
function fadeIn(i) {
  const a = CHAPTERS[i];
  const next = CHAPTERS[i + 1];
  const span = (next ? next.at : 1.02) - a.at;
  return Math.min(FADE, span * 0.5);
}

export function chapterOpacity(i, t) {
  const next = CHAPTERS[i + 1];
  /* The first chapter is already on screen when the page loads — it does not
     fade in, because there is nothing to fade in from and a reader who arrives
     to a wordless picture does not know there is anything to scroll. */
  const arrive = i === 0 ? 1 : smooth(CHAPTERS[i].at, CHAPTERS[i].at + fadeIn(i), t);
  /* The last one never fades out, or the closing line — the one the piece is
     for — is gone for anybody who overshoots the bottom by a pixel. */
  if (!next) return arrive;
  /* A chapter leaves over exactly the window the next one arrives in, so the
     two opacities sum to one the whole way across. Fading this one out
     *before* the next began left a gap of about two per cent of the scroll
     with nothing readable on screen — a beautiful picture and no words, which
     reads as the page having broken. */
  return arrive * (1 - smooth(next.at, next.at + fadeIn(i + 1), t));
}
