/* ───────────────────────────────────────────────────────────────────────────
   gobl/engine.js — everything that decides what you see.

   A food app is a photo grid on top of three problems that are genuinely easy
   to get wrong, and every one of them is wrong in shipping software today:

   1. AVERAGING. A 5.0 from two people is not better than a 4.6 from three
      hundred, and a plain mean says it is. Sort by plain mean and the top of
      every list is the places nobody has been to. Fixed here by pulling every
      average towards the global average by an amount that depends on how
      little evidence there is — `shrunkMean` — so a rating has to be *earned*
      by volume before it can sit at the top.

   2. FACET COUNTS. The number next to "vegan (6)" has to be computed with all
      the OTHER filters applied and this one left out. Apply the filter you are
      counting and every unselected option in the same facet reads zero, so the
      interface tells you there is nothing else to pick at the exact moment you
      want to change your mind. This is the single most common bug in faceted
      search and it is one line — see `facetCounts` and the test named after it.

   3. DIETARY FILTERS. "Vegan" is a promise about a kitchen, not a word that
      appears near a photo. Matching text would let a caption reading "not
      great for vegans" satisfy a vegan filter, and somebody would get ill. The
      filter reads a three-valued flag recorded per restaurant and nothing else
      — there is a test that holds the line, and it is the most important test
      in the file.

   Everything here is a pure function over the data in data.js. Nothing fetches,
   nothing writes, and the UI in index.html owns all the DOM.
   ─────────────────────────────────────────────────────────────────────────── */

import {
  RESTAURANTS, POSTS, RECIPES, TRIBES, AREAS, CITIES, TAG_LABEL,
  restaurantById, dishById, areaById, toGBP,
} from './data.js';

/* ── words ─────────────────────────────────────────────────────────────────
   People type what they call the thing, not what the menu calls it. "Noodles"
   has to find a ramen counter and "veggie" has to find the vegetarian kitchen,
   because a search box that only matches the vocabulary of the person who
   wrote the data is a search box for one person. */

export const SYNONYMS = {
  burger: ['burgers', 'smash', 'cheeseburger', 'patty'],
  ramen: ['noodle', 'noodles', 'tonkotsu', 'shoyu', 'tsukemen'],
  taco: ['tacos', 'taqueria', 'pastor', 'suadero'],
  dumpling: ['dumplings', 'gyoza', 'potsticker'],
  brunch: ['breakfast', 'eggs', 'pancake', 'pancakes'],
  vegetarian: ['veggie', 'veg', 'meatless'],
  vegan: ['plantbased', 'plant', 'vegans'],
  glutenfree: ['gf', 'gluten', 'coeliac', 'celiac'],
  cheap: ['budget', 'cheapeats', 'affordable', 'bargain'],
  pastry: ['bakery', 'bake', 'cake', 'buns', 'bun', 'nata', 'natas'],
  coffee: ['cafe', 'espresso', 'flatwhite', 'kissaten'],
  fish: ['seafood', 'oyster', 'oysters', 'sardine', 'sardines'],
  chicken: ['fried', 'wings'],
  curry: ['masala', 'dal', 'daal'],
};

/** word → the canonical word it should also match on */
const SYNONYM_OF = (() => {
  const m = new Map();
  for (const [root, words] of Object.entries(SYNONYMS)) {
    m.set(root, root);
    for (const w of words) m.set(w, root);
  }
  return m;
})();

