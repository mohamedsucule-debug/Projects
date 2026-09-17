/* apps/agents/harness.js — the agent loop, and the guards around it.

   The loop itself is ten lines and everybody writes it correctly the first
   time: send the conversation, get back either an answer or a request to call a
   tool, call the tool, append the result, send it again. That is the whole
   control flow.

   Everything hard about running one of these in production is in what happens
   when that goes wrong, and none of it is in the loop:

     - a tool throws, and now the model has to be told about the failure in a
       way it can act on rather than the process dying
     - a tool returns two hundred kilobytes, which will not fit and which
       nobody budgeted for
     - the model asks for a tool that does not exist, or passes the wrong
       arguments, or passes arguments of the wrong type
     - the model calls the same tool with the same arguments forever
     - the conversation grows every turn, because every turn resends all of it

   So this file is mostly guards, and each of them can be switched off on the
   page to see what the failure looks like without it. That is the honest way
   round: a harness is defined by what it survives.

   WHAT IS REAL HERE AND WHAT IS NOT. The loop, the guards, the tools, the
   message shapes and the token accounting are real — the tools genuinely run
   over a genuine dataset, and the token counts come from an actual byte-pair
   tokeniser. The MODEL is a scripted policy, because this page has no API key
   and is not going to ask you for one. The interface between the two is a
   single function, so a real model drops in behind it unchanged; see policy.js. */

export const STOP = {
  ANSWERED: 'answered',
  MAX_TURNS: 'max_turns',
  LOOPED: 'loop_detected',
  NO_TOOL: 'unknown_tool',
  BAD_ARGS: 'invalid_arguments',
  BROKE: 'unhandled_error',
};

export const DEFAULT_GUARDS = {
  /* Every one of these exists because of a specific way a run goes wrong.
     They are defaults rather than constants so the page can turn them off. */
  maxTurns: 8,
  maxResultBytes: 2000,
  validateArguments: true,
  detectLoops: true,
  catchToolErrors: true,
};

/**
 * Run the agent, yielding after every turn.
 *
 * A generator rather than a callback or a promise, because the page wants to
 * step through this one turn at a time and a loop you can pause is a loop you
 * can explain. Nothing in here is async: the tools are synchronous and the
 * policy is a function. Real ones are not, and that changes the error handling
 * and nothing else about the shape.
 */
export function* runAgent({ task, tools, policy, guards = {}, tokenCount = countChars }) {
  const g = { ...DEFAULT_GUARDS, ...guards };
  const byName = new Map(tools.map((t) => [t.name, t]));

  /* The conversation, in the shape these APIs actually use: a list of messages,
     each with a role and a list of content blocks. Tool calls and tool results
     are blocks inside messages, not a separate channel — which is why they cost
     tokens like everything else, and why a chatty tool is expensive twice. */
  const messages = [{ role: 'user', content: [{ type: 'text', text: task }] }];
  const seen = new Map();
  let turn = 0;
  let usage = { turns: 0, promptTokens: 0, toolCalls: 0, toolBytes: 0 };

  while (true) {
    if (turn >= g.maxTurns) {
      yield done(STOP.MAX_TURNS, null,
        `Stopped after ${g.maxTurns} turns. Without this the loop below would not have ended.`);
      return;
    }
    turn++;

    /* Everything is resent every turn. This is the single most surprising
       thing about the cost of an agent to anybody who has not run one: the
       conversation is stateless on the wire, so turn 8 pays for turns 1
       through 7 again. */
    const promptTokens = tokenCount(renderForModel(messages));
    usage = { ...usage, turns: turn, promptTokens: usage.promptTokens + promptTokens };

    const reply = policy({ messages, tools, turn });
    messages.push({ role: 'assistant', content: reply.content });

    const calls = reply.content.filter((b) => b.type === 'tool_use');
    if (calls.length === 0) {
      const text = reply.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      yield { turn, messages: messages.slice(), usage, promptTokens, event: 'answer', text };
      yield done(STOP.ANSWERED, text, null);
      return;
    }

    const results = [];
    for (const call of calls) {
      const outcome = invoke(call, byName, g, seen);
      usage.toolCalls++;
      usage.toolBytes += outcome.bytes;
      results.push(outcome.block);
      if (outcome.fatal) {
        messages.push({ role: 'user', content: results });
        yield { turn, messages: messages.slice(), usage, promptTokens, event: 'tool', calls, results };
        yield done(outcome.fatal, null, outcome.block.content);
        return;
      }
    }

    /* Tool results come back as a USER message. That looks wrong the first
       time and is not: from the model's point of view the world answered, and
       the world is not the assistant. */
    messages.push({ role: 'user', content: results });
    yield { turn, messages: messages.slice(), usage, promptTokens, event: 'tool', calls, results };
  }

  function done(stopReason, answer, note) {
    return { turn, messages: messages.slice(), usage, event: 'stop', stopReason, answer, note };
  }
}

