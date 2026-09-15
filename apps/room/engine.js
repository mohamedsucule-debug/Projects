/* ───────────────────────────────────────────────────────────────────────────
   room/engine.js — the investigation.

   Holds what has been looked at, what is therefore known, and what in the
   known set disagrees with itself. Knows nothing about the page and nothing
   about who did it.

   The contradiction rule is the whole of the reasoning and it is three lines:
   group the known facts by claim, and any claim holding more than one value is
   a contradiction. That is why it can be trusted. A hand-written list of "fact
   A clashes with fact B" would go stale the first time the story was edited,
   and it would let the case appear to reason while really reading out answers.
   ─────────────────────────────────────────────────────────────────────────── */

import { OBJECTS, STATEMENTS, CLAIMS, SUSPECTS, SOLUTION } from './case.js';

const byId = new Map(OBJECTS.map((o) => [o.id, o]));

export class Investigation {
  constructor() {
    this.examined = new Set();   // objects turned over
    this.heard = new Set();      // suspects questioned
    this.order = [];             // and the order it happened in
  }

  /** The things visible in the room right now: everything whose `needs` is met. */
  available() {
    return OBJECTS.filter((o) => !o.needs || this.examined.has(o.needs));
  }

  /** Has this been looked at, and can it be? */
  state(id) {
    const o = byId.get(id);
    if (!o) return 'missing';
    if (this.examined.has(id)) return 'examined';
    if (o.needs && !this.examined.has(o.needs)) return 'hidden';
    return 'new';
  }

  /**
   * Look at something.
   *
   * Returns what it opened up, so the interface can point at the new thing
   * rather than leaving the player to hunt for what changed. Looking twice is
   * not an error and does not double-count.
   */
  examine(id) {
    const o = byId.get(id);
    if (!o) return { ok: false, why: 'no such thing' };
    if (o.needs && !this.examined.has(o.needs)) {
      return { ok: false, why: `you have not looked at ${byId.get(o.needs).name.toLowerCase()} yet` };
    }
    const fresh = !this.examined.has(id);
    if (fresh) { this.examined.add(id); this.order.push({ kind: 'object', id }); }
    const opened = (o.reveals || []).filter((r) => byId.has(r));
    return { ok: true, fresh, object: o, opened };
  }

  /** Question somebody. Their statement carries facts like anything else does. */
  question(who) {
    const s = STATEMENTS.find((x) => x.who === who);
    if (!s) return { ok: false, why: 'nobody by that name' };
    const fresh = !this.heard.has(who);
    if (fresh) { this.heard.add(who); this.order.push({ kind: 'statement', id: who }); }
    return { ok: true, fresh, statement: s };
  }

  /** Everything known so far, each tagged with where it came from. */
  facts() {
    const out = [];
    for (const o of OBJECTS) {
      if (!this.examined.has(o.id)) continue;
      for (const f of o.facts) out.push({ ...f, from: o.name, fromId: o.id, kind: 'object' });
    }
    for (const s of STATEMENTS) {
      if (!this.heard.has(s.who)) continue;
      const who = SUSPECTS.find((p) => p.id === s.who);
      for (const f of s.facts) out.push({ ...f, from: who ? who.name : s.who, fromId: s.who, kind: 'statement' });
    }
    return out;
  }

  /**
   * Claims where what is known disagrees with itself.
   *
   * This is the entire deduction. Two facts about the same question, giving it
   * two different answers — one of them is wrong, and which one is the
   * player's problem, not the engine's.
   */
  contradictions() {
    const byClaim = new Map();
    for (const f of this.facts()) {
      if (!byClaim.has(f.claim)) byClaim.set(f.claim, []);
      byClaim.get(f.claim).push(f);
    }
    const out = [];
    for (const [claim, facts] of byClaim) {
      const values = new Set(facts.map((f) => f.value));
      if (values.size < 2) continue;
      out.push({
        claim,
        question: CLAIMS[claim].q,
        sides: [...values].map((value) => ({
          value,
          reads: CLAIMS[claim][value],
          facts: facts.filter((f) => f.value === value),
        })),
      });
    }
    return out;
  }

