/* ───────────────────────────────────────────────────────────────────────────
   covers/schedule.js — can this party sit there, and if not, why not.

   Everything a host argues with a computer about lives in this file. It has no
   DOM in it and no opinions about screens, which means the rules can be tested
   directly — and the rules are the product. A table-management system that
   looks beautiful and lets you double-book table 12 is worth nothing.

   Two ideas do most of the work:

   THE WINDOW. A booking does not occupy a table for its duration; it occupies
   the table for its duration PLUS the time it takes to clear, wipe and re-lay.
   Systems that forget the turnaround produce books that are perfect on screen
   and impossible in the room.

   THE REFUSAL IS A FEATURE. Anything that says no says why, in the words a
   host would use, and hands back the fix where there is one. "Cannot seat" is
   a dead end; "Table 7 seats four — join 7 and 8 for six?" is a system that
   knows the room.
   ─────────────────────────────────────────────────────────────────────────── */

import { byId, joinable, seats, maxSeats } from './floor.js';

/** Minutes between one party leaving a table and the next one sitting down. */
export const TURNAROUND = 15;

/* A Saturday. Last orders at half ten, doors at midnight — which matters more
   than it sounds: with a 23:30 close, the latest a party of six could start a
   two-hour sitting was 21:30, every six-capable arrangement in the room was
   busy until after that, and the system had nothing whatever to offer a large
   party. The room was not the problem; the closing time was. */
export const SERVICE = { opens: 17 * 60, closes: 24 * 60, lastOrders: 22 * 60 + 30 };

/**
 * Does a sitting of this length, starting here, fit inside service?
 *
 * One function, used by everything that either offers a time or validates one.
 * It exists because they disagreed: nextAvailable() only checked the start was
 * before last orders, so it offered a party of six 21:45 — a two-hour sitting
 * finishing a quarter of an hour after the doors are locked — and canSeat()
 * then refused the very slot the system had just recommended. A rule written
 * twice is a rule that will be enforced once.
 */
export function fitsInService(at, duration) {
  return at >= SERVICE.opens && at <= SERVICE.lastOrders && at + duration <= SERVICE.closes;
}

/**
 * How long a party of this size will have the table.
 *
 * Rising with party size, because six people order differently from two: more
 * courses, more wine, and nobody leaves until the last one has finished. These
 * are the numbers a real floor runs on, and getting them wrong in the
 * optimistic direction is what produces a queue at the door at half past eight.
 */
export function turnTime(party) {
  if (party <= 2) return 90;
  if (party <= 4) return 105;
  if (party <= 6) return 120;
  if (party <= 8) return 135;
  return 150;
}

/** The whole time a table is unavailable because of this booking. */
export function window_(booking) {
  const dur = booking.duration ?? turnTime(booking.party);
  return { from: booking.at, to: booking.at + dur + TURNAROUND };
}

/**
 * Do two bookings want the same table at the same time?
 *
 * A booking with no status yet — one being typed, or one being dragged around
 * before it is committed — counts as live. Treating a missing status as "not
 * holding a table" meant a new booking clashed with nothing at all, and the
 * only symptom was that you could drop it straight onto an occupied table and
 * the system would smile and accept it.
 */
export function clashes(a, b) {
  if (a.id === b.id) return false;
  if (!live(a) || !live(b)) return false;
  const shared = (a.tableIds || []).some((t) => (b.tableIds || []).includes(t));
  if (!shared) return false;
  const wa = window_(a), wb = window_(b);
  return wa.from < wb.to && wb.from < wa.to;
}

/** Statuses that actually hold a table. A no-show or a cancellation does not. */
export const LIVE = new Set([
  'booked', 'confirmed', 'arrived', 'seated', 'main', 'dessert', 'bill',
]);

/** Does this booking hold a table? An unsaved one, with no status, does. */
export const live = (x) => x.status === undefined || LIVE.has(x.status);

/** Statuses that mean the party is physically in the building. */
export const IN_HOUSE = new Set(['seated', 'main', 'dessert', 'bill']);

/** Every pair in the book that cannot both be true. */
export function conflicts(bookings) {
  const out = [];
  for (let i = 0; i < bookings.length; i++) {
    for (let j = i + 1; j < bookings.length; j++) {
      if (clashes(bookings[i], bookings[j])) {
        const shared = bookings[i].tableIds.filter((t) => bookings[j].tableIds.includes(t));
        out.push({ a: bookings[i], b: bookings[j], tables: shared });
      }
    }
  }
  return out;
}

/** Is this set of tables free for this window, ignoring one booking? */
export function tablesFree(tableIds, at, duration, bookings, ignoreId = null) {
  const probe = { id: '__probe', at, duration, tableIds, status: 'booked' };
  return !bookings.some((b) => b.id !== ignoreId && clashes(probe, b));
}

/** Which booking is holding a table at a given minute, if any. */
export function holderOf(tableId, at, bookings) {
  return bookings.find((b) => {
    if (!live(b) || !(b.tableIds || []).includes(tableId)) return false;
    const w = window_(b);
    return at >= w.from && at < w.to;
  }) || null;
}

