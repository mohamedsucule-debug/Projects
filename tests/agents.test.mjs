/* tests/agents.test.mjs — the agent loop and the guards around it.

   The loop is the easy part and it is barely tested here. What is tested is
   every way a run goes wrong, because that is what a harness is for: a harness
   is defined by what it survives, and each of these tests is a specific thing
   that will happen in production and must not take the process with it. */

import { test, assert } from './harness.mjs';
import {
  runAgent, runToEnd, capResult, checkArguments, renderForModel, STOP, DEFAULT_GUARDS,
} from '../apps/agents/harness.js';
import { buildTools, buildExpenses, groundTruth, CATEGORIES } from '../apps/agents/tools.js';
import { scriptedPolicy, resetIds, TASK, FAULTS } from '../apps/agents/policy.js';

const tools = buildTools();
const run = (fault, guards = {}) => {
  resetIds();
  return runToEnd({ task: TASK, tools, policy: scriptedPolicy(fault), guards });
};

/* ── the tools are real, so their answers can be checked ────────────────── */

test('the dataset is the same every time', () => {
  assert.deep(buildExpenses(20).map((r) => r.id), buildExpenses(20).map((r) => r.id));
  assert.close(buildExpenses(20)[0].amount, buildExpenses(20)[0].amount, 0);
});

test('total_expenses agrees with adding it up by hand', () => {
  const rows = buildExpenses();
  const byHand = rows
    .filter((r) => r.category === 'cloud' && r.quarter === 'Q2')
    .reduce((s, r) => s + r.amount, 0);
  const viaTool = buildTools(rows).find((t) => t.name === 'total_expenses')
    .run({ category: 'cloud', quarter: 'Q2' });
  assert.close(viaTool.total, Math.round(byHand * 100) / 100, 0.011);
});

test('a category that does not exist throws rather than returning nothing', () => {
  /* "No results" and "you asked for something that cannot exist" are different
     answers, and a model that cannot tell them apart will report the first as
     a fact about the business. */
  const tool = tools.find((t) => t.name === 'total_expenses');
  assert.throws(() => tool.run({ category: 'infrastructure' }));
  assert.ok(tool.run({ category: 'cloud', quarter: 'Q4' }).lines > 0);
});

test('the error names the categories that do exist', () => {
  try {
    tools.find((t) => t.name === 'search_expenses').run({ category: 'nope' });
    throw new Error('should have thrown');
  } catch (e) {
    for (const c of CATEGORIES) assert.ok(e.message.includes(c), `error did not mention ${c}`);
  }
});

/* ── a clean run ────────────────────────────────────────────────────────── */

test('the agent answers, and the answer is arithmetically right', () => {
  const last = run('none');
  const truth = groundTruth();
  assert.equal(last.stopReason, STOP.ANSWERED);
  /* Not "it produced text" — the number in the text has to be the number in
     the ledger. An agent test that only checks it finished is checking
     nothing. */
  assert.ok(last.answer.includes(truth.q2.toLocaleString('en-US', { minimumFractionDigits: 2 })),
    `answer did not contain the Q2 total ${truth.q2}: ${last.answer}`);
  assert.ok(last.answer.includes(String(truth.percentChange)),
    `answer did not contain the percentage change ${truth.percentChange}`);
});

test('every tool result is tied to the call it answers', () => {
  /* If these ids drift apart the model is being shown answers to questions it
     did not ask, and it will not tell you — it will just be wrong later. */
  let last = null;
  resetIds();
  for (const step of runAgent({ task: TASK, tools, policy: scriptedPolicy('none') })) last = step;
  const calls = new Map(), results = new Map();
  for (const m of last.messages) {
    for (const b of m.content) {
      if (b.type === 'tool_use') calls.set(b.id, b.name);
      if (b.type === 'tool_result') results.set(b.tool_use_id, true);
    }
  }
  assert.ok(calls.size > 0, 'the clean run made no tool calls');
  for (const id of calls.keys()) assert.ok(results.has(id), `call ${id} never got a result`);
  for (const id of results.keys()) assert.ok(calls.has(id), `result ${id} answers no call`);
});

test('tool results come back as user messages, not assistant ones', () => {
  /* Counter-intuitive and load-bearing: from the model's point of view the
     world answered, and the world is not the assistant. */
  let last = null;
  resetIds();
  for (const step of runAgent({ task: TASK, tools, policy: scriptedPolicy('none') })) last = step;
  for (const m of last.messages) {
    if (m.content.some((b) => b.type === 'tool_result')) assert.equal(m.role, 'user');
    if (m.content.some((b) => b.type === 'tool_use')) assert.equal(m.role, 'assistant');
  }
});

test('the conversation only ever grows', () => {
  const lengths = [];
  resetIds();
  for (const step of runAgent({ task: TASK, tools, policy: scriptedPolicy('none') })) {
    lengths.push(step.messages.length);
  }
  for (let i = 1; i < lengths.length; i++) {
    assert.ok(lengths[i] >= lengths[i - 1], 'a turn lost messages');
  }
});

test('every turn pays for every turn before it', () => {
  /* The most surprising thing about the cost of an agent: the conversation is
     stateless on the wire, so turn 3 resends turns 1 and 2. */
  const perTurn = [];
  resetIds();
  for (const step of runAgent({ task: TASK, tools, policy: scriptedPolicy('none') })) {
    if (step.promptTokens) perTurn.push(step.promptTokens);
  }
  assert.ok(perTurn.length >= 2);
  for (let i = 1; i < perTurn.length; i++) {
    assert.ok(perTurn[i] > perTurn[i - 1], `turn ${i + 1} did not cost more than turn ${i}`);
  }
});

/* ── every way it goes wrong ────────────────────────────────────────────── */

