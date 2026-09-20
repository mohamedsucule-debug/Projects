/* ───────────────────────────────────────────────────────────────────────────
   gobl/data.js — twenty-two places, a hundred-odd posts, and the people who
   wrote them.

   Every restaurant review app is a search problem wearing a photo grid, and a
   search problem is only as good as the data behind it is *textured*. Generated
   data has no texture: it gives you "Restaurant 12, rating 4.2" and never gives
   you "the queue is forty minutes and it is worth exactly thirty of them".

   So this is hand-written, and it is written to disagree with itself. Several
   places here are divisive on purpose — half the room gives them a five and the
   other half a two — because an app that only contains consensus can quietly
   average everything and still look right. The ones that disagree are what the
   maths in engine.js is for.

   Shape of the thing:
     · a restaurant carries FACTS (cuisine, area, price band, meal times, what
       the kitchen can actually guarantee a vegan) — things that are true of the
       place whether anyone has reviewed it or not
     · a post carries an OPINION (five scores out of five, a dish, what it cost,
       what was said) and belongs to one person and one restaurant
     · a tribe carries a SAVED SEARCH — see the note above TRIBES; this is the
       one piece of the design worth arguing about

   Dietary flags are three-valued and mean something specific:
     full  — a whole menu you can eat, cooked without cross-contact
     some  — two or three dishes, and the kitchen knows which
     none  — do not come here hungry and hopeful
   They are properties of the kitchen, recorded per restaurant. They are never
   inferred from what a caption happens to say, and engine.js has a test that
   holds the line — see 'a caption is not a dietary guarantee'.
   ─────────────────────────────────────────────────────────────────────────── */

/** Price bands. The £ count is the display; `typical` is what one person
    actually spends on a normal visit, which is the number people search by. */
export const PRICE_BANDS = [
  { band: 1, mark: '£',    label: 'cheap eats',  typical: 'under £15' },
  { band: 2, mark: '££',   label: 'mid',         typical: '£15–£35'   },
  { band: 3, mark: '£££',  label: 'a treat',     typical: '£35–£70'   },
  { band: 4, mark: '££££', label: 'blowout',     typical: '£70+'      },
];

export const MEALS = ['breakfast', 'brunch', 'lunch', 'dinner', 'late night', 'snack'];

export const DIETS = [
  { id: 'vegan',      label: 'vegan' },
  { id: 'vegetarian', label: 'vegetarian' },
  { id: 'glutenFree', label: 'gluten free' },
  { id: 'halal',      label: 'halal' },
];

/* The five things a post scores. One overall star rating is the thing every
   other app does and it is the thing that loses the most information: a place
   can be the best food in the city and a miserable evening, and a single
   number cannot say so. */
export const METRICS = [
  { id: 'food',    label: 'food',    hint: 'the plate itself' },
  { id: 'value',   label: 'value',   hint: 'for what it cost' },
  { id: 'service', label: 'service', hint: 'how you were treated' },
  { id: 'speed',   label: 'speed',   hint: 'in and fed, or waiting' },
  { id: 'vibe',    label: 'vibe',    hint: 'the room' },
];

/* Tags are chosen by the person posting, from a fixed list. They are NOT
   extracted from the caption, and this is deliberate: every "AI review
   summary" that reads sentiment out of free text gets "the wait was not bad
   at all" exactly backwards, and there is no way for the reader to tell. A
   fixed vocabulary is less clever and it is honest, and it means the counts
   on a restaurant page are countable rather than guessed. */
export const TAGS = [
  { id: 'queue',       label: 'expect a queue' },
  { id: 'worth-it',    label: 'worth the money' },
  { id: 'overpriced',  label: 'overpriced' },
  { id: 'loud',        label: 'loud' },
  { id: 'quiet',       label: 'quiet enough to talk' },
  { id: 'solo',        label: 'fine on your own' },
  { id: 'date',        label: 'good for a date' },
  { id: 'groups',      label: 'works for a group' },
  { id: 'kids',        label: 'kids welcome' },
  { id: 'quick',       label: 'in and out fast' },
  { id: 'slow',        label: 'slow service' },
  { id: 'huge',        label: 'big portions' },
  { id: 'small',       label: 'small plates' },
  { id: 'veg-strong',  label: 'strong veg options' },
  { id: 'walk-in',     label: 'walk-ins fine' },
  { id: 'book-ahead',  label: 'book ahead' },
  { id: 'cash',        label: 'cash only' },
  { id: 'outside',     label: 'tables outside' },
  { id: 'late-night',  label: 'open late' },
];

export const TAG_LABEL = new Map(TAGS.map((t) => [t.id, t.label]));

/* ── cities and neighbourhoods ─────────────────────────────────────────────
   `km` is a crude local coordinate in kilometres from the centre of each city,
   used for "within 2km of where I am". Real latitude and longitude would be
   more honest but would need a real map behind it; this is enough to make a
   distance filter behave like one, and it is labelled as what it is. */
export const AREAS = [
  { id: 'soho',        city: 'london',     label: 'Soho',            km: [0.4, 0.3] },
  { id: 'peckham',     city: 'london',     label: 'Peckham',         km: [1.9, -6.1] },
  { id: 'hackney',     city: 'london',     label: 'Hackney',         km: [4.2, 3.6] },
  { id: 'brixton',     city: 'london',     label: 'Brixton',         km: [-0.9, -5.4] },
  { id: 'kings-cross', city: 'london',     label: "King's Cross",    km: [-0.2, 2.6] },
  { id: 'whitechapel', city: 'london',     label: 'Whitechapel',     km: [3.6, 0.7] },
  { id: 'lower-east',  city: 'new-york',   label: 'Lower East Side', km: [0.8, -1.2] },
  { id: 'queens',      city: 'new-york',   label: 'Jackson Heights', km: [7.4, 4.1] },
  { id: 'brooklyn',    city: 'new-york',   label: 'Bed-Stuy',        km: [5.1, -2.2] },
  { id: 'harlem',      city: 'new-york',   label: 'Harlem',          km: [1.1, 7.8] },
  { id: 'alfama',      city: 'lisbon',     label: 'Alfama',          km: [0.9, 0.2] },
  { id: 'principe',    city: 'lisbon',     label: 'Príncipe Real',   km: [-1.3, 0.8] },
  { id: 'shimokita',   city: 'tokyo',      label: 'Shimokitazawa',   km: [-5.2, 1.4] },
  { id: 'nakameguro',  city: 'tokyo',      label: 'Nakameguro',      km: [-3.1, -1.9] },
];

export const CITIES = [
  { id: 'london',   label: 'London',      country: 'UK',    currency: '£' },
  { id: 'new-york', label: 'New York',    country: 'USA',   currency: '$' },
  { id: 'lisbon',   label: 'Lisbon',      country: 'PT',    currency: '€' },
  { id: 'tokyo',    label: 'Tokyo',       country: 'JP',    currency: '¥' },
];

export const areaById = new Map(AREAS.map((a) => [a.id, a]));
export const cityById = new Map(CITIES.map((c) => [c.id, c]));

/* Money is stored in each city's own currency, because "¥980" is what is
   printed on the menu and showing a Tokyo ramen priced in pounds is a lie about
   what you would hand over. Cross-city comparison ("under £15 anywhere") needs
   one number though, so these are the rates used to convert — a fixed snapshot,
   not a live feed, and the UI says so rather than pretending to be a bank. */
export const GBP_PER_UNIT = { london: 1, 'new-york': 0.79, lisbon: 0.85, tokyo: 0.0053 };

/** What one dish costs in pounds, for filters that span cities. */
export const toGBP = (amount, city) => amount * (GBP_PER_UNIT[city] ?? 1);

const r = (id, name, opts) => ({ id, name, ...opts });
const d = (id, name, price, archetype, tags = []) => ({ id, name, price, archetype, tags });

/* `noise` is a five-point scale a human can actually apply:
     1 library · 2 conversation · 3 raised voices · 4 shouting · 5 nothing heard
   `diet` is the kitchen's guarantee, not a marketing claim — see the header. */