export function normalise(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // café → cafe
    .replace(/[^a-z0-9£$€¥+<>: ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenise(s) {
  return normalise(s).split(' ').filter(Boolean);
}

/** Expand a token to itself plus the canonical word it is a synonym of. */
export function expand(token) {
  const root = SYNONYM_OF.get(token);
  return root && root !== token ? [token, root] : [token];
}

/** Levenshtein distance, capped: true when one edit gets you from a to b.
    "vegeterian" is a real thing people type and it should still find the
    vegetarian kitchen rather than nothing at all. */
export function withinOneEdit(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/* ── the maths on opinions ─────────────────────────────────────────────────
   Five scores per post, one to five. Everything a restaurant page shows about
   what people thought comes out of these three functions. */

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * A mean you can sort by.
 *
 * The plain average of two fives is five, and it means almost nothing. This
 * mixes in `weight` imaginary reviews at the global average `prior`, so a
 * place needs real volume before it can claim the top of the list:
 *
 *     two 5s, prior 4.0, weight 6  →  (10 + 24) / (2 + 6)  = 4.25
 *     thirty 4.6s, same prior      →  (138 + 24) / (30 + 6) = 4.50
 *
 * Which is the right way round, and a plain mean gets it backwards. `weight`
 * is the one judgement call: it is the number of reviews at which you trust
 * the average about as much as you trust the prior. Six is deliberately low
 * for a dataset this size; a real one would fit it rather than pick it.
 */
export function shrunkMean(values, prior, weight = 6) {
  const n = values.length;
  if (!n) return prior;
  return (values.reduce((a, b) => a + b, 0) + prior * weight) / (n + weight);
}

/** Counts of each score 1..5, for the little bar chart on a restaurant page. */
export function distribution(values) {
  const bins = [0, 0, 0, 0, 0];
  for (const v of values) {
    const i = Math.min(5, Math.max(1, Math.round(v))) - 1;
    bins[i]++;
  }
  return bins;
}

/**
 * Is the room actually split, or is everybody lukewarm?
 *
 * Both come out as a 3.4 and they are completely different restaurants. A
 * place where half the reviewers say 5 and half say 2 is not "average" — it is
 * a place you will either love or resent, and the app should say so instead of
 * quietly averaging it into the middle of the list.
 */
export function split(values) {
  if (values.length < 4) return { divisive: false, low: 0, high: 0, sd: 0 };
  const m = mean(values);
  const sd = Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
  const low = values.filter((v) => v <= 2).length / values.length;
  const high = values.filter((v) => v >= 4).length / values.length;
  return { divisive: low >= 0.25 && high >= 0.5, low, high, sd };
}

export const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};

/* ── what people thought ───────────────────────────────────────────────── */

export const METRIC_IDS = ['food', 'value', 'service', 'speed', 'vibe'];

/** The global average of every metric across every post — the prior that
    `shrunkMean` pulls towards. Computed from the data rather than guessed,
    because a hard-coded 4.0 stops being true the moment the data changes. */
export function priors(posts = POSTS) {
  const out = {};
  for (const id of METRIC_IDS) out[id] = mean(posts.map((p) => p.scores[id]));
  out.overall = mean(METRIC_IDS.map((id) => out[id]));
  return out;
}

/**
 * Everything a restaurant page needs about its own reviews.
 *
 * `overall` is the shrunk average of the five shrunk metric averages, and not
 * a sixth score people give — asking for an overall out of five on top of the
 * five is how you get a column of 4s that correlates with nothing.
 */
export function summarise(posts, prior = priors()) {
  const n = posts.length;
  const metrics = {};
  for (const id of METRIC_IDS) {
    const values = posts.map((p) => p.scores[id]);
    metrics[id] = {
      n, raw: mean(values), score: shrunkMean(values, prior[id]),
      dist: distribution(values), split: split(values),
    };
  }
  const waits = posts.map((p) => p.waited).filter((w) => typeof w === 'number');
  const tagCounts = new Map();
  for (const p of posts) for (const t of p.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);

  return {
    n,
    metrics,
    overall: shrunkMean(posts.map((p) => mean(METRIC_IDS.map((id) => p.scores[id]))), prior.overall),
    raw: mean(posts.map((p) => mean(METRIC_IDS.map((id) => p.scores[id])))),
    likes: posts.reduce((a, p) => a + p.likes, 0),
    /* The number every other app has and nobody publishes. Median, not mean:
       one person who waited ninety minutes should not move it much. */
    wait: waits.length ? { median: median(waits), worst: Math.max(...waits), n: waits.length } : null,
    spend: median(posts.map((p) => p.paid)),
    tags: [...tagCounts.entries()].sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ id, count, label: TAG_LABEL.get(id) ?? id, share: count / n })),
  };
}

/** One sentence explaining why a score is what it is. A ranking nobody can
    interrogate is a ranking nobody should trust. */
export function explainScore(summary, prior = priors()) {
  const gap = summary.raw - summary.overall;
  const base = `${summary.raw.toFixed(2)} average from ${summary.n} ${summary.n === 1 ? 'review' : 'reviews'}`;
  if (summary.n >= 12) return `${base} — enough of them that it barely moves.`;
  if (gap > 0.08) return `${base}, shown as ${summary.overall.toFixed(2)}: pulled down towards ${prior.overall.toFixed(2)} because ${summary.n} reviews is not many.`;
  if (gap < -0.08) return `${base}, shown as ${summary.overall.toFixed(2)}: pulled up towards ${prior.overall.toFixed(2)} for the same reason it would pull a high one down.`;
  return `${base}, and close enough to the site average that shrinking barely moves it.`;
}

