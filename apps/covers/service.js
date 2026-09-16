/* ───────────────────────────────────────────────────────────────────────────
   covers/service.js — what the room does while you watch it.

   Time is the thing a booking system is actually about, and it is the thing
   demos leave out: a static floor plan of coloured rectangles tells you
   nothing about whether the night works. Here the clock runs, and the room
   responds — parties sit, work through their courses, ask for the bill and
   leave, tables come free, people waiting at the bar get sat, and anybody who
   has not turned up twenty minutes after their slot becomes a no-show and
   gives their table back.

   All of it is a pure function of the clock, which means the whole evening can
   be played through in a test in a few milliseconds and asserted on.
   ─────────────────────────────────────────────────────────────────────────── */

import { turnTime, LIVE, IN_HOUSE, SERVICE, hhmm, findTables, tablesFree, fitsInService } from './schedule.js';
import { PROGRESSION } from './book.js';

/** How long after their slot a party stops being late and starts being a no-show. */
export const NOSHOW_AFTER = 20;

/**
 * How late this party will be, in minutes. Negative means early.
 *
 * Derived from the booking's own id, so it is the same every time the night is
 * played and a bug can be reproduced. Without this, running the clock forward
 * turned every remaining booking into a no-show and emptied the restaurant —
 * the run-the-service control did the exact opposite of what it exists to
 * show. Real parties turn up: a few early, most within ten minutes, and the
 * odd one never.
 */
