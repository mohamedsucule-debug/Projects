/* ───────────────────────────────────────────────────────────────────────────
   mercury/shaders.js — the programs that run on the graphics card.

   Kept apart from the page because the card on the front of the site runs the
   same two programs at a fraction of the size. One copy of a shader cannot
   drift out of step with another copy of it.
   ─────────────────────────────────────────────────────────────────────────── */

/* One triangle big enough to cover the screen, built from the vertex index —
   no buffers, no attributes, nothing to bind. */
export const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/* Pass one: the water.

   h_next = 2h - h_prev + c^2 * (sum of the four neighbours - 4h)

   That is the wave equation with the derivatives replaced by differences. The
   c^2 is not a free dial: above 0.5 the simulation feeds itself and the whole
   surface goes to infinity within a second or two. It runs at 0.176. */
export const SIM = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uSpeed, uDamping, uTime;
uniform vec3 uDrops[12];          // x, y, strength
uniform int uDropCount;
out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec2 st = texture(uState, uv).rg;        // r = height now, g = height before
  float h = st.r, prev = st.g;

  float l = texture(uState, uv - vec2(uTexel.x, 0.0)).r;
  float r = texture(uState, uv + vec2(uTexel.x, 0.0)).r;
  float d = texture(uState, uv - vec2(0.0, uTexel.y)).r;
  float u = texture(uState, uv + vec2(0.0, uTexel.y)).r;

  float next = (2.0 * h - prev + uSpeed * uSpeed * (l + r + d + u - 4.0 * h)) * uDamping;

  for (int i = 0; i < 12; i++) {
    if (i >= uDropCount) break;
    vec3 dp = uDrops[i];
    float dist = length((uv - dp.xy) * vec2(1.0, 1.0));
    float rad = 0.022;
    if (dist < rad) next -= dp.z * (0.5 + 0.5 * cos(dist / rad * 3.14159265));
  }

  /* A gentle swell so the metal is never a dead mirror. Two long waves at an
     angle to each other, far too slow to read as motion but enough to keep the
     reflections alive. */
  float swell = sin(uv.x * 8.0 + uTime * 0.31) * sin(uv.y * 6.5 - uTime * 0.24) * 0.0010;
  next += swell;

  /* Held at zero around the edge, so a wave that reaches the boundary is
     swallowed instead of bouncing back through the middle of the picture. */
  float edge = smoothstep(0.0, 0.13, uv.x) * smoothstep(0.0, 0.13, uv.y)
             * smoothstep(0.0, 0.13, 1.0 - uv.x) * smoothstep(0.0, 0.13, 1.0 - uv.y);
  next *= edge;

  outColor = vec4(clamp(next, -4.0, 4.0), h, 0.0, 1.0);
}`;

/* Pass two: the picture. */
export const DRAW = `#version 300 es
precision highp float;
uniform sampler2D uHeight;
uniform vec3 uEye, uTarget;
uniform vec2 uRes;
uniform float uTime, uWorld;
out vec4 outColor;

const float PI = 3.14159265;
vec3 SUN = normalize(vec3(-0.42, 0.30, -0.86));

/* ── the floating shape ──────────────────────────────────────────────────────
   Four spheres, moving, blended with a smooth minimum — which is just a
   minimum that curves where the two surfaces meet, so they melt together
   instead of intersecting. This is the whole 3D model. */
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float shape(vec3 p) {
  float t = uTime * 0.28;
  p.y -= 2.35;
  float d = length(p - vec3(sin(t) * 0.62, cos(t * 0.9) * 0.44, cos(t * 0.7) * 0.6)) - 0.66;
  d = smin(d, length(p - vec3(cos(t * 1.1) * 0.78, sin(t * 0.8) * 0.5, sin(t) * 0.44)) - 0.54, 0.62);
  d = smin(d, length(p - vec3(sin(t * 1.3 + 2.0) * 0.7, cos(t) * 0.6, cos(t * 1.2 + 1.0) * 0.7)) - 0.48, 0.62);
  d = smin(d, length(p - vec3(cos(t * 0.6 + 1.0) * 0.52, sin(t * 1.4) * 0.72, sin(t * 0.9 + 2.0) * 0.62)) - 0.44, 0.62);
  return d;
}