/* ── putting a party somewhere ───────────────────────────────────────────── */

/**
 * Rank an arrangement for a party. Lower is better.
 *
 * The rules a good host follows without thinking about them:
 *   · don't waste seats — a two on a six is two covers you cannot sell
 *   · one table beats two pushed together, every time
 *   · keep a party in one zone's character: twos at the window, sixes in
 *     the snug, and don't put a four in the middle of the banquette run if
 *     it blocks the only place an eight could go later
 */
export function score(group, party) {
  const cap = seats(group);
  let s = (cap - party) * 10;              // wasted seats, heavily penalised
  s += (group.length - 1) * 14;            // joining tables is work and noise
  if (group[0].zone === 'snug' && party < 5) s += 30;   // don't burn the big room
  if (group[0].zone === 'window' && party <= 2) s -= 8; // twos belong at the window
  if (cap === party) s -= 12;              // an exact fit is a happy fit
  /* A tiebreak, so two equally good arrangements always rank the same way
     round. Without it the suggestion a refusal makes changes between runs for
     no reason a user could ever explain. */
  return s + group[0].id / 1000;
}

/**
 * Where could this party sit?
 *
 * Returns ranked arrangements that are big enough and free for the whole
 * window. `squeeze` also returns arrangements that only work at maximum
 * capacity — a host will put six on a four-top for a birthday, and the system
 * should offer it rather than pretend it is impossible, but it must be marked
 * so nobody does it by accident.
 */
export function findTables(party, at, bookings, { duration, ignoreId = null, squeeze = false, limit = 6, exclude = null } = {}) {
  const dur = duration ?? turnTime(party);
  const skip = exclude && exclude.length ? exclude.slice().sort().join(',') : null;
  const out = [];
  for (const group of joinable(3)) {
    /* `exclude` drops one exact arrangement from the results, and it exists for
       one reason: a refusal that suggests the table the party is already on is
       not a suggestion. Taking it applies a move to where they already are,
       and the system then reports having moved them, which is worse than
       saying nothing. */
    if (skip && group.map((t) => t.id).sort().join(',') === skip) continue;
    const cap = seats(group);
    const max = maxSeats(group);
    if (cap < party && !(squeeze && max >= party)) continue;
    if (!tablesFree(group.map((t) => t.id), at, dur, bookings, ignoreId)) continue;
    out.push({
      tables: group,
      tableIds: group.map((t) => t.id),
      label: group.map((t) => t.name).join(' + '),
      seats: cap,
      tight: cap < party,
      score: score(group, party) + (cap < party ? 60 : 0),
    });
  }
  return out.sort((a, b) => a.score - b.score).slice(0, limit);
}

/**
 * The next times this party could be offered, when their first choice is gone.
 *
 * Walks outward from the requested time in fifteen-minute steps, nearest
 * first, so the host is offered "quarter of an hour either side" rather than
 * a list starting at five o'clock.
 */
export function nextAvailable(party, wanted, bookings, { span = 150, step = 15, exclude = null, notBefore = null } = {}) {
  const out = [];
  const dur = turnTime(party);
  for (let d = step; d <= span; d += step) {
    for (const at of [wanted - d, wanted + d]) {
      /* You cannot seat anybody in the past. Walking outward from the wanted
         time finds earlier slots as well as later ones, which is right when
         somebody rings up tomorrow and wrong when it is twenty to eight and
         the system cheerfully offers to move a booking to quarter past six. */
      if (notBefore != null && at < notBefore) continue;
      if (!fitsInService(at, dur)) continue;
      const hit = findTables(party, at, bookings, { limit: 1, exclude });
      if (hit.length) out.push({ at, ...hit[0] });
    }
  }
  return out;
}

/* ── the answer to "can I put them there" ────────────────────────────────── */

/**
 * Validate a specific assignment, and explain any refusal.
 *
 * This is the function behind every drag on the floor plan, and its job is not
 * to return false. Its job is to return the sentence a head waiter would say,
 * and — where the room allows one — the thing to do instead.
 */
