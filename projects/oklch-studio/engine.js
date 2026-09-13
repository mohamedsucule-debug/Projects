/* ─────────────────────────────────────────────────────────────────────────
   oklch-studio/engine.js — colour maths for building a palette that behaves.

   Everything is done in OKLab/OKLCH, where a step in lightness looks like a
   step in lightness. sRGB is only the output format: we generate in the
   perceptual space, then map into gamut and report what that cost.
   ───────────────────────────────────────────────────────────────────────── */

/* ── sRGB transfer ─────────────────────────────────────────────────────── */
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/* ── OKLab ⇄ linear sRGB (Björn Ottosson's matrices) ───────────────────── */
export function oklabToLinear(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

export function linearToOklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

export const oklchToOklab = (L, C, H) => [L, C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180)];
export const oklabToOklch = (L, a, b) => {
  const H = (Math.atan2(b, a) * 180) / Math.PI;
  return [L, Math.hypot(a, b), H < 0 ? H + 360 : H];
};

const EPS = 1e-6;
export const inGamut = ([r, g, b]) => r >= -EPS && r <= 1 + EPS && g >= -EPS && g <= 1 + EPS && b >= -EPS && b <= 1 + EPS;

/**
 * Map an OKLCH colour into sRGB. Lightness and hue are preserved and chroma is
 * reduced until the colour fits — the perceptually least-damaging trade, and
 * the one that keeps a ramp's steps evenly spaced even where the gamut pinches.
 * Returns how much chroma was surrendered, because a silent clip is a lie.
 */
export function toSrgb(L, C, H) {
  let lo = 0, hi = C, rgb = oklabToLinear(...oklchToOklab(L, C, H));
  const requested = C;
  if (!inGamut(rgb)) {
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      rgb = oklabToLinear(...oklchToOklab(L, mid, H));
      if (inGamut(rgb)) lo = mid; else hi = mid;
    }
    C = lo;
    rgb = oklabToLinear(...oklchToOklab(L, C, H));
  }
  const [r, g, b] = rgb.map((v) => Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, v))))));
  return {
    rgb: [r, g, b],
    hex: '#' + [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join(''),
    L, C, H,
    clipped: requested - C,
    css: `oklch(${(L * 100).toFixed(1)}% ${C.toFixed(3)} ${H.toFixed(1)})`,
  };
}

