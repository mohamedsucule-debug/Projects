/* apps/agents/policy.js — the thing standing in for the model.

   BE CLEAR ABOUT WHAT THIS IS. Everything else in this directory is real: the
   loop, the guards, the tools, the dataset, the token accounting. This file is
   not a model. It is a scripted policy that emits the same message blocks a
   model would, so that the harness can be exercised — including in the ways
   that are hard to provoke on purpose with a real one.

   That is a feature rather than an apology. You cannot reliably get a real
   model to pass an argument of the wrong type, or to call the same tool four
   times in a row, at the moment you want to demonstrate what your harness does
   about it. Here you can tick a box.

   THE INTERFACE IS THE POINT. A policy is one function:

       policy({ messages, tools, turn }) -> { content: Block[] }

   which is exactly the shape of a single non-streaming completion. Swapping in
   a real model means writing one of these that awaits a request instead of
   returning a script — the harness does not change, because the harness never
   knew the difference. That is the boundary worth designing, and it is why it
   is a plain function rather than something clever. */

let nextId = 1;
const callId = () => `toolu_${String(nextId++).padStart(4, '0')}`;

export const FAULTS = {
  none: {
    id: 'none',
    label: 'a clean run',
    note: 'The model asks the right questions in the right order and answers.',
  },
  unknownTool: {
    id: 'unknownTool',
    label: 'calls a tool that does not exist',
    note: 'It has decided there is a `sum_by_month` tool. There is not. With '
        + 'argument validation on, it is told what does exist and recovers.',
  },
  badArgs: {
    id: 'badArgs',
    label: 'passes the wrong argument type',
    note: 'It sends quarter as the number 2 rather than the string "Q2". '
        + 'Common, and silent unless something checks.',
  },
  toolThrows: {
    id: 'toolThrows',
    label: 'asks for something that does not exist',
    note: 'It looks up a vendor that is not in the ledger. Vendor names are '
        + 'open-ended, so no schema can rule this out in advance — the tool '
        + 'throws at runtime, and whether that ends the run is entirely up to '
        + 'the harness.',
  },
  hugeResult: {
    id: 'hugeResult',
    label: 'pulls back far too much',
    note: 'It searches for every line rather than asking for a total. The '
        + 'result is tens of kilobytes and has to be cut down.',
  },
  loops: {
    id: 'loops',
    label: 'gets stuck in a loop',
    note: 'It calls the same tool with the same arguments and does not learn '
        + 'anything from the answer. Without loop detection this runs to the '
        + 'turn limit, paying for the whole conversation every time round.',
  },
};

/**
 * Build a policy.
 *
 * The scripts below are written as a list of turns. Each entry is what the
 * "model" says on that turn, given what it has seen; a real one would decide,
 * and the shape of what comes out would be identical.
 */
export function scriptedPolicy(fault = 'none') {
  return function policy({ messages, tools, turn }) {
    const script = SCRIPTS[fault] ?? SCRIPTS.none;
    const step = script[Math.min(turn - 1, script.length - 1)];
    return step({ messages, tools, turn });
  };
}

const say = (text) => ({ content: [{ type: 'text', text }] });
const call = (name, input, thought) => ({
  content: [
    ...(thought ? [{ type: 'text', text: thought }] : []),
    { type: 'tool_use', id: callId(), name, input },
  ],
});

/** Pull the last tool result out of the conversation, the way a model would. */
function lastResult(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const block = messages[i].content.find((b) => b.type === 'tool_result');
    if (block) return block;
  }
  return null;
}

function parseResult(messages) {
  const block = lastResult(messages);
  if (!block || block.is_error) return null;
  try { return JSON.parse(block.content); } catch { return null; }
}

/* The task, for every script: "How much did we spend on cloud in Q2, and how
   does that compare with Q1?" */

const FINISH = ({ messages }) => {
  const data = parseResult(messages);
  if (data && data.difference !== undefined) {
    return say(
      `Cloud spend was ${money(data[data.to])} in ${data.to}, against ` +
      `${money(data[data.from])} in ${data.from} — up ${money(data.difference)}, ` +
      `or ${data.percentChange}%.`);
  }
  return say('I could not get a clean answer from the tools.');
};

const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const SCRIPTS = {
  none: [
    () => call('list_categories', {},
      'Let me check what categories exist before assuming "cloud" is one.'),
    () => call('compare_quarters', { category: 'cloud', from: 'Q1', to: 'Q2' },
      'Good, "cloud" is there. That is exactly what compare_quarters is for.'),
    FINISH,
  ],

  unknownTool: [
    () => call('sum_by_month', { category: 'cloud' },
      'I will total this by month.'),
    /* Having been told what exists, it picks a real one. This recovery is the
       whole argument for a good error message: the same failure with a bare
       "unknown tool" gives the model nothing to correct towards. */
    () => call('compare_quarters', { category: 'cloud', from: 'Q1', to: 'Q2' },
      'There is no sum_by_month. compare_quarters does what I need.'),
    FINISH,
  ],

  badArgs: [
    () => call('total_expenses', { category: 'cloud', quarter: 2 },
      'Totalling cloud for the second quarter.'),
    () => call('compare_quarters', { category: 'cloud', from: 'Q1', to: 'Q2' },
      'Quarters are strings like "Q2", not numbers. Trying again.'),
    FINISH,
  ],

  toolThrows: [
    () => call('get_vendor_detail', { vendor: 'Nimbus Systems' },
      'I think most of the cloud spend is with Nimbus Systems. Let me check.'),
    () => call('compare_quarters', { category: 'cloud', from: 'Q1', to: 'Q2' },
      'Nimbus Systems is not in this ledger. Going by category instead.'),
    FINISH,
  ],

  hugeResult: [
    () => call('search_expenses', { category: 'cloud' },
      'I will pull every cloud line and add them up myself.'),
    ({ messages }) => {
      const block = lastResult(messages);
      return call('compare_quarters', { category: 'cloud', from: 'Q1', to: 'Q2' },
        block?.truncated
          ? 'That came back truncated, so I cannot total it by hand reliably. '
            + 'Asking the tool to do the arithmetic instead.'
          : 'That is a lot of rows. Asking the tool to do the arithmetic instead.');
    },
    FINISH,
  ],

  loops: [
    /* Never progresses. The identical call every turn is the point: this is
       what a model doing does when it has misunderstood the answer and has no
       way to notice. */
    () => call('total_expenses', { category: 'cloud', quarter: 'Q2' },
      'Let me get the Q2 cloud total.'),
    () => call('total_expenses', { category: 'cloud', quarter: 'Q2' },
      'Let me get the Q2 cloud total.'),
    () => call('total_expenses', { category: 'cloud', quarter: 'Q2' },
      'Let me get the Q2 cloud total.'),
    () => call('total_expenses', { category: 'cloud', quarter: 'Q2' },
      'Let me get the Q2 cloud total.'),
  ],
};

export const TASK =
  'How much did we spend on cloud in Q2, and how does that compare with Q1?';

export function resetIds() { nextId = 1; }
