/* ───────────────────────────────────────────────────────────────────────────
   covers/floor.js — the room.

   A restaurant is a physical place before it is a booking system, and almost
   every table-management product on the market gets this backwards: they model
   a list of tables with a capacity number, and then the floor plan is a
   decorative picture drawn separately that slowly stops matching reality.

   Here the floor plan IS the model. A table has a position, a footprint and a
   set of neighbours it can physically be pushed together with, and everything
   the scheduler knows about capacity comes from that. You cannot join two
   tables at opposite ends of the room, because the room says so.

   Measurements are in metres. The room is 17.4m × 11.2m, which is a real size
   for a 90-cover restaurant.
   ─────────────────────────────────────────────────────────────────────────── */

export const ROOM = { w: 17.4, h: 9.9 };

/** The four areas of the house, in the order a host would offer them. */
export const ZONES = [
  { id: 'window', name: 'The Window', note: 'Front of house, street-facing. The tables people ask for.' },
  { id: 'room', name: 'The Room', note: 'Main floor. Most of the covers, and where the joins happen.' },
  { id: 'banquette', name: 'The Banquette', note: 'Wall seating along the east side. Comfortable, slow to turn.' },
  { id: 'snug', name: 'The Snug', note: 'Back room. Large parties and anything that needs a door.' },
  { id: 'bar', name: 'The Bar', note: 'Stools. Walk-ins only — never booked.' },
];

/* ── the tables ──────────────────────────────────────────────────────────────
   `seats` is what it takes comfortably. `max` is what you can squeeze on for a
   birthday, which a host will do and a scheduler should know about but should
   not choose on its own.

   `joins` is physical adjacency: the tables this one can be pushed together
   with. It is declared one way and made symmetric below, because an adjacency
   list written twice by hand is an adjacency list that disagrees with itself
   by the third edit. */

/**
 * A table.
 *
 * `shape` decides the footprint. 'bench' is a rectangle stood on its end: the
 * banquette runs down a wall, so its tables are long in Y and short in X, and
 * drawing them lengthways like the ones in the middle of the room put four
 * tables sideways against a wall they are supposed to be up against.
 */
const T = (id, name, zone, seats, max, x, y, shape, joins = []) => {
  const long = seats <= 2 ? 0.78 : seats <= 4 ? 1.35 : seats <= 6 ? 1.9 : 2.5;
  const round = seats <= 2 ? 0.82 : seats <= 4 ? 1.1 : 1.5;
  const size = {
    round: { w: round, h: round },
    rect:  { w: long,  h: 0.8 },
    bench: { w: 0.8,   h: long },
    stool: { w: 0.42,  h: 0.42 },
  }[shape];
  return { id, name, zone, seats, max, x, y, shape, joins, ...size };
};

export const TABLES = [
  /* The window: six two-tops in a row along the glass. 1 and 2 join, 3 and 4
     join, 5 and 6 join — but 2 and 3 do not, because the door is between them. */
  T(1,  '1',  'window', 2, 3, 1.5,  1.35, 'round', [2]),
  T(2,  '2',  'window', 2, 3, 3.1,  1.35, 'round', []),
  T(3,  '3',  'window', 2, 3, 6.3,  1.35, 'round', [4]),
  T(4,  '4',  'window', 2, 3, 7.9,  1.35, 'round', []),
  T(5,  '5',  'window', 2, 3, 9.9,  1.35, 'round', [6]),
  T(6,  '6',  'window', 2, 3, 11.5, 1.35, 'round', []),

  /* The room: the working floor. Two rows of fours with a service lane between
     them, and a pair of twos at the end that join into a four. */
  T(10, '10', 'room', 4, 5, 2.4,  4.3,  'rect', [11]),
  T(11, '11', 'room', 4, 5, 4.6,  4.3,  'rect', [12]),
  T(12, '12', 'room', 4, 5, 6.8,  4.3,  'rect', []),
  T(13, '13', 'room', 4, 5, 2.4,  6.6,  'rect', [14]),
  T(14, '14', 'room', 4, 5, 4.6,  6.6,  'rect', [15]),
  T(15, '15', 'room', 4, 5, 6.8,  6.6,  'rect', []),
  T(16, '16', 'room', 2, 3, 2.4,  8.9,  'round', [17]),
  T(17, '17', 'room', 2, 3, 4.0,  8.9,  'round', [18]),
  T(18, '18', 'room', 2, 3, 5.6,  8.9,  'round', []),

  /* The banquette: fixed seating against the east wall. Fours that join into
     sixes and eights, which is how a banquette actually gets used. */
  T(20, '20', 'banquette', 4, 4, 15.5, 3.0, 'bench', [21]),
  T(21, '21', 'banquette', 4, 4, 15.5, 4.9, 'bench', [22]),
  T(22, '22', 'banquette', 4, 4, 15.5, 6.8, 'bench', [23]),
  T(23, '23', 'banquette', 2, 3, 15.5, 8.4, 'bench', []),

  /* The snug: the back room, through a door. One six and one ten. */
  T(30, '30', 'snug', 6,  8,  10.3, 8.5, 'round', []),
  T(31, '31', 'snug', 10, 12, 12.9, 8.5, 'rect',  []),

  /* The bar: stools. Never bookable — walk-ins and people waiting for a table. */
  T(40, 'B1', 'bar', 1, 1, 9.6,  3.9, 'stool', []),
  T(41, 'B2', 'bar', 1, 1, 10.5, 3.9, 'stool', []),
  T(42, 'B3', 'bar', 1, 1, 11.4, 3.9, 'stool', []),
];

