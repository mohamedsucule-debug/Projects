import { readFileSync } from 'node:fs';
import { test, assert } from './harness.mjs';
import {
  PREAMBLE, ENTRIES, APPENDIX, BEATS,
  due, progress, readingsLine, returningEntry, store,
} from '../apps/nightshift/story.js';

/* ── the log ─────────────────────────────────────────────────────────────────
   It is a piece of writing, so most of it is not the kind of thing a test has
   an opinion about. These check the mechanical parts: that nothing is empty,
   that the times are times, and that the shape of every entry is one the page
   knows how to set. A typo in `kind` would otherwise drop a line silently. */

test('every entry is a kind the page can render', () => {
  const kinds = new Set(['log', 'note', 'gap', 'damaged']);
  for (const [i, e] of ENTRIES.entries()) {
    assert.ok(kinds.has(e.kind), `entry ${i} has kind ${JSON.stringify(e.kind)}`);
  }
});

test('no entry is blank', () => {
  for (const [i, e] of ENTRIES.entries()) {
    if (e.kind === 'gap') continue;
    if (e.kind === 'damaged') { assert.ok(e.time, `entry ${i} has no time`); continue; }
    assert.ok(e.text && e.text.trim().length > 0, `entry ${i} has no text`);
  }
});

test('the times are four-digit times and the night runs 2200 to 0630', () => {
  const timed = ENTRIES.filter((e) => e.time);
  for (const e of timed) assert.ok(/^\d{4}$/.test(e.time), `bad time ${JSON.stringify(e.time)}`);
  assert.equal(timed[0].time, '2200');
  assert.equal(timed[timed.length - 1].time, '0630');
});

test('the log does not go straight for the throat', () => {
  /* The first stretch has to read as paperwork or the ending has nothing to
     land against. Anything before the first contact should be weather. */
  const firstContact = ENTRIES.findIndex((e) => (e.text || '').includes('Contact bearing'));
  assert.ok(firstContact >= 10, `something happens at entry ${firstContact}, too early`);
  for (let i = 0; i < firstContact; i++) {
    const t = ENTRIES[i].text || '';
    assert.ok(
      /Nothing to report|Wind|Watch|passed E-bound/.test(t),
      `entry ${i} breaks the dullness: ${JSON.stringify(t)}`,
    );
  }
});

test('the archive frames the log at both ends', () => {
  assert.ok(PREAMBLE.length >= 3);
  assert.ok(APPENDIX.length >= 3);
  assert.ok(APPENDIX.some((l) => /read 1 time/.test(l)), 'the readings line must be last');
});

/* ── the sequence ─────────────────────────────────────────────────────────── */

