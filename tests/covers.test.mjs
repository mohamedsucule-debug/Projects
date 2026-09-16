import { test, assert } from './harness.mjs';
import { TABLES, BOOKABLE, ZONES, byId, joinable, seats, maxSeats, ROOM } from '../apps/covers/floor.js';
import { chairs, groupChairs, outline, tableAt, scaleFor } from '../apps/covers/plan.js';
import {
  turnTime, TURNAROUND, SERVICE, window_, clashes, conflicts, tablesFree,
  findTables, nextAvailable, canSeat, connected, score, loadCurve, pacing,
  hhmm, parseTime, LIVE, IN_HOUSE, holderOf, fitsInService, wayForward,
} from '../apps/covers/schedule.js';
import { freshBook, freshWaitlist, PLANTED_CONFLICT, NOW, STATUS, PROGRESSION } from '../apps/covers/book.js';
import { replan, makeRoom, barPlan, applyMoves, value, isImprovement, isPinned } from '../apps/covers/optimise.js';

const at = (h, m = 0) => h * 60 + m;

/* ── the room ────────────────────────────────────────────────────────────── */

test('every table is inside the room', () => {
  for (const t of TABLES) {
    assert.ok(t.x - t.w / 2 >= 0 && t.x + t.w / 2 <= ROOM.w, `${t.name} is through a side wall`);
    assert.ok(t.y - t.h / 2 >= 0 && t.y + t.h / 2 <= ROOM.h, `${t.name} is through the front or back`);
  }
});

test('no two tables occupy the same floor', () => {
  /* A floor plan that overlaps itself is a floor plan nobody can trust, and it
     is the kind of thing that survives review because it only shows up when
     you draw it. */
  for (let i = 0; i < TABLES.length; i++) {
    for (let j = i + 1; j < TABLES.length; j++) {
      const a = TABLES[i], b = TABLES[j];
      const gapX = Math.abs(a.x - b.x) - (a.w + b.w) / 2;
      const gapY = Math.abs(a.y - b.y) - (a.h + b.h) / 2;
      assert.ok(gapX > -0.01 || gapY > -0.01, `${a.name} and ${b.name} are on top of each other`);
    }
  }
});

test('adjacency is symmetric', () => {
  /* Declared one way in the data and mirrored on load. Without the mirror, 10
     can join 11 but 11 cannot join 10, and which one you drag decides whether
     the join is allowed. */
  for (const t of TABLES) {
    for (const id of t.joins) {
      assert.ok(byId.get(id).joins.includes(t.id), `${t.name} → ${byId.get(id).name} is one-way`);
    }
  }
});

test('tables only join inside their own zone', () => {
  for (const g of joinable(3)) {
    assert.equal(new Set(g.map((t) => t.zone)).size, 1, g.map((t) => t.name).join('+'));
  }
});

test('every joined arrangement is one connected run', () => {
  /* 10 + 12 is not a join: table 11 is between them. Taking combinations of a
     list would offer it; walking the adjacency graph cannot. */
  for (const g of joinable(3)) assert.ok(connected(g), g.map((t) => t.name).join('+'));
});

test('pushing tables together gains the ends', () => {
  const ten = byId.get(10), eleven = byId.get(11);
  assert.equal(seats([ten]), 4);
  assert.equal(seats([ten, eleven]), 9, 'four and four is nine, not eight');
  assert.ok(maxSeats([ten, eleven]) >= seats([ten, eleven]));
});

test('the bar is never bookable', () => {
  assert.ok(TABLES.some((t) => t.zone === 'bar'));
  assert.ok(!BOOKABLE.some((t) => t.zone === 'bar'));
  for (const g of joinable(3)) assert.ok(g[0].zone !== 'bar');
  const r = canSeat({ id: 'x', party: 2, at: at(19) }, [40], []);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'bar');
});

test('the room can seat a party of every ordinary size', () => {
  for (let party = 1; party <= 10; party++) {
    assert.ok(findTables(party, at(19), []).length > 0, `nowhere for a party of ${party}`);
  }
});

/* ── the window a booking really occupies ────────────────────────────────── */

test('a table is held for the meal and the turnaround, not just the meal', () => {
  /* The bug this exists to prevent: a book that is perfect on screen and
     impossible in the room, because nobody left time to clear and re-lay. */
  const w = window_({ at: at(19), party: 2 });
  assert.equal(w.from, at(19));
  assert.equal(w.to, at(19) + turnTime(2) + TURNAROUND);
  assert.equal(w.to, at(20, 45));
});

