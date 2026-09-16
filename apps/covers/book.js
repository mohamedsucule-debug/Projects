/* ───────────────────────────────────────────────────────────────────────────
   covers/book.js — a Saturday night, already half underway.

   This file is the single most important design decision in the product and it
   is not code. Every table-management demo ever built opens on an empty grid
   with a "＋ Add your first booking" button, and every one of them is boring,
   because an empty restaurant is not a restaurant and nobody can tell whether
   an empty system is any good.

   So you arrive at 19:42 on a Saturday. Thirty-one bookings are in the book.
   Eleven parties are eating, four are due in the next twenty minutes, one is
   twenty-five minutes late and has not called, there are three groups waiting
   at the bar, and the eight o'clock sitting is about to land all at once. The
   job is already half done and going wrong in the ordinary ways.

   The detail is hand-written rather than generated, because generated data has
   no texture: it produces "Customer 14, party of 3" and never produces "Wants
   the same table as last time. Do not sit her near the door."
   ─────────────────────────────────────────────────────────────────────────── */

/** Where the clock starts. The middle of service, deliberately. */
export const NOW = 19 * 60 + 42;
export const SERVICE_DATE = 'Saturday 14 March';

const b = (id, at, name, party, tableIds, status, extra = {}) =>
  ({ id, at, name, party, tableIds, status, ...extra });

/* status: booked · confirmed · arrived · seated · main · dessert · bill · paid
           · left · noshow · cancelled
   Anything from `seated` to `bill` is sitting at the table right now. */

export const BOOKINGS = [
  /* ── the early sitting, mostly finished ─────────────────────────────── */
  b('r01', 17 * 60 +  0, 'Adeyemi',       2, [3],      'left',   { phone: '07700 900412', tag: 'pre-theatre', note: 'Out by 18:45 for curtain up. Told them 6pm.' }),
  b('r02', 17 * 60 + 15, 'Brennan',       4, [13],     'left',   { phone: '07700 900188', tag: 'pre-theatre' }),
  b('r03', 17 * 60 + 30, 'Kowalczyk',     2, [1],      'left',   { phone: '07700 900733' }),
  b('r04', 17 * 60 + 45, 'Odell',         6, [30],     'paid',   { phone: '07700 900021', note: 'Birthday. Candle in the tart at the end — done, 19:20.' }),
  b('r05', 18 * 60 +  0, 'Fitzgerald',    2, [5],      'left',   { phone: '07700 900904' }),
  b('r06', 18 * 60 +  0, 'Nakamura',      4, [10],     'bill',   { phone: '07700 900550', note: 'Asked for the bill twice. Chase it.' }),
  b('r07', 18 * 60 + 15, 'Oyelaran',      2, [16],     'left',   { phone: '07700 900317' }),
  b('r08', 18 * 60 + 30, 'Marchetti',     4, [20],     'dessert',{ phone: '07700 900645', tag: 'regular', note: 'In most Saturdays. Always the banquette.' }),

  /* ── the seven o'clock, in the room now ─────────────────────────────── */
  b('r09', 19 * 60 +  0, 'Sørensen',      2, [2],      'main',   { phone: '07700 900872' }),
  b('r10', 19 * 60 +  0, 'Achterberg',    4, [11],     'main',   { phone: '07700 900263', note: 'Nut allergy — table knows, kitchen carded.' , allergy: true }),
  b('r11', 19 * 60 +  0, 'Villanueva',    2, [4],      'main',   { phone: '07700 900109' }),
  b('r12', 19 * 60 + 15, 'Okonkwo',       8, [16, 17, 18], 'main', { phone: '07700 900488', note: 'Two highchairs. Running loud but happy.' }),
  b('r13', 19 * 60 + 15, 'Delacroix',     4, [14],     'seated', { phone: '07700 900351', tag: 'VIP', note: 'Food writer. Do not comp anything, do not fuss.' }),
  b('r14', 19 * 60 + 30, 'Haugen',        2, [6],      'seated', { phone: '07700 900077' }),
  b('r15', 19 * 60 + 30, 'Rahman',        4, [21],     'seated', { phone: '07700 900620', note: 'Anniversary — twenty years. Champagne is on the pass.' }),
  b('r16', 19 * 60 + 30, 'Iqbal',         6, [22, 23], 'seated', { phone: '07700 900934' }),
  b('r17', 19 * 60 + 30, 'Petrov',        2, [17],     'cancelled', { phone: '07700 900215', note: 'Cancelled 16:10. Apologetic.' }),

  /* ── due now, or very shortly ───────────────────────────────────────── */
  b('r18', 19 * 60 + 15, 'Mbeki',         2, [18],     'noshow', { phone: '07700 900846', note: 'Twenty-five minutes late. Two calls, no answer.' }),
  b('r19', 19 * 60 + 45, 'Castellanos',   4, [12],     'confirmed', { phone: '07700 900702' }),
  b('r20', 19 * 60 + 45, 'Ó Briain',      2, [1],      'arrived',{ phone: '07700 900459', note: 'At the door now.' }),
  b('r21', 20 * 60 +  0, 'Lindqvist',     4, [15],     'confirmed', { phone: '07700 900530' }),
  b('r22', 20 * 60 +  0, 'Ferreira',      2, [3],      'confirmed', { phone: '07700 900684' }),

  /* ── the eight o'clock, all landing together ────────────────────────── */
  b('r23', 20 * 60 +  0, 'Zieliński',    10, [31],     'confirmed', { phone: '07700 900773', tag: 'large party', note: 'Set menu B, pre-ordered. Two vegetarians, one coeliac.' }),
  b('r24', 20 * 60 + 15, 'Bello',         2, [5],      'booked', { phone: '07700 900290' }),
  b('r25', 20 * 60 + 15, 'Whitcombe',     4, [13],     'booked', { phone: '07700 900615' }),
  /* DELIBERATE. Sørensen sat on table 2 at 19:00; a party of two holds a table
     for ninety minutes and fifteen to re-lay, so table 2 is not free until
     20:45. This booking is on it at 20:30.

     It is in the book on purpose, because a system that only ever shows you a
     clean night has not shown you anything. You arrive to one real problem,
     the header says so, and the fix is two clicks. It was also not planted:
     conflicts() found it in data that had been hand-written to look fine, which
     is exactly the point of having the rules somewhere a test can reach. */
  b('r26', 20 * 60 + 30, 'Traoré',        2, [2],      'booked', { phone: '07700 900841', note: 'Double-booked with Sørensen — table 2 is not free until 20:45.' }),
  b('r27', 20 * 60 + 30, 'Sandhu',        6, [30],     'booked', { phone: '07700 900368', note: 'Wheelchair — needs the wide approach, not past the pass.', access: true }),
  b('r28', 20 * 60 + 45, 'Eriksen',       4, [10],     'booked', { phone: '07700 900127' }),
  /* The one party tonight that will not turn up. Flagged in the data rather
     than left to chance, so the no-show mechanic is always demonstrable and
     the night plays the same way twice. */
  b('r29', 21 * 60 +  0, 'Nwosu',         2, [4],      'booked', { phone: '07700 900983', willNoShow: true }),
  b('r30', 21 * 60 +  0, 'Bianchi',       4, [20],     'booked', { phone: '07700 900406', tag: 'regular' }),
  b('r31', 21 * 60 + 15, 'Duval',         2, [6],      'booked', { phone: '07700 900572', note: 'Late one. Kitchen warned.' }),
];