export const RESTAURANTS = [
  /* ── London ──────────────────────────────────────────────────────────── */
  r('kettle', 'Kettle & Crow', {
    city: 'london', area: 'soho', cuisine: 'british', styles: ['modern british', 'seasonal', 'small plates'],
    band: 3, meals: ['dinner', 'late night'], noise: 3, booking: 'book-ahead', seats: 44, opened: 2019,
    diet: { vegan: 'some', vegetarian: 'full', glutenFree: 'some', halal: 'none' },
    blurb: 'Twelve tables, one blackboard, and whatever the market had that morning.',
    dishes: [
      d('kettle-lamb', 'Lamb shoulder, anchovy, mint', 26, 'roast', ['sharing']),
      d('kettle-crab', 'Brown crab crumpet', 11, 'toast'),
      d('kettle-celeriac', 'Whole roast celeriac', 18, 'roast', ['vegan']),
      d('kettle-tart', 'Treacle tart, buttermilk', 9, 'pastry'),
    ],
  }),
  r('tonkotsu-row', 'Row 9 Ramen', {
    city: 'london', area: 'soho', cuisine: 'japanese', styles: ['ramen', 'noodles', 'counter'],
    band: 2, meals: ['lunch', 'dinner', 'late night'], noise: 4, booking: 'walk-in', seats: 18, opened: 2016,
    diet: { vegan: 'some', vegetarian: 'some', glutenFree: 'none', halal: 'none' },
    blurb: 'Eighteen stools round a counter. The queue starts at ten to twelve.',
    dishes: [
      d('row9-tonkotsu', 'Tonkotsu, 18-hour', 15, 'ramen'),
      d('row9-shoyu', 'Shoyu, chicken fat', 14, 'ramen'),
      d('row9-veg', 'Mushroom shio', 13, 'ramen', ['vegan']),
      d('row9-gyoza', 'Pork gyoza, six', 7, 'dumplings'),
    ],
  }),
  r('molly', "Molly's", {
    city: 'london', area: 'hackney', cuisine: 'cafe', styles: ['brunch', 'bakery', 'coffee'],
    band: 2, meals: ['breakfast', 'brunch', 'lunch'], noise: 3, booking: 'walk-in', seats: 30, opened: 2021,
    diet: { vegan: 'full', vegetarian: 'full', glutenFree: 'some', halal: 'some' },
    blurb: 'A bakery that got out of hand and started doing eggs.',
    dishes: [
      d('molly-eggs', 'Eggs, brown butter hollandaise', 13, 'eggs'),
      d('molly-pancake', 'Buttermilk stack, burnt honey', 12, 'pancakes'),
      d('molly-bun', 'Cardamom bun', 4.2, 'pastry', ['vegan']),
      d('molly-beans', 'House beans on sourdough', 10, 'toast', ['vegan']),
    ],
  }),
  r('nkechi', 'Nkechi', {
    city: 'london', area: 'peckham', cuisine: 'west african', styles: ['nigerian', 'grill', 'family'],
    band: 2, meals: ['lunch', 'dinner'], noise: 4, booking: 'walk-in', seats: 52, opened: 2018,
    diet: { vegan: 'some', vegetarian: 'some', glutenFree: 'full', halal: 'full' },
    blurb: 'Suya off the grill at the door, and a dining room that has never once been quiet.',
    dishes: [
      d('nkechi-suya', 'Beef suya, yaji', 12, 'grill'),
      d('nkechi-jollof', 'Party jollof, smoked', 11, 'rice-bowl'),
      d('nkechi-egusi', 'Egusi and pounded yam', 14, 'stew'),
      d('nkechi-plantain', 'Plantain, scotch bonnet honey', 6, 'fried', ['vegan']),
    ],
  }),
  r('sourdough-hole', 'The Hole in the Wall', {
    city: 'london', area: 'whitechapel', cuisine: 'bakery', styles: ['pizza', 'slices', 'takeaway'],
    band: 1, meals: ['lunch', 'snack', 'late night'], noise: 2, booking: 'walk-in', seats: 6, opened: 2022,
    diet: { vegan: 'some', vegetarian: 'full', glutenFree: 'none', halal: 'none' },
    blurb: 'Literally a hatch. Two slices and a can, six pounds, eat it standing up.',
    dishes: [
      d('hole-margherita', 'Margherita slice', 3.5, 'pizza', ['vegetarian']),
      d('hole-nduja', "'Nduja and honey slice", 4.5, 'pizza'),
      d('hole-marinara', 'Marinara slice', 3, 'pizza', ['vegan']),
    ],
  }),
  r('spice-hut', 'Brixton Spice Hut', {
    city: 'london', area: 'brixton', cuisine: 'south indian', styles: ['dosa', 'vegetarian', 'canteen'],
    band: 1, meals: ['breakfast', 'lunch', 'dinner'], noise: 3, booking: 'walk-in', seats: 38, opened: 2011,
    diet: { vegan: 'full', vegetarian: 'full', glutenFree: 'full', halal: 'some' },
    blurb: 'Dosas the length of your forearm, and nothing on the menu over nine pounds.',
    dishes: [
      d('hut-masala', 'Masala dosa', 8, 'dosa', ['vegetarian']),
      d('hut-rava', 'Rava dosa, coconut chutney', 8.5, 'dosa', ['vegan']),
      d('hut-idli', 'Idli sambar, three', 5.5, 'rice-bowl', ['vegan']),
      d('hut-filter', 'Filter coffee', 2.2, 'coffee', ['vegetarian']),
    ],
  }),
  r('granary', 'Granary Counter', {
    city: 'london', area: 'kings-cross', cuisine: 'european', styles: ['wine bar', 'small plates', 'natural wine'],
    band: 3, meals: ['dinner', 'late night'], noise: 4, booking: 'walk-in', seats: 26, opened: 2023,
    diet: { vegan: 'some', vegetarian: 'full', glutenFree: 'some', halal: 'none' },
    blurb: 'Standing room, orange wine, and a chalkboard that changes twice a night.',
    dishes: [
      d('granary-anchovy', 'Anchovy, butter, toast', 8, 'toast'),
      d('granary-chicory', 'Grilled chicory, hazelnut', 9, 'grill', ['vegan']),
      d('granary-tortilla', 'Tortilla, 40 minutes', 7, 'eggs', ['vegetarian']),
      d('granary-steak', 'Onglet, bone marrow', 24, 'steak'),
    ],
  }),
  r('mamas-caff', "Vera's", {
    city: 'london', area: 'hackney', cuisine: 'cafe', styles: ['greasy spoon', 'fry up', 'old school'],
    band: 1, meals: ['breakfast', 'brunch', 'lunch'], noise: 3, booking: 'walk-in', seats: 24, opened: 1974,
    diet: { vegan: 'some', vegetarian: 'some', glutenFree: 'none', halal: 'none' },
    blurb: 'Formica tables, a tea urn, and the same fry-up since 1974.',
    dishes: [
      d('vera-fry', 'Full English', 8.5, 'eggs'),
      d('vera-bacon', 'Bacon sandwich, white', 4.5, 'sandwich'),
      d('vera-veg', 'Veggie breakfast', 8, 'eggs', ['vegetarian']),
      d('vera-tea', 'Mug of tea', 1.4, 'coffee', ['vegan']),
    ],
  }),
  r('oyster-shed', 'The Oyster Shed', {
    city: 'london', area: 'soho', cuisine: 'seafood', styles: ['oysters', 'raw bar', 'date'],
    band: 4, meals: ['dinner'], noise: 2, booking: 'book-ahead', seats: 20, opened: 2015,
    diet: { vegan: 'none', vegetarian: 'some', glutenFree: 'full', halal: 'none' },
    blurb: 'Twenty seats, ice, lemon, and a bill that will surprise you if you are not careful.',
    dishes: [
      d('shed-oysters', 'Half dozen rock oysters', 21, 'oysters'),
      d('shed-turbot', 'Turbot on the bone, for two', 78, 'fish'),
      d('shed-caviar', 'Caviar, crumpet', 64, 'toast'),
    ],
  }),

  /* ── New York ────────────────────────────────────────────────────────── */
  r('patty-melt', 'Gus & Sons', {
    city: 'new-york', area: 'brooklyn', cuisine: 'american', styles: ['burgers', 'diner', 'late night'],
    band: 2, meals: ['lunch', 'dinner', 'late night'], noise: 4, booking: 'walk-in', seats: 40, opened: 1998,
    diet: { vegan: 'none', vegetarian: 'some', glutenFree: 'none', halal: 'none' },
    blurb: 'A griddle that has not been cold since the Clinton administration.',
    dishes: [
      d('gus-double', 'Double cheeseburger', 14, 'burger'),
      d('gus-melt', 'Patty melt, rye', 15, 'sandwich'),
      d('gus-fries', 'Fries, salt, vinegar', 5, 'fried', ['vegetarian']),
      d('gus-shake', 'Black and white shake', 7, 'shake', ['vegetarian']),
    ],
  }),
  r('smash-lab', 'Smash Lab', {
    city: 'new-york', area: 'lower-east', cuisine: 'american', styles: ['burgers', 'smash', 'counter'],
    band: 2, meals: ['lunch', 'dinner', 'late night'], noise: 4, booking: 'walk-in', seats: 12, opened: 2023,
    diet: { vegan: 'some', vegetarian: 'some', glutenFree: 'some', halal: 'none' },
    blurb: 'Two patties, pressed thin, cooked in about ninety seconds. Line down the block by seven.',
    dishes: [
      d('smash-classic', 'Classic smash', 12, 'burger'),
      d('smash-double', 'Double, extra crisp', 15, 'burger'),
      d('smash-mush', 'Mushroom smash', 13, 'burger', ['vegan']),
      d('smash-tots', 'Tots', 5, 'fried', ['vegetarian']),
    ],
  }),
  r('la-reina', 'La Reina', {
    city: 'new-york', area: 'queens', cuisine: 'mexican', styles: ['tacos', 'al pastor', 'street'],
    band: 1, meals: ['lunch', 'dinner', 'late night'], noise: 3, booking: 'walk-in', seats: 14, opened: 2009,
    diet: { vegan: 'some', vegetarian: 'some', glutenFree: 'full', halal: 'none' },
    blurb: 'A trompo turning in the window from noon until it runs out.',
    dishes: [
      d('reina-pastor', 'Al pastor, three', 9, 'taco'),
      d('reina-suadero', 'Suadero, three', 9.5, 'taco'),
      d('reina-nopal', 'Nopal and bean, three', 8, 'taco', ['vegan']),
      d('reina-horchata', 'Horchata', 3.5, 'shake', ['vegetarian']),
    ],
  }),
  r('golden-dumpling', 'Golden Dumpling House', {
    city: 'new-york', area: 'queens', cuisine: 'chinese', styles: ['dumplings', 'hand pulled', 'cash only'],
    band: 1, meals: ['lunch', 'dinner'], noise: 3, booking: 'walk-in', seats: 22, opened: 2004,
    diet: { vegan: 'some', vegetarian: 'some', glutenFree: 'none', halal: 'none' },
    blurb: 'Twelve dumplings for eight dollars. Cash, and they mean it.',
    dishes: [
      d('golden-pork', 'Pork and chive, twelve', 8, 'dumplings'),
      d('golden-lamb', 'Lamb and cumin, twelve', 10, 'dumplings'),
      d('golden-veg', 'Mushroom and cabbage, twelve', 8, 'dumplings', ['vegan']),
      d('golden-noodle', 'Hand-pulled noodle, beef', 12, 'noodles'),
    ],
  }),
  r('harlem-fish', 'Miss Delphine', {
    city: 'new-york', area: 'harlem', cuisine: 'southern', styles: ['soul food', 'fried', 'sunday'],
    band: 2, meals: ['brunch', 'lunch', 'dinner'], noise: 4, booking: 'walk-in', seats: 60, opened: 1991,
    diet: { vegan: 'none', vegetarian: 'some', glutenFree: 'some', halal: 'none' },
    blurb: 'Fried chicken, waffles, and a Sunday queue that is half church and half pilgrimage.',
    dishes: [
      d('delphine-chicken', 'Fried chicken and waffle', 22, 'fried'),
      d('delphine-catfish', 'Catfish, hot sauce', 19, 'fish'),
      d('delphine-greens', 'Collards, smoked turkey', 8, 'stew'),
      d('delphine-mac', 'Mac and cheese', 9, 'bake', ['vegetarian']),
    ],
  }),
  r('naan-stop', 'Naan Stop', {
    city: 'new-york', area: 'queens', cuisine: 'south asian', styles: ['halal', 'kebab', 'late night'],
    band: 1, meals: ['lunch', 'dinner', 'late night'], noise: 3, booking: 'walk-in', seats: 26, opened: 2013,
    diet: { vegan: 'some', vegetarian: 'full', glutenFree: 'some', halal: 'full' },
    blurb: 'Open until four, halal throughout, and the naan comes out of the tandoor blistered.',
    dishes: [
      d('naan-seekh', 'Seekh kebab, two', 11, 'grill'),
      d('naan-butter', 'Butter chicken', 14, 'curry'),
      d('naan-chana', 'Chana masala', 10, 'curry', ['vegan']),
      d('naan-garlic', 'Garlic naan', 3.5, 'bread', ['vegetarian']),
    ],
  }),
  r('mariposa', 'Mariposa', {
    city: 'new-york', area: 'lower-east', cuisine: 'modern', styles: ['tasting menu', 'fine dining', 'date'],
    band: 4, meals: ['dinner'], noise: 1, booking: 'book-ahead', seats: 18, opened: 2020,
    diet: { vegan: 'full', vegetarian: 'full', glutenFree: 'full', halal: 'none' },
    blurb: 'Eleven courses, two hours, and a vegan version of every single one of them.',
    dishes: [
      d('mariposa-menu', 'The eleven-course menu', 165, 'fine'),
      d('mariposa-veg', 'The vegan eleven', 165, 'fine', ['vegan']),
      d('mariposa-pair', 'Wine pairing', 95, 'wine'),
    ],
  }),

  /* ── Lisbon ──────────────────────────────────────────────────────────── */
  r('tasca-sete', 'Tasca Sete', {
    city: 'lisbon', area: 'alfama', cuisine: 'portuguese', styles: ['tasca', 'grilled fish', 'family'],
    band: 1, meals: ['lunch', 'dinner'], noise: 3, booking: 'walk-in', seats: 28, opened: 1982,
    diet: { vegan: 'none', vegetarian: 'some', glutenFree: 'some', halal: 'none' },
    blurb: 'Sardines on the charcoal out front, paper tablecloths, house wine in a jug.',
    dishes: [
      d('sete-sardinha', 'Sardinhas assadas', 9, 'fish'),
      d('sete-bacalhau', 'Bacalhau à brás', 12, 'eggs'),
      d('sete-caldo', 'Caldo verde', 4, 'stew'),
      d('sete-vinho', 'Jug of house red', 6, 'wine', ['vegan']),
    ],
  }),
  r('pastel-pombo', 'Pombo', {
    city: 'lisbon', area: 'principe', cuisine: 'bakery', styles: ['pastelaria', 'coffee', 'snack'],
    band: 1, meals: ['breakfast', 'snack'], noise: 2, booking: 'walk-in', seats: 10, opened: 1948,
    diet: { vegan: 'none', vegetarian: 'full', glutenFree: 'none', halal: 'some' },
    blurb: 'Custard tarts out of the oven every twenty minutes, all day, since 1948.',
    dishes: [
      d('pombo-nata', 'Pastel de nata', 1.4, 'pastry', ['vegetarian']),
      d('pombo-galao', 'Galão', 1.8, 'coffee', ['vegetarian']),
      d('pombo-torrada', 'Torrada, butter', 2.2, 'toast', ['vegetarian']),
    ],
  }),
  r('verde-lisboa', 'Verde', {
    city: 'lisbon', area: 'principe', cuisine: 'vegetarian', styles: ['plant based', 'brunch', 'garden'],
    band: 2, meals: ['brunch', 'lunch', 'dinner'], noise: 2, booking: 'book-ahead', seats: 34, opened: 2019,
    diet: { vegan: 'full', vegetarian: 'full', glutenFree: 'full', halal: 'some' },
    blurb: 'A courtyard with a lemon tree in it and not a gram of meat on the premises.',
    dishes: [
      d('verde-bowl', 'Grain bowl, preserved lemon', 13, 'rice-bowl', ['vegan']),
      d('verde-toast', 'Tomato toast, garlic oil', 8, 'toast', ['vegan']),
      d('verde-cake', 'Olive oil cake', 5, 'pastry', ['vegetarian']),
    ],
  }),

  /* ── Tokyo ───────────────────────────────────────────────────────────── */
  r('sanchome', 'Sanchōme Ramen', {
    city: 'tokyo', area: 'shimokita', cuisine: 'japanese', styles: ['ramen', 'counter', 'late night'],
    band: 1, meals: ['lunch', 'dinner', 'late night'], noise: 2, booking: 'walk-in', seats: 9, opened: 1996,
    diet: { vegan: 'none', vegetarian: 'none', glutenFree: 'none', halal: 'none' },
    blurb: 'Nine seats, a ticket machine, and no conversation at all while you eat.',
    dishes: [
      d('sanchome-shoyu', 'Shoyu ramen', 980, 'ramen'),
      d('sanchome-tsuke', 'Tsukemen', 1150, 'noodles'),
      d('sanchome-egg', 'Ajitama', 150, 'eggs'),
    ],
  }),
  r('kissaten-ao', 'Kissaten Ao', {
    city: 'tokyo', area: 'nakameguro', cuisine: 'cafe', styles: ['kissaten', 'coffee', 'quiet'],
    band: 2, meals: ['breakfast', 'brunch', 'snack'], noise: 1, booking: 'walk-in', seats: 16, opened: 1979,
    diet: { vegan: 'some', vegetarian: 'some', glutenFree: 'none', halal: 'none' },
    blurb: 'Siphon coffee, a jazz record on, and nobody speaking above a murmur.',
    dishes: [
      d('ao-siphon', 'Siphon blend', 750, 'coffee', ['vegan']),
      d('ao-toast', 'Thick-cut toast, red bean and butter', 620, 'toast', ['vegetarian']),
      d('ao-pudding', 'Custard pudding', 550, 'pastry', ['vegetarian']),
    ],
  }),
  r('yakitori-ban', 'Ban', {
    city: 'tokyo', area: 'nakameguro', cuisine: 'japanese', styles: ['yakitori', 'grill', 'counter'],
    band: 3, meals: ['dinner', 'late night'], noise: 3, booking: 'book-ahead', seats: 12, opened: 2011,
    diet: { vegan: 'none', vegetarian: 'some', glutenFree: 'some', halal: 'none' },
    blurb: 'Twelve seats round the charcoal. The chef decides what you are having.',
    dishes: [
      d('ban-omakase', 'Omakase, twelve skewers', 6800, 'grill'),
      d('ban-negima', 'Negima', 420, 'grill'),
      d('ban-shiitake', 'Shiitake, sea salt', 380, 'grill', ['vegan']),
    ],
  }),
];