test('turn time rises with party size', () => {
  let last = 0;
  for (const p of [1, 2, 3, 4, 5, 6, 7, 8, 9, 12]) {
    const t = turnTime(p);
    assert.ok(t >= last, `a party of ${p} turns faster than a smaller one`);
    last = t;
  }
  assert.ok(turnTime(10) > turnTime(2) * 1.4, 'ten people are not two people twice');
});

test('a booking does not clash with itself', () => {
  const x = { id: 'a', at: at(19), party: 2, tableIds: [1], status: 'booked' };
  assert.equal(clashes(x, x), false);
});

test('a cancellation or a no-show releases the table', () => {
  const held = { id: 'a', at: at(19), party: 2, tableIds: [1], status: 'booked' };
  const next = { id: 'b', at: at(19, 30), party: 2, tableIds: [1], status: 'booked' };
  assert.ok(clashes(held, next), 'while it is live it holds the table');
  for (const gone of ['cancelled', 'noshow', 'left']) {
    assert.equal(clashes({ ...held, status: gone }, next), false, gone);
    assert.ok(!LIVE.has(gone));
  }
});

test('back-to-back bookings are allowed the moment the turnaround is up', () => {
  const first = { id: 'a', at: at(19), party: 2, tableIds: [1], status: 'booked' };
  const tooSoon = { id: 'b', at: at(20, 30), party: 2, tableIds: [1], status: 'booked' };
  const exact = { id: 'c', at: at(20, 45), party: 2, tableIds: [1], status: 'booked' };
  assert.ok(clashes(first, tooSoon), 'fifteen minutes short is a clash');
  assert.equal(clashes(first, exact), false, 'exactly on the turnaround is fine');
});

test('a clash needs a shared table, not just a shared hour', () => {
  const a = { id: 'a', at: at(19), party: 2, tableIds: [1], status: 'booked' };
  const b = { id: 'b', at: at(19), party: 2, tableIds: [2], status: 'booked' };
  assert.equal(clashes(a, b), false);
  assert.ok(clashes(a, { ...b, tableIds: [2, 1] }), 'one table in common is enough');
});

/* ── the seeded night ────────────────────────────────────────────────────── */

test('the night ships with exactly one conflict, on purpose', () => {
  /* Found by conflicts() in data hand-written to look fine, and then kept.
     A system that only ever shows a clean book has not shown you anything. */
  const found = conflicts(freshBook());
  assert.equal(found.length, 1, found.map((c) => `${c.a.name}/${c.b.name}`).join(', '));
  const ids = [found[0].a.id, found[0].b.id].sort();
  assert.deep(ids, [PLANTED_CONFLICT.a, PLANTED_CONFLICT.b].sort());
  assert.deep(found[0].tables, [PLANTED_CONFLICT.table]);
});

test('the planted conflict has a resolution the system can offer', () => {
  /* At 20:30 the room is genuinely full — every free table has a booking
     landing inside the ninety minutes this party needs. So the fix is not a
     different table, it is a different time, which is exactly what a host
     would do: ring them and move them by half an hour. The system has to be
     able to say so, and applying what it says has to leave a clean book. */
  const book = freshBook();
  const clash = book.find((x) => x.id === PLANTED_CONFLICT.b);

  assert.deep(findTables(clash.party, clash.at, book, { ignoreId: clash.id }), [],
    'if a table ever frees up at 20:30 this test should be the thing that notices');

  const later = nextAvailable(clash.party, clash.at, book, { span: 120 });
  assert.ok(later.length > 0, 'there has to be somewhere to move them to');
  clash.at = later[0].at;
  clash.tableIds = later[0].tableIds;
  assert.deep(conflicts(book), [], 'taking the offer has to actually fix it');
});

test('every booking in the night sits on tables that exist and fit', () => {
  for (const x of freshBook()) {
    for (const id of x.tableIds) assert.ok(byId.get(id), `${x.name} is on table ${id}, which does not exist`);
    const group = x.tableIds.map((id) => byId.get(id));
    assert.ok(connected(group), `${x.name} is spread across tables that do not touch`);
    assert.ok(maxSeats(group) >= x.party, `${x.name}, party of ${x.party}, is on ${seats(group)} seats`);
  }
});

test('every booking has a status the interface knows how to draw', () => {
  for (const x of freshBook()) assert.ok(STATUS[x.status], `${x.name} is "${x.status}"`);
  for (const s of PROGRESSION) assert.ok(STATUS[s], s);
});