/** Which dishes people actually rate, rather than which the chef is proud of. */
export function dishRanking(posts, prior = priors()) {
  const by = new Map();
  for (const p of posts) {
    if (!by.has(p.dish)) by.set(p.dish, []);
    by.get(p.dish).push(p);
  }
  return [...by.entries()]
    .map(([id, ps]) => ({
      dish: dishById.get(id),
      n: ps.length,
      score: shrunkMean(ps.map((p) => p.scores.food), prior.food, 3),
      raw: mean(ps.map((p) => p.scores.food)),
      likes: ps.reduce((a, p) => a + p.likes, 0),
    }))
    .sort((a, b) => b.score - a.score);
}

/* ── the filters ───────────────────────────────────────────────────────────
   One object describes the entire state of the search. Every facet is either
   absent (no constraint) or an array of accepted values, except the numeric
   ones, which are ceilings. Keeping it plain data is what lets a tribe BE a
   filter, and what lets the whole search state live in the URL. */

export const EMPTY = Object.freeze({
  q: '', cities: [], areas: [], cuisines: [], bands: [], meals: [], tags: [],
  diet: null, dietLevel: 'some', maxSpendGBP: null, maxWait: null, maxNoise: null,
  maxSeats: null, minScore: null, openFor: null, dishKind: null, sort: 'best',
});

export const FACETS = ['cities', 'areas', 'cuisines', 'bands', 'meals', 'tags', 'diet'];

const has = (arr) => Array.isArray(arr) && arr.length > 0;

/** Does one restaurant satisfy one filter object? `postsOf` is injected so the
    tag and wait facets — which are properties of the REVIEWS, not of the place
    — can be answered without this module reaching for global state. */
export function matches(rest, f, ctx) {
  const s = ctx.summaryOf(rest.id);

  if (has(f.cities) && !f.cities.includes(rest.city)) return false;
  if (has(f.areas) && !f.areas.includes(rest.area)) return false;
  if (has(f.cuisines) && !f.cuisines.includes(rest.cuisine)) return false;
  if (has(f.bands) && !f.bands.includes(rest.band)) return false;
  if (has(f.meals) && !f.meals.some((m) => rest.meals.includes(m))) return false;

  /* The important one. `diet` is read from the kitchen's own flag, and
     `dietLevel` decides whether "two dishes and they know which" counts.
     There is no path in this function from a caption to a yes. */
  if (f.diet) {
    const level = rest.diet[f.diet] ?? 'none';
    if (level === 'none') return false;
    if (f.dietLevel === 'full' && level !== 'full') return false;
  }

  if (f.maxNoise != null && rest.noise > f.maxNoise) return false;
  if (f.maxSeats != null && rest.seats > f.maxSeats) return false;
  if (f.maxSpendGBP != null) {
    const spend = s.spend == null ? Infinity : toGBP(s.spend, rest.city);
    if (spend > f.maxSpendGBP) return false;
  }
  if (f.maxWait != null) {
    const w = s.wait ? s.wait.median : 0;
    if (w > f.maxWait) return false;
  }
  if (f.minScore != null && s.overall < f.minScore) return false;
  if (has(f.tags) && !f.tags.every((t) => s.tags.some((x) => x.id === t && x.count >= 2))) return false;
  if (f.dishKind && !rest.dishes.some((d) => d.archetype === f.dishKind)) return false;
  return true;
}

export function filterRestaurants(f, ctx, list = RESTAURANTS) {
  return list.filter((r) => matches(r, f, ctx));
}

/**
 * The counts next to each option in one facet.
 *
 * `{ ...filters, [facet]: <cleared> }` is the whole fix and the whole point.
 * Count with every OTHER filter applied and this one ignored, and the numbers
 * answer the question the reader is actually asking — "if I picked this
 * instead, how many would I get" — rather than "how many of the things I have
 * already narrowed to are the thing I already narrowed to", which is the
 * question the buggy version answers and is always either everything or zero.
 */
