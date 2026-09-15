import { test, assert } from './harness.mjs';
import {
  Puzzle, spanningTree, rotate, period, turnsTo, rng,
  dayNumber, share, DIRS, N, E, S, W,
} from '../play/tangle/engine.js';

/* ── the tile arithmetic ─────────────────────────────────────────────────── */

test('four quarter turns is where you started', () => {
  for (let m = 0; m < 16; m++) assert.equal(rotate(m, 4), m, `mask ${m}`);
});

test('a quarter turn moves every connector one side clockwise', () => {
  assert.equal(rotate(N), E);
  assert.equal(rotate(E), S);
  assert.equal(rotate(S), W);
  assert.equal(rotate(W), N);
  assert.equal(rotate(N | S), E | W, 'a straight turns into the other straight');
});

test('turning backwards, or a silly number of times, still lands somewhere real', () => {
  for (const k of [-1, -5, 9, 400]) {
    for (let m = 0; m < 16; m++) {
      const r = rotate(m, k);
      assert.ok(r >= 0 && r < 16, `rotate(${m}, ${k}) gave ${r}`);
      assert.equal(period(r), period(m), 'turning a tile cannot change its symmetry');
    }
  }
});

test('a tile knows how many orientations it really has', () => {
  assert.equal(period(N | E | S | W), 1, 'a cross looks the same however you turn it');
  assert.equal(period(N | S), 2, 'a straight has two');
  assert.equal(period(E | W), 2);
  assert.equal(period(N), 4, 'a stub has four');
  assert.equal(period(N | E), 4, 'an elbow has four');
  assert.equal(period(N | E | S), 4, 'a tee has four');
});

test('turnsTo says how to get from one orientation to another, or that you cannot', () => {
  assert.equal(turnsTo(N, E), 1);
  assert.equal(turnsTo(N, W), 3);
  assert.equal(turnsTo(N, N), 0);
  assert.equal(turnsTo(N | S, S | N), 0, 'a straight is already itself');
  assert.equal(turnsTo(N, N | E), -1, 'a stub can never become an elbow');
});

/* ── the generator, which is the whole safety argument ───────────────────── */

test('the tree reaches every single cell', () => {
  /* If it missed one, that cell would have no connectors, and a blank tile in
     the middle of a board is a puzzle nobody can finish. */
  for (const seed of [1, 2, 3, 17, 99, 12345]) {
    for (const [cols, rows] of [[3, 3], [6, 6], [4, 9], [9, 4]]) {
      const mask = spanningTree(cols, rows, rng(seed));
      for (let i = 0; i < mask.length; i++) {
        assert.ok(mask[i] !== 0, `${cols}x${rows} seed ${seed}: cell ${i} was never reached`);
      }
    }
  }
});

test('the tree never points off the edge of the board', () => {
  for (const seed of [4, 8, 15, 16, 23, 42]) {
    const cols = 7, rows = 5;
    const mask = spanningTree(cols, rows, rng(seed));
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const m = mask[y * cols + x];
        for (const d of DIRS) {
          if (!(m & d.bit)) continue;
          const nx = x + d.dx, ny = y + d.dy;
          assert.ok(nx >= 0 && ny >= 0 && nx < cols && ny < rows,
            `seed ${seed}: cell ${x},${y} points off the board`);
        }
      }
    }
  }
});

test('every connector in the tree has one facing it', () => {
  for (const seed of [1, 50, 500]) {
    const cols = 6, rows = 6;
    const mask = spanningTree(cols, rows, rng(seed));
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const m = mask[y * cols + x];
        for (const d of DIRS) {
          if (!(m & d.bit)) continue;
          const nm = mask[(y + d.dy) * cols + (x + d.dx)];
          assert.ok(nm & d.opp, `seed ${seed}: ${x},${y} reaches out and nothing reaches back`);
        }
      }
    }
  }
});