test('the night starts in the middle of service, not before it', () => {
  const book = freshBook();
  assert.ok(NOW > SERVICE.opens + 120 && NOW < SERVICE.lastOrders, hhmm(NOW));
  const inHouse = book.filter((x) => IN_HOUSE.has(x.status));
  assert.ok(inHouse.length >= 8, `only ${inHouse.length} parties are eating`);
  assert.ok(book.some((x) => x.status === 'noshow'), 'a real service has one');
  assert.ok(book.some((x) => x.status === 'arrived'), 'and somebody at the door');
  assert.ok(freshWaitlist().length >= 2, 'and people at the bar');
});

test('the book is busy enough to be worth managing', () => {
  const book = freshBook();
  const peak = Math.max(...loadCurve(book).map((p) => p.covers));
  assert.ok(peak >= 45, `peak is only ${peak} covers`);
  assert.ok(book.length >= 25, 'a Saturday has more than a handful of tables');
});

/* ── finding somewhere to put people ─────────────────────────────────────── */

test('an exact fit is preferred to a bigger table', () => {
  const best = findTables(6, at(19), [])[0];
  assert.equal(best.seats, 6, `offered ${best.label} (${best.seats} seats) for six`);
});

test('one table is preferred to two pushed together', () => {
  const best = findTables(4, at(19), [])[0];
  assert.equal(best.tableIds.length, 1, `offered ${best.label}`);
});

test('a party of two is not put in the ten-seat back room', () => {
  const offers = findTables(2, at(19), [], { limit: 8 });
  assert.ok(!offers.slice(0, 4).some((o) => o.tables[0].zone === 'snug'), 'the snug is for parties');
});

test('nothing occupied is ever offered', () => {
  const book = [{ id: 'a', name: 'Held', at: at(19), party: 4, tableIds: [10], status: 'seated' }];
  const offers = findTables(4, at(19, 30), book, { limit: 20 });
  assert.ok(!offers.some((o) => o.tableIds.includes(10)), 'table 10 is taken');
  assert.ok(offers.length > 0, 'but there is plenty else');
});

test('a booking being moved does not block itself', () => {
  const book = [{ id: 'a', name: 'Moving', at: at(19), party: 4, tableIds: [10], status: 'booked' }];
  const without = findTables(4, at(19), book, { ignoreId: 'a', limit: 30 });
  assert.ok(without.some((o) => o.tableIds.includes(10)), 'its own table should be on offer');
  const with_ = findTables(4, at(19), book, { limit: 30 });
  assert.ok(!with_.some((o) => o.tableIds.includes(10)));
});

test('a full room offers nothing rather than something wrong', () => {
  const book = BOOKABLE.map((t, i) => ({
    id: `f${i}`, name: 'Full', at: at(19), party: t.seats, tableIds: [t.id], status: 'seated',
  }));
  assert.deep(findTables(2, at(19, 30), book), []);
});

test('when the time is gone it offers the nearest times that are not', () => {
  const book = BOOKABLE.map((t, i) => ({
    id: `f${i}`, name: 'Full', at: at(19), party: t.seats, tableIds: [t.id], status: 'seated',
  }));
  const later = nextAvailable(2, at(19, 30), book);
  assert.ok(later.length > 0, 'the room empties eventually');
  /* Nearest first, so a host offers "quarter of an hour either side" rather
     than reading out the whole evening from five o'clock. */
  const gaps = later.map((o) => Math.abs(o.at - at(19, 30)));
  assert.deep(gaps, [...gaps].sort((a, b) => a - b));
});

test('nothing is offered after last orders', () => {
  for (const o of nextAvailable(2, SERVICE.lastOrders, [], { span: 300 })) {
    assert.ok(o.at <= SERVICE.lastOrders, hhmm(o.at));
  }
});

/* ── the refusals, which are the product ─────────────────────────────────── */

test('a party too big for the table is refused, with the join that would work', () => {
  const six = { id: 'x', name: 'Six', party: 6, at: at(19) };
  const r = canSeat(six, [1], []);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'too-small');
  assert.ok(/seats 2/.test(r.message) && /party of 6/.test(r.message), r.message);
  assert.ok(r.suggestion, 'a refusal without a way forward is a dead end');
  assert.ok(seats(r.suggestion.tableIds.map((id) => byId.get(id))) >= 6);
});

test('a party that would only just fit is offered as a squeeze, not a refusal', () => {
  /* A host will put five on a four-top for a birthday. The system should offer
     it and mark it, rather than pretend the room does not work that way. */
  const five = { id: 'x', name: 'Five', party: 5, at: at(19) };
  const r = canSeat(five, [10], []);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'squeeze');
  assert.ok(r.squeeze, 'it has to be offerable');
  const forced = canSeat(five, [10], [], { squeeze: true });
  assert.ok(forced.ok, 'and forcing it has to work');
  assert.ok(forced.tight, 'and be marked as tight');
});

