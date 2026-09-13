/* lab.js — the 60 lines of shared plumbing every project here uses.
   No framework. Just the three things you actually reach for: an element
   factory, a theme switch that persists, and a frame loop you can stop. */

export const h = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'data') for (const [dk, dv] of Object.entries(v)) el.dataset[dk] = dv;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(4)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
};

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp  = (a, b, t) => a + (b - a) * t;

/** Fixed-step simulation loop. Returns a handle you can start/stop/step. */
export function ticker(step, hz = 60) {
  let raf = null, last = 0, acc = 0, running = false;
  const dt = 1000 / hz;
  const frame = (t) => {
    if (!running) return;
    acc += Math.min(250, t - (last || t));
    last = t;
    while (acc >= dt) { step(dt); acc -= dt; }
    raf = requestAnimationFrame(frame);
  };
  return {
    get running() { return running; },
    start() { if (running) return; running = true; last = 0; acc = 0; raf = requestAnimationFrame(frame); },
    stop()  { running = false; if (raf) cancelAnimationFrame(raf); raf = null; },
    toggle() { running ? this.stop() : this.start(); },
    once()  { step(dt); },
  };
}

/** Theme toggle wired to a button; remembers the choice per-origin. */
export function themeToggle(btn) {
  const KEY = 'lab.theme';
  const apply = (t) => {
    document.documentElement.dataset.theme = t;
    if (btn) btn.textContent = t === 'light' ? '◐ light' : '◑ dark';
  };
  let cur = 'dark';
  try { cur = localStorage.getItem(KEY) || 'dark'; } catch {}
  apply(cur);
  btn?.addEventListener('click', () => {
    cur = cur === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, cur); } catch {}
    apply(cur);
  });
  return () => cur;
}

/** Canvas sized to its CSS box at device pixel ratio. Returns a ctx getter. */
export function hidpi(canvas, onResize) {
  const fit = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    onResize?.(ctx, r.width, r.height);
  };
  new ResizeObserver(fit).observe(canvas);
  fit();
  return fit;
}

export const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const fmt = {
  ms: (v) => (v < 1 ? `${(v * 1000).toFixed(0)}µs` : v < 1000 ? `${v.toFixed(v < 10 ? 2 : 1)}ms` : `${(v / 1000).toFixed(2)}s`),
  n:  (v) => (Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(2) + 'B'
            : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + 'M'
            : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(1) + 'k'
            : String(Math.round(v * 100) / 100)),
  pct: (v) => `${(v * 100).toFixed(1)}%`,
};

/** Deterministic PRNG (mulberry32) — demos must look the same every reload. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