export const restaurantById = new Map(RESTAURANTS.map((x) => [x.id, x]));
export const DISHES = RESTAURANTS.flatMap((x) => x.dishes.map((y) => ({ ...y, restaurant: x.id })));
export const dishById = new Map(DISHES.map((x) => [x.id, x]));

/* ── the people ────────────────────────────────────────────────────────────
   Twenty-four of them, each with a bias you can see in their posts: one only
   ever eats under a tenner, one scores service harshly, one has been going to
   the same caff since the eighties. Reviewers with no personality average out
   to a flat 3.8 across everything, and then there is nothing for the ranking to
   do — the disagreement is the interesting part, so it had to be written in. */
const u = (id, name, bio, city, extra = {}) => ({ id, name, bio, city, ...extra });

export const PEOPLE = [
  u('ayo', 'Ayo', 'Peckham. Jollof opinions I will defend.', 'london'),
  u('marta', 'Marta', 'Chef, day off. Scores service hard because I know what it costs.', 'london'),
  u('sanj', 'Sanj', 'Vegetarian since birth, not by choice, now by conviction.', 'london', { diet: 'vegetarian' }),
  u('lex', 'Lex', 'Sub-£10 lunches only. It is a discipline.', 'london', { budget: 1 }),
  u('rhi', 'Rhiannon', 'Brunch is a meal and also a hobby.', 'london'),
  u('des', 'Des', 'Forty years in Hackney. I remember what this was.', 'london'),
  u('nina', 'Nina', 'Wine first, food second, bill never.', 'london'),
  u('tobi', 'Tobi', 'Halal and hungry. Mostly at 2am.', 'london', { diet: 'halal' }),
  u('priya', 'Priya', 'Dosa is the correct breakfast.', 'london', { diet: 'vegetarian' }),
  u('cal', 'Cal', 'I queue. I am not proud of it.', 'london'),
  u('joan', 'Joan', 'Coeliac. Ask me how the kitchen answered the question.', 'london', { diet: 'glutenFree' }),
  u('dev', 'Dev', 'Late shift. Everything I eat is after eleven.', 'london'),
  u('marcus', 'Marcus', 'Brooklyn. Burgers are a research area.', 'new-york'),
  u('esme', 'Esmé', 'Vegan, and tired of being handed a portobello.', 'new-york', { diet: 'vegan' }),
  u('hector', 'Héctor', 'Jackson Heights. I will tell you if the trompo is fresh.', 'new-york'),
  u('birdie', 'Birdie', 'Harlem born. Sunday is not negotiable.', 'new-york'),
  u('wen', 'Wen', 'Dumplings, weekly, in cash.', 'new-york'),
  u('theo', 'Theo', 'I save up for one big dinner a quarter.', 'new-york'),
  u('amina', 'Amina', 'Halal, late, and honest about it.', 'new-york', { diet: 'halal' }),
  u('paulo', 'Paulo', 'Lisboeta. The tourists have ruined three of my favourites.', 'lisbon'),
  u('ines', 'Inês', 'Natas are a benchmark, not a snack.', 'lisbon'),
  u('kenji', 'Kenji', 'Shimokita. Ramen in under nine minutes or I am not interested.', 'tokyo'),
  u('mei', 'Mei', 'Kissaten completist. Coffee should be slow.', 'tokyo'),
  u('fran', 'Fran', 'Travels for food, writes it all down.', 'london'),
];