  /** How much of the room has been turned over, 0..1. */
  progress() {
    const reachable = OBJECTS.length;
    return {
      examined: this.examined.size,
      objects: reachable,
      heard: this.heard.size,
      people: STATEMENTS.length,
      found: this.contradictions().length,
      contradictions: countContradictions(),
    };
  }

  /**
   * Name somebody.
   *
   * The verdict is not "right" or "wrong" — it is whether the accusation was
   * *earned*. Naming the right man on a hunch, having looked at four things,
   * is a guess, and a case that congratulates a guess teaches the player that
   * looking was optional.
   */
  accuse(who) {
    const person = SUSPECTS.find((p) => p.id === who);
    if (!person) return { ok: false, why: 'nobody by that name' };
    const right = who === SOLUTION.guilty;
    const missing = SOLUTION.proof.filter((id) => !this.examined.has(id));
    const found = this.contradictions().map((c) => c.claim);

    return {
      ok: true,
      right,
      /* Earned means: the right man, and the things that prove it actually
         looked at. Everything else — including the right answer for the wrong
         reasons — is told plainly what it was. */
      earned: right && missing.length === 0,
      person,
      guilty: SUSPECTS.find((p) => p.id === SOLUTION.guilty),
      because: SOLUTION.because,
      missed: SOLUTION.missed[who] || null,
      missing: missing.map((id) => byId.get(id)),
      found,
      total: countContradictions(),
    };
  }
}

/** How many contradictions the finished case contains, for the score line. */
export function countContradictions() {
  const byClaim = new Map();
  for (const o of OBJECTS) for (const f of o.facts) push(byClaim, f);
  for (const s of STATEMENTS) for (const f of s.facts) push(byClaim, f);
  let n = 0;
  for (const values of byClaim.values()) if (values.size > 1) n++;
  return n;
}
function push(map, f) {
  if (!map.has(f.claim)) map.set(f.claim, new Set());
  map.get(f.claim).add(f.value);
}

/**
 * Check the case holds together, at load, in the browser as well as in tests.
 *
 * A mystery whose data has drifted is not a bug you notice — it is a clue that
 * quietly stops pointing anywhere, and the player just finds the case a bit
 * thin. So the case checks itself and says so out loud.
 */
export function audit() {
  const problems = [];
  const ids = new Set(OBJECTS.map((o) => o.id));

  for (const o of OBJECTS) {
    if (o.needs && !ids.has(o.needs)) problems.push(`${o.id} needs ${o.needs}, which does not exist`);
    for (const r of o.reveals || []) {
      if (!ids.has(r)) problems.push(`${o.id} reveals ${r}, which does not exist`);
      else if (byId.get(r).needs !== o.id) problems.push(`${o.id} reveals ${r}, but ${r} does not need it`);
    }
    for (const f of o.facts) checkFact(f, o.id, problems);
  }
  for (const s of STATEMENTS) {
    if (!SUSPECTS.some((p) => p.id === s.who)) problems.push(`a statement from ${s.who}, who is not a suspect`);
    for (const f of s.facts) checkFact(f, s.who, problems);
  }

  /* Every hidden thing must be reachable, or it is written and never seen. */
  for (const o of OBJECTS) {
    if (o.needs && !OBJECTS.some((p) => (p.reveals || []).includes(o.id))) {
      problems.push(`${o.id} is hidden behind ${o.needs} but nothing reveals it`);
    }
  }
  /* And everything that proves the case must be reachable from the room. */
  for (const id of SOLUTION.proof) {
    if (!ids.has(id)) problems.push(`the proof names ${id}, which is not in the room`);
  }
  if (!SUSPECTS.some((p) => p.id === SOLUTION.guilty)) problems.push('the guilty party is not a suspect');

  return problems;
}

function checkFact(f, src, problems) {
  const claim = CLAIMS[f.claim];
  if (!claim) { problems.push(`${src} asserts ${f.claim}, which is not a claim`); return; }
  if (!(f.value in claim)) problems.push(`${src} gives ${f.claim} the value ${f.value}, which it does not take`);
  if (!f.says || f.says.length < 10) problems.push(`${src} has a fact with nothing to say`);
}
