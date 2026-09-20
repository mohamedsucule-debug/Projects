/* tests/gobl.test.mjs — the three things a food app gets wrong, and the data
   that has to stay true underneath them.

   Gobl is a photo grid on top of a search engine, and the search engine is
   where the bugs live. All three of the ones this is built to avoid are
   invisible on screen: a ranking that looks plausible, a facet count that
   looks plausible, and a dietary filter that looks plausible right up until
   somebody eats something. None of them throw. So they are tested here, and
   two of these tests are about the *reasons* rather than the results — the
   tribe test below is the one that actually caught a bug in this app, where a
   tribe's filter key was silently ignored and its feed quietly contained every
   restaurant in the dataset. */

import { test, assert } from './harness.mjs';
import {
  RESTAURANTS, POSTS, RECIPES, TRIBES, PEOPLE, DISHES, TAGS, METRICS, MEALS,
  restaurantById, dishById, personById, toGBP,
} from '../apps/gobl/data.js';
import {
  EMPTY, makeContext, matches, filterRestaurants, facetCounts, parseQuery, rank,
  shrunkMean, mean, median, split, distribution, summarise, priors, explainScore,
  dishRanking, tribeFilter, tribeMembership, searchScore, buildIndex, tokenise,
  normalise, expand, withinOneEdit, summariseRecipe, filterRecipes, rankRecipes,
  recipePrior, distanceKm, METRIC_IDS,
} from '../apps/gobl/engine.js';
import { hasArchetype, rng, ARCHETYPES } from '../apps/gobl/plates.js';

const ctx = makeContext();
const base = () => ({ ...EMPTY, cities: [], areas: [], cuisines: [], bands: [], meals: [], tags: [] });
const names = (f) => filterRestaurants(f, ctx).map((r) => r.id).sort();

/* ── 1 · a rating has to be earned ───────────────────────────────────────── */

test('a 5.0 from two people ranks below a 4.6 from thirty', () => {
  /* The whole reason shrinkage is in here. Sort a restaurant list by plain
     mean and the top of it is always the places nobody has been to, which is
     the opposite of a recommendation. */
  const prior = 4.0;
  const newcomer = shrunkMean([5, 5], prior);
  const established = shrunkMean(Array(30).fill(4.6), prior);
  assert.ok(established > newcomer,
    `expected the established 4.6 to outrank the 5.0, got ${established.toFixed(3)} vs ${newcomer.toFixed(3)}`);
  assert.close(mean([5, 5]), 5, 1e-9, 'and the plain mean gets it backwards');
});

test('shrinking moves a rating towards the prior and never past it', () => {
  assert.ok(shrunkMean([5, 5, 5], 3) < 5);
  assert.ok(shrunkMean([5, 5, 5], 3) > 3);
  assert.ok(shrunkMean([1], 3) > 1);
  assert.ok(shrunkMean([1], 3) < 3);
});

test('with no reviews at all, the score IS the prior', () => {
  /* Not zero, and not "5.0 — no reviews yet", which is how an empty listing
     ends up at the top of a list sorted by rating. */
  assert.equal(shrunkMean([], 3.9), 3.9);
});

test('more evidence moves a rating less', () => {
  const prior = 4.0;
  const short = Math.abs(shrunkMean([5, 5, 5], prior) - 5);
  const long = Math.abs(shrunkMean(Array(40).fill(5), prior) - 5);
  assert.ok(long < short, 'forty fives should sit closer to five than three do');
});

test('the prior is computed from the data, not typed in', () => {
  const p = priors(POSTS);
  const everyScore = POSTS.flatMap((x) => METRIC_IDS.map((id) => x.scores[id]));
  assert.close(p.overall, mean(everyScore), 1e-9);
  assert.ok(p.overall > 3 && p.overall < 5, `prior of ${p.overall} is not a plausible average of 1–5 scores`);
});

