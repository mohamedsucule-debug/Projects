/* ───────────────────────────────────────────────────────────────────────────
   orbit/levels.js — the shape of the difficulty curve, on its own.

   No DOM, no canvas, no game state. Given a level number it returns the
   numbers that level runs on, which means the curve can be checked from a
   terminal instead of by dying repeatedly and forming an opinion.

   Two rules the whole thing is built around:

   IT NEVER STOPS. Levels are authored by hand for as long as they need to be
   and extrapolated after that, so the run always has a next level. A game that
   ends at level 7 tells a good player they have finished; a game that keeps
   going tells them they have not.

   IT NEVER BECOMES IMPOSSIBLE. Every number approaches a ceiling rather than
   climbing for ever. Difficulty that increases without bound is not difficulty,
   it is a countdown with extra steps — the player stops improving and starts
   waiting to lose, and they can feel the difference.
   ─────────────────────────────────────────────────────────────────────────── */

/** The hard limits. Nothing the extrapolator does may exceed these. */
export const CEILING = {
  quota: 26,        // orbs to clear a level — beyond this a level is a chore
  drones: 8,        // homing hunters on screen at once
  mines: 6,         // stationary hazards
  spinners: 3,      // rotating bars
  chase: 0.125,     // how hard a drone steers towards you
  speed: 5.2,       // a drone's top speed
};

/**
 * The authored levels.
 *
 * The first three teach, one idea at a time: dodge, then dodge more, then
 * dodge something that does not move and cannot be dashed through. Nothing new
 * is introduced while something else is still new.
 */
export const AUTHORED = [
  { name: 'Warm-up',   quota: 6,  drones: 2, chase: 0.055, speed: 2.4, mines: 0, spinners: 0 },
  { name: 'Company',   quota: 8,  drones: 3, chase: 0.062, speed: 2.8, mines: 0, spinners: 0 },
  { name: 'Minefield', quota: 10, drones: 3, chase: 0.068, speed: 3.0, mines: 2, spinners: 0 },
  { name: 'Crowded',   quota: 11, drones: 4, chase: 0.074, speed: 3.3, mines: 3, spinners: 0 },
  { name: 'Sweeper',   quota: 12, drones: 3, chase: 0.078, speed: 3.5, mines: 2, spinners: 1 },
  { name: 'Gauntlet',  quota: 14, drones: 5, chase: 0.086, speed: 3.8, mines: 3, spinners: 1 },
  { name: 'Storm',     quota: 16, drones: 5, chase: 0.094, speed: 4.1, mines: 4, spinners: 2 },
  { name: 'Swarm',     quota: 18, drones: 6, chase: 0.102, speed: 4.4, mines: 5, spinners: 2 },
];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Everything level `n` needs. 1-based; anything below 1 is treated as 1.
 *
 * Past the authored table each value eases towards its ceiling rather than
 * marching past it — an exponential approach, so level 40 is harder than level
 * 20 and level 400 is barely harder than level 40, which is correct. By then
 * the player is the variable, not the settings.
 */
export function levelFor(n) {
  const level = Math.max(1, Math.floor(n) || 1);
  if (level <= AUTHORED.length) return { level, ...AUTHORED[level - 1] };

  const last = AUTHORED[AUTHORED.length - 1];
  const past = level - AUTHORED.length;
  // 0 at the end of the authored run, approaching 1 as the level number grows
  const t = 1 - Math.exp(-past / 9);
  const to = (from, ceiling) => from + (ceiling - from) * t;

  return {
    level,
    name: `Deep ${past}`,
    quota: Math.round(clamp(to(last.quota, CEILING.quota), 4, CEILING.quota)),
    drones: Math.round(clamp(to(last.drones, CEILING.drones), 1, CEILING.drones)),
    chase: clamp(to(last.chase, CEILING.chase), 0.01, CEILING.chase),
    speed: clamp(to(last.speed, CEILING.speed), 0.5, CEILING.speed),
    mines: Math.round(clamp(to(last.mines, CEILING.mines), 0, CEILING.mines)),
    spinners: Math.round(clamp(to(last.spinners, CEILING.spinners), 0, CEILING.spinners)),
  };
}

/** Points for finishing a level. Later levels are worth more, within reason. */
export const clearBonus = (level) => 100 + Math.min(400, Math.max(1, level) * 25);

/**
 * How far through the current level you are, 0..1.
 * Used for the progress ring, so it has to be safe against a zero quota.
 */
export const progress = (collected, quota) =>
  clamp(quota > 0 ? collected / quota : 1, 0, 1);

/* Best level and best score are kept apart, because they are different
   brags: a big score says you played well, a deep level says you kept
   playing. */

export const store = {
  /* localStorage throws outright in a private window with site data blocked.
     A high score is never worth taking the whole game down for, so every
     access is wrapped and a failure just means nothing is remembered. */
  get(key, fallback = 0) {
    try { return Number(localStorage.getItem(key)) || fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, String(value)); } catch { /* nothing to do */ }
  },
  best() { return { score: this.get('comet.best', 0), level: this.get('comet.bestLevel', 1) }; },
  record(score, level) {
    const b = this.best();
    if (score > b.score) this.set('comet.best', score);
    if (level > b.level) this.set('comet.bestLevel', level);
    return { score: score > b.score, level: level > b.level };
  },
};
