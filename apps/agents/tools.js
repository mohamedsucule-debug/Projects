/* apps/agents/tools.js — real tools, over a real dataset.

   Three hundred expense lines, generated deterministically, and four tools that
   genuinely run over them. Nothing here is mocked: `search` really filters,
   `total` really adds up, and if you ask for a category that does not exist you
   really get an error — which is the point, because the harness next door is
   about what happens when a tool says no.

   The tool definitions are in the shape these APIs actually take: a name, a
   description written for a reader who cannot see the code, and a JSON Schema.
   Those three things are the entire interface a model has to your system, and
   they are resent on every request, so they are worth more care than they
   usually get. */

import { rng } from '../evals/stats.js';

const CATEGORIES = ['cloud', 'travel', 'software', 'hardware', 'contractors', 'office'];
const VENDORS = {
  cloud: ['Northwind Cloud', 'Blue Harbour', 'Stratus'],
  travel: ['Meridian Air', 'Rail Group', 'Cabot Hotels'],
  software: ['Ledgerly', 'Pagewright', 'Signal Desk'],
  hardware: ['Ironmonger', 'Bench & Vice'],
  contractors: ['A. Whitlock', 'Renn Studio', 'K. Osei'],
  office: ['Corner Supply', 'Fern & Co'],
};

/** The dataset. Seeded, so every number on the page is the same every time. */
export function buildExpenses(n = 300, seed = 4242) {
  const next = rng(seed);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const category = CATEGORIES[(next() * CATEGORIES.length) | 0];
    const vendors = VENDORS[category];
    const month = 1 + ((next() * 12) | 0);
    /* Cloud spend rises through the year and everything else does not. That is
       the answer the task below is looking for, and it is in the data rather
       than in a lookup table — so the agent has to actually do the work. */
    const base = category === 'cloud' ? 900 + month * 220 : 200 + next() * 1800;
    const amount = Math.round((base * (0.75 + next() * 0.5)) * 100) / 100;
    rows.push({
      id: `EXP-${String(i + 1).padStart(4, '0')}`,
      date: `2026-${String(month).padStart(2, '0')}-${String(1 + ((next() * 28) | 0)).padStart(2, '0')}`,
      quarter: `Q${Math.ceil(month / 3)}`,
      category,
      vendor: vendors[(next() * vendors.length) | 0],
      amount,
    });
  }
  return rows;
}

export const EXPENSES = buildExpenses();

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

export function buildTools(rows = EXPENSES) {
  return [
    {
      name: 'list_categories',
      description:
        'List every expense category in the ledger, with how many lines each has. ' +
        'Call this first if you are not certain a category exists.',
      input_schema: { type: 'object', properties: {}, required: [] },
      run: () => {
        const counts = new Map();
        for (const r of rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
        return [...counts.entries()].map(([category, lines]) => ({ category, lines }));
      },
    },
    {
      name: 'search_expenses',
      description:
        'Find expense lines by category and/or quarter. Returns the matching lines. ' +
        'This can return a lot of rows; use total_expenses if you only need a sum.',
      input_schema: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: CATEGORIES },
          quarter: { type: 'string', enum: QUARTERS },
        },
        required: [],
      },
      run: ({ category, quarter }) => {
        if (category && !CATEGORIES.includes(category)) {
          /* Thrown, not returned empty. "No results" and "you asked for
             something that cannot exist" are different answers and a model
             that cannot tell them apart will report the first as a fact. */
          throw new Error(
            `No category "${category}". The ledger has: ${CATEGORIES.join(', ')}.`);
        }
        return rows.filter((r) =>
          (!category || r.category === category) && (!quarter || r.quarter === quarter));
      },
    },
    {
      name: 'total_expenses',
      description:
        'Add up expenses, optionally filtered by category and quarter. ' +
        'Returns the total and the number of lines it covers.',
      input_schema: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: CATEGORIES },
          quarter: { type: 'string', enum: QUARTERS },
        },
        required: [],
      },
      run: ({ category, quarter }) => {
        if (category && !CATEGORIES.includes(category)) {
          throw new Error(
            `No category "${category}". The ledger has: ${CATEGORIES.join(', ')}.`);
        }
        const matching = rows.filter((r) =>
          (!category || r.category === category) && (!quarter || r.quarter === quarter));
        const total = matching.reduce((s, r) => s + r.amount, 0);
        return { total: Math.round(total * 100) / 100, lines: matching.length, category, quarter };
      },
    },
    {
      name: 'get_vendor_detail',
      description:
        'Look up one vendor by name and return what was spent with them. ' +
        'The name must match the ledger exactly.',
      /* Deliberately NOT an enum. Vendor names are open-ended in any real
         ledger, so nothing in the schema can say in advance which ones exist —
         which makes this the case argument validation cannot help with, and
         therefore the case the runtime error handler is actually for.

         The first version of the page demonstrated "a tool throws" by asking
         for a category outside its enum. That never reached the tool at all:
         validation rejected it first, so the error handler it was meant to
         exercise was never run. Validation catches what it can describe ahead
         of time; this is what is left. */
      input_schema: {
        type: 'object',
        properties: { vendor: { type: 'string' } },
        required: ['vendor'],
      },
      run: ({ vendor }) => {
        const matching = rows.filter((r) => r.vendor === vendor);
        if (matching.length === 0) {
          const known = [...new Set(rows.map((r) => r.vendor))].sort();
          throw new Error(
            `No vendor called "${vendor}" in the ledger. Known vendors: ${known.join(', ')}.`);
        }
        return {
          vendor,
          lines: matching.length,
          total: Math.round(matching.reduce((s, r) => s + r.amount, 0) * 100) / 100,
          categories: [...new Set(matching.map((r) => r.category))],
        };
      },
    },
    {
      name: 'compare_quarters',
      description:
        'Compare the total for one category between two quarters. Returns both totals, ' +
        'the difference and the percentage change.',
      input_schema: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: CATEGORIES },
          from: { type: 'string', enum: QUARTERS },
          to: { type: 'string', enum: QUARTERS },
        },
        required: ['category', 'from', 'to'],
      },
      run: ({ category, from, to }) => {
        const sum = (q) => rows
          .filter((r) => r.category === category && r.quarter === q)
          .reduce((s, r) => s + r.amount, 0);
        const a = Math.round(sum(from) * 100) / 100;
        const b = Math.round(sum(to) * 100) / 100;
        return {
          category, from, to,
          [from]: a, [to]: b,
          difference: Math.round((b - a) * 100) / 100,
          percentChange: a === 0 ? null : Math.round(((b - a) / a) * 1000) / 10,
        };
      },
    },
  ];
}

/** The answer, computed directly — so the agent's answer can be checked. */
export function groundTruth(rows = EXPENSES) {
  const sum = (c, q) => rows
    .filter((r) => r.category === c && r.quarter === q)
    .reduce((s, r) => s + r.amount, 0);
  const q1 = Math.round(sum('cloud', 'Q1') * 100) / 100;
  const q2 = Math.round(sum('cloud', 'Q2') * 100) / 100;
  return {
    q1, q2,
    difference: Math.round((q2 - q1) * 100) / 100,
    percentChange: Math.round(((q2 - q1) / q1) * 1000) / 10,
  };
}

export { CATEGORIES, QUARTERS };