test('no restaurant with two reviews outranks one with ten unless it deserves to', () => {
  const ranked = rank(filterRestaurants(base(), ctx), { ...base(), sort: 'best' }, ctx);
  for (const hit of ranked.slice(0, 3)) {
    assert.ok(hit.summary.n >= 4, `${hit.rest.name} is in the top three on ${hit.summary.n} reviews`);
  }
});

/* ── 2 · facet counts that stay useful ───────────────────────────────────── */

test('selecting one value in a facet does not zero the others in it', () => {
  /* THE bug. Count with the facet you are counting applied and every option
     the reader has not picked reads zero, so the interface says "there is
     nothing else" at the exact moment they want to change their mind. */
  const f = { ...base(), cities: ['london'] };
  const counts = facetCounts('cities', f, ctx);
  assert.ok(counts.get('new-york') > 0, 'New York reads zero while London is selected');
  assert.ok(counts.get('tokyo') > 0, 'Tokyo reads zero while London is selected');
  assert.equal(counts.get('london'), RESTAURANTS.filter((r) => r.city === 'london').length);
});

test('facet counts DO narrow under the other filters', () => {
  /* The other half. Leaving one facet out must not mean ignoring all of them,
     or the counts are just the size of the dataset forever. */
  const all = facetCounts('cuisines', base(), ctx);
  const londonOnly = facetCounts('cuisines', { ...base(), cities: ['london'] }, ctx);
  assert.ok(londonOnly.get('mexican') === undefined || londonOnly.get('mexican') < all.get('mexican'),
    'the Mexican count did not drop when the search was narrowed to London');
  assert.ok(londonOnly.get('british') >= 1);
});

test('a facet count is exactly what you would get if you picked it', () => {
  /* The count is a promise about the next click, so it is checked by making
     the click. */
  const f = { ...base(), bands: [1] };
  const counts = facetCounts('cuisines', f, ctx);
  for (const [cuisine, n] of counts) {
    const got = filterRestaurants({ ...f, cuisines: [cuisine] }, ctx).length;
    assert.equal(got, n, `count said ${n} for ${cuisine}, picking it gave ${got}`);
  }
});

test('the diet facet counts kitchens that can do it, under the other filters', () => {
  const f = { ...base(), cities: ['london'] };
  const counts = facetCounts('diet', f, ctx);
  const londonVegan = RESTAURANTS.filter((r) => r.city === 'london' && r.diet.vegan !== 'none').length;
  assert.equal(counts.get('vegan'), londonVegan);
});

/* ── 3 · a caption is not a dietary guarantee ────────────────────────────── */

test('a caption is not a dietary guarantee', () => {
  /* The most important test here. Text matching is how a filter ends up
     recommending a steakhouse to a vegan, because "not great for vegans"
     contains the word. This builds exactly that trap — a kitchen with nothing
     vegan, and five reviews that all say the word — and asserts the filter is
     not fooled. */
  const trap = {
    id: 'trap', name: 'The Trap', city: 'london', area: 'soho', cuisine: 'steakhouse',
    styles: ['steak'], band: 3, meals: ['dinner'], noise: 3, booking: 'walk-in', seats: 40, opened: 2000,
    diet: { vegan: 'none', vegetarian: 'none', glutenFree: 'none', halal: 'none' },
    blurb: 'Vegan friendly? No.', dishes: [{ id: 'trap-steak', name: 'Steak', price: 30, archetype: 'steak', tags: [] }],
  };
  const posts = Array.from({ length: 5 }, (_, i) => ({
    id: `trap${i}`, author: 'lex', restaurant: 'trap', dish: 'trap-steak', paid: 30, daysAgo: i,
    likes: 1, tags: [], caption: 'Not vegan friendly at all — vegan options are nonexistent, vegan vegan vegan.',
    scores: { food: 5, value: 5, service: 5, speed: 5, vibe: 5 },
  }));
  const trapCtx = makeContext({ restaurants: [trap], posts });

  assert.equal(filterRestaurants({ ...base(), diet: 'vegan' }, trapCtx, [trap]).length, 0,
    'the filter was satisfied by the word in a caption');

  /* And the search box still finds it, which is correct and is the whole
     distinction: search is a suggestion, a filter is a promise. */
  const hit = searchScore(buildIndex([trap], posts)[0], ['vegan']);
  assert.ok(hit.score > 0, 'search should still find the word — it is in the text');
});