/* Adjacency declared once, applied both ways. */
for (const t of TABLES) {
  for (const other of t.joins) {
    const o = TABLES.find((x) => x.id === other);
    if (o && !o.joins.includes(t.id)) o.joins.push(t.id);
  }
}

export const byId = new Map(TABLES.map((t) => [t.id, t]));

/** Tables a booking can be put on. The bar takes walk-ins, never reservations. */
export const BOOKABLE = TABLES.filter((t) => t.zone !== 'bar');

/**
 * Every set of tables that can physically be pushed together, up to `limit`.
 *
 * A join has to be a connected run — 10+11+12 is a line of three down the
 * middle of the room, and that works; 10+12 does not, because 11 is in the
 * way and nobody is carrying a table over another table. So this walks the
 * adjacency graph rather than taking combinations of a list, and the room's
 * geometry decides what is possible.
 *
 * Returned sorted by size, so a caller looking for the smallest workable
 * arrangement finds it first.
 */
export function joinable(limit = 3) {
  const seen = new Set();
  const out = [];

  const walk = (group) => {
    const key = group.map((t) => t.id).sort((a, b) => a - b).join('+');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(group.slice());
    if (group.length >= limit) return;
    for (const t of group) {
      for (const nid of t.joins) {
        if (group.some((g) => g.id === nid)) continue;
        const n = byId.get(nid);
        /* Tables only join within their own zone. Two fours either side of the
           doorway between The Room and The Banquette are adjacent on a plan
           and are not one table. */
        if (!n || n.zone !== t.zone) continue;
        walk([...group, n]);
      }
    }
  };

  for (const t of BOOKABLE) walk([t]);
  return out.sort((a, b) => a.length - b.length || seats(a) - seats(b));
}

/** Comfortable capacity of a set of tables pushed together. */
export function seats(group) {
  const base = group.reduce((n, t) => n + t.seats, 0);
  /* Pushing two tables together gains you the two ends that were previously
     nobody's seat — a real gain every host knows about, and the reason a
     four and a four is a nine rather than an eight. */
  return base + (group.length - 1);
}

/** The absolute squeeze, for a host who has decided to make it work. */
export function maxSeats(group) {
  return group.reduce((n, t) => n + t.max, 0) + (group.length - 1);
}

/** Tables, in the order a floor plan should draw them: back to front. */
export function drawOrder() {
  return [...TABLES].sort((a, b) => a.y - b.y || a.x - b.x);
}

/** The room's fixed furniture — walls, the bar, the pass, the door. */
export const FIXTURES = [
  { kind: 'bar',   x: 8.9,  y: 2.7,  w: 3.4,  h: 0.75, label: 'BAR' },
  { kind: 'pass',  x: 8.9,  y: 6.0,  w: 3.2,  h: 0.7, label: 'PASS' },
  { kind: 'wall',  x: 13.6, y: 0,    w: 0.22, h: 7.4 },
  { kind: 'wall',  x: 8.6,  y: 7.4,  w: 0.22, h: 2.5 },
  { kind: 'door',  x: 4.6,  y: 0,    w: 1.6,  h: 0.22, label: 'STREET' },
  { kind: 'door',  x: 8.6,  y: 8.1,  w: 0.22, h: 1.3,  label: 'SNUG' },
  { kind: 'kitchen', x: 12.4, y: 0,  w: 5.0,  h: 2.2, label: 'KITCHEN' },
];