/** One tool call, with every guard applied in turn. */
function invoke(call, byName, g, seen) {
  const tool = byName.get(call.name);

  if (!tool) {
    /* A model asking for a tool that does not exist is not a crash, it is a
       correctable mistake — provided you tell it what DOES exist. An error
       message that just says "unknown tool" invites it to guess again. */
    const text = `No tool called "${call.name}". Available: ${[...byName.keys()].join(', ')}.`;
    return {
      block: errorBlock(call.id, text),
      bytes: text.length,
      fatal: g.validateArguments ? null : STOP.NO_TOOL,
    };
  }

  if (g.validateArguments) {
    const problem = checkArguments(tool, call.input);
    if (problem) {
      return { block: errorBlock(call.id, problem), bytes: problem.length, fatal: null };
    }
  }

  if (g.detectLoops) {
    /* The same call, three times, means the model is not learning anything
       from the answer and will not on the fourth. This is the guard that saves
       actual money: without it a stuck agent will happily run until the turn
       limit, paying for the whole conversation every time round. */
    const key = `${call.name}:${JSON.stringify(call.input)}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n >= 3) {
      const text = `Called ${call.name} with identical arguments ${n} times. Stopping.`;
      return { block: errorBlock(call.id, text), bytes: text.length, fatal: STOP.LOOPED };
    }
  }

  let output;
  try {
    output = tool.run(call.input);
  } catch (e) {
    if (!g.catchToolErrors) {
      return { block: errorBlock(call.id, String(e.message)), bytes: 0, fatal: STOP.BROKE };
    }
    /* Handed back as a tool_result with is_error set, rather than thrown. The
       model can then apologise, pick different arguments and carry on, which
       is the entire reason an agent is more useful than a script. */
    const text = `${e.message}`;
    return { block: errorBlock(call.id, text), bytes: text.length, fatal: null };
  }

  const full = typeof output === 'string' ? output : JSON.stringify(output);
  const { text, truncated } = capResult(full, g.maxResultBytes);
  return {
    block: { type: 'tool_result', tool_use_id: call.id, content: text, truncated },
    bytes: full.length,
    fatal: null,
  };
}

function errorBlock(id, text) {
  return { type: 'tool_result', tool_use_id: id, content: text, is_error: true };
}

/**
 * Keep a tool result inside its budget.
 *
 * Cut from the MIDDLE, not the end. The beginning of a result says what it is
 * and the end usually carries the total or the conclusion; chopping the tail
 * throws away the half the model most often needs, and does it silently. The
 * marker in the middle is not decoration either — a model given a truncated
 * result and not told it was truncated will confidently report a partial
 * answer as a complete one.
 */
export function capResult(text, maxBytes) {
  if (!maxBytes || text.length <= maxBytes) return { text, truncated: false };
  const keep = Math.floor((maxBytes - 40) / 2);
  const cut = text.length - keep * 2;
  return {
    text: `${text.slice(0, keep)}\n… [${cut} characters cut] …\n${text.slice(-keep)}`,
    truncated: true,
  };
}

/** Check a tool call's arguments against the tool's declared schema. */
export function checkArguments(tool, input) {
  const schema = tool.input_schema ?? {};
  const props = schema.properties ?? {};
  const required = schema.required ?? [];

  for (const key of required) {
    if (input?.[key] === undefined) {
      return `Missing required argument "${key}" for ${tool.name}. ` +
             `Expected: ${describe(schema)}`;
    }
  }
  for (const [key, value] of Object.entries(input ?? {})) {
    const spec = props[key];
    if (!spec) {
      /* Named rather than ignored. A model that passes `filename` where the
         tool wants `path` will keep doing it until something says so. */
      return `${tool.name} has no argument "${key}". Expected: ${describe(schema)}`;
    }
    const actual = Array.isArray(value) ? 'array' : typeof value;
    const wanted = spec.type === 'integer' ? 'number' : spec.type;
    if (wanted && actual !== wanted) {
      return `Argument "${key}" of ${tool.name} should be ${spec.type}, got ${actual}.`;
    }
    if (spec.enum && !spec.enum.includes(value)) {
      return `Argument "${key}" of ${tool.name} must be one of ${spec.enum.join(', ')}; got ${JSON.stringify(value)}.`;
    }
  }
  return null;
}

function describe(schema) {
  const props = schema.properties ?? {};
  return Object.entries(props)
    .map(([k, v]) => `${k}: ${v.type}${(schema.required ?? []).includes(k) ? '' : '?'}`)
    .join(', ') || '(no arguments)';
}

/**
 * The conversation as the model would see it.
 *
 * Used for token accounting, and deliberately includes the tool definitions —
 * they are resent on every single request, and a team that writes generous
 * descriptions for twelve tools has added a fixed cost to every turn of every
 * conversation forever. That cost is invisible unless you count it.
 */
export function renderForModel(messages, tools = []) {
  const head = tools.map((t) =>
    `${t.name}: ${t.description}\n${JSON.stringify(t.input_schema)}`).join('\n');
  const body = messages.map((m) =>
    m.content.map((b) => {
      if (b.type === 'text') return b.text;
      if (b.type === 'tool_use') return `${b.name}(${JSON.stringify(b.input)})`;
      if (b.type === 'tool_result') return String(b.content);
      return '';
    }).join('\n')
  ).join('\n');
  return head ? `${head}\n${body}` : body;
}

const countChars = (s) => Math.ceil(s.length / 4);

/** Run to completion, for tests and for anything that does not want to step. */
export function runToEnd(options) {
  let last = null;
  for (const step of runAgent(options)) last = step;
  return last;
}