test('"a few dishes" satisfies a relaxed vegan filter and not a strict one', () => {
  const some = names({ ...base(), diet: 'vegan', dietLevel: 'some' });
  const full = names({ ...base(), diet: 'vegan', dietLevel: 'full' });
  assert.ok(some.length > full.length, 'strict and relaxed returned the same set');
  for (const id of full) assert.ok(some.includes(id), `${id} is in the strict set but not the relaxed one`);
  for (const id of full) assert.equal(restaurantById.get(id).diet.vegan, 'full');
});

test('a kitchen that can do nothing is never returned', () => {
  for (const diet of ['vegan', 'vegetarian', 'glutenFree', 'halal']) {
    for (const r of filterRestaurants({ ...base(), diet }, ctx)) {
      assert.ok(r.diet[diet] !== 'none', `${r.name} was returned for ${diet} with a 'none' flag`);
    }
  }
});

/* ── reading what somebody typed ─────────────────────────────────────────── */

test('a sentence becomes filters, and the words that became filters leave the query', () => {
  const { filters, read, terms } = parseQuery('cheap vegan brunch in peckham under £15');
  assert.deep(filters.areas, ['peckham']);
  assert.deep(filters.meals, ['brunch']);
  assert.equal(filters.diet, 'vegan');
  assert.equal(filters.maxSpendGBP, 15);
  assert.deep(filters.bands, [1]);
  assert.equal(terms.length, 0, `left ${JSON.stringify(terms)} as free text`);
  assert.ok(read.length >= 5, 'the reader is not shown everything that was understood');
});

test('what was understood is reported back, because guessing silently is worse', () => {
  const { read } = parseQuery('quiet dinner in soho');
  assert.ok(read.includes('quiet'), 'the noise ceiling was applied without saying so');
  assert.ok(read.includes('soho'));
});

test('a typo still finds the thing', () => {
  assert.ok(withinOneEdit('vegeterian', 'vegetarian'));
  assert.ok(withinOneEdit('ramn', 'ramen'));
  assert.ok(!withinOneEdit('ramen', 'gyoza'));
  assert.equal(parseQuery('vegeterian').filters.diet, 'vegetarian');
});

test('"noodles" finds the ramen counter', () => {
  const index = buildIndex();
  const scored = RESTAURANTS.map((r, i) => ({ r, s: searchScore(index[i], ['noodles']).score }))
    .sort((a, b) => b.s - a.s);
  assert.ok(['tonkotsu-row', 'sanchome'].includes(scored[0].r.id),
    `"noodles" ranked ${scored[0].r.name} first`);
  assert.deep(expand('gyoza'), ['gyoza', 'dumpling']);
});

test('every term has to hit something', () => {
  /* Otherwise "vegan ramen soho" returns the ramen place that is none of the
     other two things, and the app looks like it ignored half the sentence. */
  const index = buildIndex();
  const row9 = index.find((d) => d.id === 'tonkotsu-row');
  const both = searchScore(row9, ['ramen', 'soho']).score;
  const oneMissing = searchScore(row9, ['ramen', 'helsinki']).score;
  assert.ok(oneMissing < both / 2, 'a miss barely cost anything');
});

test('accents and case do not matter', () => {
  assert.equal(normalise('Príncipe Real'), 'principe real');
  assert.deep(tokenise('  Eggs,   BRUNCH '), ['eggs', 'brunch']);
});

/* ── what people thought ─────────────────────────────────────────────────── */