export const personById = new Map(PEOPLE.map((p) => [p.id, p]));

/* ── the posts ─────────────────────────────────────────────────────────────
   scores are [food, value, service, speed, vibe], each 1–5.
   `waited` is minutes queued before sitting down — the number nobody publishes
   and everybody wants. `paid` is per person, in the city's own currency. */
const p = (id, author, restaurant, dish, paid, daysAgo, scores, likes, tags, caption, extra = {}) => ({
  id, author, restaurant, dish, paid, daysAgo, likes, tags, caption,
  scores: { food: scores[0], value: scores[1], service: scores[2], speed: scores[3], vibe: scores[4] },
  ...extra,
});

export const POSTS = [
  /* Row 9 — divisive on the queue, agreed on the bowl */
  p('n1', 'cal', 'tonkotsu-row', 'row9-tonkotsu', 15, 3, [5, 4, 4, 2, 4], 214, ['queue', 'solo', 'worth-it'],
    'Forty minutes standing in the rain for this and I would do it again on Thursday.', { waited: 40, meal: 'lunch', party: 1 }),
  p('n2', 'marta', 'tonkotsu-row', 'row9-tonkotsu', 15, 9, [5, 4, 5, 2, 3], 88, ['queue', 'solo'],
    'The broth is properly emulsified, which almost nobody gets right at this price. Go at 3pm.', { waited: 35, meal: 'lunch', party: 1 }),
  p('n3', 'lex', 'tonkotsu-row', 'row9-shoyu', 14, 14, [4, 3, 3, 1, 3], 41, ['queue', 'slow'],
    'Good bowl. Fifty minutes of my one hour lunch spent not eating it.', { waited: 50, meal: 'lunch', party: 1 }),
  p('n4', 'sanj', 'tonkotsu-row', 'row9-veg', 13, 21, [4, 4, 4, 3, 4], 63, ['veg-strong', 'solo'],
    'The mushroom shio is a real bowl, not an apology. Rare.', { waited: 20, meal: 'dinner', party: 2 }),
  p('n5', 'dev', 'tonkotsu-row', 'row9-gyoza', 22, 5, [4, 3, 4, 5, 4], 37, ['quick', 'solo'],
    'Eleven at night, no queue, six gyoza and a beer. This is the version of this place nobody talks about.', { waited: 0, meal: 'late night', party: 1 }),

  /* Kettle & Crow */
  p('k1', 'nina', 'kettle', 'kettle-lamb', 52, 6, [5, 4, 5, 4, 5], 176, ['date', 'quiet', 'book-ahead'],
    'The lamb comes out on the bone and they carve it at the table like it is 1965. Utterly charming.', { meal: 'dinner', party: 2 }),
  p('k2', 'marta', 'kettle', 'kettle-crab', 44, 12, [5, 3, 4, 4, 4], 92, ['small', 'book-ahead'],
    'The crumpet is the best eleven pounds on this list and the rest of the bill knows it.', { meal: 'dinner', party: 2 }),
  p('k3', 'sanj', 'kettle', 'kettle-celeriac', 38, 19, [4, 3, 5, 4, 5], 58, ['veg-strong', 'date'],
    'Whole celeriac, three hours in the embers. They did not treat it as the sad option.', { meal: 'dinner', party: 2 }),
  p('k4', 'lex', 'kettle', 'kettle-tart', 49, 30, [4, 2, 4, 3, 4], 22, ['overpriced'],
    'Lovely. Fifty quid for dinner on a Tuesday is not my life.', { meal: 'dinner', party: 2 }),

  /* Molly's — the brunch anchor */
  p('m1', 'rhi', 'molly', 'molly-pancake', 19, 2, [5, 4, 4, 3, 5], 341, ['queue', 'worth-it', 'outside'],
    'The burnt honey on these. I have thought about it every day this week.', { waited: 25, meal: 'brunch', party: 3 }),
  p('m2', 'esme', 'molly', 'molly-bun', 8, 11, [5, 5, 4, 4, 4], 129, ['veg-strong', 'quick'],
    'Vegan cardamom bun that is not dry. I want it on the record that this is possible.', { waited: 10, meal: 'breakfast', party: 1 }),
  p('m3', 'des', 'molly', 'molly-eggs', 21, 16, [3, 2, 3, 2, 2], 19, ['queue', 'overpriced', 'loud'],
    'Twenty-one pounds for eggs on bread and a forty minute wait to stand up again.', { waited: 40, meal: 'brunch', party: 2 }),
  p('m4', 'cal', 'molly', 'molly-beans', 14, 24, [4, 4, 4, 3, 4], 47, ['veg-strong', 'walk-in'],
    'House beans are genuinely good, which I did not expect from a bakery.', { waited: 15, meal: 'brunch', party: 2 }),
  p('m5', 'joan', 'molly', 'molly-eggs', 19, 33, [4, 3, 5, 3, 4], 71, ['veg-strong'],
    'Asked about gluten and got a real answer from someone who had checked, not a shrug. Two things safe, clearly named.', { waited: 20, meal: 'brunch', party: 2 }),

  /* Nkechi */
  p('j1', 'ayo', 'nkechi', 'nkechi-jollof', 18, 4, [5, 5, 4, 4, 5], 402, ['loud', 'groups', 'huge'],
    'Smoke on the jollof. Actual smoke, from actual fire. Everything else in this city is rice.', { meal: 'dinner', party: 5 }),
  p('j2', 'tobi', 'nkechi', 'nkechi-suya', 16, 8, [5, 4, 4, 3, 5], 188, ['loud', 'groups'],
    'Suya off the grill by the door at eleven on a Friday. The yaji is aggressive and correct.', { meal: 'late night', party: 4 }),
  p('j3', 'fran', 'nkechi', 'nkechi-egusi', 20, 17, [4, 4, 3, 3, 4], 64, ['loud', 'huge'],
    'Egusi with pounded yam, and a room so loud I gave up on conversation and just ate.', { meal: 'dinner', party: 2 }),
  p('j4', 'joan', 'nkechi', 'nkechi-plantain', 14, 27, [5, 5, 4, 4, 4], 83, ['veg-strong', 'groups'],
    'Whole menu is naturally gluten free and they said so without making it weird.', { meal: 'dinner', party: 3 }),
  p('j5', 'des', 'nkechi', 'nkechi-jollof', 17, 40, [4, 4, 2, 2, 3], 12, ['loud', 'slow'],
    'Food excellent. Waited twenty-five minutes to be acknowledged at all.', { meal: 'dinner', party: 2 }),

  /* The Hole in the Wall */
  p('h1', 'lex', 'sourdough-hole', 'hole-margherita', 7, 1, [5, 5, 4, 5, 3], 156, ['quick', 'cash', 'walk-in'],
    'Two slices and a can for seven quid, eaten leaning on a bollard. Perfect lunch, no notes.', { waited: 4, meal: 'lunch', party: 1 }),
  p('h2', 'dev', 'sourdough-hole', 'hole-nduja', 9, 7, [5, 4, 4, 5, 3], 98, ['quick', 'late-night'],
    "'Nduja and honey at midnight is a decision you make once and then keep making.", { waited: 2, meal: 'late night', party: 1 }),
  p('h3', 'esme', 'sourdough-hole', 'hole-marinara', 3, 15, [4, 5, 3, 5, 2], 55, ['quick', 'veg-strong'],
    'Marinara slice is vegan by accident, three pounds, and better than most deliberate attempts.', { waited: 3, meal: 'snack', party: 1 }),
  p('h4', 'cal', 'sourdough-hole', 'hole-margherita', 7, 26, [4, 5, 3, 4, 2], 30, ['cash', 'quick'],
    'There is nowhere to sit and that is the entire concept. Bring cash.', { waited: 6, meal: 'lunch', party: 2 }),

  /* Brixton Spice Hut */
  p('s1', 'priya', 'spice-hut', 'hut-masala', 10, 3, [5, 5, 4, 4, 3], 221, ['veg-strong', 'kids', 'huge'],
    'Dosa longer than the table. Ten pounds including filter coffee. I am not sure how.', { meal: 'breakfast', party: 3 }),
  p('s2', 'sanj', 'spice-hut', 'hut-rava', 11, 10, [5, 5, 3, 3, 3], 97, ['veg-strong', 'walk-in'],
    'Entirely vegetarian kitchen, half of it vegan, and nobody has to have the conversation.', { meal: 'lunch', party: 2 }),
  p('s3', 'lex', 'spice-hut', 'hut-idli', 6, 18, [4, 5, 3, 4, 2], 44, ['quick', 'solo'],
    'Three idli and sambar for five fifty. The room is strip lights and formica and I do not care.', { meal: 'breakfast', party: 1 }),
  p('s4', 'joan', 'spice-hut', 'hut-masala', 9, 29, [5, 5, 5, 4, 3], 76, ['veg-strong', 'kids'],
    'Rice and lentil batter, no wheat anywhere near it, and the manager walked me through the fryer.', { meal: 'lunch', party: 2 }),
  p('s5', 'fran', 'spice-hut', 'hut-filter', 3, 44, [4, 5, 4, 5, 3], 18, ['quick'],
    'Best two pounds twenty in South London. Filter coffee, poured from a height, twice.', { meal: 'snack', party: 1 }),

  /* Granary Counter — the divisive one */
  p('g1', 'nina', 'granary', 'granary-anchovy', 41, 2, [5, 4, 5, 4, 5], 167, ['loud', 'date', 'walk-in'],
    'Standing room, orange wine, anchovies on butter an inch thick. Best hour of my week.', { meal: 'dinner', party: 2 }),
  p('g2', 'des', 'granary', 'granary-tortilla', 36, 13, [4, 3, 2, 3, 1], 9, ['loud', 'overpriced'],
    'I could not hear my wife. We have been married thirty-one years and I still wanted to.', { meal: 'dinner', party: 2 }),
  p('g3', 'marta', 'granary', 'granary-steak', 58, 20, [5, 3, 5, 4, 4], 74, ['loud', 'small'],
    'Onglet cooked exactly right by someone working a two-metre bench. Respect.', { meal: 'dinner', party: 2 }),
  p('g4', 'sanj', 'granary', 'granary-chicory', 33, 25, [4, 3, 4, 4, 4], 52, ['loud', 'veg-strong'],
    'Grilled chicory and hazelnut, and one other thing I could eat. Vegan here is thin.', { meal: 'dinner', party: 2 }),
  p('g5', 'rhi', 'granary', 'granary-anchovy', 44, 35, [3, 2, 3, 3, 2], 14, ['loud', 'overpriced', 'small'],
    'Four small plates, two glasses, forty-four pounds, still hungry, ears ringing.', { meal: 'dinner', party: 2 }),
  p('g6', 'cal', 'granary', 'granary-steak', 51, 47, [5, 3, 4, 3, 5], 61, ['loud', 'date'],
    'If you want a quiet dinner this is the wrong building. If you want a night, it is the right one.', { meal: 'dinner', party: 3 }),

  /* Vera's */
  p('v1', 'des', 'mamas-caff', 'vera-fry', 9, 5, [5, 5, 5, 5, 5], 288, ['quick', 'cash', 'kids'],
    'Same plate, same price bracket, same woman behind the counter since I was twenty-two.', { meal: 'breakfast', party: 1 }),
  p('v2', 'lex', 'mamas-caff', 'vera-bacon', 5, 12, [4, 5, 4, 5, 4], 112, ['quick', 'cash'],
    'Bacon sandwich on white with red sauce, four fifty, out in six minutes.', { meal: 'breakfast', party: 1 }),
  p('v3', 'rhi', 'mamas-caff', 'vera-veg', 8, 22, [3, 4, 4, 4, 4], 33, ['quick'],
    'The veggie breakfast is beans, eggs, toast and two hash browns. It is not trying to be brunch.', { meal: 'brunch', party: 2 }),
  p('v4', 'cal', 'mamas-caff', 'vera-fry', 9, 38, [4, 5, 5, 5, 5], 58, ['cash', 'quick'],
    'Nine pounds. Nine. And the tea comes in a mug the size of a bucket.', { meal: 'breakfast', party: 2 }),

  /* The Oyster Shed */
  p('o1', 'nina', 'oyster-shed', 'shed-oysters', 96, 8, [5, 3, 5, 4, 5], 143, ['date', 'quiet', 'book-ahead'],
    'Twenty seats, no music, and the bill arrives like a small surprise. Worth it once a year.', { meal: 'dinner', party: 2 }),
  p('o2', 'theo', 'oyster-shed', 'shed-turbot', 134, 23, [5, 3, 5, 3, 4], 87, ['date', 'quiet', 'slow'],
    'Turbot for two, carved at the pass. Took two and a half hours, which was fine, which I did not expect.', { meal: 'dinner', party: 2 }),
  p('o3', 'marta', 'oyster-shed', 'shed-caviar', 121, 41, [5, 2, 5, 4, 4], 39, ['overpriced', 'quiet'],
    'Technically flawless and priced for a different economy.', { meal: 'dinner', party: 2 }),
  p('o4', 'joan', 'oyster-shed', 'shed-oysters', 88, 52, [5, 3, 5, 4, 5], 44, ['quiet', 'date'],
    'Nothing here has ever met flour. For once I ordered without a conversation first.', { meal: 'dinner', party: 2 }),

  /* Gus & Sons */
  p('b1', 'marcus', 'patty-melt', 'gus-double', 21, 2, [5, 4, 4, 4, 5], 256, ['late-night', 'walk-in', 'huge'],
    'The griddle has twenty-six years of fond on it and you can taste every one of them.', { meal: 'dinner', party: 2 }),
  p('b2', 'wen', 'patty-melt', 'gus-melt', 22, 9, [4, 4, 4, 4, 4], 78, ['walk-in', 'huge'],
    'Patty melt on rye at one in the morning. The onions are cooked down for an hour.', { meal: 'late night', party: 2 }),
  p('b3', 'esme', 'patty-melt', 'gus-fries', 8, 19, [2, 3, 3, 4, 3], 11, ['veg-strong'],
    'Nothing for me here beyond fries, and the menu pretends otherwise. Fries are excellent though.', { meal: 'dinner', party: 4 }),
  p('b4', 'theo', 'patty-melt', 'gus-shake', 28, 31, [5, 4, 5, 4, 5], 96, ['kids', 'groups'],
    'Took my nephew. Two burgers, two shakes, change from sixty, and he has not stopped talking about it.', { meal: 'dinner', party: 2 }),

  /* Smash Lab — the queue argument */
  p('q1', 'marcus', 'smash-lab', 'smash-double', 19, 1, [5, 4, 3, 3, 3], 389, ['queue', 'worth-it'],
    'Lacy crisp edges all the way round. Fifty-five minutes in line and I have made peace with that.', { waited: 55, meal: 'dinner', party: 1 }),
  p('q2', 'wen', 'smash-lab', 'smash-classic', 15, 6, [4, 4, 3, 2, 2], 66, ['queue', 'slow'],
    'It is a very good burger. It is not a one-hour burger.', { waited: 60, meal: 'dinner', party: 2 }),
  p('q3', 'esme', 'smash-lab', 'smash-mush', 16, 13, [5, 4, 4, 3, 3], 174, ['veg-strong', 'queue'],
    'The mushroom one is smashed on the same press with a separate scraper and they explained that unprompted.', { waited: 35, meal: 'dinner', party: 1 }),
  p('q4', 'theo', 'smash-lab', 'smash-double', 19, 27, [5, 3, 2, 1, 2], 43, ['queue', 'slow', 'loud'],
    'Ninety minutes. Ninety. For twelve square feet of restaurant and a cardboard tray.', { waited: 90, meal: 'dinner', party: 3 }),
  p('q5', 'amina', 'smash-lab', 'smash-tots', 9, 37, [4, 4, 4, 4, 3], 27, ['quick'],
    'Went at 3pm on a Tuesday. Walked straight in. Everyone complaining about the line is going at seven.', { waited: 0, meal: 'lunch', party: 1 }),

  /* La Reina */
  p('t1', 'hector', 'la-reina', 'reina-pastor', 12, 3, [5, 5, 4, 5, 4], 312, ['cash', 'quick', 'late-night'],
    'Trompo turning, shaved to order, pineapple flicked on top. Nine dollars for three. It is still 2009 in here.', { meal: 'dinner', party: 2 }),
  p('t2', 'marcus', 'la-reina', 'reina-suadero', 13, 11, [5, 5, 4, 5, 4], 141, ['quick', 'cash'],
    'Suadero, double tortilla, the green one not the red one. Trust me.', { meal: 'lunch', party: 1 }),
  p('t3', 'esme', 'la-reina', 'reina-nopal', 11, 20, [4, 4, 4, 5, 4], 88, ['veg-strong', 'quick'],
    'Nopal and bean taco is not a consolation prize, and the comal is separate.', { meal: 'lunch', party: 2 }),
  p('t4', 'joan', 'la-reina', 'reina-pastor', 12, 34, [5, 5, 4, 5, 3], 51, ['quick', 'cash'],
    'Corn tortillas, nothing battered, no shared fryer at all. Easiest meal I have ordered all year.', { meal: 'dinner', party: 2 }),
  p('t5', 'amina', 'la-reina', 'reina-suadero', 13, 45, [4, 4, 3, 4, 4], 29, ['late-night', 'cash'],
    'Two in the morning, queue of cab drivers, which is the only review anyone needs.', { meal: 'late night', party: 1 }),

  /* Golden Dumpling House */
  p('dp1', 'wen', 'golden-dumpling', 'golden-pork', 11, 4, [5, 5, 3, 4, 3], 198, ['cash', 'huge', 'groups'],
    'Twelve pork and chive for eight dollars. Cash only and they are not sorry about it.', { meal: 'lunch', party: 3 }),
  p('dp2', 'hector', 'golden-dumpling', 'golden-lamb', 13, 14, [5, 5, 3, 4, 3], 104, ['cash', 'huge'],
    'Lamb and cumin, properly numbing. Bring small bills, the ATM upstairs charges four dollars.', { meal: 'dinner', party: 2 }),
  p('dp3', 'esme', 'golden-dumpling', 'golden-veg', 10, 28, [4, 5, 3, 4, 3], 62, ['veg-strong', 'cash'],
    'Mushroom and cabbage dumplings, same wrapper, same price. Shared steamer though — worth knowing.', { meal: 'lunch', party: 2 }),
  p('dp4', 'theo', 'golden-dumpling', 'golden-noodle', 14, 39, [5, 4, 2, 3, 3], 47, ['cash', 'slow'],
    'Watched him pull the noodles in the window. Nobody spoke to us for fifteen minutes and it was fine.', { meal: 'dinner', party: 2 }),

  /* Miss Delphine */
  p('dl1', 'birdie', 'harlem-fish', 'delphine-chicken', 31, 2, [5, 4, 5, 2, 5], 367, ['queue', 'worth-it', 'groups'],
    'Sunday after service, an hour on the sidewalk, and the first bite resets your whole week.', { waited: 65, meal: 'brunch', party: 4 }),
  p('dl2', 'marcus', 'harlem-fish', 'delphine-catfish', 27, 15, [5, 4, 4, 3, 4], 129, ['loud', 'huge'],
    'Catfish fried to order, which is why it takes twenty minutes, which is why it is good.', { waited: 20, meal: 'dinner', party: 2 }),
  p('dl3', 'theo', 'harlem-fish', 'delphine-mac', 24, 26, [4, 4, 4, 2, 4], 58, ['queue', 'slow'],
    'The mac is the sleeper. The waiting is not.', { waited: 45, meal: 'dinner', party: 3 }),
  p('dl4', 'amina', 'harlem-fish', 'delphine-greens', 22, 36, [4, 4, 5, 3, 5], 71, ['groups', 'kids'],
    'Collards with smoked turkey rather than pork, and they told me straight when I asked.', { meal: 'lunch', party: 4 }),

  /* Naan Stop */
  p('ns1', 'amina', 'naan-stop', 'naan-seekh', 16, 1, [5, 5, 4, 4, 3], 176, ['late-night', 'quick'],
    'Halal, open till four, and the naan comes out blistered and folded round the kebab. This is the one.', { meal: 'late night', party: 2 }),
  p('ns2', 'hector', 'naan-stop', 'naan-butter', 18, 10, [4, 4, 4, 4, 3], 63, ['late-night', 'huge'],
    'Butter chicken is sweeter than I want but the portion is a scandal in my favour.', { meal: 'dinner', party: 2 }),
  p('ns3', 'esme', 'naan-stop', 'naan-chana', 12, 24, [4, 5, 4, 4, 3], 49, ['veg-strong'],
    'Chana masala made with oil not ghee, confirmed twice, and it is ten dollars.', { meal: 'dinner', party: 1 }),
  p('ns4', 'wen', 'naan-stop', 'naan-garlic', 15, 42, [4, 4, 3, 5, 2], 24, ['quick', 'late-night'],
    'Strip lighting, plastic chairs, food out in four minutes at 1am. Exactly what it says.', { meal: 'late night', party: 1 }),

  /* Mariposa */
  p('mp1', 'theo', 'mariposa', 'mariposa-menu', 285, 7, [5, 3, 5, 3, 5], 211, ['date', 'quiet', 'book-ahead', 'slow'],
    'My one big dinner of the quarter. Eleven courses, two hours, and course six made me put the cutlery down.', { meal: 'dinner', party: 2 }),
  p('mp2', 'esme', 'mariposa', 'mariposa-veg', 285, 18, [5, 3, 5, 3, 5], 298, ['veg-strong', 'date', 'quiet'],
    'A whole vegan menu built in parallel rather than subtracted from the real one. I have waited ten years to write that sentence.', { meal: 'dinner', party: 2 }),
  p('mp3', 'marcus', 'mariposa', 'mariposa-menu', 260, 32, [4, 2, 5, 2, 4], 46, ['overpriced', 'slow', 'quiet'],
    'Two hundred and sixty dollars and I ate again at midnight. Technically brilliant, physically insufficient.', { meal: 'dinner', party: 2 }),
  p('mp4', 'birdie', 'mariposa', 'mariposa-pair', 340, 50, [5, 3, 5, 3, 5], 83, ['date', 'quiet', 'book-ahead'],
    'Anniversary. They remembered a thing I said on the phone three weeks earlier.', { meal: 'dinner', party: 2 }),

  /* Tasca Sete */
  p('ts1', 'paulo', 'tasca-sete', 'sete-sardinha', 14, 5, [5, 5, 4, 4, 5], 187, ['cash', 'outside', 'groups'],
    'Sardines on the charcoal outside, paper on the table, wine in a jug. Nothing has changed and nothing should.', { meal: 'lunch', party: 4 }),
  p('ts2', 'ines', 'tasca-sete', 'sete-bacalhau', 16, 16, [4, 5, 4, 3, 4], 74, ['cash', 'loud'],
    'Bacalhau à brás done properly — still loose, not a brick. The tourists have not found it yet. Do not.', { meal: 'dinner', party: 2 }),
  p('ts3', 'fran', 'tasca-sete', 'sete-caldo', 12, 29, [4, 5, 3, 4, 4], 41, ['cash', 'outside'],
    'Caldo verde for four euros and a view of somebody else’s washing. Ideal.', { meal: 'lunch', party: 2 }),
  p('ts4', 'sanj', 'tasca-sete', 'sete-caldo', 11, 46, [3, 4, 3, 4, 4], 17, [],
    'As a vegetarian I had soup and bread and watched everyone else have the good time.', { meal: 'dinner', party: 3 }),

  /* Pombo */
  p('pb1', 'ines', 'pastel-pombo', 'pombo-nata', 3, 2, [5, 5, 4, 5, 4], 254, ['quick', 'cash'],
    'Out of the oven at 11:20, eaten at 11:22, still too hot. The correct way.', { meal: 'breakfast', party: 1 }),
  p('pb2', 'paulo', 'pastel-pombo', 'pombo-galao', 3.2, 12, [5, 5, 5, 5, 4], 98, ['quick'],
    'Nata and a galão standing at the counter, three euros twenty. Seventy-seven years of practice.', { meal: 'breakfast', party: 1 }),
  p('pb3', 'fran', 'pastel-pombo', 'pombo-nata', 2.8, 25, [5, 5, 4, 5, 3], 66, ['quick', 'solo'],
    'I queued at the famous one for thirty-five minutes and then found this, forty metres away, empty.', { waited: 2, meal: 'snack', party: 1 }),
  p('pb4', 'joan', 'pastel-pombo', 'pombo-galao', 1.8, 43, [4, 5, 4, 5, 3], 22, [],
    'Nothing here is safe for me and they said so immediately rather than guessing. That is worth something.', { meal: 'snack', party: 2 }),

  /* Verde */
  p('vd1', 'esme', 'verde-lisboa', 'verde-bowl', 21, 4, [5, 4, 5, 4, 5], 233, ['veg-strong', 'outside', 'quiet'],
    'An entire menu. Not a section, not a symbol next to two dishes — a menu.', { meal: 'lunch', party: 2 }),
  p('vd2', 'ines', 'verde-lisboa', 'verde-cake', 14, 21, [4, 3, 4, 4, 5], 57, ['outside', 'date'],
    'The courtyard is the point. The olive oil cake is the other point.', { meal: 'brunch', party: 2 }),
  p('vd3', 'paulo', 'verde-lisboa', 'verde-toast', 12, 33, [3, 3, 4, 4, 4], 19, ['overpriced'],
    'Twelve euros for tomato on toast in Lisbon. I understand what they are doing. I am not the customer.', { meal: 'brunch', party: 2 }),
  p('vd4', 'sanj', 'verde-lisboa', 'verde-bowl', 19, 48, [5, 4, 5, 4, 4], 84, ['veg-strong', 'quiet'],
    'First meal in months where I read the whole menu instead of scanning it for the one dish.', { meal: 'dinner', party: 2 }),

  /* Sanchōme */
  p('sn1', 'kenji', 'sanchome', 'sanchome-shoyu', 980, 2, [5, 5, 3, 5, 4], 167, ['solo', 'quick', 'quiet'],
    'Ticket machine, nine seats, bowl down in ninety seconds, out in eight minutes. Perfect system.', { waited: 6, meal: 'lunch', party: 1 }),
  p('sn2', 'mei', 'sanchome', 'sanchome-tsuke', 1150, 13, [5, 5, 3, 4, 3], 79, ['solo', 'quiet'],
    'Tsukemen with the dipping broth kept at a temperature somebody clearly argues about.', { waited: 12, meal: 'dinner', party: 1 }),
  p('sn3', 'fran', 'sanchome', 'sanchome-shoyu', 1130, 30, [5, 5, 2, 5, 3], 52, ['solo', 'quick'],
    'Nobody speaks. Nobody looks up. I have never felt more comfortable eating alone.', { waited: 9, meal: 'late night', party: 1 }),
  p('sn4', 'sanj', 'sanchome', 'sanchome-egg', 980, 51, [2, 3, 2, 5, 2], 8, [],
    'There is nothing for a vegetarian here and the menu does not pretend there is. Fair enough, but noting it.', { waited: 7, meal: 'lunch', party: 1 }),

  /* Kissaten Ao */
  p('ka1', 'mei', 'kissaten-ao', 'ao-siphon', 750, 3, [5, 4, 5, 2, 5], 188, ['quiet', 'solo', 'slow'],
    'Eleven minutes for a siphon coffee, a jazz record on, and nobody in this room has looked at a phone.', { meal: 'breakfast', party: 1 }),
  p('ka2', 'kenji', 'kissaten-ao', 'ao-toast', 620, 19, [4, 4, 5, 3, 5], 71, ['quiet', 'date'],
    'Thick-cut toast with red bean and butter. Unchanged since 1979 and there is a reason.', { meal: 'brunch', party: 2 }),
  p('ka3', 'fran', 'kissaten-ao', 'ao-pudding', 550, 37, [5, 4, 4, 3, 5], 94, ['quiet', 'solo'],
    'Custard pudding that wobbles correctly. The whole café is about ten decibels.', { meal: 'snack', party: 1 }),
  p('ka4', 'esme', 'kissaten-ao', 'ao-siphon', 750, 49, [4, 3, 4, 2, 5], 26, [],
    'Black coffee and that is my lot — the milk and the butter are the whole menu here.', { meal: 'breakfast', party: 1 }),

  /* Ban */
  p('yk1', 'kenji', 'yakitori-ban', 'ban-omakase', 8900, 6, [5, 4, 5, 4, 5], 204, ['book-ahead', 'date', 'small'],
    'Twelve skewers, in an order somebody thought hard about, and the chef says nothing until the ninth.', { meal: 'dinner', party: 2 }),
  p('yk2', 'mei', 'yakitori-ban', 'ban-negima', 7200, 22, [5, 3, 5, 4, 4], 88, ['book-ahead', 'small'],
    'Charcoal so hot the skin goes glassy. Booking opens on the first of the month and goes in a morning.', { meal: 'dinner', party: 2 }),
  p('yk3', 'fran', 'yakitori-ban', 'ban-shiitake', 6400, 44, [4, 3, 4, 4, 4], 37, ['small', 'book-ahead'],
    'Shiitake with salt was the best thing I ate in Tokyo and it cost three hundred and eighty yen.', { meal: 'dinner', party: 2 }),
];