test('a squeeze past the absolute maximum is still a flat refusal', () => {
  const twelve = { id: 'x', name: 'Twelve', party: 12, at: at(19) };
  const r = canSeat(twelve, [1], [], { squeeze: true });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'too-small');
});

test('tables that do not touch cannot be one booking', () => {
  const r = canSeat({ id: 'x', name: 'Eight', party: 8, at: at(19) }, [10, 12], []);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'not-adjacent');
  assert.ok(canSeat({ id: 'x', name: 'Eight', party: 8, at: at(19) }, [10, 11], []).ok);
});

test('an occupied table says who has it and until when', () => {
  const book = [{ id: 'a', name: 'Sørensen', at: at(19), party: 2, tableIds: [1], status: 'seated' }];
  const r = canSeat({ id: 'b', name: 'Late', party: 2, at: at(20) }, [1], book);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'taken');
  assert.ok(r.message.includes('Sørensen'), r.message);
  assert.ok(r.message.includes('20:45'), `should name the time it frees up: ${r.message}`);
  assert.ok(r.suggestion, 'and offer somewhere else');
});

test('a booking that would run past closing is refused', () => {
  const late = { id: 'x', name: 'Late', party: 10, at: SERVICE.closes - 60 };
  const r = canSeat(late, [31], []);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'after-close');
});

test('every refusal explains itself in a sentence', () => {
  const cases = [
    [{ party: 6, at: at(19) }, [1]],
    [{ party: 5, at: at(19) }, [10]],
    [{ party: 8, at: at(19) }, [10, 12]],
    [{ party: 2, at: at(19) }, [40]],
    [{ party: 10, at: at(19) }, []],
  ];
  for (const [booking, tables] of cases) {
    const r = canSeat({ id: 'x', name: 'Test', ...booking }, tables, []);
    assert.equal(r.ok, false);
    /* The bar is not "no": every refusal is a whole sentence a host could say
       out loud. Fifteen characters is the shortest one that clears it
       ("No table selected."), and the full stop is the real check. */
    assert.ok(r.message && r.message.length >= 18 && /[.?]$/.test(r.message),
      `${r.code}: ${JSON.stringify(r.message)}`);
  }
});

test('every suggestion a refusal makes is one you could actually take', () => {
  const book = freshBook();
  for (const booking of book.filter((x) => LIVE.has(x.status))) {
    for (const t of BOOKABLE.slice(0, 8)) {
      const r = canSeat(booking, [t.id], book);
      if (r.ok || !r.suggestion) continue;
      const check = canSeat(booking, r.suggestion.tableIds, book, { squeeze: true });
      assert.ok(check.ok || check.code === 'taken',
        `${booking.name}: was told "${r.suggestion.note}", which gives ${check.code}`);
    }
  }
});

/* ── the shape of the evening ────────────────────────────────────────────── */

test('the load curve covers the whole service and peaks in the middle', () => {
  const curve = loadCurve(freshBook());
  assert.equal(curve[0].at, SERVICE.opens);
  assert.equal(curve[curve.length - 1].at, SERVICE.closes);
  const peak = curve.reduce((best, p) => (p.covers > best.covers ? p : best));
  assert.ok(peak.at > at(18, 30) && peak.at < at(21, 30), `peak at ${hhmm(peak.at)}`);
  assert.ok(curve[0].covers < peak.covers && curve[curve.length - 1].covers < peak.covers);
});

test('pacing counts parties starting, not parties sitting', () => {
  const book = [
    { id: 'a', at: at(20), party: 4, tableIds: [10], status: 'booked' },
    { id: 'b', at: at(20, 5), party: 2, tableIds: [1], status: 'booked' },
    { id: 'c', at: at(21), party: 2, tableIds: [2], status: 'booked' },
  ];
  const eight = pacing(book).find((p) => p.at === at(20));
  assert.equal(eight.parties, 2);
  assert.equal(eight.covers, 6, 'six people hit the kitchen at once');
});

test('holderOf finds who is on a table at a given minute, and nobody after', () => {
  const book = [{ id: 'a', name: 'Held', at: at(19), party: 2, tableIds: [1], status: 'seated' }];
  assert.equal(holderOf(1, at(19, 30), book).name, 'Held');
  assert.equal(holderOf(1, at(18, 59), book), null, 'not before they sat');
  assert.equal(holderOf(1, at(20, 45), book), null, 'not once the turnaround is done');
  assert.equal(holderOf(2, at(19, 30), book), null, 'and not on a table they are not on');
});