test('a split room is reported as split, not as average', () => {
  /* Two restaurants, same mean, completely different evenings. */
  const divisive = split([5, 5, 5, 2, 2, 1]);
  const lukewarm = split([3, 3, 4, 3, 3, 4]);
  assert.ok(divisive.divisive, 'a 5/5/5/2/2/1 room was not flagged as split');
  assert.ok(!lukewarm.divisive, 'a room that agreed was flagged as split');
  assert.ok(divisive.sd > lukewarm.sd);
});

test('three reviews is never enough to call a place divisive', () => {
  assert.ok(!split([5, 1, 5]).divisive, 'called it on three data points');
});

test('the wait is a median, so one ninety-minute outlier does not own it', () => {
  const s = ctx.summaryOf('smash-lab');
  assert.ok(s.wait, 'no wait reported for the place with a famous queue');
  assert.equal(s.wait.worst, 90);
  assert.ok(s.wait.median < 60, `median wait came out at ${s.wait.median}`);
});

test('the distribution adds up to the number of reviews', () => {
  for (const r of RESTAURANTS) {
    const s = ctx.summaryOf(r.id);
    const total = s.metrics.food.dist.reduce((a, b) => a + b, 0);
    assert.equal(total, s.n, `${r.name}: ${total} scores in the histogram, ${s.n} reviews`);
  }
  assert.deep(distribution([1, 3, 3, 5]), [1, 0, 2, 0, 1]);
});

test('the score explains itself in a sentence that contains the numbers', () => {
  const s = ctx.summaryOf('yakitori-ban');
  const why = explainScore(s, ctx.prior);
  assert.ok(why.includes(s.raw.toFixed(2)), `"${why}" does not say what the raw average was`);
  assert.ok(why.includes(String(s.n)), 'it does not say how many reviews that is');
});

test('a dish is shrunk harder than a restaurant', () => {
  /* Three reviews of a side order should not be able to top the list. */
  const posts = ctx.postsOf('kettle');
  const ranked = dishRanking(posts, ctx.prior);
  for (const d of ranked) {
    assert.ok(Math.abs(d.score - ctx.prior.food) <= Math.abs(d.raw - ctx.prior.food) + 1e-9,
      `${d.dish.name} moved away from the prior`);
  }
  assert.ok(ranked[0].score >= ranked[ranked.length - 1].score, 'not sorted');
});

/* ── filters, sorting and money ──────────────────────────────────────────── */

test('every ceiling filter actually holds', () => {
  for (const r of filterRestaurants({ ...base(), maxNoise: 2 }, ctx)) assert.ok(r.noise <= 2);
  for (const r of filterRestaurants({ ...base(), maxSeats: 20 }, ctx)) assert.ok(r.seats <= 20);
  for (const r of filterRestaurants({ ...base(), minScore: 4 }, ctx)) {
    assert.ok(ctx.summaryOf(r.id).overall >= 4);
  }
  for (const r of filterRestaurants({ ...base(), maxSpendGBP: 15 }, ctx)) {
    assert.ok(toGBP(ctx.summaryOf(r.id).spend, r.city) <= 15,
      `${r.name} costs ${toGBP(ctx.summaryOf(r.id).spend, r.city)} in pounds`);
  }
});

test('a spend ceiling compares like with like across four currencies', () => {
  /* ¥980 is not 980 pounds, and a filter that thinks it is puts every Tokyo
     restaurant in the blowout bracket. */
  assert.close(toGBP(980, 'tokyo'), 5.194, 0.01);
  const cheap = filterRestaurants({ ...base(), maxSpendGBP: 12 }, ctx);
  assert.ok(cheap.some((r) => r.city === 'tokyo'), 'nothing in Tokyo counts as cheap');
  assert.ok(cheap.some((r) => r.city === 'london'));
});

test('sorting by different things gives different orders', () => {
  const f = base();
  const order = (sort) => rank(filterRestaurants(f, ctx), { ...f, sort }, ctx).map((h) => h.rest.id);
  const best = order('best');
  assert.ok(JSON.stringify(best) !== JSON.stringify(order('cheapest')), 'cheapest matched best rated');
  assert.ok(JSON.stringify(best) !== JSON.stringify(order('talked')), 'most talked about matched best rated');
  assert.equal(order('cheapest').length, RESTAURANTS.length, 'a sort dropped results');
});