test('beat ids are unique', () => {
  const ids = BEATS.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate id in ${ids.join(', ')}`);
});

test('every beat names an effect the page actually implements', () => {
  /* A beat naming an effect that does not exist fires, is marked done, and
     does nothing — the quietest possible bug. This reads the page and checks
     the names line up. */
  const page = readFileSync(new URL('../apps/nightshift/index.html', import.meta.url), 'utf8');
  const block = page.slice(page.indexOf('const EFFECTS = {'));
  for (const beat of BEATS) {
    assert.ok(
      new RegExp(`\\n  ${beat.effect}\\(`).test(block),
      `beat ${beat.id} wants effect ${JSON.stringify(beat.effect)}, which the page has no handler for`,
    );
  }
});

test('nothing fires twice', () => {
  const done = new Set();
  const state = { at: 1, after: 10_000, hidden: 99, done };
  const first = due(state);
  assert.ok(first.length > 0, 'the first pass should fire everything reachable');
  for (const b of first) done.add(b.id);
  assert.deep(due(state), [], 'a second pass with the same state fired again');
});

test('beats come back in the order they are written', () => {
  const order = BEATS.map((b) => b.id);
  const fired = due({ at: 1, after: 10_000, hidden: 99 }).map((b) => b.id);
  const expected = order.filter((id) => fired.includes(id));
  assert.deep(fired, expected);
});

test('nothing fires before its trigger', () => {
  assert.deep(due({ at: 0, after: 0, hidden: 0 }), []);
  const early = due({ at: 0.2, after: 0, hidden: 0 }).map((b) => b.id);
  assert.ok(early.includes('favicon'), 'favicon is at 0.18 and should have fired');
  assert.ok(!early.includes('lights'), 'lights is at 0.80 and should not have');
});

test('a manual beat cannot be reached by scrolling, waiting, or leaving', () => {
  /* The ending used to sit at at:0.995, which meant somebody who flung the
     scrollbar to the bottom got the closing address and the fade to black in
     the same frame: the address wrote one character before the veil covered
     it. The ending is now handed over to by the address finishing. Nothing in
     the reader's control may jump that queue. */
  const manual = BEATS.filter((b) => b.manual).map((b) => b.id);
  assert.ok(manual.includes('close'), 'the ending must be manual');
  for (const at of [0, 0.5, 0.999, 1, 2]) {
    for (const after of [0, 600, 1e6]) {
      const fired = due({ at, after, hidden: 50 }).map((b) => b.id);
      for (const id of manual) {
        assert.ok(!fired.includes(id), `${id} fired at at=${at} after=${after}`);
      }
    }
  }
});

test('somebody who scrolls straight to the bottom still gets the story', () => {
  /* The impatient reader is the common case. They should arrive at the closing
     address with every earlier beat already spent, not skip to an ending that
     has no build behind it. */
  const fired = due({ at: 1, after: 0, hidden: 0 }).map((b) => b.id);
  const scrollBeats = BEATS.filter((b) => b.at !== undefined).map((b) => b.id);
  assert.deep(fired, scrollBeats);
  assert.ok(fired[fired.length - 1] === 'address', 'the address should be the last scroll beat');
});

test('the address comes before the ending it hands over to', () => {
  assert.ok(
    BEATS.findIndex((b) => b.id === 'address') < BEATS.findIndex((b) => b.id === 'close'),
  );
});

/* ── where the reader is ─────────────────────────────────────────────────── */

test('progress is a fraction of the scrollable range, not of the page', () => {
  assert.equal(progress(0, 2000, 1000), 0);
  assert.equal(progress(500, 2000, 1000), 0.5);
  assert.equal(progress(1000, 2000, 1000), 1);
});

test('progress clamps rather than overshooting on rubber-band scroll', () => {
  assert.equal(progress(-300, 2000, 1000), 0, 'iOS scrolls past the top');
  assert.equal(progress(9999, 2000, 1000), 1, 'and past the bottom');
});

test('a page shorter than the window does not deliver the whole story at once', () => {
  /* Zero scroll range means scrollTop/range is 0/0. Left alone that is NaN,
     every comparison against it is false, and nothing ever fires; the obvious
     fix of treating it as 1 is what we do, so a reader on a very tall screen
     gets the ending rather than an inert page. */
  assert.equal(progress(0, 800, 800), 1);
  assert.equal(progress(0, 800, 1200), 1, 'window taller than the document');
  assert.ok(Number.isFinite(progress(0, NaN, 900)));
});

/* ── being remembered ────────────────────────────────────────────────────── */

test('the readings line counts, and names the reader on the second visit', () => {
  assert.equal(readingsLine(1), 'This file has been read 1 time.');
  assert.ok(/2 times\. Both by you\./.test(readingsLine(2)));
  assert.ok(/5 times\. All of them by you\./.test(readingsLine(5)));
});

test('the readings line survives nonsense from storage', () => {
  for (const v of [0, -4, NaN, undefined, null, 'seven']) {
    assert.ok(/^This file has been read \d+ time/.test(readingsLine(v)), `broke on ${v}`);
  }
});

test('a first-time reader is not told they have been here before', () => {
  assert.equal(returningEntry(1), null);
  assert.equal(returningEntry(0), null);
});

test('a returning reader finds an entry dated today at the top of a 1987 log', () => {
  const e = returningEntry(2, new Date(2026, 8, 15));
  assert.equal(e.kind, 'log');
  assert.ok(e.text.startsWith('15 SEP 2026'), e.text);
  assert.ok(/did not stay closed/.test(e.text));
  assert.ok(/Reading 3/.test(returningEntry(3, new Date(2026, 0, 1)).text));
});

test('storage failing is not a crash', () => {
  /* Reading localStorage throws outright in a private window, and there is no
     localStorage at all here — which is the same thing from the code's point
     of view, so this runs the real path. */
  const s = store.read();
  assert.equal(s.visits, 0);
  assert.equal(store.arrive().visits, 1, 'the visit still counts in memory for this page load');
  assert.ok(store.finish());
});