export function canSeat(booking, tableIds, bookings, { squeeze = false, now = null } = {}) {
  const group = tableIds.map((id) => byId.get(id)).filter(Boolean);
  if (!group.length) return { ok: false, code: 'no-table', message: 'No table selected.' };

  if (group.some((t) => t.zone === 'bar')) {
    return { ok: false, code: 'bar', message: 'The bar is walk-ins only — it is never booked.' };
  }

  /* Every table in a multi-table assignment has to actually touch the others.
     Without this you can hold table 3 and table 19 for one party, which reads
     as perfectly valid in a database and is two strangers sharing a birthday. */
  if (group.length > 1 && !connected(group)) {
    return {
      ok: false, code: 'not-adjacent',
      message: `${group.map((t) => t.name).join(' and ')} are not next to each other.`,
    };
  }

  const cap = seats(group);
  const max = maxSeats(group);
  const names = group.map((t) => t.name).join(' + ');

  if (booking.party > max) {
    return {
      ok: false, code: 'too-small',
      message: `${names} seats ${cap}. This is a party of ${booking.party}.`,
      suggestion: wayForward(booking, bookings, { now }),
    };
  }

  if (booking.party > cap && !squeeze) {
    return {
      ok: false, code: 'squeeze',
      message: `${names} seats ${cap} comfortably. You can force ${booking.party} on at a push.`,
      squeeze: { tableIds, label: names, note: `Squeeze ${booking.party} onto ${names}` },
    };
  }

  const dur = booking.duration ?? turnTime(booking.party);
  const probe = { ...booking, status: booking.status ?? 'booked', tableIds, duration: dur };
  const busy = bookings.find((b) =>
    b.id !== booking.id && live(b)
    && (b.tableIds || []).some((t) => tableIds.includes(t))
    && clashes(probe, b));

  if (busy) {
    const w = window_(busy);
    return {
      ok: false, code: 'taken',
      message: `${busy.name} has ${names} until ${hhmm(w.to)}.`,
      suggestion: wayForward(booking, bookings, { now }),
    };
  }

  if (!fitsInService(booking.at, dur)) {
    return {
      ok: false, code: 'after-close',
      message: `A party of ${booking.party} needs ${dur} minutes. That runs past close at ${hhmm(SERVICE.closes)}.`,
      suggestion: wayForward({ ...booking, at: Math.max(SERVICE.opens, now ?? SERVICE.opens) }, bookings, { now }),
    };
  }

  return {
    ok: true,
    tableIds,
    label: names,
    seats: cap,
    tight: booking.party > cap,
    note: booking.party > cap ? `${booking.party} squeezed onto ${cap} seats` : null,
  };
}

/**
 * The best thing to do instead, for a party that cannot sit where you asked.
 *
 * Another table at the same time if there is one, and a different time if
 * there is not — which is what a host does when the room is full: ring them
 * and move them by half an hour. Excluding the tables they are already on
 * matters here, because otherwise the only free six-top at 20:30 is the one
 * they are sitting at, and "use the snug instead" is advice to do nothing.
 *
 * Returns nothing only when the night genuinely cannot take them, and the
 * interface then says exactly that rather than offering a dead button.
 */
export function wayForward(booking, bookings, { now = null } = {}) {
  const alt = findTables(booking.party, booking.at, bookings,
    { ignoreId: booking.id, limit: 1, exclude: booking.tableIds })[0];
  if (alt) {
    return { tableIds: alt.tableIds, label: alt.label, note: `${alt.label} is free at ${hhmm(booking.at)}` };
  }
  const later = nextAvailable(booking.party, booking.at, bookings, { span: 150, notBefore: now })[0];
  if (later) {
    const shift = later.at - booking.at;
    return {
      tableIds: later.tableIds, label: later.label, at: later.at,
      note: `Nothing at ${hhmm(booking.at)} — ${hhmm(later.at)} on ${later.label} (${shift > 0 ? '+' : ''}${shift} min)`,
    };
  }
  return null;
}

/** Are these tables one connected run? */
export function connected(group) {
  if (group.length < 2) return true;
  const ids = new Set(group.map((t) => t.id));
  const seen = new Set([group[0].id]);
  const stack = [group[0]];
  while (stack.length) {
    const t = stack.pop();
    for (const n of t.joins) {
      if (ids.has(n) && !seen.has(n)) { seen.add(n); stack.push(byId.get(n)); }
    }
  }
  return seen.size === group.length;
}

/* ── the shape of a service ──────────────────────────────────────────────── */

/** Covers seated, or due to be, in each fifteen minutes of the evening. */
export function loadCurve(bookings, step = 15) {
  const out = [];
  for (let at = SERVICE.opens; at <= SERVICE.closes; at += step) {
    let covers = 0, parties = 0;
    for (const b of bookings) {
      if (!live(b)) continue;
      const dur = b.duration ?? turnTime(b.party);
      if (at >= b.at && at < b.at + dur) { covers += b.party; parties++; }
    }
    out.push({ at, covers, parties });
  }
  return out;
}

/** What the kitchen is about to be hit with: parties starting in each window. */
export function pacing(bookings, step = 15) {
  const out = [];
  for (let at = SERVICE.opens; at <= SERVICE.lastOrders; at += step) {
    const starting = bookings.filter((b) => LIVE.has(b.status) && b.at >= at && b.at < at + step);
    out.push({
      at,
      parties: starting.length,
      covers: starting.reduce((n, b) => n + b.party, 0),
    });
  }
  return out;
}

/* ── time ────────────────────────────────────────────────────────────────── */

export const hhmm = (m) => {
  const t = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

export const parseTime = (s) => {
  const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  const h = +m[1], mins = +m[2];
  if (h > 23 || mins > 59) return null;
  return h * 60 + mins;
};