test('an empty filter returns everything, and a contradictory one returns nothing', () => {
  assert.equal(filterRestaurants(base(), ctx).length, RESTAURANTS.length);
  assert.equal(filterRestaurants({ ...base(), cities: ['tokyo'], areas: ['soho'] }, ctx).length, 0);
});

/* ── tribes ──────────────────────────────────────────────────────────────── */

test('every key a tribe filters on is one the filter builder understands', () => {
  /* This is the test that caught a real bug: #CounterCulture filtered on
     `maxSeats`, `tribeFilter` did not map it, and the tribe silently contained
     all twenty-two restaurants — a saved search with no search in it. Nothing
     threw, the feed looked full, and it was wrong. */
  const known = new Set(['city', 'meals', 'diet', 'dietLevel', 'maxSpend', 'maxWait', 'maxNoise', 'maxSeats', 'dish', 'tags']);
  for (const t of TRIBES) {
    for (const key of Object.keys(t.filter)) {
      assert.ok(known.has(key), `#${t.name} filters on "${key}", which tribeFilter ignores`);
    }
    const f = tribeFilter(t);
    const n = filterRestaurants(f, ctx).length;
    assert.ok(n > 0, `#${t.name} is empty`);
    assert.ok(n < RESTAURANTS.length, `#${t.name} contains everything — its filter is doing nothing`);
  }
});

test('tribe membership is computed, so a place is in a tribe if and only if it matches', () => {
  for (const r of RESTAURANTS.slice(0, 6)) {
    for (const t of TRIBES) {
      const inIt = tribeMembership(r.id, ctx).some((x) => x.id === t.id);
      assert.equal(inIt, matches(r, tribeFilter(t), ctx), `${r.name} / #${t.name} disagree`);
    }
  }
});

test('the burger tribe contains burger places and not a bakery', () => {
  const ids = filterRestaurants(tribeFilter(TRIBES.find((t) => t.id === 'nyc-burgers')), ctx).map((r) => r.id);
  assert.ok(ids.includes('smash-lab') && ids.includes('patty-melt'));
  assert.ok(!ids.includes('pastel-pombo'));
});

/* ── recipes ─────────────────────────────────────────────────────────────── */

test('recipes are ranked by the same shrinkage as restaurants', () => {
  const prior = recipePrior();
  const ranked = rankRecipes(RECIPES, prior);
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(summariseRecipe(ranked[i - 1], prior).score >= summariseRecipe(ranked[i], prior).score);
  }
  /* People who bother to report cooking something liked it, so the recipe
     prior sits high — 4.60 as the data stands. That is worth stating rather
     than hiding, because it changes what shrinkage does here: two fives are
     pulled down only to 4.73, so they still beat twenty 4.6s. That is the
     model being right, not the model failing — twenty reviews AT the average
     carry no information that the average did not already have. Against a
     genuinely better established recipe it loses, which is the claim. */
  const thin = { cooks: [{ by: 'x', rating: 5 }, { by: 'y', rating: 5 }] };
  const thick = { cooks: Array.from({ length: 20 }, () => ({ by: 'z', rating: 4.9 })) };
  assert.close(prior, 4.6, 0.05, 'the prior moved — the numbers below are chosen around it');
  assert.ok(summariseRecipe(thick, prior).score > summariseRecipe(thin, prior).score,
    'a well-established 4.9 should outrank a brand new 5.0');
  assert.ok(summariseRecipe(thin, prior).score < 5, 'the thin 5.0 was not shrunk at all');
});

test('a vegan filter on recipes reads the recipe flag', () => {
  for (const r of filterRecipes({ diet: 'vegan' })) assert.ok(r.diet.vegan, `${r.title} is not vegan`);
  assert.ok(filterRecipes({ q: 'dal' }).some((r) => r.id === 'dal'));
  assert.equal(filterRecipes({ maxMinutes: 25 }).every((r) => r.minutes <= 25), true);
});