/* ── clocks ──────────────────────────────────────────────────────────────── */

test('times read as a human would write them', () => {
  assert.equal(hhmm(0), '00:00');
  assert.equal(hhmm(at(19, 5)), '19:05');
  assert.equal(hhmm(at(23, 59)), '23:59');
  assert.equal(hhmm(1440), '00:00', 'midnight wraps rather than reading 24:00');
  assert.equal(hhmm(-30), '23:30', 'and so does going backwards');
});

test('typed times are read forgivingly and nonsense is rejected', () => {
  for (const s of ['19:30', '1930', '19.30', ' 19:30 ']) assert.equal(parseTime(s), at(19, 30), s);
  assert.equal(parseTime('7:05'), at(7, 5));
  for (const s of ['', 'half seven', '25:00', '19:75', 'abc']) assert.equal(parseTime(s), null, s);
});

/* ── the drawing has to agree with the model ─────────────────────────────── */

test('every table is drawn with exactly as many chairs as it seats', () => {
  for (const t of TABLES) {
    assert.equal(chairs(t).length, t.seats, `${t.name} is drawn with the wrong number of chairs`);
  }
});

test('a joined run is drawn with the seats the model says it has', () => {
  /* The drawing showed eight chairs round a run the scheduler would sell to
     nine people. Somebody counting chairs on the screen would have been right
     and the software would have been wrong. */
  for (const g of joinable(3)) {
    const ids = g.map((t) => t.id);
    assert.equal(groupChairs(ids).length, seats(g), g.map((t) => t.name).join('+'));
  }
});

test('a joined run is drawn as one table, not two touching', () => {
  const box = outline([10, 11]);
  const a = byId.get(10), b = byId.get(11);
  assert.ok(Math.abs(box.w - ((b.x + b.w / 2) - (a.x - a.w / 2))) < 0.001, 'the union spans both');
  assert.ok(box.h >= a.h - 0.001);
  assert.equal(outline([]), null, 'and nothing is drawn for nothing');
});

test('the drop target is forgiving without being wrong', () => {
  /* Requiring a hit on the table top exactly is precise, correct, and
     infuriating: most drops land on a chair. */
  assert.equal(tableAt(2.4, 4.3).id, 10, 'dead centre');
  assert.equal(tableAt(2.4, 4.3 + 0.4 + 0.2).id, 10, 'on a chair still counts');
  assert.equal(tableAt(8.2, 10.6), null, 'the middle of the floor is not a table');
  assert.equal(tableAt(-3, -3), null, 'and neither is outside the room');
});

test('the plan scales to any frame without distorting the room', () => {
  for (const [w, h] of [[1200, 700], [380, 620], [900, 900]]) {
    const s = scaleFor(w, h);
    assert.ok(s.width <= w + 0.5 && s.height <= h + 0.5, `${w}x${h} overflows`);
    assert.ok(s.s > 0 && Number.isFinite(s.s));
    /* One scale for both axes: a room squashed to fit is a room where the
       tables are no longer the size they are. */
    assert.ok(Math.abs(s.len(ROOM.w) / s.len(ROOM.h) - ROOM.w / ROOM.h) < 1e-9);
  }
});

/* ── a suggestion has to be worth taking ─────────────────────────────────── */

test('a refusal never suggests the table the party is already on', () => {
  /* Dragging a party of six from the snug onto a two-top was refused, and the
     refusal offered the snug — where they already were. Taking it applied a
     move to nowhere, and the system then announced having moved them. */
  const book = freshBook();
  const sandhu = book.find((x) => x.name === 'Sandhu');
  const r = canSeat(sandhu, [1], book);
  assert.equal(r.ok, false);
  assert.ok(r.suggestion, 'and it still has to offer something');
  /* The same table at a different time is a real move — ring them and shift
     them by an hour. It is the same table at the same time that is advice to
     do nothing. */
  const sameTables = r.suggestion.tableIds.length === sandhu.tableIds.length
    && r.suggestion.tableIds.every((id) => sandhu.tableIds.includes(id));
  const sameTime = (r.suggestion.at ?? sandhu.at) === sandhu.at;
  assert.ok(!(sameTables && sameTime),
    `suggested ${r.suggestion.label} at ${hhmm(r.suggestion.at ?? sandhu.at)}, which is where they already are`);
});