test('it is a tree, not a web: exactly one edge fewer than there are cells', () => {
  /* A spanning tree over n cells has n-1 edges. More than that means a closed
     circuit got in, which makes the board ambiguous; fewer means it is in two
     pieces. Counting is cheaper than trusting. */
  for (const seed of [2, 7, 30, 404]) {
    const cols = 6, rows = 7, n = cols * rows;
    const mask = spanningTree(cols, rows, rng(seed));
    let ends = 0;
    for (const m of mask) ends += (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
    assert.equal(ends / 2, n - 1, `seed ${seed}: ${ends / 2} edges over ${n} cells`);
  }
});

test('the tiles it produces are varied enough to be worth looking at', () => {
  /* A depth-first walk gives corridors and almost nothing but elbows. The
     board should contain stubs, corners, tees — something to read. */
  const counts = new Map();
  for (let seed = 1; seed <= 40; seed++) {
    for (const m of spanningTree(8, 8, rng(seed))) {
      const deg = (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
      counts.set(deg, (counts.get(deg) || 0) + 1);
    }
  }
  for (const deg of [1, 2, 3]) {
    assert.ok((counts.get(deg) || 0) > 40, `only ${counts.get(deg) || 0} tiles of degree ${deg} in forty boards`);
  }
});

/* ── the puzzle ──────────────────────────────────────────────────────────── */

test('a fresh board is never already solved', () => {
  // "here is your puzzle, it is finished" is not a puzzle
  for (let seed = 1; seed <= 300; seed++) {
    const p = new Puzzle({ cols: 5, rows: 5, seed });
    assert.ok(!p.solved, `seed ${seed} handed out a finished board`);
  }
});

test('every board can be turned back to solved', () => {
  /* The promise the generator exists to keep. Turning each tile back to the
     orientation the tree gave it must always finish the puzzle. */
  for (let seed = 1; seed <= 200; seed++) {
    const p = new Puzzle({ cols: 6, rows: 6, seed });
    for (let i = 0; i < p.tiles.length; i++) {
      let guard = 0;
      while (p.tiles[i] !== p.solution[i] && guard++ < 4) p.turn(i);
      assert.ok(guard <= 4, `seed ${seed}: tile ${i} never came back`);
    }
    assert.ok(p.solved, `seed ${seed} could not be solved by undoing the scramble`);
  }
});

test('par is the number of turns undoing the scramble actually takes', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const p = new Puzzle({ cols: 5, rows: 5, seed });
    const par = p.par;
    let turns = 0;
    for (let i = 0; i < p.tiles.length; i++) {
      while (p.tiles[i] !== p.solution[i]) { p.turn(i); turns++; }
    }
    assert.equal(turns, par, `seed ${seed}: par said ${par}, it took ${turns}`);
  }
});

test('solving it any other way still counts', () => {
  /* Solved means nothing is dangling, NOT "you matched the tree I grew". Other
     arrangements can leave nothing dangling too, and a player who finds one has
     solved the puzzle in front of them. A board of straights proves the point:
     every row joined end to end is solved, and is not the tree. */
  const p = new Puzzle({ cols: 4, rows: 2, seed: 1 });
  p.tiles.fill(E | W);
  assert.ok(!p.solved, 'the ends of each row are dangling');
  for (let y = 0; y < 2; y++) {
    p.tiles[y * 4] = E;
    p.tiles[y * 4 + 3] = W;
  }
  assert.ok(p.solved, 'two tidy rows leave nothing dangling and must count');
});

test('the loose count is the number of connectors with nothing to meet', () => {
  const p = new Puzzle({ cols: 2, rows: 1, seed: 1 });
  p.tiles[0] = E; p.tiles[1] = W;
  assert.equal(p.loose, 0);
  p.tiles[1] = E;                       // now one points at a wall, one at nothing
  assert.equal(p.loose, 2);
  p.tiles[0] = N; p.tiles[1] = N;       // both point at the top wall
  assert.equal(p.loose, 2);
});

test('a solved board ignores further turns', () => {
  const p = new Puzzle({ cols: 3, rows: 3, seed: 5 });
  for (let i = 0; i < p.tiles.length; i++) {
    while (p.tiles[i] !== p.solution[i]) p.turn(i);
  }
  const moves = p.moves;
  assert.equal(p.turn(0), false);
  assert.equal(p.moves, moves, 'a turn after the end still counted');
});

test('a turn outside the board is ignored rather than throwing', () => {
  const p = new Puzzle({ cols: 3, rows: 3, seed: 9 });
  for (const i of [-1, 999, 9, NaN]) assert.equal(p.turn(i), false, `turn(${i})`);
  assert.equal(p.moves, 0);
});