export function facetCounts(facet, f, ctx, list = RESTAURANTS) {
  const without = { ...f, [facet]: facet === 'diet' ? null : [] };
  const pool = filterRestaurants(without, ctx, list);
  const counts = new Map();
  const bump = (k) => counts.set(k, (counts.get(k) ?? 0) + 1);

  for (const r of pool) {
    if (facet === 'cities') bump(r.city);
    else if (facet === 'areas') bump(r.area);
    else if (facet === 'cuisines') bump(r.cuisine);
    else if (facet === 'bands') bump(r.band);
    else if (facet === 'meals') for (const m of r.meals) bump(m);
    else if (facet === 'diet') { for (const [k, v] of Object.entries(r.diet)) if (v !== 'none') bump(k); }
    else if (facet === 'tags') {
      for (const t of ctx.summaryOf(r.id).tags) if (t.count >= 2) bump(t.id);
    }
  }
  return counts;
}

/* ── reading what somebody typed ───────────────────────────────────────────
   "cheap vegan brunch in peckham under £15" is four filters and no search
   terms, and treating it as five words to match against a blurb finds nothing.
   So the query is parsed first: recognised words become filters and are
   REMOVED from the free text, and the app shows you what it understood as
   chips you can take off again. Being wrong visibly is fine; being wrong
   silently is what makes search boxes feel broken. */

const BAND_WORDS = { '£': 1, '££': 2, '£££': 3, '££££': 4, cheap: 1, budget: 1, midrange: 2, fancy: 4, blowout: 4 };

export function parseQuery(text, f = EMPTY) {
  const out = { ...f, cities: [...f.cities], areas: [...f.areas], cuisines: [...f.cuisines],
    bands: [...f.bands], meals: [...f.meals], tags: [...f.tags] };
  const read = [];
  const rest = [];
  const tokens = tokenise(text);

  const cityByName = new Map(CITIES.map((c) => [normalise(c.label).replace(/ /g, ''), c.id]));
  const areaByName = new Map(AREAS.map((a) => [normalise(a.label).replace(/ /g, ''), a.id]));
  const cuisines = new Set(RESTAURANTS.map((r) => r.cuisine));

  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i];
    const next = tokens[i + 1];

    /* "under £15", "under 15", "<20" */
    const money = /^[£$€¥]?(\d+(?:\.\d+)?)$/.exec(w);
    if ((w === 'under' || w === 'below' || w === 'max') && next) {
      const m = /^[£$€¥]?(\d+(?:\.\d+)?)$/.exec(next);
      if (m) { out.maxSpendGBP = Number(m[1]); read.push(`under £${m[1]}`); i++; continue; }
    }
    if (/^<\d+$/.test(w)) { out.maxSpendGBP = Number(w.slice(1)); read.push(`under £${out.maxSpendGBP}`); continue; }

    if (w in BAND_WORDS) { pushOnce(out.bands, BAND_WORDS[w]); read.push(`${w}`); continue; }
    if (cityByName.has(w)) { pushOnce(out.cities, cityByName.get(w)); read.push(w); continue; }
    if (areaByName.has(w)) { pushOnce(out.areas, areaByName.get(w)); read.push(w); continue; }
    if (w === 'in' && next && areaByName.has(next)) { pushOnce(out.areas, areaByName.get(next)); read.push(next); i++; continue; }
    if (cuisines.has(w)) { pushOnce(out.cuisines, w); read.push(w); continue; }

    if (w === 'vegan' || w === 'plantbased') { out.diet = 'vegan'; read.push('vegan'); continue; }
    if (w === 'vegetarian' || w === 'veggie' || withinOneEdit(w, 'vegetarian')) { out.diet = 'vegetarian'; read.push('vegetarian'); continue; }
    if (w === 'halal') { out.diet = 'halal'; read.push('halal'); continue; }
    if (w === 'gf' || w === 'glutenfree' || w === 'coeliac' || w === 'celiac') { out.diet = 'glutenFree'; read.push('gluten free'); continue; }
    if (w === 'gluten' && next === 'free') { out.diet = 'glutenFree'; read.push('gluten free'); i++; continue; }

    if (['breakfast', 'brunch', 'lunch', 'dinner', 'snack'].includes(w)) { pushOnce(out.meals, w); read.push(w); continue; }
    if (w === 'late' && (next === 'night' || next === 'opening')) { pushOnce(out.meals, 'late night'); read.push('late night'); i++; continue; }

    if (w === 'quiet') { out.maxNoise = 2; read.push('quiet'); continue; }
    if (w === 'no' && (next === 'queue' || next === 'wait')) { out.maxWait = 10; read.push('no queue'); i++; continue; }
    if (/^[45]\+$/.test(w)) { out.minScore = Number(w[0]); read.push(`${w[0]}+ rated`); continue; }
    if (money && Number(money[1]) <= 4 && /^[£$€¥]/.test(w)) { pushOnce(out.bands, Number(money[1])); read.push(w); continue; }

    rest.push(w);
  }

  out.q = rest.join(' ');
  return { filters: out, read, terms: rest };
}