test('exclude drops exactly one arrangement and nothing else', () => {
  const all = findTables(4, at(19), [], { limit: 50 });
  const without = findTables(4, at(19), [], { limit: 50, exclude: [10] });
  assert.equal(without.length, all.length - 1);
  assert.ok(all.some((o) => o.label === '10'));
  assert.ok(!without.some((o) => o.label === '10'));
  assert.deep(findTables(4, at(19), [], { limit: 50, exclude: [11, 10] }).filter((o) => o.label === '10 + 11'), [],
    'order in the exclude list must not matter');
});

test('a refusal offers a different time when there is no other table', () => {
  /* Excluding the table they are already on left the only six-top in the room
     off the list, and the refusal came back with nothing at all. A dead end is
     worse than a useless suggestion: the host is left with a red box and no
     next move. */
  const book = freshBook();
  const sandhu = book.find((x) => x.name === 'Sandhu');
  const r = canSeat(sandhu, [1], book);
  assert.equal(r.ok, false);
  assert.ok(r.suggestion, 'every refusal needs a way forward');
  assert.ok(r.suggestion.at != null, 'here it has to be a different time');
  assert.ok(r.suggestion.at !== sandhu.at, 'and actually a different one');
  sandhu.at = r.suggestion.at;
  sandhu.tableIds = r.suggestion.tableIds;
  assert.ok(canSeat(sandhu, sandhu.tableIds, book).ok, 'and taking it has to work');
});

test('a way forward is only withheld when the night genuinely cannot take them', () => {
  const full = BOOKABLE.map((t, i) => ({
    id: `f${i}`, name: 'Full', at: SERVICE.opens, party: t.seats,
    duration: SERVICE.closes - SERVICE.opens, tableIds: [t.id], status: 'seated',
  }));
  const r = canSeat({ id: 'x', name: 'Nope', party: 4, at: at(20) }, [10], full);
  assert.equal(r.ok, false);
  assert.equal(r.suggestion ?? null, null, 'nothing is free all night, so there is nothing to offer');
});

test('a time is never offered that the validator would then refuse', () => {
  /* The one that got away: nextAvailable() checked only that the START was
     before last orders, so it offered a party of six 21:45 — a two-hour
     sitting ending a quarter of an hour after the doors are locked — and
     canSeat() then refused the slot the system had just recommended. Every
     offer in the app now goes through fitsInService, and so does the refusal. */
  const book = freshBook();
  for (let party = 1; party <= 10; party++) {
    for (const wanted of [at(18), at(20), at(21, 30), at(22)]) {
      for (const offer of nextAvailable(party, wanted, book, { span: 240 })) {
        const probe = { id: 'probe', name: 'Probe', party, at: offer.at };
        const check = canSeat(probe, offer.tableIds, book);
        assert.ok(check.ok, `offered ${party} at ${hhmm(offer.at)} on ${offer.label}, then refused it: ${check.message}`);
      }
    }
  }
});

test('service hours are one rule, applied everywhere', () => {
  /* Written against the constants rather than the clock times they happened to
     have. The first version hard-coded 22:30 as "after last orders" and went
     stale the moment the restaurant started closing at midnight — a test that
     fails because the opening hours changed is a test nobody trusts. */
  assert.ok(fitsInService(SERVICE.opens, 90));
  assert.ok(!fitsInService(SERVICE.opens - 15, 90), 'before the doors open');
  assert.ok(!fitsInService(SERVICE.lastOrders + 15, 60), 'after last orders');
  assert.ok(fitsInService(SERVICE.closes - 90, 90), 'a sitting that ends exactly at close is fine');
  assert.ok(!fitsInService(SERVICE.closes - 90, 105), 'one that runs fifteen minutes over is not');
  assert.ok(!fitsInService(SERVICE.lastOrders, turnTime(10)), 'and nor is the longest turn at the latest start');
});

test('nothing is ever offered in the past', () => {
  /* It offered to move a booking from 20:30 back to 18:15, which is both
     impossible and, at twenty to eight on a Saturday, absurd. */
  const book = freshBook();
  for (const offer of nextAvailable(6, at(20, 30), book, { span: 240, notBefore: NOW })) {
    assert.ok(offer.at >= NOW, `offered ${hhmm(offer.at)} when it is ${hhmm(NOW)}`);
  }
  const sandhu = book.find((x) => x.name === 'Sandhu');
  const r = canSeat(sandhu, [1], book, { now: NOW });
  assert.ok(r.suggestion.at == null || r.suggestion.at >= NOW, 'and neither does a refusal');
});

/* ── turning a no into a yes ─────────────────────────────────────────────────
   The optimiser is the one part of this system that can make things worse, so
   it is the part with the most tests. Every failure mode below is one an
   optimiser reaches for on its own: moving somebody who is eating, losing a
   booking to make a number look better, or producing a plan that does not work
   when you apply it. */