/* ── the data itself ─────────────────────────────────────────────────────── */

test('every post points at a restaurant, a dish on that restaurant, and a person', () => {
  for (const p of POSTS) {
    const r = restaurantById.get(p.restaurant);
    assert.ok(r, `${p.id} points at missing restaurant ${p.restaurant}`);
    assert.ok(personById.get(p.author), `${p.id} has unknown author ${p.author}`);
    const dish = dishById.get(p.dish);
    assert.ok(dish, `${p.id} points at missing dish ${p.dish}`);
    assert.equal(dish.restaurant, p.restaurant, `${p.id} reviews a dish from another restaurant`);
  }
});

test('every score is on the scale it claims to be on', () => {
  for (const p of POSTS) {
    for (const id of METRIC_IDS) {
      const v = p.scores[id];
      assert.ok(Number.isInteger(v) && v >= 1 && v <= 5, `${p.id}.${id} is ${v}`);
    }
    assert.ok(p.paid > 0, `${p.id} paid ${p.paid}`);
    if (p.waited != null) assert.ok(p.waited >= 0 && p.waited <= 180, `${p.id} waited ${p.waited}`);
    if (p.meal) assert.ok(MEALS.includes(p.meal), `${p.id} ate at "${p.meal}"`);
  }
});

test('every tag on a post comes from the fixed vocabulary', () => {
  /* Tags are counted and shown as facts on a restaurant page, so a freehand
     tag is a fact nobody can filter by and a count that silently splits. */
  const known = new Set(TAGS.map((t) => t.id));
  for (const p of POSTS) for (const t of p.tags) assert.ok(known.has(t), `${p.id} carries unknown tag "${t}"`);
});

test('every restaurant has reviews, and enough of them to say anything', () => {
  for (const r of RESTAURANTS) {
    assert.ok(ctx.postsOf(r.id).length >= 3, `${r.name} has ${ctx.postsOf(r.id).length} reviews`);
  }
  assert.ok(POSTS.length >= 90, `only ${POSTS.length} posts`);
});

test('every dish can actually be drawn', () => {
  /* A dish whose archetype has no drawing routine falls back to a generic
     plate, which is not wrong but is not what anyone intended. */
  for (const d of DISHES) {
    assert.ok(hasArchetype(d.archetype), `${d.name} wants a "${d.archetype}" that plates.js cannot draw`);
  }
  for (const r of RECIPES) assert.ok(hasArchetype(r.archetype), `recipe ${r.id}: no "${r.archetype}"`);
  assert.ok(ARCHETYPES.length >= 20);
});

test('a dish looks the same every time it is drawn', () => {
  /* The seed is the dish id, and a picture that reshuffles on every render
     reads as a bug rather than as variety. */
  const a = rng('kettle-lamb'), b = rng('kettle-lamb'), c = rng('kettle-crab');
  const draw = (f) => Array.from({ length: 5 }, f);
  assert.deep(draw(a), draw(b));
  assert.ok(JSON.stringify(draw(rng('kettle-lamb'))) !== JSON.stringify(draw(c)), 'two dishes drew identically');
});

test('the data disagrees with itself somewhere, or none of this maths matters', () => {
  const divisive = RESTAURANTS.filter((r) => {
    const s = ctx.summaryOf(r.id);
    return METRIC_IDS.some((id) => s.metrics[id].split.divisive);
  });
  assert.ok(divisive.length >= 2, `only ${divisive.length} places have a split room — the dataset is too polite to test with`);
});

test('the crude distance grid is a distance', () => {
  assert.close(distanceKm('soho', 'soho'), 0, 1e-9);
  assert.equal(distanceKm('soho', 'queens'), Infinity, 'two cities should not have a walking distance');
  assert.ok(distanceKm('soho', 'peckham') > distanceKm('soho', 'kings-cross'));
});