function pushOnce(arr, v) { if (!arr.includes(v)) arr.push(v); }

/* ── free-text search ──────────────────────────────────────────────────────
   Small enough that an inverted index would be showing off; this scores every
   restaurant against the remaining terms, weighting a name match above a
   cuisine match above a word somebody happened to use in a caption.

   Captions ARE searched — "queue", "loud", "anniversary" are the words people
   actually want — but note that a caption can never satisfy the dietary
   filter. Search is a suggestion; a filter is a promise. */

export function buildIndex(list = RESTAURANTS, posts = POSTS) {
  const postsOf = new Map();
  for (const p of posts) {
    if (!postsOf.has(p.restaurant)) postsOf.set(p.restaurant, []);
    postsOf.get(p.restaurant).push(p);
  }
  return list.map((r) => ({
    id: r.id,
    fields: {
      name: tokenise(r.name),
      cuisine: [...tokenise(r.cuisine), ...r.styles.flatMap((s) => tokenise(s))],
      place: [...tokenise(areaById.get(r.area)?.label ?? ''), ...tokenise(r.city.replace('-', ' '))],
      dishes: r.dishes.flatMap((d) => tokenise(d.name)),
      words: [...tokenise(r.blurb), ...(postsOf.get(r.id) ?? []).flatMap((p) => tokenise(p.caption))],
    },
  }));
}

const WEIGHTS = { name: 12, cuisine: 7, dishes: 5, place: 4, words: 1.2 };

export function searchScore(doc, terms) {
  let score = 0;
  const why = [];
  for (const term of terms) {
    const wanted = expand(term);
    let best = 0, hit = null;
    for (const [field, words] of Object.entries(doc.fields)) {
      for (const w of words) {
        const exact = wanted.includes(w);
        const near = !exact && term.length >= 5 && withinOneEdit(term, w);
        const prefix = !exact && !near && term.length >= 4 && w.startsWith(term);
        if (!exact && !near && !prefix) continue;
        const v = WEIGHTS[field] * (exact ? 1 : near ? 0.55 : 0.75);
        if (v > best) { best = v; hit = w; }
      }
    }
    if (best) { score += best; why.push(hit); }
  }
  /* Every term has to hit something. Otherwise "vegan ramen soho" returns the
     ramen place that is none of those other things, which reads as the app
     ignoring half of what you said. */
  return { score: why.length === terms.length ? score : score * 0.25, why };
}

/* ── ranking ───────────────────────────────────────────────────────────── */

export const SORTS = [
  { id: 'best',    label: 'Best rated' },
  { id: 'talked',  label: 'Most talked about' },
  { id: 'value',   label: 'Best value' },
  { id: 'cheapest',label: 'Cheapest' },
  { id: 'quickest',label: 'Shortest wait' },
  { id: 'newest',  label: 'Newest posts' },
];

export function rank(list, f, ctx) {
  const terms = tokenise(f.q ?? '');
  const index = ctx.index;
  const scored = list.map((r) => {
    const s = ctx.summaryOf(r.id);
    const doc = index.find((d) => d.id === r.id);
    const hit = terms.length ? searchScore(doc, terms) : { score: 0, why: [] };
    return { rest: r, summary: s, text: hit.score, why: hit.why };
  });

  const alive = terms.length ? scored.filter((x) => x.text > 0) : scored;
  const key = {
    best:     (x) => x.summary.overall,
    talked:   (x) => x.summary.n * 100 + x.summary.likes / 100,
    value:    (x) => x.summary.metrics.value.score,
    cheapest: (x) => -toGBP(x.summary.spend ?? 1e6, x.rest.city),
    quickest: (x) => -(x.summary.wait ? x.summary.wait.median : 0),
    newest:   (x) => -Math.min(...(ctx.postsOf(x.rest.id).map((p) => p.daysAgo))),
  }[f.sort ?? 'best'] ?? ((x) => x.summary.overall);

  return alive.sort((a, b) => (b.text - a.text) || (key(b) - key(a)));
}