test('a tool that throws does not end the run', () => {
  const last = run('toolThrows');
  assert.equal(last.stopReason, STOP.ANSWERED, 'the agent should have recovered and answered');
});

test('…and without that guard, it does', () => {
  const last = run('toolThrows', { catchToolErrors: false });
  assert.equal(last.stopReason, STOP.BROKE);
  assert.equal(last.usage.turns, 1, 'it should have died on the first tool call');
});

test('a tool that does not exist is answered with the ones that do', () => {
  resetIds();
  let text = null;
  for (const step of runAgent({ task: TASK, tools, policy: scriptedPolicy('unknownTool') })) {
    const err = step.results?.find((r) => r.is_error);
    if (err && !text) text = err.content;
  }
  assert.ok(text, 'no error was reported for the unknown tool');
  for (const t of tools) assert.ok(text.includes(t.name), `the error did not offer ${t.name}`);
});

test('an argument of the wrong type is caught before the tool runs', () => {
  const last = run('badArgs');
  assert.equal(last.stopReason, STOP.ANSWERED);
  const errors = last.messages.flatMap((m) => m.content.filter((b) => b.is_error));
  assert.ok(errors.length > 0, 'the bad argument was not reported');
  assert.ok(errors[0].content.includes('quarter'), 'the error did not name the argument');
});

test('a loop is stopped, and it is stopped at the third identical call', () => {
  const last = run('loops');
  assert.equal(last.stopReason, STOP.LOOPED);
  assert.ok(last.usage.turns <= 3, `took ${last.usage.turns} turns to notice`);
});

test('…and without that guard it runs until it runs out of turns', () => {
  const last = run('loops', { detectLoops: false });
  assert.equal(last.stopReason, STOP.MAX_TURNS);
  assert.equal(last.usage.turns, DEFAULT_GUARDS.maxTurns);
});

test('an oversized tool result is cut down before it reaches the conversation', () => {
  const capped = run('hugeResult');
  const uncapped = run('hugeResult', { maxResultBytes: 0 });
  assert.equal(capped.stopReason, STOP.ANSWERED);
  assert.ok(capped.usage.promptTokens < uncapped.usage.promptTokens,
    'capping results did not reduce what was sent');
});

test('the turn limit always holds, whatever else is switched off', () => {
  const last = run('loops', { detectLoops: false, maxTurns: 3 });
  assert.equal(last.usage.turns, 3);
  assert.equal(last.stopReason, STOP.MAX_TURNS);
});

test('every named fault is actually exercised by a script', () => {
  for (const id of Object.keys(FAULTS)) {
    const last = run(id);
    assert.ok(last.stopReason, `fault "${id}" produced no outcome`);
    assert.ok(last.usage.turns > 0, `fault "${id}" never ran`);
  }
});

/* ── truncation ─────────────────────────────────────────────────────────── */

test('short results are left completely alone', () => {
  const { text, truncated } = capResult('hello', 2000);
  assert.equal(text, 'hello');
  assert.equal(truncated, false);
});

test('truncation cuts the middle, keeping both ends', () => {
  /* The beginning says what the result is and the end usually carries the
     total. Chopping the tail throws away the half most often needed. */
  const body = 'START' + 'x'.repeat(5000) + 'END';
  const { text, truncated } = capResult(body, 400);
  assert.ok(truncated);
  assert.ok(text.startsWith('START'), 'lost the beginning');
  assert.ok(text.endsWith('END'), 'lost the end');
  assert.ok(text.length < body.length);
});

test('truncation says so, in the text the model will read', () => {
  /* A model handed a truncated result and not told will confidently report a
     partial answer as a complete one. */
  const { text } = capResult('y'.repeat(9000), 300);
  assert.ok(/characters cut/.test(text), `no marker in: ${text.slice(0, 80)}`);
});

test('a cap of zero means no cap', () => {
  const long = 'z'.repeat(9000);
  assert.equal(capResult(long, 0).text, long);
});

/* ── argument checking ──────────────────────────────────────────────────── */

const compare = tools.find((t) => t.name === 'compare_quarters');

test('a missing required argument is named', () => {
  const problem = checkArguments(compare, { category: 'cloud', from: 'Q1' });
  assert.ok(problem && problem.includes('to'), problem);
});

test('an argument the tool does not have is named rather than ignored', () => {
  /* A model passing `filename` where the tool wants `path` will keep doing it
     until something tells it. */
  const problem = checkArguments(compare, { category: 'cloud', from: 'Q1', to: 'Q2',月: 3 });
  assert.ok(problem && problem.includes('no argument'), problem);
});

test('the wrong type is caught', () => {
  const problem = checkArguments(compare, { category: 'cloud', from: 'Q1', to: 2 });
  assert.ok(problem && problem.includes('string'), problem);
});

test('a value outside the enum is caught, and the options are listed', () => {
  const problem = checkArguments(compare, { category: 'cloud', from: 'Q1', to: 'Q5' });
  assert.ok(problem && problem.includes('Q2'), problem);
});

test('a valid call passes', () => {
  assert.equal(checkArguments(compare, { category: 'cloud', from: 'Q1', to: 'Q2' }), null);
});

test('a tool with no arguments accepts none', () => {
  const list = tools.find((t) => t.name === 'list_categories');
  assert.equal(checkArguments(list, {}), null);
});

/* ── what the model is actually sent ────────────────────────────────────── */

test('tool definitions count towards the prompt, every single turn', () => {
  /* A team that writes generous descriptions for twelve tools has added a
     fixed cost to every turn of every conversation forever, and it is
     invisible unless you count it. */
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];
  const without = renderForModel(messages).length;
  const with_ = renderForModel(messages, tools).length;
  assert.ok(with_ > without * 3, 'the tool schemas barely registered, which cannot be right');
});
