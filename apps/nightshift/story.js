/* ───────────────────────────────────────────────────────────────────────────
   nightshift/story.js — the log, and the thing that happens to it.

   Two halves, both free of the DOM.

   THE LOG is written out in full below. It is a night's watch at a coastal
   station in 1987, and it starts as dull as a real one: wind, visibility,
   vessels passing on schedule. It stops being dull.

   THE SEQUENCE decides when each beat fires — some on how far you have read,
   some on how long you have been here, some on you leaving the tab and coming
   back. Keeping that here rather than in a pile of timers means the order of
   a haunting can be tested: that nothing fires twice, that nothing fires out
   of turn, and that somebody who scrolls straight to the bottom still gets the
   story rather than the ending.
   ─────────────────────────────────────────────────────────────────────────── */

/** A line of the log. `kind` decides how it is set on the page. */
const log = (time, text) => ({ kind: 'log', time, text });
const note = (text) => ({ kind: 'note', text });
const gap = () => ({ kind: 'gap' });
const damaged = (time) => ({ kind: 'damaged', time });

/* The transcriber's own voice, at the top: bureaucratic, unbothered, and the
   only part of the page that is not from that night. */
export const PREAMBLE = [
  'COASTAL WATCH — STATION K (KILDA NORTH)',
  'WATCH LOG, NIGHT OF 14–15 NOVEMBER 1987',
  'Transcribed from the original daybook, 2011. Entries appear as written.',
  'Where the original is illegible this is marked. Nothing has been added.',
];

export const ENTRIES = [
  log('2200', 'Watch commenced. Wind SW 4. Vis good. Sea slight.'),
  log('2215', 'Nothing to report.'),
  log('2230', 'MV LOCHMOR passed E-bound, 3 miles. On schedule. Acknowledged.'),
  log('2245', 'Wind SW 4. Vis good.'),
  log('2300', 'Nothing to report.'),
  log('2315', 'Nothing to report.'),
  log('2330', 'Wind SW 4–5. Vis good. Barometer steady.'),
  log('2345', 'Nothing to report.'),
  log('0000', 'Watch continues. Wind SW 5. Vis good.'),
  log('0015', 'Nothing to report.'),
  log('0030', 'Contact bearing 041, range 6 miles. No lights. No transponder.'),
  log('0045', 'Contact bearing 041, range 6 miles. Hailed on Ch16. No response.'),
  log('0100', 'Contact bearing 041, range 6 miles. Hailed twice. No response.'),
  note('Same bearing, same range, three quarters of an hour. Tide is running. It should have moved.'),
  log('0115', 'Contact bearing 041, range 4 miles.'),
  log('0130', 'Contact bearing 041, range 4 miles.'),
  log('0145', 'Contact bearing 041, range 4 miles.'),
  note('It closes when I am not looking at it. It does not close while I watch.'),
  log('0200', 'Hailed Stornoway. No vessel expected in this sector tonight.'),
  log('0215', 'Contact bearing 041, range 2 miles. Still no lights.'),
  log('0230', 'Contact bearing 041, range 2 miles.'),
  damaged('0245'),
  log('0300', 'Contact has not moved. I have not looked away.'),
  note('I have been at this window one hour and eleven minutes. I have not blinked as far as I can tell.'),
  log('0315', 'Range 2 miles. Bearing 041.'),
  log('0330', 'Range 2 miles. Bearing 041.'),
  log('0345', 'Range 2 miles. Bearing 041.'),
  log('0400', 'Range 2 miles. Bearing 041.'),
  gap(),
  log('0415', 'It is not a vessel.'),
  log('0430', 'Hailed Stornoway. Line is open. Nobody is on it.'),
  log('0445', 'The line has been open for fourteen minutes. Somebody is breathing on it.'),
  note('I asked who it was. It repeated the question back in my own voice. Not an echo. A little after.'),
  damaged('0500'),
  log('0515', 'It is at the door of the station.'),
  log('0530', 'It is not at the door of the station. It is in the log.'),
  note('I have read back through tonight. Entries I did not write. In my hand.'),
  log('0545', 'Whoever reads this: it does not want the station.'),
  log('0600', 'It wants somebody to read the log.'),
  log('0615', 'You have been reading for some time now.'),
  gap(),
  log('0630', 'Watch ended. Relief did not arrive.'),
  log('0630', 'Watch ended. Relief did not arrive.'),
  log('0630', 'Watch ended. Relief did not arrive.'),
];

/* The transcriber again, closing the file. The last normal thing on the page. */
export const APPENDIX = [
  'The station was found unmanned on the morning of 15 November 1987.',
  'The daybook was on the desk, open at this page.',
  'The keeper was not located. No vessel was reported missing that night.',
  'This file has been read 1 time.',
];

/* ── the sequence ────────────────────────────────────────────────────────────
   Each beat has a trigger and an effect. The effect is a name; what it does to
   the page is the page's business, not the story's.

   `at` is how far down the reader has got, 0..1.
   `after` is seconds on the page.
   `hidden` is how many times they have switched away and come back. */