export function fromHex(hex) {
  const m = hex.replace('#', '').match(/^([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!m) return null;
  const s = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
  return { rgb: [r, g, b], oklch: oklabToOklch(...linearToOklab(toLinear(r), toLinear(g), toLinear(b))) };
}

/* ── contrast ──────────────────────────────────────────────────────────── */

/** WCAG 2.x relative luminance and ratio — the one that is normative today. */
export function wcagLuminance([r, g, b]) {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}
export function wcagRatio(fg, bg) {
  const a = wcagLuminance(fg), b = wcagLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * APCA (W3 draft, 0.1.9 constants) — the perceptual contrast model behind the
 * WCAG 3 proposals. Polarity matters: dark-on-light and light-on-dark are not
 * the same problem, which is exactly what WCAG 2's symmetric ratio misses.
 * Returns Lc, roughly 0…106.
 */
export function apca(fg, bg) {
  const Y = (c) => 0.2126729 * c[0] ** 2.4 + 0.7151522 * c[1] ** 2.4 + 0.0721750 * c[2] ** 2.4;
  const blkThrs = 0.022, blkClmp = 1.414;
  const soft = (y) => (y > blkThrs ? y : y + (blkThrs - y) ** blkClmp);
  let Ytxt = soft(Y(fg)), Ybg = soft(Y(bg));
  if (Math.abs(Ybg - Ytxt) < 0.0005) return 0;
  let out;
  if (Ybg > Ytxt) {                                   // dark text on light
    const s = (Ybg ** 0.56 - Ytxt ** 0.57) * 1.14;
    out = s < 0.1 ? 0 : s - 0.027;
  } else {                                            // light text on dark
    const s = (Ybg ** 0.65 - Ytxt ** 0.62) * 1.14;
    out = s > -0.1 ? 0 : s + 0.027;
  }
  return out * 100;
}

/** What APCA's own guidance allows at a given Lc. */
export function apcaUse(lc) {
  const v = Math.abs(lc);
  if (v >= 90) return { label: 'any text', rank: 5 };
  if (v >= 75) return { label: 'body text ≥16px', rank: 4 };
  if (v >= 60) return { label: 'body text ≥18px', rank: 3 };
  if (v >= 45) return { label: 'large / bold only', rank: 2 };
  if (v >= 30) return { label: 'non-text only', rank: 1 };
  return { label: 'invisible', rank: 0 };
}

/* ── ramp generation ───────────────────────────────────────────────────── */

/** The step names everybody already has muscle memory for. */
export const DEFAULT_SCALE = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

/**
 * A ramp is a lightness curve, a chroma envelope and a hue path.
 *
 * - lightness is spaced with an easing so the light end has finer steps, which
 *   is where interface surfaces actually live;
 * - chroma follows a bell so the ends stay neutral and the middle sings;
 * - hue rotates slightly along the ramp ("hue torsion") because a constant hue
 *   reads as drifting: dark blues want to go violet, light yellows go green.
 */
export function ramp({ hue, chroma = 0.13, steps = 11, lMax = 0.975, lMin = 0.22, ease = 1.15, peak = 0.55, torsion = 0 }) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const te = t ** ease;                              // easing on lightness
    const L = lMax + (lMin - lMax) * te;
    const bell = Math.exp(-((t - peak) ** 2) / (2 * 0.30 ** 2));
    const C = chroma * bell;
    const H = (hue + torsion * (t - 0.5) * 2 + 360) % 360;
    out.push({ ...toSrgb(L, C, H), step: DEFAULT_SCALE[i] ?? i * 100, index: i, t });
  }
  return out;
}

export const PRESET = [
  { name: 'neutral', hue: 250, chroma: 0.016, torsion: 0 },
  { name: 'primary', hue: 262, chroma: 0.155, torsion: -14 },
  { name: 'success', hue: 155, chroma: 0.135, torsion: 10 },
  { name: 'warning', hue: 74, chroma: 0.155, torsion: 26 },
  { name: 'danger', hue: 26, chroma: 0.165, torsion: 12 },
];

/** Build the whole palette. */
export function palette(families, opts = {}) {
  return families.map((f) => ({
    ...f,
    swatches: ramp({ ...opts, hue: f.hue, chroma: f.chroma, torsion: f.torsion ?? 0 })
      .map((s, i) => ({ ...s, name: `${f.name}-${DEFAULT_SCALE[i] ?? i}` })),
  }));
}

/* ── auditing a palette ────────────────────────────────────────────────── */

/**
 * A palette is only as good as the pairs you will actually use. For each
 * family, check its steps against the two surfaces that matter — the lightest
 * and the darkest neutral — and report the first step that is safe for body
 * text. This is the question a designer asks; "what is the contrast ratio of
 * blue-500" is not.
 */
export function audit(pal) {
  const neutral = pal.find((f) => f.name === 'neutral') || pal[0];
  const light = neutral.swatches[0].rgb;
  const dark = neutral.swatches[neutral.swatches.length - 1].rgb;
  return pal.map((f) => {
    const onLight = f.swatches.map((s) => apca(s.rgb, light));
    const onDark = f.swatches.map((s) => apca(s.rgb, dark));
    const firstSafe = (arr) => {
      const i = arr.findIndex((lc) => Math.abs(lc) >= 75);
      return i < 0 ? null : f.swatches[i].name;
    };
    return {
      family: f.name,
      textOnLight: firstSafe(onLight),
      textOnDark: firstSafe(onDark),
      maxClip: Math.max(...f.swatches.map((s) => s.clipped)),
      onLight, onDark,
    };
  });
}

/* ── export ────────────────────────────────────────────────────────────── */
export function toCss(pal, { space = 'oklch' } = {}) {
  const rows = [':root {'];
  for (const f of pal) {
    for (const s of f.swatches) rows.push(`  --${s.name}: ${space === 'oklch' ? s.css : s.hex};`);
    rows.push('');
  }
  rows[rows.length - 1] = '}';
  return rows.join('\n');
}

export function toJson(pal) {
  return JSON.stringify(Object.fromEntries(pal.map((f) => [
    f.name, Object.fromEntries(f.swatches.map((s) => [s.name.split('-')[1], s.hex])),
  ])), null, 2);
}