export const postById = new Map(POSTS.map((x) => [x.id, x]));

/* ── tribes ────────────────────────────────────────────────────────────────
   The one design decision in this file worth arguing about.

   A tribe could have been a table: a name, and a list of restaurant ids
   somebody maintains by hand. That version is dead within a month — a place
   opens in Peckham and it is not in #PeckhamCheap until a human notices.

   So a tribe is a SAVED SEARCH with people in it. #LondonBrunch is not a list,
   it is `city=london, meal=brunch` plus the members who care about that corner
   of the map, and anything that opens tomorrow and serves brunch in London is
   in it the moment it is posted. The feed of a tribe is the feed of its filter.

   The cost, stated honestly: you cannot hand-pick. A tribe cannot include one
   oddity that does not match its own filter, and #NYCBurgerLovers therefore
   cannot quietly contain a hot dog place. That trade is the right way round —
   a rule that stays true beats a list that needs a caretaker. */
const t = (id, name, blurb, filter, members) => ({ id, name, blurb, filter, members });

export const TRIBES = [
  t('london-brunch', 'LondonBrunch', 'Eggs, pastry and queueing, W1 to E8.',
    { city: 'london', meals: ['brunch', 'breakfast'] }, ['rhi', 'cal', 'des', 'joan', 'marta']),
  t('nyc-burgers', 'NYCBurgerLovers', 'Smashed, stacked, and argued about.',
    { city: 'new-york', dish: 'burger' }, ['marcus', 'wen', 'theo', 'esme']),
  t('under-a-tenner', 'UnderATenner', 'Every meal here costs less than a cinema ticket.',
    { maxSpend: 10 }, ['lex', 'des', 'hector', 'priya', 'wen']),
  t('plant-first', 'PlantFirst', 'Kitchens where vegan is a menu, not a footnote.',
    { diet: 'vegan', dietLevel: 'full' }, ['esme', 'sanj', 'ines', 'priya']),
  t('late-and-open', 'LateAndOpen', 'After eleven, and still cooking.',
    { meals: ['late night'] }, ['dev', 'amina', 'tobi', 'kenji']),
  t('counter-culture', 'CounterCulture', 'Sit at the pass. Watch it happen.',
    { maxSeats: 20 }, ['marta', 'kenji', 'mei', 'nina']),
  /* A wait ceiling alone was not enough: most places have nobody reporting a
     queue at all, which scores as zero and put eighteen of twenty-two in the
     tribe. Requiring the "in and out fast" tag as well asks for evidence of
     speed rather than absence of evidence of slowness. */
  t('no-queue-club', 'NoQueueClub', 'Great food you can walk into. The whole point is the not-waiting.',
    { maxWait: 15, tags: ['quick'] }, ['lex', 'dev', 'paulo', 'amina']),
  t('quiet-tables', 'QuietTables', 'Rooms where you can hear the person opposite you.',
    { maxNoise: 2 }, ['des', 'mei', 'joan', 'theo']),
];

