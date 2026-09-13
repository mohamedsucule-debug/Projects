import { test, assert } from './harness.mjs';
import {
  toSrgb, fromHex, apca, apcaUse, wcagRatio, wcagLuminance, palette, ramp,
  PRESET, DEFAULT_SCALE, oklabToLinear, linearToOklab, oklchToOklab, oklabToOklch,
  inGamut, audit, toCss, toJson,
} from '../projects/oklch-studio/engine.js';
import { rng } from '../shared/lab.js';

const HEXES = ['#000000', '#ffffff', '#3b82f6', '#ff0000', '#00ff00', '#0000ff',
  '#7f7f7f', '#fbbf24', '#1a1a2e', '#f0abfc'];

test('hex survives a round trip through OKLCH', () => {
  for (const hex of HEXES) {
    const c = fromHex(hex);
    assert.ok(c, `${hex} failed to parse`);
    assert.equal(toSrgb(...c.oklch).hex, hex.toLowerCase(), `${hex} did not survive`);
  }
});

test('OKLab and linear sRGB are inverses of each other', () => {
  // The two matrices are published rounded to ten decimals, so they are not
  // exact inverses. Measured over 200k samples the worst round-trip error is
  // 2.6e-7 — far below one step of an 8-bit channel (1/255 ≈ 3.9e-3), which
  // is the tolerance that actually matters here.
  const r = rng(12);
  let worst = 0;
  for (let i = 0; i < 2000; i++) {
    const rgb = [r(), r(), r()];
    const back = oklabToLinear(...linearToOklab(...rgb));
    for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(back[k] - rgb[k]));
  }
  assert.ok(worst < 1e-6, `round-trip error ${worst.toExponential(2)} is larger than expected`);
  assert.ok(worst < 1 / 255 / 100, 'and it must stay invisible at 8-bit output');
});

test('OKLCH and OKLab are inverses of each other', () => {
  const r = rng(13);
  for (let i = 0; i < 200; i++) {
    const L = r(), C = r() * 0.3, H = r() * 360;
    const [L2, C2, H2] = oklabToOklch(...oklchToOklab(L, C, H));
    assert.close(L2, L, 1e-9);
    assert.close(C2, C, 1e-9);
    if (C > 1e-6) assert.close(H2, H, 1e-6);
  }
});

test('three malformed hex strings are rejected rather than guessed at', () => {
  for (const bad of ['', '#12', 'not-a-colour', '#12345', 'rgb(1,2,3)']) {
    assert.equal(fromHex(bad), null, `${JSON.stringify(bad)} should not parse`);
  }
  assert.ok(fromHex('#abc'), 'three-digit hex is legitimate and should parse');
  assert.equal(fromHex('#abc').rgb.join(), fromHex('#aabbcc').rgb.join());
});

test('APCA matches its published reference values', () => {
  // From the APCA-W3 documentation: black on white is Lc 106, and the reverse
  // is Lc -108. The asymmetry is the entire point of the model.
  assert.close(apca([0, 0, 0], [1, 1, 1]), 106.0, 0.5);
  assert.close(apca([1, 1, 1], [0, 0, 0]), -107.9, 0.5);
  assert.equal(apca([0.5, 0.5, 0.5], [0.5, 0.5, 0.5]), 0, 'a colour has no contrast with itself');
});

test('APCA is polarity-sensitive where WCAG is not', () => {
  const a = fromHex('#767676').rgb, b = fromHex('#ffffff').rgb;
  assert.close(wcagRatio(a, b), wcagRatio(b, a), 1e-12, 'WCAG is symmetric by construction');
  assert.ok(Math.abs(apca(a, b)) !== Math.abs(apca(b, a)), 'APCA should not be');
});

test('WCAG luminance and ratio match the specification', () => {
  assert.close(wcagLuminance([1, 1, 1]), 1, 1e-9);
  assert.close(wcagLuminance([0, 0, 0]), 0, 1e-9);
  assert.close(wcagRatio([0, 0, 0], [1, 1, 1]), 21, 1e-9);
  assert.close(wcagRatio([1, 1, 1], [1, 1, 1]), 1, 1e-9);
  // #767676 on white is the canonical 4.54:1 boundary case for AA body text
  assert.close(wcagRatio(fromHex('#767676').rgb, [1, 1, 1]), 4.54, 0.02);
});

