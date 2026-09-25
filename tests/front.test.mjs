/* tests/front.test.mjs — the promises the front page makes in large type.

   The hero says thirty and the wall behind it is meant to be all of them. Both
   are hand-written lists in a page that gets edited often, and the day a
   thirty-first piece is added to the atlas is exactly the day one of them will
   be forgotten — and a wall that silently leaves one thing off still looks
   complete. So the counts are checked against the atlas, which is the one
   list the navigator and the search already trust. */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert } from './harness.mjs';
import { ATLAS, byId } from '../shared/atlas.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
  'twenty', 'twenty-one', 'twenty-two', 'twenty-three', 'twenty-four', 'twenty-five', 'twenty-six',
  'twenty-seven', 'twenty-eight', 'twenty-nine', 'thirty', 'thirty-one', 'thirty-two', 'thirty-three'];

/* The WALL array, with the fact(...) entries taken out — what is left is the
   ids of the live tiles, one quoted string each. */
function wallIds() {
  const block = html.match(/const WALL = \[([\s\S]*?)\n\];/);
  assert.ok(block, 'could not find the WALL list in index.html');
  const bare = block[1].replace(/fact\((?:[^()']|'[^']*')*\)/g, '');
  return [...bare.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
}

function wallFacts() {
  const block = html.match(/const WALL = \[([\s\S]*?)\n\];/)[1];
  return [...block.matchAll(/fact\((?:[^()']|'[^']*')*\)/g)].map((m) => m[0]);
}

test('the wall carries every project in the atlas, exactly once', () => {
  const ids = wallIds();
  const seen = new Set();
  for (const id of ids) {
    assert.ok(byId.has(id), `the wall lists "${id}", which is not in the atlas`);
    assert.ok(!seen.has(id), `the wall lists "${id}" twice`);
    seen.add(id);
  }
  for (const e of ATLAS) assert.ok(seen.has(e.id), `${e.title} is in the atlas but not on the wall`);
});

test('every fact on the wall points somewhere real', () => {
  const facts = wallFacts();
  assert.ok(facts.length > 0, 'found no facts on the wall');
  for (const f of facts) {
    const go = f.match(/,\s*(REPO|'[a-z0-9-]+')\s*(?:,\s*true\s*)?\)$/);
    assert.ok(go, `could not read where ${f} links to`);
    if (go[1] !== 'REPO') {
      const id = go[1].slice(1, -1);
      assert.ok(byId.has(id), `${f} links to "${id}", which is not in the atlas`);
      assert.ok(existsSync(join(root, byId.get(id).href)), `${f} links to a page that does not exist`);
    }
  }
});

test('the wall fills its columns evenly', () => {
  /* Six columns, and every column has to be the same length, or the short
     one runs out of tiles and shows a gap as it loops. */
  const cols = Number(html.match(/const WALL_COLS = (\d+);/)?.[1]);
  const n = wallIds().length + wallFacts().length;
  assert.ok(cols > 0, 'no WALL_COLS');
  assert.equal(n % cols, 0, `${n} tiles do not divide into ${cols} equal columns`);
});

test('the number on the front page is the number of things in the atlas', () => {
  const claimed = Number(html.match(/<b data-count="(\d+)">\d+<\/b><span>projects/)?.[1]);
  assert.equal(claimed, ATLAS.length, `the page says ${claimed} projects; the atlas has ${ATLAS.length}`);
  const heading = html.match(/<h1>[\s\S]*?<span[^>]*>([^<]*)<\/span>/)?.[1] ?? '';
  assert.ok(heading.toLowerCase().startsWith(`${WORDS[ATLAS.length]} things`),
    `the headline reads "${heading}" but the atlas has ${ATLAS.length}`);
});

test('the counts in the way down match the atlas', () => {
  const ml = ATLAS.filter((e) => e.kind === 'ml').length;
  const cue = (html.match(/<a class="cue"[^>]*>([^<]*)</)?.[1] ?? '').trim();
  const expected = `${WORDS[ml]} on machine learning, then ${WORDS[ATLAS.length - ml]} more`;
  assert.equal(cue, expected, `the cue says "${cue}"`);
});