/* ── the reader ────────────────────────────────────────────────────────── */

/** Distance in kilometres between two areas, in the crude local grid the data
    file is honest about. Used by the "near me" filter and nothing else. */
export function distanceKm(areaA, areaB) {
  const a = areaById.get(areaA), b = areaById.get(areaB);
  if (!a || !b || a.city !== b.city) return Infinity;
  return Math.hypot(a.km[0] - b.km[0], a.km[1] - b.km[1]);
}

/* ── recipes ───────────────────────────────────────────────────────────────
   Ranked by exactly the same shrinkage as restaurants, which is the payoff for
   storing who cooked it and what they gave it rather than a star count. */

export function recipePrior(list = RECIPES) {
  return mean(list.flatMap((r) => r.cooks.map((c) => c.rating)));
}

export function summariseRecipe(recipe, prior = recipePrior()) {
  const ratings = recipe.cooks.map((c) => c.rating);
  return {
    n: ratings.length, raw: mean(ratings), score: shrunkMean(ratings, prior, 4),
    dist: distribution(ratings), split: split(ratings),
  };
}

export function filterRecipes(f, list = RECIPES) {
  const terms = tokenise(f.q ?? '');
  return list.filter((r) => {
    if (f.diet) {
      const key = f.diet === 'glutenFree' ? 'glutenFree' : f.diet;
      if (!r.diet[key]) return false;
    }
    if (f.maxMinutes != null && r.minutes > f.maxMinutes) return false;
    if (!terms.length) return true;
    const hay = tokenise([r.title, r.blurb, r.ingredients.join(' ')].join(' '));
    return terms.every((t) => expand(t).some((w) => hay.includes(w) || hay.some((h) => h.startsWith(w))));
  });
}

export function rankRecipes(list, prior = recipePrior()) {
  return [...list].sort((a, b) => summariseRecipe(b, prior).score - summariseRecipe(a, prior).score);
}

/* ── tribes ────────────────────────────────────────────────────────────────
   A tribe is its filter. `tribeFilter` turns the saved search stored in
   data.js into the same filter object the UI builds, so there is exactly one
   code path that decides what is in a feed. */

export function tribeFilter(tribe) {
  const f = { ...EMPTY };
  const t = tribe.filter;
  if (t.city) f.cities = [t.city];
  if (t.meals) f.meals = [...t.meals];
  if (t.tags) f.tags = [...t.tags];
  if (t.diet) { f.diet = t.diet; if (t.dietLevel) f.dietLevel = t.dietLevel; }
  if (t.maxSpend != null) f.maxSpendGBP = t.maxSpend;
  if (t.maxWait != null) f.maxWait = t.maxWait;
  if (t.maxNoise != null) f.maxNoise = t.maxNoise;
  if (t.maxSeats != null) f.maxSeats = t.maxSeats;
  if (t.dish) f.dishKind = t.dish;
  return f;
}

export function tribeMembership(restId, ctx, tribes = TRIBES) {
  return tribes.filter((t) => matches(restaurantById.get(restId), tribeFilter(t), ctx));
}

/* ── the context object ────────────────────────────────────────────────────
   Summarising every restaurant is not free and the filters ask for it
   constantly — every facet count re-filters the whole list. So it is computed
   once and memoised here, and every function above takes it as an argument
   rather than reaching for a module-level cache, which is what makes them all
   testable against data that is not the data in data.js. */

export function makeContext({ restaurants = RESTAURANTS, posts = POSTS } = {}) {
  const byRest = new Map();
  for (const p of posts) {
    if (!byRest.has(p.restaurant)) byRest.set(p.restaurant, []);
    byRest.get(p.restaurant).push(p);
  }
  const prior = priors(posts);
  const summaries = new Map();
  for (const r of restaurants) summaries.set(r.id, summarise(byRest.get(r.id) ?? [], prior));

  return {
    prior,
    index: buildIndex(restaurants, posts),
    postsOf: (id) => byRest.get(id) ?? [],
    summaryOf: (id) => summaries.get(id) ?? summarise([], prior),
    restaurants, posts,
  };
}