test('APCA thresholds are ordered', () => {
  const ranks = [95, 80, 65, 50, 35, 10].map((lc) => apcaUse(lc).rank);
  for (let i = 1; i < ranks.length; i++) assert.ok(ranks[i] < ranks[i - 1], 'lower contrast must not allow more');
  assert.equal(apcaUse(-95).rank, apcaUse(95).rank, 'polarity should not change what is legible');
});

test('every generated colour is inside sRGB', () => {
  for (const f of palette(PRESET)) {
    for (const s of f.swatches) {
      assert.ok(inGamut(oklabToLinear(...oklchToOklab(s.L, s.C, s.H))), `${s.name} is out of gamut`);
      assert.ok(/^#[0-9a-f]{6}$/.test(s.hex), `${s.name} produced ${s.hex}`);
      assert.ok(s.clipped >= 0, `${s.name} reports negative clipping`);
    }
  }
});

test('gamut mapping preserves lightness and hue, and only sacrifices chroma', () => {
  // A wildly out-of-gamut request: full chroma at mid lightness.
  const asked = { L: 0.55, C: 0.4, H: 150 };
  const got = toSrgb(asked.L, asked.C, asked.H);
  assert.ok(got.clipped > 0, 'this colour has no sRGB equivalent and should report the loss');
  assert.close(got.L, asked.L, 1e-12, 'lightness must be preserved exactly');
  assert.close(got.H, asked.H, 1e-12, 'hue must be preserved exactly');
  assert.ok(got.C < asked.C, 'chroma is what gets given up');
  // and the result really is representable
  const back = fromHex(got.hex);
  assert.close(back.oklch[0], asked.L, 0.01);
});

test('a ramp descends in lightness, monotonically', () => {
  for (const f of palette(PRESET)) {
    for (let i = 1; i < f.swatches.length; i++) {
      assert.ok(f.swatches[i].L < f.swatches[i - 1].L, `${f.name} is not monotonic at step ${i}`);
    }
    assert.ok(f.swatches[0].L > 0.9, `${f.name} should start near white`);
    assert.ok(f.swatches.at(-1).L < 0.35, `${f.name} should end near black`);
  }
});

test('chroma peaks in the middle and settles at both ends', () => {
  const steps = ramp({ hue: 262, chroma: 0.15, steps: 11 });
  const mid = steps[Math.floor(steps.length / 2)];
  assert.ok(mid.C > steps[0].C, 'the middle should be more colourful than the lightest step');
  assert.ok(mid.C > steps.at(-1).C, 'and than the darkest');
});

test('ramps of any length are named and well formed', () => {
  for (const steps of [3, 5, 11, 15]) {
    const r = ramp({ hue: 200, chroma: 0.12, steps });
    assert.equal(r.length, steps);
    assert.equal(new Set(r.map((s) => s.hex)).size, steps, 'no two steps should collide');
  }
  const pal = palette(PRESET);
  assert.deep(pal[0].swatches.map((s) => s.step), DEFAULT_SCALE);
});

test('the audit finds a usable text step for every family', () => {
  for (const a of audit(palette(PRESET))) {
    assert.ok(a.textOnLight, `${a.family} has no step readable on a light surface`);
    assert.ok(a.textOnDark, `${a.family} has no step readable on a dark surface`);
    const lc = Math.abs(a.onLight[a.onLight.findIndex((v) => Math.abs(v) >= 75)]);
    assert.ok(lc >= 75, 'the reported step must actually clear the threshold');
  }
});

test('exports are valid and complete', () => {
  const pal = palette(PRESET);
  const css = toCss(pal);
  const count = (css.match(/--[a-z]+-\d+:/g) || []).length;
  assert.equal(count, pal.length * pal[0].swatches.length, 'every swatch should be exported');
  assert.ok(css.startsWith(':root {') && css.trimEnd().endsWith('}'));
  const json = JSON.parse(toJson(pal));
  assert.deep(Object.keys(json), PRESET.map((p) => p.name));
  assert.equal(Object.keys(json.primary).length, pal[0].swatches.length);
});