vec3 shapeNormal(vec3 p) {
  vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(
    shape(p + e.xyy) - shape(p - e.xyy),
    shape(p + e.yxy) - shape(p - e.yxy),
    shape(p + e.yyx) - shape(p - e.yyx)));
}

/* Walk along the ray in steps no longer than the distance to the nearest
   surface, so it can never step through anything. */
float marchShape(vec3 ro, vec3 rd, float maxT, int steps) {
  float t = 0.05;
  for (int i = 0; i < 96; i++) {
    if (i >= steps) break;
    vec3 p = ro + rd * t;
    float d = shape(p);
    if (d < 0.0007 * t) return t;
    t += d;
    if (t > maxT) break;
  }
  return -1.0;
}

/* Soft shadow for free: march towards the light and remember how close the
   ray came to something. A near miss is a soft edge. */
float shadow(vec3 ro, vec3 rd) {
  float res = 1.0, t = 0.12;
  for (int i = 0; i < 26; i++) {
    float d = shape(ro + rd * t);
    res = min(res, 9.0 * d / t);
    t += clamp(d, 0.08, 0.6);
    if (res < 0.003 || t > 14.0) break;
  }
  return clamp(res, 0.0, 1.0);
}

vec3 sky(vec3 rd) {
  /* Most of this dome has to be DARK. A mirror is only dramatic if there is
     something dark for the bright parts to sit against — a sky that is bright
     from top to bottom gives a mirror nothing to do, and the metal comes out
     looking like milky plastic however reflective you make it. */
  float h = rd.y;
  vec3 zenith  = vec3(0.010, 0.014, 0.052);
  vec3 horizon = vec3(0.62, 0.20, 0.11);
  vec3 c = mix(horizon, zenith, pow(clamp(h * 5.5, 0.0, 1.0), 0.7));
  // below the horizon, for rays that bounce downwards off the shape
  c = mix(c, vec3(0.012, 0.012, 0.020), clamp(-h * 2.2, 0.0, 1.0));

  float sun = max(dot(rd, SUN), 0.0);
  c += vec3(1.0, 0.60, 0.28) * pow(sun, 1400.0) * 26.0;   // the disc, small and hot
  c += vec3(1.0, 0.40, 0.16) * pow(sun, 26.0) * 0.55;     // the glow just around it
  c += vec3(0.9, 0.30, 0.14) * pow(sun, 7.0) * 0.08;      // and the wash across the sky

  // a thin deck of cloud catching the light, from two sine waves
  float band = sin(rd.x * 6.0 + uTime * 0.02) * sin(rd.z * 4.4 - uTime * 0.016);
  float deck = smoothstep(0.45, 0.98, band) * smoothstep(0.015, 0.16, h) * smoothstep(0.55, 0.2, h);
  c += vec3(0.7, 0.28, 0.16) * deck * 0.5;
  return c;
}

/* The metal's own colour: dark, slightly warm, so the reflections have
   something to sit on rather than sitting in a void. */
vec3 metal(vec3 rd) {
  // the small part of the light the metal keeps: cold, and very dark
  return mix(vec3(0.012, 0.014, 0.022), vec3(0.05, 0.05, 0.062), clamp(rd.y, 0.0, 1.0));
}

vec2 waterUV(vec3 p) { return p.xz / (uWorld * 2.0) + 0.5; }

float heightAt(vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  return texture(uHeight, uv).r;
}

/* The surface normal from the height field: the slope in x and the slope in z.
   This is the only place the simulation touches the picture, and it is the
   reason the reflections bend. */
vec3 waterNormal(vec3 p) {
  vec2 uv = waterUV(p);
  float e = 1.0 / 512.0;
  float hx = heightAt(uv + vec2(e, 0.0)) - heightAt(uv - vec2(e, 0.0));
  float hz = heightAt(uv + vec2(0.0, e)) - heightAt(uv - vec2(0.0, e));
  float s = 0.55;
  return normalize(vec3(-hx * s, 2.0 * e * (uWorld * 2.0), -hz * s));
}