/* ── the people standing at the bar ──────────────────────────────────────── */

export const WAITLIST = [
  { id: 'w1', name: 'Hartley',  party: 2, since: 19 * 60 + 26, quoted: 30, phone: '07700 900194',
    note: 'Happy at the bar. Second drink.' },
  { id: 'w2', name: 'Aslan',    party: 4, since: 19 * 60 + 34, quoted: 45, phone: '07700 900857',
    note: 'Asked twice how long.' },
  { id: 'w3', name: 'Grønvold', party: 2, since: 19 * 60 + 40, quoted: 40, phone: '07700 900331' },
];

/* ── what the kitchen is sending ─────────────────────────────────────────── */

export const MENU_NOTES = [
  { at: 19 * 60 + 12, text: 'Eighty-six the halibut. Two portions left, then it is off.' },
  { at: 19 * 60 + 38, text: 'Kitchen asking for a five-minute gap at 20:00 — eleven covers land at once.' },
];

/* Live service statuses in the order a table moves through them, which is what
   the "advance" control walks down and what the floor plan colours by. */
export const PROGRESSION = ['arrived', 'seated', 'main', 'dessert', 'bill', 'paid', 'left'];

export const STATUS = {
  booked:    { label: 'Booked',     tone: 'quiet',  desc: 'In the book, not confirmed.' },
  confirmed: { label: 'Confirmed',  tone: 'quiet',  desc: 'Confirmed by text.' },
  arrived:   { label: 'At the door', tone: 'warn',  desc: 'Here, not yet sat.' },
  seated:    { label: 'Seated',     tone: 'live',   desc: 'Sat down, ordering.' },
  main:      { label: 'On mains',   tone: 'live',   desc: 'Main course away.' },
  dessert:   { label: 'Dessert',    tone: 'live',   desc: 'Pudding and coffee.' },
  bill:      { label: 'Bill',       tone: 'turn',   desc: 'Asked for the bill — table turning soon.' },
  paid:      { label: 'Paid',       tone: 'turn',   desc: 'Paid, still sitting.' },
  left:      { label: 'Left',       tone: 'done',   desc: 'Gone. Table being re-laid.' },
  noshow:    { label: 'No-show',    tone: 'bad',    desc: 'Did not arrive. Table released.' },
  cancelled: { label: 'Cancelled',  tone: 'done',   desc: 'Cancelled in advance.' },
};

/** The one clash the night ships with, so a test can prove it is on purpose. */
export const PLANTED_CONFLICT = { a: 'r09', b: 'r26', table: 2 };

/** A fresh copy of the night, so a reset really does reset. */
export function freshBook() {
  return BOOKINGS.map((x) => ({ ...x, tableIds: [...x.tableIds] }));
}
export function freshWaitlist() {
  return WAITLIST.map((x) => ({ ...x }));
}