test('nothing that has sat down is ever moved', () => {
  /* You cannot ask a table halfway through their main to move, and a system
     that suggests it will never be trusted again. */
  const book = freshBook();
  const eating = book.filter((b) => IN_HOUSE.has(b.status)).map((b) => [b.id, b.tableIds.join()]);
  assert.ok(eating.length >= 8, 'the test needs people in the room');
  const { moves } = replan(book, { now: NOW });
  for (const m of moves) {
    assert.ok(!eating.some(([id]) => id === m.id), `${m.name} is eating and was moved`);
  }
  for (const [id, tables] of eating) {
    assert.equal(book.find((b) => b.id === id).tableIds.join(), tables, 'and the book is untouched');
  }
});

test('a replan is proposed, never applied', () => {
  /* Silently rearranging somebody's evening is not a tool, it is a hazard. */
  const book = freshBook();
  const snapshot = book.map((b) => `${b.id}:${b.tableIds.join()}@${b.at}`).join('|');
  replan(book, { now: NOW });
  assert.equal(book.map((b) => `${b.id}:${b.tableIds.join()}@${b.at}`).join('|'), snapshot);
});

test('applying a replan leaves a book with no conflicts', () => {
  const book = freshBook();
  const { moves, after } = replan(book, { now: NOW });
  assert.ok(moves.length > 0, 'tonight has room to improve');
  applyMoves(book, moves);
  assert.deep(conflicts(book), []);
  assert.equal(value(book).conflicts, after.conflicts);
});

test('a replan never seats fewer people or strands anybody', () => {
  const book = freshBook();
  const { before, after } = replan(book, { now: NOW });
  assert.ok(after.covers >= before.covers, `${before.covers} covers became ${after.covers}`);
  assert.ok(after.unseated <= before.unseated, 'somebody lost their table');
  assert.ok(after.conflicts <= before.conflicts);
});

test('a replan that is not better is not offered', () => {
  assert.ok(!isImprovement({ covers: 80, waste: 4, joins: 2, unseated: 0, conflicts: 0 },
                           { covers: 74, waste: 0, joins: 0, unseated: 0, conflicts: 0 }),
    'fewer covers is not an improvement however tidy the tables look');
  assert.ok(!isImprovement({ covers: 80, waste: 4, joins: 2, unseated: 0, conflicts: 0 },
                           { covers: 80, waste: 4, joins: 2, unseated: 1, conflicts: 0 }),
    'stranding a booking is not an improvement');
  assert.ok(!isImprovement({ covers: 80, waste: 4, joins: 2, unseated: 0, conflicts: 0 },
                           { covers: 82, waste: 2, joins: 1, unseated: 0, conflicts: 1 }),
    'nor is buying covers with a double-booking');
  assert.ok(!isImprovement({ covers: 80, waste: 4, joins: 2, unseated: 0, conflicts: 0 },
                           { covers: 80, waste: 4, joins: 2, unseated: 0, conflicts: 0 }),
    'and neither is doing nothing');
  assert.ok(isImprovement({ covers: 80, waste: 6, joins: 2, unseated: 0, conflicts: 1 },
                          { covers: 80, waste: 4, joins: 2, unseated: 0, conflicts: 0 }));
});

test('a replan gives the same answer every time', () => {
  /* A host who runs it twice and gets two different nights will run it zero
     more times. */
  const a = replan(freshBook(), { now: NOW }).moves.map((m) => `${m.id}→${m.toLabel}`).join('|');
  const b = replan(freshBook(), { now: NOW }).moves.map((m) => `${m.id}→${m.toLabel}`).join('|');
  assert.equal(a, b);
});

test('make-room finds the rearrangement that turns a no into a yes', () => {
  const book = freshBook();
  assert.deep(findTables(4, at(20, 30), book), [], 'nothing is free at 20:30 as things stand');
  const plans = makeRoom(4, at(20, 30), book, { now: NOW });
  assert.ok(plans.length > 0, 'but the room can be rearranged');
  const best = plans[0];
  assert.ok(best.moves.length >= 1 && best.moves.length <= 2);
  for (const m of best.moves) assert.ok(m.from.length && m.to.length && m.fromLabel !== m.toLabel);
});