export function arrivalOffset(booking) {
  if (booking.willNoShow) return Infinity;
  let h = 0;
  for (const ch of String(booking.id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 16) - 4;                       // −4 to +11 minutes
}

/**
 * Where a seated party should be in their meal, as a fraction of their turn.
 *
 * Deliberately not even quarters: people sit and talk before ordering, mains
 * take the longest, and the gap between asking for the bill and actually
 * leaving is the one every restaurant underestimates.
 */
export const COURSES = [
  { status: 'seated',  until: 0.22 },
  { status: 'main',    until: 0.58 },
  { status: 'dessert', until: 0.80 },
  { status: 'bill',    until: 0.93 },
  { status: 'paid',    until: 1.00 },
];

/** What this booking's status should be at `now`, given when they sat. */
export function courseAt(booking, now) {
  const seatedAt = booking.seatedAt ?? booking.at;
  const dur = booking.duration ?? turnTime(booking.party);
  const through = (now - seatedAt) / dur;
  if (through < 0) return booking.status;
  for (const c of COURSES) if (through < c.until) return c.status;
  return 'left';
}

/**
 * Move the world on to `now`.
 *
 * Returns the events it caused rather than only mutating, so the interface can
 * say what happened — "Delacroix asked for the bill", "table 14 is free" —
 * instead of the floor plan silently changing colour and hoping somebody
 * noticed.
 */
export function tick(state, now) {
  const events = [];
  const before = state.now;
  state.now = now;
  if (now <= before) return events;

  for (const b of state.book) {
    if (!LIVE.has(b.status)) continue;

    /* Somebody at the door gets sat as soon as their table is clear — and not
       before. Seating them the moment they arrive regardless is how you end up
       with two parties on table 14, and it also hides the thing this product
       is about: the wait at the door while the previous table finishes
       coffee. Their meal is timed from when they actually sat, so a party sat
       twenty minutes late still gets their full turn, which is fair and is
       also what makes the rest of the night run late. */
    if (b.status === 'arrived') {
      const dur = b.duration ?? turnTime(b.party);
      if (!tablesFree(b.tableIds, now, dur, state.book, b.id)) {
        if (!b.waitingSince) b.waitingSince = now;
        continue;
      }
      b.seatedAt = now;
      b.status = 'seated';
      events.push({
        at: now, kind: 'seated', booking: b,
        text: b.waitingSince
          ? `${b.name} sat on ${tableNames(b)} after ${now - b.waitingSince} min at the door`
          : `${b.name} sat on ${tableNames(b)}`,
      });
      continue;
    }

    if (IN_HOUSE.has(b.status) || b.status === 'paid') {
      const next = courseAt(b, now);
      if (next !== b.status) {
        const was = b.status;
        b.status = next;
        if (next === 'left') {
          events.push({ at: now, kind: 'left', booking: b, text: `${tableNames(b)} is free — ${b.name} left` });
        } else if (next === 'bill') {
          events.push({ at: now, kind: 'bill', booking: b, text: `${b.name} asked for the bill` });
        } else if (was !== 'seated' || next !== 'seated') {
          events.push({ at: now, kind: 'course', booking: b, text: `${b.name} on ${next}` });
        }
      }
      continue;
    }

    /* Due. Most parties turn up somewhere around their slot; a booking that is
       only a little late is still a booking. Past twenty minutes the table
       goes back into the room, because holding it any longer costs a cover you
       could have sold. */
    if ((b.status === 'booked' || b.status === 'confirmed') && now >= b.at) {
      const offset = arrivalOffset(b);
      if (Number.isFinite(offset) && now >= b.at + offset) {
        b.status = 'arrived';
        events.push({
          at: now, kind: 'arrived', booking: b,
          text: offset > 4 ? `${b.name} arrived, ${offset} min late` : `${b.name} arrived`,
        });
      } else if (now - b.at >= NOSHOW_AFTER) {
        b.status = 'noshow';
        events.push({ at: now, kind: 'noshow', booking: b, text: `${b.name} did not arrive — ${tableNames(b)} released` });
      } else if (!b.flaggedLate) {
        b.flaggedLate = true;
        events.push({ at: now, kind: 'late', booking: b, text: `${b.name} is due — ${tableNames(b)}` });
      }
    }
  }

  return events;
}

const tableNames = (b) => (b.tableIds || []).join(' + ') || 'no table';

/** A snapshot of the room, for the numbers along the bottom of the screen. */
export function summary(state) {
  const { book, waitlist, now } = state;
  const inHouse = book.filter((b) => IN_HOUSE.has(b.status));
  const done = book.filter((b) => b.status === 'left' || b.status === 'paid');
  const due = book.filter((b) => (b.status === 'booked' || b.status === 'confirmed') && b.at >= now && b.at < now + 45);
  return {
    seatedCovers: inHouse.reduce((n, b) => n + b.party, 0),
    seatedParties: inHouse.length,
    servedCovers: done.reduce((n, b) => n + b.party, 0) + inHouse.reduce((n, b) => n + b.party, 0),
    bookedCovers: book.filter((b) => LIVE.has(b.status)).reduce((n, b) => n + b.party, 0),
    dueSoon: due.length,
    waiting: waitlist.length,
    waitingCovers: waitlist.reduce((n, w) => n + w.party, 0),
    noshows: book.filter((b) => b.status === 'noshow').length,
    remaining: Math.max(0, SERVICE.lastOrders - now),
  };
}

/**
 * How long until a table comes free, for the people standing at the bar.
 *
 * The number a host is asked every ninety seconds on a Saturday, and the one
 * they are worst at guessing. Rounded up to five minutes, because "about
 * twenty-five minutes" is an answer and "23 minutes" is a promise.
 */
export function waitFor(party, state) {
  const { book, now } = state;
  const dur = turnTime(party);
  for (let at = now; at <= SERVICE.lastOrders; at += 5) {
    if (!fitsInService(at, dur)) continue;
    const hit = findTables(party, at, book, { limit: 1 });
    if (hit.length) {
      return { at, minutes: Math.ceil((at - now) / 5) * 5, table: hit[0] };
    }
  }
  return null;
}

/** Times a host would read out, for a party of this size tonight. */
export function offerTimes(party, state, from = SERVICE.opens) {
  const { book } = state;
  const out = [];
  const dur = turnTime(party);
  for (let at = Math.max(from, state.now); at <= SERVICE.lastOrders; at += 15) {
    /* Same rule as everywhere else: a time is only offerable if the whole
       sitting finishes before the doors are locked. */
    if (!fitsInService(at, dur)) continue;
    const hit = findTables(party, at, book, { limit: 1 });
    if (hit.length) out.push({ at, label: hhmm(at), ...hit[0] });
  }
  return out;
}
