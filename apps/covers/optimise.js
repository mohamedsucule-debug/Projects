/* ───────────────────────────────────────────────────────────────────────────
   covers/optimise.js — turning a no into a yes.

   Everything else in this system answers the question a host asks: can these
   people sit there? This file answers the question the host's manager asks:
   could we have fitted more people in?

   Two jobs.

   MAKE ROOM. Somebody rings up wanting a table at eight and the answer is no.
   A good host does not stop there — they look at the book and see that if
   Lindqvist went on 11 instead of 15, the six could have 15 and 16 together.
   That is a search over rearrangements of the night, and it is the single most
   valuable thing a booking system can do, because every one it finds is a
   table's worth of revenue that would otherwise have walked down the road.

   REPLAN. The same idea over the whole evening: take everything that has not
   sat down yet and lay it out again from scratch, better. Nobody who is eating
   is touched, because you cannot ask a table halfway through their main to
   move, and a system that suggests it will never be trusted again.

   Both are pure, both are bounded, and both refuse rather than guess: if the
   search cannot find something demonstrably better, it says so.
   ─────────────────────────────────────────────────────────────────────────── */

import { joinable, seats, byId, BOOKABLE } from './floor.js';
import {
  turnTime, LIVE, IN_HOUSE, findTables, tablesFree, score, fitsInService,
  conflicts, hhmm,
} from './schedule.js';

/** Bookings that cannot be moved: sitting down, gone, or already history. */
export function isPinned(b, now) {
  return IN_HOUSE.has(b.status) || b.status === 'arrived'
    || !LIVE.has(b.status) || b.at < now;
}

/** What a layout is worth: covers seated, less the seats left empty on tables. */
export function value(book) {
  const live = book.filter((b) => LIVE.has(b.status) && b.tableIds.length);
  let covers = 0, waste = 0, joins = 0;
  for (const b of live) {
    const group = b.tableIds.map((id) => byId.get(id)).filter(Boolean);
    if (!group.length) continue;
    covers += b.party;
    waste += Math.max(0, seats(group) - b.party);
    if (group.length > 1) joins++;
  }
  return {
    covers, waste, joins,
    unseated: book.filter((b) => LIVE.has(b.status) && !b.tableIds.length).length,
    conflicts: conflicts(book).length,
  };
}

/**
 * Can this party be fitted in, if we are allowed to move other people?
 *
 * Breadth-first over rearrangements, up to `maxMoves` deep. Depth one is
 * "move one booking out of the way"; depth two is "move one booking, which
 * needs another booking moved to make space for it". Beyond two the search
 * stops, not because it could not go further but because a suggestion nobody
 * can hold in their head is a suggestion nobody will take — "move three
 * parties so this party can sit" is not advice, it is a demand.
 *
 * Only bookings that have not sat down are ever moved. Everything in the room
 * is fixed.
 */
export function makeRoom(party, at, book, { now = 0, maxMoves = 2, limit = 3 } = {}) {
  const dur = turnTime(party);
  if (!fitsInService(at, dur)) return [];

  const direct = findTables(party, at, book, { limit: 1 });
  if (direct.length) return [{ moves: [], tableIds: direct[0].tableIds, label: direct[0].label, cost: 0 }];

  const found = [];

  for (const group of joinable(3)) {
    if (seats(group) < party) continue;
    const ids = group.map((t) => t.id);

    /* Who is in the way, and can any of them be moved at all? */
    const blockers = book.filter((b) =>
      LIVE.has(b.status) && b.tableIds.some((id) => ids.includes(id))
      && overlaps(b, at, dur));
    if (!blockers.length) continue;                 // free already — direct would have found it
    if (blockers.length > maxMoves) continue;
    if (blockers.some((b) => isPinned(b, now))) continue;

    /* Try to rehouse every blocker, one at a time, against a book that already
       reflects the moves made so far. */
    const trial = book.map((b) => ({ ...b, tableIds: [...b.tableIds] }));
    const moves = [];
    let ok = true;

    for (const blocker of blockers) {
      const t = trial.find((b) => b.id === blocker.id);
      t.tableIds = [];                              // lift them off the floor
      const spot = findTables(t.party, t.at, trial, { ignoreId: t.id, limit: 1, exclude: ids })[0];
      if (!spot || spot.tableIds.some((id) => ids.includes(id))) { ok = false; break; }
      t.tableIds = spot.tableIds;
      moves.push({
        id: t.id, name: t.name, party: t.party, at: t.at,
        from: blocker.tableIds, to: spot.tableIds,
        fromLabel: blocker.tableIds.join(' + '), toLabel: spot.label,
      });
    }
    if (!ok) continue;

    /* And check the thing we did all this for actually fits now. */
    if (!tablesFree(ids, at, dur, trial)) continue;

    found.push({
      moves,
      tableIds: ids,
      label: group.map((t) => t.name).join(' + '),
      /* Cheapest first: fewest people disturbed, then least waste. */
      cost: moves.length * 100 + score(group, party),
    });
  }

  return found.sort((a, b) => a.cost - b.cost).slice(0, limit);
}

function overlaps(b, at, dur) {
  const bDur = b.duration ?? turnTime(b.party);
  return b.at < at + dur + 15 && at < b.at + bDur + 15;
}

/**
 * Lay the rest of the night out again, better.
 *
 * Greedy, biggest party first, because a ten is the hardest thing in the book
 * to place and leaving it until last is how you end up unable to seat it at
 * all. Then a local improvement pass: for every booking, try every other
 * arrangement and keep the swap if the layout gets cheaper. It is not optimal
 * — table assignment with joins is bin-packing and optimal is not on the table
 * for a page that has to answer in a frame — but it is reliably better than a
 * book filled in by hand one phone call at a time, which is the thing it is
 * actually competing with.
 *
 * Returns the moves rather than a new book, so the caller can show them before
 * anything happens. A system that silently rearranges somebody's evening is
 * not a tool, it is a hazard.
 */