export const tribeById = new Map(TRIBES.map((x) => [x.id, x]));

/* ── recipes ───────────────────────────────────────────────────────────────
   Half of what people want from a food app is "what do I cook tonight", and
   that half needs its own object: a recipe is not a restaurant with a kitchen
   attached, it has ingredients, a time, and a number of people it feeds.

   `cooks` are people who actually made it and said so. They are scored and
   aggregated by exactly the same function that ranks restaurants — see
   `shrunkMean` in engine.js — which is the payoff for storing the individual
   opinions rather than a pre-averaged star count. */
const rc = (id, author, title, opts) => ({ id, author, title, ...opts });
const ck = (by, rating, daysAgo, note = '') => ({ by, rating, daysAgo, note });

export const RECIPES = [
  rc('jollof', 'ayo', 'Party jollof, the smoky way', {
    minutes: 70, serves: 6, difficulty: 'medium', archetype: 'rice-bowl',
    diet: { vegan: false, vegetarian: false, glutenFree: true, halal: true },
    free: ['dairy-free', 'nut-free'],
    blurb: 'The smoke is not a flavouring, it is a technique: the pot goes on too high for the last eight minutes and you let the bottom catch.',
    ingredients: ['400g long grain rice, washed until the water runs clear', '6 plum tomatoes', '2 red peppers',
      '1 scotch bonnet, more if you know yourself', '2 onions', '120ml groundnut oil', '2 tbsp tomato purée',
      '1 tsp curry powder', '1 tsp dried thyme', '2 bay leaves', '700ml chicken stock'],
    steps: ['Blend tomatoes, peppers, scotch bonnet and one onion until smooth. Boil it down hard for fifteen minutes — it should go from bright red to brick.',
      'Slice the second onion and fry in the oil until it collapses. Add the purée and fry two minutes more.',
      'In with the reduced blend, the spices and the bay. Cook until the oil separates and floats.',
      'Rice in, stock in, one stir only. Lid on, lowest heat, twenty-five minutes, no peeking.',
      'Last eight minutes: heat up. You want to hear it. The layer that catches on the bottom is the point of the dish.'],
    cooks: [ck('tobi', 5, 4, 'Did the last eight minutes properly and it was worth the pan.'),
      ck('fran', 5, 12, 'First jollof I have made that tasted like a party rather than like rice.'),
      ck('rhi', 4, 19, 'Scotch bonnet took me out. My fault, not the recipe’s.'),
      ck('cal', 5, 26), ck('des', 4, 40), ck('marta', 5, 55, 'Correct.')],
  }),
  rc('cardamom-buns', 'rhi', 'Cardamom buns, vegan and not dry', {
    minutes: 210, serves: 12, difficulty: 'hard', archetype: 'pastry',
    diet: { vegan: true, vegetarian: true, glutenFree: false, halal: true },
    free: ['dairy-free', 'egg-free'],
    blurb: 'Vegan enriched dough goes dry because people swap butter for oil. Swap it for a solid fat and a tangzhong and it does not.',
    ingredients: ['500g strong white flour (plus 25g for the tangzhong)', '150ml oat milk for the tangzhong',
      '200ml oat milk, warm', '100g vegan block butter, cold', '90g caster sugar', '7g instant yeast',
      '2 tbsp cardamom pods, toasted and ground yourself', '8g salt', 'pearl sugar'],
    steps: ['Tangzhong: 25g flour and 150ml oat milk, whisked over low heat until it is a thick paste. Cool it.',
      'Mix everything but the butter. Knead ten minutes. Then add the cold butter a cube at a time.',
      'Prove until doubled, about ninety minutes.', 'Roll, butter, cardamom sugar, fold in three, cut into strips and knot.',
      'Second prove forty minutes. 200°C, 14 minutes. Syrup them straight out of the oven.'],
    cooks: [ck('esme', 5, 3, 'The tangzhong is the whole trick. They were still soft on day two.'),
      ck('ines', 5, 15), ck('sanj', 4, 21, 'Grinding your own cardamom is not optional, I tried.'),
      ck('joan', 3, 31, 'Cannot eat it myself. Made it for the office and they were gone by ten.'),
      ck('fran', 5, 47)],
  }),
  rc('dal', 'priya', 'Everyday dal, twenty minutes', {
    minutes: 20, serves: 4, difficulty: 'easy', archetype: 'stew',
    diet: { vegan: true, vegetarian: true, glutenFree: true, halal: true },
    free: ['dairy-free', 'nut-free', 'egg-free'],
    blurb: 'The tadka goes on at the end and it goes on hot. Everything before that is boiling lentils.',
    ingredients: ['200g red lentils', '1 tsp turmeric', '3 tbsp ghee or oil', '1 tsp cumin seed',
      '1 tsp black mustard seed', '6 curry leaves', '4 garlic cloves, sliced', '2 dried red chillies', 'lime'],
    steps: ['Lentils, turmeric, 700ml water. Simmer eighteen minutes, skimming.',
      'Hot oil, mustard seed until it pops, then cumin, garlic, chillies, curry leaves — twenty seconds, no more.',
      'Pour it over. It should hiss. Lime, salt, done.'],
    cooks: [ck('sanj', 5, 2, 'I make this twice a week and have stopped measuring anything.'),
      ck('lex', 5, 9, 'Eighty pence a portion.'), ck('esme', 5, 17), ck('rhi', 4, 25),
      ck('joan', 5, 34, 'Naturally gluten free without anyone having to be clever about it.'),
      ck('fran', 4, 41), ck('cal', 5, 50)],
  }),
  rc('smash', 'marcus', 'Smash burger with a lacy edge', {
    minutes: 15, serves: 2, difficulty: 'easy', archetype: 'burger',
    diet: { vegan: false, vegetarian: false, glutenFree: false, halal: false },
    free: ['nut-free'],
    blurb: 'The lace comes from pressure in the first ten seconds and from nothing else. Press once, hard, and never again.',
    ingredients: ['400g chuck mince, 20% fat, cold', '4 slices American cheese', '2 potato rolls',
      'white onion, sliced paper thin', 'pickles', 'mustard'],
    steps: ['Ball the mince into four. Do not compact them. Fridge until the pan is beyond hot.',
      'Ball on, ten seconds, then press flat with a stiff spatula and hold three seconds. Salt now.',
      'Ninety seconds. Scrape under with the whole edge so the crust comes with it. Flip, cheese, thirty seconds.',
      'Stack two patties. Toasted roll. Mustard, onion, pickle. Nothing else.'],
    cooks: [ck('wen', 5, 5), ck('theo', 4, 13, 'My extractor fan has filed a complaint.'),
      ck('hector', 5, 22), ck('birdie', 5, 29), ck('marta', 4, 44, 'Chuck at 20% or do not bother.')],
  }),
  rc('nata', 'ines', 'Pastéis de nata at home', {
    minutes: 150, serves: 12, difficulty: 'hard', archetype: 'pastry',
    diet: { vegan: false, vegetarian: true, glutenFree: false, halal: true },
    free: ['nut-free'],
    blurb: 'Your oven does not go to 300°C, so this compensates: a blistering pre-heat, a tin on the floor of the oven, and cold custard into hot pastry.',
    ingredients: ['320g puff pastry, all butter, rolled thin', '500ml whole milk', '250g sugar',
      '40g plain flour', '6 egg yolks', '1 cinnamon stick', 'lemon peel'],
    steps: ['Sugar and 125ml water to 100°C. Set aside.', 'Flour and milk whisked smooth, heated to a thick béchamel.',
      'Combine, off the heat, with the cinnamon and lemon. Then the yolks. Strain. Cool it properly.',
      'Roll the pastry into a tight log, cut 2cm discs, press each into the tin with a wet thumb.',
      'Cold custard, 80% full. Hottest your oven goes, top shelf, until the tops are actually black in places. They must be.'],
    cooks: [ck('paulo', 4, 7, 'Not Belém. Nothing at home is. Closer than anything I have made before.'),
      ck('fran', 5, 18), ck('rhi', 3, 27, 'Mine did not blister. Oven not hot enough — that is on my landlord.'),
      ck('mei', 5, 38), ck('nina', 4, 49)],
  }),
  rc('tsukemen-egg', 'kenji', 'Ajitama, the six-and-a-half minute egg', {
    minutes: 15, serves: 4, difficulty: 'easy', archetype: 'eggs',
    diet: { vegan: false, vegetarian: true, glutenFree: false, halal: true },
    free: ['dairy-free', 'nut-free'],
    blurb: 'Six minutes thirty from fridge-cold, into ice, then twelve hours in the marinade. Anything over seven minutes is a different egg.',
    ingredients: ['4 eggs, fridge cold', '120ml soy', '120ml mirin', '120ml water', '1 tsp sugar'],
    steps: ['Rolling boil. Eggs in on a spoon. Six minutes thirty exactly, stirring for the first minute so the yolk centres.',
      'Ice bath, five minutes, peel under water.', 'Marinade in a bag with the air pressed out. Twelve hours, no more than twenty-four.'],
    cooks: [ck('mei', 5, 6), ck('fran', 5, 14, 'The stirring-for-a-minute thing is why mine were always off-centre.'),
      ck('dev', 4, 23), ck('marcus', 5, 36)],
  }),
  rc('caldo', 'paulo', 'Caldo verde, four euros of soup', {
    minutes: 40, serves: 6, difficulty: 'easy', archetype: 'stew',
    diet: { vegan: false, vegetarian: false, glutenFree: true, halal: false },
    free: ['dairy-free', 'nut-free', 'egg-free'],
    blurb: 'Potato blended smooth, cabbage shredded to threads and in for four minutes only. Long-cooked greens are somebody else’s soup.',
    ingredients: ['800g floury potatoes', '1 onion', '3 garlic cloves', '200g couve or cavolo nero, shredded fine',
      '100g chouriço, sliced', 'good olive oil'],
    steps: ['Soften onion and garlic in oil. Potatoes and 1.5L water, boil until falling apart. Blend smooth.',
      'Fry the chouriço separately and keep the red oil.', 'Greens into the soup for four minutes. Not longer.',
      'Chouriço on top, the red oil over, more olive oil than feels reasonable.'],
    cooks: [ck('ines', 5, 8), ck('fran', 4, 20), ck('des', 5, 33, 'Made it for eight people for under a fiver.'),
      ck('nina', 4, 45)],
  }),
  rc('dosa-batter', 'priya', 'Dosa batter, from two bags of rice', {
    minutes: 1200, serves: 10, difficulty: 'medium', archetype: 'dosa',
    diet: { vegan: true, vegetarian: true, glutenFree: true, halal: true },
    free: ['dairy-free', 'nut-free', 'egg-free'],
    blurb: 'Fermentation is a temperature problem, not a time problem. In a cold flat it will not go in eight hours and no amount of waiting fixes the wrong spot.',
    ingredients: ['3 cups idli rice', '1 cup urad dal', '1 tsp fenugreek seed', 'salt, only after fermenting'],
    steps: ['Soak rice and dal separately, six hours.', 'Grind dal first until it is aerated and holds a peak. Then the rice, coarser.',
      'Combine by hand — the warmth matters. Ferment somewhere 28–30°C for eight to twelve hours.',
      'It is ready when it has doubled and smells sour, not when the clock says so. Salt after.',
      'Hot tawa, wipe with oil, ladle, spiral outwards fast.'],
    cooks: [ck('sanj', 5, 10), ck('esme', 4, 24, 'Took sixteen hours in my kitchen in February. Worked eventually.'),
      ck('joan', 5, 35), ck('lex', 4, 46)],
  }),
  rc('collards', 'birdie', 'Collards, smoked turkey, no pork', {
    minutes: 120, serves: 8, difficulty: 'easy', archetype: 'stew',
    diet: { vegan: false, vegetarian: false, glutenFree: true, halal: false },
    free: ['dairy-free', 'nut-free', 'egg-free'],
    blurb: 'My grandmother used a ham hock. Half the table could not eat it. Smoked turkey wing does the same job and nobody has to sit out.',
    ingredients: ['2 large bunches collards, stemmed and torn', '2 smoked turkey wings', '1 onion',
      '2 tbsp cider vinegar', '1 tsp red pepper flake', 'hot sauce at the table'],
    steps: ['Wings and onion in 2L water, simmer an hour until the meat gives.',
      'Pull the meat, back into the pot with the greens.', 'Ninety minutes on low. They should be soft, not khaki.',
      'Vinegar at the very end. The pot liquor is the best part — do not pour it away.'],
    cooks: [ck('amina', 5, 11, 'Finally a version I can actually serve at my table.'),
      ck('marcus', 5, 28), ck('theo', 4, 39), ck('ayo', 5, 52)],
  }),
  rc('tortilla', 'marta', 'Tortilla, forty minutes, runny', {
    minutes: 40, serves: 4, difficulty: 'medium', archetype: 'eggs',
    diet: { vegan: false, vegetarian: true, glutenFree: true, halal: true },
    free: ['dairy-free', 'nut-free'],
    blurb: 'The argument is settled: runny. The potatoes are poached in oil rather than fried, which is where the forty minutes goes.',
    ingredients: ['700g waxy potatoes, sliced 3mm', '1 large onion, sliced', '500ml olive oil', '6 eggs', 'salt'],
    steps: ['Potatoes and onion into the oil at 130°C. Poach, do not fry, twenty-five minutes until they break with a spoon.',
      'Drain, keep the oil, cool five minutes so they do not scramble the eggs.',
      'Beaten eggs, salt, combine, rest ten minutes.', 'Two tablespoons of that oil in the pan, in, four minutes, flip on a plate, three more. The middle should wobble.'],
    cooks: [ck('nina', 5, 16), ck('paulo', 4, 30, 'Runny is correct and I will not be discussing it further.'),
      ck('sanj', 5, 42), ck('ines', 5, 51)],
  }),
  rc('chana', 'esme', 'Chana masala, no ghee, no apology', {
    minutes: 35, serves: 4, difficulty: 'easy', archetype: 'curry',
    diet: { vegan: true, vegetarian: true, glutenFree: true, halal: true },
    free: ['dairy-free', 'nut-free', 'egg-free'],
    blurb: 'Dried chickpeas, soaked, with a tea bag in the cooking water — it darkens them and takes the flat edge off tinned.',
    ingredients: ['250g dried chickpeas, soaked overnight', '1 black tea bag', '2 onions, browned properly',
      '4 garlic, thumb of ginger', '2 tsp amchur', '2 tsp garam masala', '1 tin tomatoes'],
    steps: ['Boil the chickpeas with the tea bag and a pinch of bicarb until soft. Keep the liquor.',
      'Brown the onions for fifteen minutes. This is the recipe. Everything else is assembly.',
      'Ginger, garlic, spices, tomatoes, reduce.', 'Chickpeas and a ladle of their liquor. Twenty minutes. Amchur at the end.'],
    cooks: [ck('sanj', 5, 12), ck('amina', 5, 26), ck('priya', 4, 37, 'Would add a second tin of tomatoes.'),
      ck('lex', 5, 48)],
  }),
  rc('pancakes', 'rhi', 'Buttermilk stack, burnt honey', {
    minutes: 30, serves: 4, difficulty: 'easy', archetype: 'pancakes',
    diet: { vegan: false, vegetarian: true, glutenFree: false, halal: true },
    free: ['nut-free'],
    blurb: 'Burning honey is a thirty-second job that makes a two-ingredient sauce taste like it took an hour. Take it further than you think.',
    ingredients: ['300g plain flour', '2 tsp baking powder', '1 tsp bicarb', '400ml buttermilk',
      '2 eggs, separated', '50g melted butter', '150g honey', 'flaky salt'],
    steps: ['Dry mixed. Wet mixed. Whites whipped to soft peaks and folded in last.',
      'Rest the batter fifteen minutes or they will be flat.', 'Medium-low pan, dry, three minutes a side.',
      'Honey alone in a small pan until it is genuinely dark and smells of toffee and slightly of smoke. Off the heat, splash of water, flaky salt.'],
    cooks: [ck('cal', 5, 9), ck('des', 4, 21, 'Burnt the honey too far the first time. Second go, perfect.'),
      ck('birdie', 5, 32), ck('ines', 5, 43), ck('theo', 4, 54)],
  }),
];

export const recipeById = new Map(RECIPES.map((x) => [x.id, x]));

/* ── you ───────────────────────────────────────────────────────────────────
   The app has a signed-in reader, because half the features in a social app
   are meaningless without one: what your feed is filtered to, which tribes you
   are in, what you saved. Everything here is local to the browser. */
export const ME = {
  id: 'me', name: 'Jason Bakes', handle: '@Jason.Bake5', badge: 'Homecook',
  bio: ['Gains are made in the kitchen', 'Tastiest high protein baking recipes'],
  unpopular: 'Pineapple should never be added to anything.',
  following: 10, followers: 11700, likes: 205400,
  tribes: ['london-brunch', 'under-a-tenner', 'no-queue-club'],
  diet: null, city: 'london',
};
