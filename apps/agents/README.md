# Agents — the loop is easy, the failure modes are not

**[Open it](index.html)** · Step through a real tool-use loop turn by turn, then
break it on purpose and switch the guards off one at a time to see what each one
was for.

Five tools over 300 deterministic expense lines. The tools genuinely run, the
token counts come from a real byte-pair tokeniser, and the agent's answer is
checked against the ledger. [29 tests](../../tests/agents.test.mjs).

## The argument

The loop is ten lines and everybody writes it correctly the first time: send the
conversation, get back an answer or a request to call a tool, call it, append
the result, send it again.

Everything hard about running one of these is in what happens when that goes
wrong, and none of it is in the loop. A tool throws. One returns five kilobytes.
The model asks for a tool that does not exist, or passes a number where a string
goes, or calls the same thing four times in a row. The conversation grows every
turn, because every turn resends all of it.

So [`harness.js`](harness.js) is mostly guards, and each of them can be switched
off on the page. **A harness is defined by what it survives**, not by how neatly
the happy path reads.

| guard | what it prevents |
|---|---|
| validate arguments | A wrong type, a missing field, a value outside an enum — named, so the model can correct rather than guess. |
| catch tool errors | Handed back as a `tool_result` marked as an error instead of thrown. This is what lets an agent apologise, pick different arguments and carry on. |
| detect loops | The same call three times means the model is not learning from the answer and will not on the fourth. Without this a stuck agent runs to the turn limit, paying for the whole conversation every time round. |
| cap result size | Cut from the **middle**, keeping both ends, and say so. The start says what the result is; the end usually carries the total. |
| turn limit | The one that cannot be switched off. Everything else is a way of not reaching it. |

## What is real and what is not

Real: the loop, the guards, the tools, the dataset, the message shapes (content
blocks, `tool_use` ids matched to `tool_result` ids, results returning as *user*
messages), and the token accounting — which runs an actual byte-pair tokeniser
over the actual conversation text rather than dividing a length by four.

Not real: **the model**. There is no API key on this page and it is not going to
ask you for one. [`policy.js`](policy.js) is a scripted policy that emits the
same blocks a model would.

That is the right call rather than a compromise. You cannot reliably get a real
model to pass an argument of the wrong type, or to loop, at the moment you want
to show what your harness does about it. Here it is a dropdown.

And the interface between the two is one function:

```js
policy({ messages, tools, turn }) -> { content: Block[] }
```

which is the shape of a single non-streaming completion. A real model drops in
behind it without the harness knowing. **That boundary is the thing worth
designing**, and it is why it is a plain function rather than anything clever.

## The cost section

Same task, same answer, same number of turns. Pulling every row back instead of
asking the tool for a total costs **3,554 prompt tokens against 673 — 5.3×**.

The conversation is stateless on the wire, so turn four resends turns one, two
and three, plus every tool definition, every time. The cost of an agent is not
the number of turns, it is roughly the square of it, and a chatty tool is
expensive twice: once when its output arrives and again on every turn after it.

A test asserts each turn costs more than the one before, because that property is
the whole argument and it would be easy to break by accident.

## The bug worth recording

**The "a tool throws" demonstration never reached the tool.** It asked for an
expense category called `infrastructure`, and `category` is declared with an
`enum` — so argument validation rejected it before the tool ran. The error
handler the fault existed to exercise was never executed, and the page would
have been demonstrating the wrong guard under the right label.

A test caught it: switching `catchToolErrors` off was supposed to kill the run
and the run kept answering.

The fix is `get_vendor_detail`, which takes a free-form vendor name with no enum
— because vendor names are open-ended in any real ledger, so nothing in a schema
can say in advance which ones exist. That makes it the case validation *cannot*
help with, and therefore the case the runtime error handler is actually for.

**Validation catches what it can describe ahead of time. Error handling is what
is left.** Which is a better version of the point than the one I set out to make.