export const BEATS = [
  {
    id: 'title-first',
    hidden: 1,
    effect: 'title',
    data: 'come back to the log',
  },
  {
    id: 'favicon',
    at: 0.18,
    effect: 'favicon',
  },
  {
    id: 'rewrite',
    at: 0.34,
    effect: 'rewrite',
    /* An entry a long way back is quietly changed. Nobody is told. Most people
       never scroll up to find it, and the ones who do are the ones this is
       for. */
    data: { index: 4, text: 'Nothing to report. He is still reading.' },
  },
  {
    id: 'title-second',
    hidden: 2,
    effect: 'title',
    data: 'the log is still open',
  },
  {
    id: 'phantom',
    at: 0.52,
    effect: 'phantom',      // the scrollbar grows. There is nothing down there.
  },
  {
    id: 'clock',
    at: 0.62,
    effect: 'insert',
    data: { after: 0.62, text: 'It is {{clock}} where you are. The watch was at night too.' },
  },
  {
    id: 'rewrite-two',
    at: 0.70,
    effect: 'rewrite',
    data: { index: 1, text: 'Nothing to report. Except the reading. That is new.' },
  },
  {
    id: 'lights',
    at: 0.80,
    effect: 'dim',          // the page loses its light, slowly, over a minute
  },
  {
    id: 'title-third',
    hidden: 3,
    effect: 'title',
    data: 'it noticed you leave',
  },
  {
    id: 'breath',
    after: 150,
    effect: 'breath',       // something in the audio that was not there before
  },
  {
    id: 'address',
    at: 0.92,
    effect: 'address',      // it stops being a log
  },
  {
    /* No trigger. Scrolling cannot reach this one, and that is the point: the
       reader who flings the scrollbar to the bottom arrives at 'address' with
       everything still ahead of them, and the ending waits until the last line
       has actually been written out. An earlier version had this at 0.995 and
       both beats fired in the same frame — the direct address got exactly one
       character onto the page before the veil came down over it. */
    id: 'close',
    manual: true,
    effect: 'close',
  },
];

/**
 * Decide what fires, given where the reader is.
 *
 * Pure: hand it the same state twice and it returns nothing the second time,
 * because beats that have already fired are in `done`. The page keeps that set
 * and does not have to think about ordering at all.
 *
 * Beats marked `manual` are never returned. They are fired by another beat
 * finishing, so no amount of scrolling or waiting can jump the queue.
 */
export function due({ at = 0, after = 0, hidden = 0, done = new Set() } = {}) {
  const out = [];
  for (const beat of BEATS) {
    if (done.has(beat.id) || beat.manual) continue;
    const reached =
      (beat.at !== undefined && at >= beat.at) ||
      (beat.after !== undefined && after >= beat.after) ||
      (beat.hidden !== undefined && hidden >= beat.hidden);
    if (reached) out.push(beat);
  }
  return out;
}

/**
 * How far through the log a scroll position is.
 *
 * Guarded, because a page shorter than the window gives a zero-length scroll
 * range, and dividing by it would make every beat fire at once on the first
 * frame — the whole story delivered in a single flash to somebody on a very
 * tall screen.
 */
export function progress(scrollTop, scrollHeight, viewport) {
  const range = scrollHeight - viewport;
  if (!Number.isFinite(range) || range <= 1) return 1;
  const p = scrollTop / range;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/* ── being remembered ────────────────────────────────────────────────────────
   The second visit is the point of the whole thing, so it has to survive a
   closed tab — and it has to fail quietly in a private window, where reading
   storage throws outright. */

const KEY = 'nightshift.v1';

export const store = {
  read() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null') || { visits: 0, finished: 0 }; }
    catch { return { visits: 0, finished: 0 }; }
  },
  write(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* nothing to do */ }
    return state;
  },
  arrive() {
    const s = this.read();
    s.visits = (s.visits || 0) + 1;
    s.last = Date.now();
    return this.write(s);
  },
  finish() {
    const s = this.read();
    s.finished = (s.finished || 0) + 1;
    return this.write(s);
  },
};

/**
 * What the file says about how often it has been read.
 *
 * On a first visit this is the dullest line on the page. On a second visit it
 * is the reason people send the link to somebody else.
 */
export function readingsLine(visits) {
  const n = Math.max(1, Math.floor(visits) || 1);
  if (n === 1) return 'This file has been read 1 time.';
  if (n === 2) return 'This file has been read 2 times. Both by you.';
  return `This file has been read ${n} times. All of them by you.`;
}

/** The extra entry a returning reader finds waiting at the top of the log. */
export function returningEntry(visits, date = new Date()) {
  if (visits < 2) return null;
  const dd = String(date.getDate()).padStart(2, '0');
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const stamp = `${dd} ${months[date.getMonth()]} ${date.getFullYear()}`;
  return {
    kind: 'log',
    time: '----',
    text: visits === 2
      ? `${stamp}. Second reading logged. The file was closed. It did not stay closed.`
      : `${stamp}. Reading ${visits}. You keep coming back to check.`,
  };
}
