# Gobl — a food app you can actually search

**[Open it](index.html)** · Twenty-two restaurants, ninety-five reviews, twelve
recipes and eight tribes. No backend, no framework, no image files — every
plate on screen is drawn on a canvas from the dish id.

The pitch was "Instagram, but for food". The photo grid is the easy half. The
half that decides whether anyone comes back is the search, and a restaurant
search is three problems that shipping software gets wrong every day. None of
the three throws. All three produce a screen that looks completely fine.

---

## 1 · A five from two people is not a five

Sort any list of restaurants by average rating and the top of it is the places
nobody has been to. Two friends, two fives, a 5.0 — and it outranks three
hundred people agreeing on 4.6.

Every average here is pulled towards the site-wide average by six imaginary
reviews:

```
shrunkMean(values, prior, weight) = (Σ values + prior × weight) / (n + weight)

  two 5s,        prior 4.0, weight 6 → (10  + 24) / (2  + 6)  = 4.25
  thirty 4.6s,   prior 4.0, weight 6 → (138 + 24) / (30 + 6)  = 4.50
```

Which is the right way round. A rating has to be *earned* by volume before it
can sit at the top of a list, and one enthusiast can no longer put a place
there on their own.

Two decisions inside that are worth stating plainly:

- **The prior is computed, not typed in.** It is the mean of every score in the
  dataset, so it stays true when the data changes. A hard-coded 4.0 is a
  constant that quietly stops being the average the day somebody adds twenty
  reviews.
- **The weight — six — is a judgement call.** It is the number of reviews at
  which you trust the average about as much as you trust the prior. Six is low,
  chosen for a dataset of this size. A real one would fit it rather than pick
  it, and the app says so rather than implying six is a law of nature.

The restaurant page shows the sentence behind the number: *"3.63 average from 6
reviews, shown as 3.80: pulled up towards 3.97 because 6 reviews is not many."*
A ranking nobody can interrogate is a ranking nobody should trust.

## 2 · The facet count bug

Next to every filter option is a number. The number has to be computed with all
the **other** filters applied and **this one left out**.

Apply the filter you are counting, and every option the reader has not picked
reads zero. The interface then says "there is nothing else" at the exact moment
they want to change their mind — pick London and New York shows `(0)`, so the
app looks like it contains one city.

It is one line:

```js
const without = { ...filters, [facet]: cleared };
```

and it is the single most common bug in faceted search. There are three tests
on it: that selecting one value does not zero the others, that the counts
**do** still narrow under the other filters (the opposite failure — leaving one
facet out must not mean ignoring all of them), and that a count is exactly what
you get if you click it, checked by clicking it.

## 3 · A caption is not a dietary guarantee

"Vegan" is a promise about a kitchen. It is not a word that appears near a
photo.

Match text and a caption reading *"not great for vegans"* satisfies a vegan
filter, because it contains the word — and somebody gets ill. So the filter
reads a three-valued flag recorded per restaurant and nothing else:

| flag | means |
|---|---|
| `full` | a whole menu you can eat |
| `some` | two or three dishes, and the kitchen knows which |
| `none` | do not come here hungry and hopeful |

The test for it builds the trap on purpose: a steakhouse with nothing vegan and
five reviews that all say the word. The filter must return nothing — **and the
search box must still find it**, because that distinction is the point. Search
is a suggestion. A filter is a promise.

The restaurant page states the same three values in words rather than as a
green tick, because "vegan friendly ✓" is exactly the claim that means nothing.

---

## The other decisions

**A tribe is a saved search.** #LondonBrunch could have been a hand-kept list of
restaurant ids. That version is dead within a month — a place opens in Peckham
and it is not in the tribe until a human notices. Instead a tribe stores a
filter (`city=london, meal=brunch`) and its feed is that filter's results, so
anything that opens tomorrow and fits is in it the day it is posted. The cost
is real and worth naming: a tribe cannot hand-pick, so #NYCBurgerLovers cannot
quietly contain a hot dog place.

**This is where the one real bug in the app was.** #CounterCulture filtered on
`maxSeats`, the filter builder did not map that key, and the tribe silently
contained all twenty-two restaurants — a saved search with no search in it. It
looked completely normal: a full feed of good restaurants. The test that now
catches it does not check a count, it checks that *every key any tribe filters
on is a key the builder understands*, which is the version that keeps working
when somebody adds a tribe.

**Five scores, not one.** A place can be the best food in the city and a
miserable evening, and one star rating cannot say so. Food, value, service,
speed and vibe are scored separately, and the overall is derived from them
rather than asked for on top — asking for both is how you get a sixth column of
4s that correlates with nothing.

**Where people disagreed is shown, not averaged away.** Five fives and five
twos is a 3.5. So is everybody shrugging. They are completely different
restaurants, and the second one is not worth your Friday. When at least a
quarter of reviewers went low and at least half went high, the page says *"Split
room on vibe. 67% gave it 4 or 5, 33% gave it 1 or 2. The average is the one
number that describes nobody here."*

**Tags are chosen, not extracted.** Every "AI review summary" that reads
sentiment out of free text gets *"the wait was not bad at all"* exactly
backwards, and the reader has no way to tell. Reviewers here pick from a fixed
list of eighteen tags. It is less clever and it is honest, and it means the
counts on a restaurant page are countable rather than guessed.

**The numbers nobody publishes.** Median wait — not mean, so one ninety-minute
outlier does not own it — and median of what people actually said they paid,
rather than what the menu says. The queue at Smash Lab is the entire argument
about that restaurant, and it is the one fact no restaurant app will print.

**Typing a sentence sets filters, and the app shows you what it took them to
mean.** "cheap vegan brunch in peckham under £15" is four filters and no search
terms; treating it as five words to match against a blurb finds nothing. The
recognised words become filters and come off the free text, and every one comes
back as a chip you can remove. Being wrong visibly is fine. Being wrong
silently is what makes a search box feel broken.

**Money is stored in the city's own currency.** ¥980 is what is printed on the
menu. Cross-city filters convert through one fixed snapshot rate, which the app
labels as exactly that rather than pretending to be a bank.

---

## The pictures

There are no photographs, because there are only three ways to get them: take
them, take somebody else's, or draw them. Every plate is drawn on a canvas from
a seed, so the repository contains no image files and the app works with the
network off.

They are not trying to fool anyone. They have to be legible at 180 pixels — you
should know at a glance that this is ramen and that is a slice — and warm
rather than flat, which is three things: nothing is a perfect circle, everything
is lit from the top left with a contact shadow under it, and the whole frame
gets a grain and a vignette at the end. Twenty-seven dish archetypes, and a test
that no dish in the data falls through to the generic plate.

The seed is the dish id, so a dish is the same picture every time you see it. A
picture that reshuffles on every render reads as a bug, not as variety.

## Running it

Open `index.html`. Nothing to install.

```
node tests/run.mjs gobl     # 42 tests on the engine and the data
```

`engine.js` is pure functions over `data.js` and never touches the DOM;
`index.html` owns every pixel and does not contain one rating calculation. That
split is why the maths is tested in Node with no browser anywhere near it.

| file | what is in it |
|---|---|
| `data.js` | 22 restaurants, 95 posts, 24 people, 12 recipes, 8 tribes — hand-written, and written to disagree with itself |
| `engine.js` | filtering, facet counts, query parsing, search, shrinkage, distributions |
| `plates.js` | the food, drawn |
| `index.html` | the app |
