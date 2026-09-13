# OKLCH Studio

A colour-system builder that generates in a perceptual space, maps into sRGB
honestly, and audits every pair it produces with both contrast models.

**Run it:** open `index.html` from the [index](../../index.html), or serve the
repo root and visit `/projects/oklch-studio/`.

### The design problem

Most palette tools generate colour in HSL, which lies. In HSL, `hsl(60 100% 50%)`
and `hsl(240 100% 50%)` claim the same lightness; one is yellow, the other is
navy. Build a ramp that way and your "500" step is a different brightness in
every hue, so the same text colour passes contrast on one accent and fails on
the next — and you only find out during an accessibility audit, after the
brand is signed off.

Three things follow:

**Generate in OKLCH.** Lightness means lightness. A step down the ramp is the
same perceptual step in every family, which is what makes a scale reusable —
`primary-600` and `danger-600` behave the same way against the same surface.

**Say what the gamut cost.** Plenty of OKLCH colours have no sRGB equivalent.
The usual answer is to clip the channels, which silently shifts hue and
flattens the end of a ramp. This does a binary search on chroma instead —
preserving lightness and hue, sacrificing saturation — and then marks every
swatch that was mapped, with how much it lost. A silent clip is a lie about
what you designed.

**Audit pairs, not colours.** A colour is not accessible; a *pairing* is. The
matrix scores every step of the selected family against every neutral surface,
and you can flip between APCA and WCAG 2.1 on the same palette to see where
they disagree. They disagree a lot, and the disagreement is instructive: WCAG's
ratio is symmetric, so it cannot tell that light-on-dark and dark-on-light are
different problems. APCA can, which is why its numbers go negative.

The preview panel builds a real fragment of interface out of the generated
tokens — in both polarities — because a palette that only looks good as a row
of squares has not been tested.

### Implementation notes

`engine.js` carries the maths and no DOM:

- **OKLab ⇄ linear sRGB** via Ottosson's matrices, with the correct piecewise
  sRGB transfer (not a 2.2 gamma approximation).
- **Gamut mapping** by 24-step bisection on chroma at fixed L and H.
- **APCA** implemented to the W3 draft 0.1.9 constants, including the black
  soft-clamp and the separate coefficients per polarity. Sanity-checked in the
  tests against the reference values: black on white is Lc 106, white on black
  is Lc −108.
- **WCAG 2.1** relative luminance and ratio, for the standard you are actually
  audited against today.
- **Ramp shape** is three curves: eased lightness (finer steps at the pale end,
  where surfaces live), a chroma bell (neutral ends so both extremes can sit
  under text), and optional hue torsion, because a ramp at one fixed hue reads
  as drifting — dark blues want to lean violet, pale yellows lean green.

Paste a brand hex into the seed field and it is converted to OKLCH to become
the selected family's hue and chroma.

### Known limits

sRGB only — no Display P3 output, though the gamut mapper would extend to it
directly. APCA is a draft and is used here as guidance, not a conformance
claim. And the generator makes *ramps*, not a full semantic token layer: the
CSS export gives you `--primary-600`, not `--color-surface-raised`.
