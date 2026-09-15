/* ───────────────────────────────────────────────────────────────────────────
   sumo/engine.js — two people, one keyboard, one key each.

   Your blob has an arrow on it that sweeps round and round on its own. Hold
   your key and two things happen at once: the arrow stops turning, and you
   accelerate the way it is pointing. Let go and it starts sweeping again.

   That is one key doing both steering and thrust, and it is the reason the
   game is playable by somebody who was handed a laptop four seconds ago. You
   are not aiming, you are choosing a moment — which is a thing people are
   good at without being told.

   Knock the other one out of the ring. The ring shrinks the whole time, which
   is not decoration: it is what makes the game finish. Two players who never
   press anything are not in a stalemate, they are both about to be standing
   outside a circle that used to be under them.

   No DOM here. Two bots can play a thousand rounds in a test.
   ─────────────────────────────────────────────────────────────────────────── */

export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* Every number here was picked by having two bots play a few thousand rounds
   and measuring two things: how long a round lasts, and how often it is
   decided by a shove rather than by the ring quietly closing under somebody.
   The second one is the real test. A sumo game where the ring does the work
   is not a sumo game, and the first draft of these numbers had the ring
   deciding 91% of rounds. These settle at a ten-second round decided by
   contact essentially every time. */
export const RULES = {
  radius: 30,             // a blob
  sweep: 2.3,             // radians per second the arrow turns when you are not holding
  thrust: 1600,           // acceleration while you are
  drag: 3.0,              /* proportional, so there is a top speed — and, more
                             usefully, so overcommitting is recoverable. Low
                             drag made the game one where everybody flew out on
                             their own and never touched each other. */
  bounce: 2.1,            /* deliberately springier than real. A realistic
                             collision makes contact feel like paperwork; this
                             makes a well-timed hit send somebody across the
                             ring, which is the moment the game is sold on. */

  ringStart: 200,
  ringEnd: 38,            // small enough that standing still is eventually fatal
  shrink: 9,              // seconds to get most of the way there

  countdown: 1.5,         // before a round starts
  interval: 1.2,          // after a point, before the next one
  target: 5,              // points to win the match
};

export const STATE = { COUNTDOWN: 'countdown', PLAYING: 'playing', POINT: 'point', OVER: 'over' };

export class Bout {
  constructor({ seed = 1, rules = RULES } = {}) {
    this.rules = rules;
    this.reset(seed);
  }

  reset(seed = (Math.random() * 1e9) | 0) {
    this.seed = seed >>> 0;
    this.rand = rng(this.seed);
    this.score = [0, 0];
    this.round = 0;
    this.events = [];
    this.winner = -1;
    this.newRound();
    return this;
  }

  newRound() {
    const R = this.rules;
    this.round++;
    this.time = 0;
    this.acc = 0;
    this.timer = R.countdown;
    this.state = STATE.COUNTDOWN;
    this.out = -1;
    /* Opposite each other, and a different pair of spots every round so the
       opening is not a memorised move. */
    const a = this.rand() * TAU;
    const d = R.ringStart * 0.55;
    this.players = [0, 1].map((i) => {
      const t = a + i * Math.PI;
      return {
        i,
        x: Math.cos(t) * d,
        y: Math.sin(t) * d,
        vx: 0, vy: 0,
        angle: t + Math.PI,     // facing the middle, so nobody starts aimed at the exit
        hold: false,
        alive: true,
      };
    });
    return this;
  }

  /** The ring a moment into the round. Shrinks towards a floor, never past it. */
  get ring() {
    const R = this.rules;
    if (this.state === STATE.COUNTDOWN) return R.ringStart;
    const t = 1 - Math.exp(-this.time / R.shrink);
    return R.ringStart + (R.ringEnd - R.ringStart) * t;
  }

  /** The one button, for player 0 or 1. */
  hold(i, down) {
    const p = this.players[i];
    if (!p) return false;
    p.hold = !!down && this.state === STATE.PLAYING;
    return p.hold;
  }

  step(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return this;
    if (dt > 0.5) return this;              // a backgrounded tab is not a forfeit
    const SLICE = 1 / 120;
    this.acc += dt;
    let guard = 0;
    /* The epsilon: adding 1/144 to itself lands a hair under a whole number of
       slices, and without it one slice fires late at some frame rates and not
       at others. A rounding error is not a rule. */
    while (this.acc >= SLICE - 1e-9 && guard++ < 240) {
      this.acc -= SLICE;
      this.advance(SLICE);
    }
    return this;
  }