vec3 trace(vec3 ro, vec3 rd) {
  float tShape = marchShape(ro, rd, 36.0, 76);
  float tWater = rd.y < -0.0001 ? (0.0 - ro.y) / rd.y : -1.0;

  bool hitWater = tWater > 0.0 && (tShape < 0.0 || tWater < tShape);
  bool hitShape = tShape > 0.0 && !hitWater;

  if (hitShape) {
    vec3 p = ro + rd * tShape;
    vec3 n = shapeNormal(p);
    vec3 refl = reflect(rd, n);
    vec3 col = sky(refl) * 0.92;
    float fres = pow(1.0 - max(dot(-rd, n), 0.0), 4.0);
    col += vec3(1.0, 0.8, 0.65) * fres * 0.5;
    col += vec3(1.0, 0.86, 0.7) * pow(max(dot(refl, SUN), 0.0), 90.0) * 2.2;
    return col;
  }

  if (hitWater) {
    vec3 p = ro + rd * tWater;
    vec3 n = waterNormal(p);
    /* Far away, one pixel covers several waves, and sampling a single point
       inside it produces shimmering bands across the horizon rather than a
       surface. Settle the normal towards flat with distance: it is the same
       reason a texture gets a mipmap. */
    /* Not all the way to flat. A perfectly flat far field collapses the sun's
       glitter path into a razor line across the horizon; leaving a little
       roughness out there spreads it back into a band, which is what it looks
       like on real water. */
    n = normalize(mix(n, vec3(0.0, 1.0, 0.0), 0.88 * smoothstep(7.0, 26.0, tWater)));
    vec3 refl = reflect(rd, n);

    // what the reflected ray sees: the shape if it is in the way, else the sky
    float rt = marchShape(p + n * 0.02, refl, 22.0, 42);
    vec3 seen;
    if (rt > 0.0) {
      vec3 q = p + n * 0.02 + refl * rt;
      vec3 qn = shapeNormal(q);
      seen = sky(reflect(refl, qn)) * 0.9;
    } else {
      seen = sky(refl);
    }

    /* Metals reflect most of what hits them from every angle — around 0.04 at
       normal incidence is the number for WATER, and using it here is what made
       this look like milky plastic rather than like mercury. */
    float fres = 0.76 + 0.24 * pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
    vec3 col = mix(metal(refl), seen, fres);

    col *= mix(0.35, 1.0, shadow(p, SUN));
    col += vec3(1.0, 0.85, 0.66) * pow(max(dot(refl, SUN), 0.0), 90.0) * 1.5;

    // fade into the sky at the horizon, or the plane ends in a hard line
    /* Thick enough that the far edge of the metal dissolves into the sky. At
       0.03 the plane ended in a hard diagonal line across the picture, which
       is the one thing that says "this is a flat plane in a shader". */
    /* Nothing in the near field. An exponential thick enough to close the
       horizon was already a third of the way in at five units out, which
       poured pale sky over the dark mirror in the foreground — the exact
       thing the mirror is there for. */
    float fog = smoothstep(8.0, 42.0, tWater);
    /* Fade into the sky AT THE HORIZON, not into the sky the view ray is
       pointing at — which is downwards, and dark. Fading to the wrong colour
       leaves a hard line right across the picture where the two meet. */
    vec3 far = sky(normalize(vec3(rd.x, 0.004, rd.z)));
    return mix(col, far, fog);
  }

  return sky(rd);
}

void main() {
  vec2 uv = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  uv.x *= uRes.x / uRes.y;

  vec3 fwd = normalize(uTarget - uEye);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  vec3 rd = normalize(fwd + right * uv.x * 0.5463 + up * uv.y * 0.5463);

  vec3 col = trace(uEye, rd);

  // tone map, then a mild vignette so the eye goes to the middle
  col *= 0.92;
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);   // ACES, roughly
  col = pow(clamp(col, 0.0, 1.0), vec3(0.4545));
  vec2 q = gl_FragCoord.xy / uRes;
  col *= 0.72 + 0.28 * pow(16.0 * q.x * q.y * (1.0 - q.x) * (1.0 - q.y), 0.25);

  outColor = vec4(col, 1.0);
}`;