test('a make-room plan works when you actually apply it', () => {
  /* The failure mode of every planner: a confident answer that falls apart on
     contact with the thing it was planning. */
  const book = freshBook();
  /* The night ships with one conflict on purpose, so the bar is "no NEW
     conflicts" rather than "no conflicts" — an absolute count here fails
     against data that is deliberately imperfect, which is the test's fault
     and not the planner's. */
  const baseline = conflicts(book).length;
  for (const party of [2, 4, 6]) {
    for (const t of [at(20, 30), at(21), at(21, 30), at(22)]) {
      const plan = makeRoom(party, t, book, { now: NOW })[0];
      if (!plan) continue;
      const trial = book.map((b) => ({ ...b, tableIds: [...b.tableIds] }));
      applyMoves(trial, plan.moves);
      const probe = { id: 'probe', name: 'Probe', party, at: t };
      const check = canSeat(probe, plan.tableIds, trial, { now: NOW });
      assert.ok(check.ok, `plan for ${party} at ${hhmm(t)} failed on application: ${check.message}`);
      trial.push({ ...probe, tableIds: plan.tableIds, status: 'booked' });
      assert.ok(conflicts(trial).length <= baseline,
        `plan for ${party} at ${hhmm(t)} created a conflict: `
        + conflicts(trial).map((c) => `${c.a.name}/${c.b.name}`).join(', '));
    }
  }
});

test('make-room will not move somebody who is eating', () => {
  const book = freshBook();
  const pinned = new Set(book.filter((b) => isPinned(b, NOW)).map((b) => b.id));
  for (const party of [2, 4, 6, 8]) {
    for (const t of [at(20), at(20, 30), at(21)]) {
      for (const plan of makeRoom(party, t, book, { now: NOW })) {
        for (const m of plan.moves) assert.ok(!pinned.has(m.id), `${m.name} is pinned`);
      }
    }
  }
});

test('make-room respects how many people it is allowed to disturb', () => {
  const book = freshBook();
  for (const max of [1, 2]) {
    for (const plan of makeRoom(6, at(21, 30), book, { now: NOW, maxMoves: max })) {
      assert.ok(plan.moves.length <= max, `${plan.moves.length} moves with a limit of ${max}`);
    }
  }
});

test('make-room prefers disturbing nobody, then as few people as possible', () => {
  const book = freshBook();
  const plans = makeRoom(2, at(22), book, { now: NOW, limit: 5 });
  assert.ok(plans.length > 0);
  assert.equal(plans[0].moves.length, 0, 'there is a free table at 22:00, so nothing should move');
  const counts = plans.map((p) => p.moves.length);
  assert.deep(counts, [...counts].sort((a, b) => a - b), 'cheapest first');
});

test('the bar is quoted in sequence, not three times for the same table', () => {
  /* Costing each waiting party independently gave all three the same answer:
     the same table, at the same time, by moving the same booking — a plan that
     works exactly once. */
  const book = freshBook();
  const quoted = barPlan(freshWaitlist(), book, { now: NOW }).filter((r) => r.withMoves);
  assert.ok(quoted.length >= 2, 'at least two of them can be given a time');
  const slots = quoted.map((r) => `${r.withMoves.at}:${r.withMoves.plan.label}`);
  assert.equal(new Set(slots).size, slots.length, `two parties were promised ${slots}`);
  assert.ok(quoted[0].party >= quoted[quoted.length - 1].party, 'biggest party quoted first');
});

test('the bar plan never quotes a time it could not honour', () => {
  const book = freshBook();
  const trial = book.map((b) => ({ ...b, tableIds: [...b.tableIds] }));
  for (const r of barPlan(freshWaitlist(), book, { now: NOW })) {
    if (!r.withMoves) continue;
    assert.ok(r.withMoves.at >= NOW, 'and never one in the past');
    applyMoves(trial, r.withMoves.plan.moves);
    const probe = { id: `p${r.id}`, name: r.name, party: r.party, at: r.withMoves.at };
    assert.ok(canSeat(probe, r.withMoves.plan.tableIds, trial, { now: NOW }).ok,
      `${r.name} was quoted ${hhmm(r.withMoves.at)} on ${r.withMoves.plan.label}, which does not work`);
    trial.push({ ...probe, tableIds: r.withMoves.plan.tableIds, status: 'booked' });
  }
});

test('value counts what a layout is worth', () => {
  const v = value([
    { id: 'a', party: 4, tableIds: [10], status: 'seated' },
    { id: 'b', party: 2, tableIds: [31], status: 'booked' },
    { id: 'c', party: 2, tableIds: [], status: 'booked' },
    { id: 'd', party: 9, tableIds: [10, 11], status: 'cancelled' },
  ]);
  assert.equal(v.covers, 6, 'a cancellation is not a cover');
  assert.equal(v.waste, 8, 'two people on the ten-top wastes eight seats');
  assert.equal(v.unseated, 1);
  assert.equal(v.joins, 0);
});