  advance(h) {
    const R = this.rules;

    if (this.state === STATE.OVER) return;

    if (this.state === STATE.COUNTDOWN || this.state === STATE.POINT) {
      this.timer -= h;
      if (this.timer <= 0) {
        if (this.state === STATE.POINT) {
          if (Math.max(...this.score) >= R.target) {
            this.state = STATE.OVER;
            this.winner = this.score[0] > this.score[1] ? 0 : 1;
            this.events.push({ kind: 'match', winner: this.winner });
          } else this.newRound();
        } else {
          this.state = STATE.PLAYING;
          this.events.push({ kind: 'go' });
        }
      }
      return;
    }

    this.time += h;

    for (const p of this.players) {
      if (!p.alive) continue;
      if (p.hold) {
        p.vx += Math.cos(p.angle) * R.thrust * h;
        p.vy += Math.sin(p.angle) * R.thrust * h;
      } else {
        p.angle = (p.angle + R.sweep * h) % TAU;
      }
      const k = Math.max(0, 1 - R.drag * h);
      p.vx *= k; p.vy *= k;
      p.x += p.vx * h;
      p.y += p.vy * h;
    }

    this.collide();

    // and then the ring decides who is still standing on something
    const r = this.ring;
    const outs = this.players.filter((p) => p.alive && Math.hypot(p.x, p.y) > r);
    if (outs.length) {
      /* Both at once: whoever is further out went first. Deterministic, which
         matters — a coin flip for the match point would be indefensible. */
      outs.sort((a, b) => Math.hypot(b.x, b.y) - Math.hypot(a.x, a.y));
      const loser = outs[0];
      loser.alive = false;
      this.out = loser.i;
      const winner = 1 - loser.i;
      this.score[winner]++;
      this.state = STATE.POINT;
      this.timer = R.interval;
      this.events.push({ kind: 'out', loser: loser.i, winner });
    }
  }

  /** Two equal circles, bounced apart harder than physics would. */
  collide() {
    const R = this.rules;
    const [a, b] = this.players;
    if (!a.alive || !b.alive) return;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const min = R.radius * 2;
    if (dist >= min || dist === 0) return;

    const nx = dx / dist, ny = dy / dist;
    // push them apart so they cannot settle inside each other and buzz
    const overlap = (min - dist) / 2;
    a.x -= nx * overlap; a.y -= ny * overlap;
    b.x += nx * overlap; b.y += ny * overlap;

    // equal masses: swap the components along the line between them
    const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rel > 0) return;                    // already separating
    const j = -(1 + R.bounce) * rel / 2;
    a.vx -= j * nx; a.vy -= j * ny;
    b.vx += j * nx; b.vy += j * ny;
    this.events.push({ kind: 'clash', force: Math.abs(rel) });
  }
}

/* ── an opponent for one player ──────────────────────────────────────────────
   Not clever, and deliberately so. It waits until its arrow points at the
   other blob with the middle of the ring behind it — that is, until pushing
   would send them towards the edge — and holds. When it is the one in trouble
   it aims at the middle instead. A bot that never made a mistake would not be
   an opponent, it would be a wall, so `sloppiness` blurs the moment it picks. */

export function botHold(bout, i, { sloppiness = 0.16, rand = Math.random } = {}) {
  if (bout.state !== STATE.PLAYING) return false;
  const me = bout.players[i], them = bout.players[1 - i];
  if (!me.alive || !them.alive) return false;

  const edge = Math.hypot(me.x, me.y) / Math.max(1, bout.ring);
  // in danger: point at the middle and go
  const tx = edge > 0.66 ? -me.x : them.x - me.x;
  const ty = edge > 0.66 ? -me.y : them.y - me.y;

  const want = Math.atan2(ty, tx);
  let off = Math.abs(((me.angle - want + Math.PI) % TAU + TAU) % TAU - Math.PI);
  off += (rand() - 0.5) * sloppiness * 2;
  return off < 0.28;
}

/* ── remembering ─────────────────────────────────────────────────────────────
   localStorage throws outright in a private window with site data blocked, so
   every access is wrapped. */

export const store = {
  get(key, fallback = 0) {
    try { return Number(localStorage.getItem(key)) || fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, String(value)); } catch { /* nothing to do */ }
  },
  wins() { return { you: this.get('sumo.you', 0), bot: this.get('sumo.bot', 0) }; },
  record(youWon) {
    const w = this.wins();
    if (youWon) this.set('sumo.you', w.you + 1); else this.set('sumo.bot', w.bot + 1);
    return this.wins();
  },
};