export function replan(book, { now = 0, passes = 2 } = {}) {
  const before = value(book);
  const trial = book.map((b) => ({ ...b, tableIds: [...b.tableIds] }));

  const movable = trial.filter((b) => LIVE.has(b.status) && !isPinned(b, now));
  const original = new Map(movable.map((b) => [b.id, [...b.tableIds]]));

  for (const b of movable) b.tableIds = [];

  /* Hardest first: big parties, then early ones, then the order they were
     taken, so the result is the same every time it is run. */
  const order = [...movable].sort((a, b) =>
    b.party - a.party || a.at - b.at || String(a.id).localeCompare(String(b.id)));

  const unplaced = [];
  for (const b of order) {
    const spot = findTables(b.party, b.at, trial, { ignoreId: b.id, limit: 1 })[0];
    if (spot) b.tableIds = spot.tableIds;
    else unplaced.push(b);
  }

  /* Local improvement: swap anything that makes the layout cheaper. */
  for (let pass = 0; pass < passes; pass++) {
    let improved = false;
    for (const b of order) {
      if (!b.tableIds.length) continue;
      const here = score(b.tableIds.map((id) => byId.get(id)), b.party);
      const better = findTables(b.party, b.at, trial, { ignoreId: b.id, limit: 3, exclude: b.tableIds })
        .find((o) => o.score < here - 0.5);
      if (better) { b.tableIds = better.tableIds; improved = true; }
    }
    if (!improved) break;
  }

  /* Anything the replan could not place goes back where it was, if that still
     works — losing a booking to make the numbers look better is not an
     improvement, it is a bug with a good press release. */
  for (const b of unplaced) {
    const was = original.get(b.id);
    if (was && was.length && tablesFree(was, b.at, b.duration ?? turnTime(b.party), trial, b.id)) {
      b.tableIds = was;
    }
  }

  const moves = [];
  for (const b of movable) {
    const was = original.get(b.id) || [];
    const now_ = b.tableIds;
    const same = was.length === now_.length && was.every((id) => now_.includes(id));
    if (same) continue;
    moves.push({
      id: b.id, name: b.name, party: b.party, at: b.at,
      from: was, to: now_,
      fromLabel: was.join(' + ') || 'unassigned',
      toLabel: now_.join(' + ') || 'unassigned',
    });
  }

  const after = value(trial);
  return { moves, before, after, unplaced: unplaced.filter((b) => !b.tableIds.length).map((b) => b.name) };
}

/**
 * Is this plan actually better?
 *
 * Asked before anything is offered, because a replan that seats fewer people,
 * or introduces a conflict, or leaves somebody with no table, is not a plan —
 * and the failure mode of every optimiser is confidently producing one.
 */
export function isImprovement(before, after) {
  if (after.conflicts > before.conflicts) return false;
  if (after.unseated > before.unseated) return false;
  if (after.covers < before.covers) return false;
  return after.covers > before.covers
    || after.conflicts < before.conflicts
    || after.waste < before.waste
    || after.joins < before.joins;
}

/** Apply a set of moves to a real book, in place. */
export function applyMoves(book, moves) {
  for (const m of moves) {
    const b = book.find((x) => x.id === m.id);
    if (b) b.tableIds = [...m.to];
  }
  return book;
}

/**
 * What to tell the people standing at the bar.
 *
 * For each of them: the earliest they could be sat if nothing is touched, and
 * the earliest they could be sat if the system is allowed to move somebody who
 * has not arrived yet. The gap between those two numbers is the whole argument
 * for this file — "twenty minutes sooner if I move one booking" is a table you
 * would otherwise have lost to the place across the road.
 *
 * Planned in sequence, not in parallel, against a book that grows as it goes.
 * Costing all three independently gave all three the same answer — the same
 * table, at the same time, by moving the same booking — which is a plan that
 * works exactly once. The biggest party is quoted first, because they are the
 * hardest to place and the one most likely to leave.
 *
 * Bounded: it looks a couple of hours ahead in quarter hours, which is as far
 * as anybody standing at a bar is willing to be quoted.
 */
export function barPlan(waitlist, book, { now = 0, horizon = 150, step = 15 } = {}) {
  const trial = book.map((b) => ({ ...b, tableIds: [...b.tableIds] }));
  const out = [];

  for (const w of [...waitlist].sort((a, b) => b.party - a.party || a.since - b.since)) {
    const dur = turnTime(w.party);
    let plain = null, withMoves = null;
    for (let at = now; at <= now + horizon; at += step) {
      if (!fitsInService(at, dur)) continue;
      if (plain == null && findTables(w.party, at, trial, { limit: 1 }).length) plain = at;
      if (!withMoves) {
        const plan = makeRoom(w.party, at, trial, { now, maxMoves: 1, limit: 1 })[0];
        if (plan) withMoves = { at, plan };
      }
      if (plain != null && withMoves) break;
    }

    const saving = plain != null && withMoves && withMoves.at < plain ? plain - withMoves.at : 0;
    out.push({ ...w, plain, withMoves, saving });

    /* Take the table out of circulation for whoever is quoted next. */
    if (withMoves) {
      applyMoves(trial, withMoves.plan.moves);
      trial.push({
        id: `bar-${w.id}`, name: w.name, party: w.party, at: withMoves.at,
        tableIds: withMoves.plan.tableIds, status: 'booked',
      });
    }
  }
  return out;
}
