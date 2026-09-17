/* apps/attention/quantise.js — int8 weights, which is how models actually ship.

   The trained checkpoints on this page are 45,440 double-precision numbers
   each. As JSON that is about 400KB per checkpoint and there are thirteen of
   them, which is not a web page, it is a download.

   So they ship the way real weights ship: quantised. Each matrix gets one
   scale factor, every number in it becomes a single signed byte, and the
   matrix is reconstructed as `byte × scale` when the page loads. Eight times
   smaller than float64, four times smaller than float32.

   SYMMETRIC, PER-MATRIX. Symmetric means zero maps to zero — no separate
   offset — which matters because a weight matrix is roughly centred on zero
   anyway and an asymmetric scheme spends a parameter describing that. Per
   matrix rather than per model because the embedding and the attention
   matrices live at genuinely different magnitudes, and one shared scale would
   quantise the smaller of them into almost nothing.

   The error this introduces is real and it is measured rather than assumed:
   pack.mjs reports the model's loss before and after, and the page prints it.
   A compression step you have not measured the cost of is a compression step
   you are hoping about. */

/**
 * Float array → one scale and an array of signed bytes.
 *
 * The scale is the largest magnitude divided by 127, so the biggest weight
 * lands on ±127 and everything else is proportional. 127 rather than 128
 * because the range of a signed byte is −128 to 127, and using 128 as the
 * positive bound would overflow on the single largest positive weight.
 */
export function quantise(data) {
  let max = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    if (a > max) max = a;
  }
  /* An all-zero matrix has no scale — the bias vectors start like this. Any
     non-zero scale reconstructs it exactly, so 1 is as good as anything and
     avoids a division by zero. */
  const scale = max === 0 ? 1 : max / 127;
  const q = new Int8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    /* Rounded, not truncated. Truncation biases every weight towards zero,
       and a bias applied to forty-five thousand parameters at once is a
       systematic shrink of the whole model rather than noise. */
    q[i] = Math.max(-127, Math.min(127, Math.round(data[i] / scale)));
  }
  return { scale, q };
}

export function dequantise(q, scale) {
  const out = new Float64Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = q[i] * scale;
  return out;
}

/** The worst single-weight error this quantisation introduced. */
export function maxError(data, q, scale) {
  let worst = 0;
  for (let i = 0; i < data.length; i++) {
    worst = Math.max(worst, Math.abs(data[i] - q[i] * scale));
  }
  return worst;
}

/* ── base64, in both runtimes ───────────────────────────────────────────────
   The page has to read this in a browser and pack.mjs has to write it in node,
   and the two have entirely different base64 APIs. Rather than ship a polyfill
   the size of the data, both paths are here and the right one is picked once. */

const hasBtoa = typeof btoa === 'function';

export function toBase64(int8) {
  const bytes = new Uint8Array(int8.buffer, int8.byteOffset, int8.byteLength);
  if (!hasBtoa) return Buffer.from(bytes).toString('base64');
  /* In chunks. String.fromCharCode.apply with a hundred thousand arguments
     throws a call-stack error in every engine, and it does it at a size that
     is comfortably past anything you would test with by hand. */
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

export function fromBase64(str) {
  if (typeof atob !== 'function') {
    const buf = Buffer.from(str, 'base64');
    return new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int8Array(bytes.buffer);
}

/** A whole model's parameters, packed. */
export function packParams(params) {
  return params.map((p) => {
    const { scale, q } = quantise(p.data);
    return { rows: p.rows, cols: p.cols, scale, b64: toBase64(q) };
  });
}

/** …and unpacked, back into the shape Transformer.fromJSON expects. */
export function unpackParams(packed) {
  return packed.map((p) => ({
    rows: p.rows,
    cols: p.cols,
    data: Array.from(dequantise(fromBase64(p.b64), p.scale)),
  }));
}