test('the same seed is the same board, always', () => {
  const a = new Puzzle({ seed: 777 }), b = new Puzzle({ seed: 777 });
  assert.deep([...a.tiles], [...b.tiles]);
  assert.deep([...a.solution], [...b.solution]);
  assert.equal(a.par, b.par);
});

test('different days are different boards', () => {
  const seen = new Set();
  for (let d = 1; d <= 120; d++) seen.add(new Puzzle({ seed: d }).tiles.join(','));
  assert.ok(seen.size >= 118, `${seen.size} distinct boards in 120 days`);
});

/* ── the day ─────────────────────────────────────────────────────────────── */

test('the day rolls over in UTC, so the world turns over together', () => {
  const a = dayNumber(new Date('2026-03-04T23:59:59Z'));
  const b = dayNumber(new Date('2026-03-05T00:00:01Z'));
  assert.equal(b, a + 1);
  assert.equal(dayNumber(new Date('2026-01-01T12:00:00Z')), 1);
});

test('a clock set to last century gets day one, not a negative one', () => {
  assert.equal(dayNumber(new Date('1999-06-01T00:00:00Z')), 1);
  assert.ok(new Puzzle({ seed: dayNumber(new Date('1999-06-01T00:00:00Z')) }).par > 0);
});

test('consecutive days do not repeat a board', () => {
  for (let d = 1; d < 60; d++) {
    const a = new Puzzle({ seed: d }).tiles.join(',');
    const b = new Puzzle({ seed: d + 1 }).tiles.join(',');
    assert.ok(a !== b, `day ${d} and ${d + 1} are the same board`);
  }
});

/* ── the line you paste into a chat ──────────────────────────────────────── */

test('the shared result gives nothing away', () => {
  /* A grid of coloured squares is a picture of the finished board. The whole
     point of a daily puzzle is that the person you send it to has not done it
     yet, so nothing positional may appear in it. */
  const p = new Puzzle({ seed: 42 });
  const text = share({ day: 42, moves: 61, par: p.par, seconds: 134 });
  assert.ok(!/[▪▫🟦🟩⬛⬜]/.test(text), 'that looks like a picture of the board');
  assert.ok(text.includes('#42'));
  assert.ok(text.includes('61 turns'));
  assert.ok(text.includes('2:14'));
  assert.equal(text.split('\n').length, 2, 'two lines, or nobody will paste it');
});

test('the bar reflects how well it went', () => {
  const full = share({ day: 1, moves: 40, par: 40, seconds: 60 }).split('\n')[1];
  const half = share({ day: 1, moves: 80, par: 40, seconds: 60 }).split('\n')[1];
  const poor = share({ day: 1, moves: 400, par: 40, seconds: 60 }).split('\n')[1];
  const filled = (s) => (s.match(/▰/g) || []).length;
  assert.equal(filled(full), 10, 'hitting par should fill it');
  assert.equal(filled(half), 5);
  assert.ok(filled(poor) >= 1, 'a bad round still shows something, or it reads as broken');
  assert.ok(filled(full) > filled(half) && filled(half) > filled(poor));
});

test('the share line survives nonsense rather than printing NaN at somebody', () => {
  const text = share({ day: 1, moves: 0, par: 0, seconds: 0 });
  assert.ok(!text.includes('NaN'), text);
  assert.ok(!text.includes('Infinity'), text);
});

test('a link is included only when there is one', () => {
  assert.equal(share({ day: 1, moves: 1, par: 1, seconds: 1 }).split('\n').length, 2);
  assert.equal(share({ day: 1, moves: 1, par: 1, seconds: 1, url: 'https://example.com' }).split('\n').length, 3);
});

/* ── how long does one take? ─────────────────────────────────────────────── */

test('a daily board is a couple of minutes, not an afternoon', () => {
  /* Par is turns, and a turn is a tap. Somewhere around forty to seventy taps
     is a coffee-break puzzle; two hundred is a chore nobody comes back to. */
  let total = 0;
  for (let d = 1; d <= 60; d++) total += new Puzzle({ cols: 6, rows: 6, seed: d }).par;
  const avg = total / 60;
  assert.ok(avg > 30, `par averages ${avg.toFixed(1)} turns — too slight to be satisfying`);
  assert.ok(avg < 80, `par averages ${avg.toFixed(1)} turns — too long for a daily`);
});
