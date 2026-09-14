/* ───────────────────────────────────────────────────────────────────────────
   briefings.js — what each tool is, in words anyone can follow.

   Six of the things in this repo show something genuinely hard to picture:
   what a database is thinking, why a cluster of servers disagrees, where a
   slow page actually spent its time. A clever visualisation of a subject you
   have never heard of is just a prettier kind of confusing, so each one
   carries a briefing: one sentence, then what is on screen, then why anyone
   cares, then how it works underneath.

   These live in one file rather than in each page because the front page
   describes the same six tools. Two copies of an explanation drift apart
   within a month; one copy cannot.

   House rules for writing them, which took a couple of attempts to get right:
     - no jargon in the first sentence, ever
     - say what it is FOR before saying how it works
     - name the limits honestly; every one of these is a model, not the thing
   ─────────────────────────────────────────────────────────────────────────── */

export const BRIEFINGS = {

  /* ─────────────────────────────────────────────────────────────────────── */
  'regex-lab': {
    key: 'regex-lab',
    title: 'Regex Lab',
    href: 'projects/regex-lab/index.html',
    colour: '#4dd6ff',
    tagline: 'A search pattern, compiled into a machine you can watch run.',
    plain: `A "regular expression" is the search pattern behind every find-and-replace box
            you have ever used — the thing that decides whether an email address looks valid.
            This takes one apart and runs it a character at a time, so you can see the decision
            being made instead of just getting a yes or no.`,
    sections: [
      {
        h: 'In one sentence',
        p: 'A search pattern is turned into a little machine, and you get to watch that machine read your text one letter at a time.',
      },
      {
        h: 'What you are looking at',
        p: [
          'The box at the top is the <b>pattern</b> — a compact way of describing a shape of text, like "some letters, then an @, then some more letters". Underneath it is the text being searched.',
          'The diagram is that pattern rebuilt as a map of states with arrows between them. A marker moves through the map as each character is read. Where several arrows are possible at once, several markers move at once.',
        ],
      },
      {
        h: 'Why this matters',
        p: [
          'Patterns like these run on nearly every website, usually on whatever a stranger just typed into a form. Most of the time that is fine. Occasionally it is not.',
          'There is a famous failure where a pattern that looks harmless takes an <b>exponential</b> amount of time on a short, deliberately-chosen input — a few dozen characters can occupy a server for hours. Sites have been taken offline by it. One of the presets here is exactly that pattern, so you can watch the step counter explode and see precisely where the time goes.',
        ],
      },
      {
        h: 'How it works',
        p: [
          'The pattern is parsed into a tree, then the tree is turned into a state machine by a construction from 1968 that is still the standard way to do it.',
          'Then the same pattern is run two different ways against the same text. One tries a possibility, and when it fails, backs up and tries the next — simple, and the source of that exponential blow-up. The other keeps <b>every</b> live possibility in play simultaneously, which cannot blow up but cannot support some conveniences either. Running both side by side is the point: the step counters diverge in front of you.',
        ],
      },
      {
        h: 'The honest limits',
        p: 'This implements the classic core — characters, groups, alternatives, repetition, character classes, anchors. It deliberately leaves out back-references and look-around, because those are the features that make the fast method impossible, and pretending otherwise would undercut the whole comparison.',
      },
    ],
  },

  /* ─────────────────────────────────────────────────────────────────────── */
  'query-planner': {
    key: 'query-planner',
    title: 'Query Planner',
    href: 'projects/query-planner/index.html',
    colour: '#a78bfa',
    tagline: 'A database deciding how to answer a question, with its reasoning attached.',
    plain: `When you ask a database a question, it has to choose <i>how</i> to go and get the
            answer — and the choices differ by factors of thousands. This shows the decision
            being made. Drag a table's size and watch it change its mind.`,
    sections: [
      {
        h: 'In one sentence',
        p: 'You write a question; this shows you the plan the database would make to answer it, and the arithmetic behind every step of that plan.',
      },
      {
        h: 'What you are looking at',
        p: [
          'On the left is a question written in SQL, the language databases speak. On the right is the <b>plan</b>: a tree, read bottom to top, of the steps it would actually perform. Read every row of this table. Match it against that one. Sort the result. Keep the first ten.',
          'Every step carries two numbers: how many rows it expects to produce, and what it expects that to cost. Hover any of them and the workings appear.',
        ],
      },
      {
        h: 'Why this matters',
        p: [
          'This is the single most common reason a website is slow. The same question, answered two different ways, can differ by a factor of a thousand — and nothing in the question itself tells you which way you got.',
          'The database is guessing, using statistics it keeps about your data: how many rows are in each table, how many different values a column has. When those guesses are good the plan is good. When they are stale the plan can be catastrophic, and the query that ran in 20ms yesterday takes 40 seconds today with nothing having changed in the code.',
        ],
      },
      {
        h: 'Try this',
        p: 'Drag a table\'s row count. At a few hundred rows it will happily look things up one at a time. Push it past a certain size and the plan flips to a completely different strategy — because building an index in memory once finally beats doing a million small lookups. Watching that threshold arrive is the whole idea.',
      },
      {
        h: 'How it works',
        p: [
          'It costs every possible ordering of the tables and keeps the cheapest, building up from pairs — the approach IBM published in 1979 and essentially everything has used since. The cost model prices a random disk read at four times a sequential one, as PostgreSQL does, and those constants are shown on screen rather than hidden.',
          'A note on why the reasoning is displayed and not just the answer: an early version of this keyed its table scans by table name while keying its estimates by alias. Every filter silently fell back to a default guess, and it produced plans that looked entirely plausible. A number on its own is unfalsifiable; a number with its derivation attached is not.',
        ],
      },
    ],
  },

  /* ─────────────────────────────────────────────────────────────────────── */
  'raft-lab': {
    key: 'raft-lab',
    title: 'Raft Lab',
    href: 'projects/raft-lab/index.html',
    colour: '#4ade80',
    tagline: 'Five servers agreeing with each other. Break the network and watch them cope.',
    plain: `Important data is kept on several machines at once, so that losing one does not
            lose the data. But then the machines have to agree on what the data <i>is</i> —
            which is far harder than it sounds. Here are five of them. You can cut the network
            in half and crash the one in charge, and watch them recover.`,
    sections: [
      {
        h: 'In one sentence',
        p: 'Five servers keeping identical copies of a list, staying in agreement even while you actively sabotage them.',
      },
      {
        h: 'What you are looking at',
        p: [
          'Each circle is a server. One of them is the <b>leader</b> — the only one allowed to accept changes. The others follow it, copying its list.',
          'Lines between the circles are messages in flight. The bars underneath are each server\'s copy of the list, so you can see a change spread outwards from the leader and watch the copies line up.',
        ],
      },
      {
        h: 'Why this matters',
        p: [
          'Anything that must not lose your data — a bank ledger, an order, the configuration a whole company runs on — is stored this way. The hard part is not storing it several times. The hard part is that networks lose messages, machines die mid-sentence, and two servers can each be convinced they are in charge.',
          'The guarantee being demonstrated is narrow and absolute: <b>once a change is confirmed, no sequence of failures can ever make it disappear or be replaced by a different one.</b> Not "usually". Ever. That is what lets a database promise your money was moved.',
        ],
      },
      {
        h: 'Try this',
        p: 'Crash the leader. The others will notice it has gone quiet, wait a random amount of time, and hold an election — the randomness is what stops them all nominating themselves at once forever. Then cut the network in two. The side with fewer than half the servers will refuse to accept changes, which looks like a failure and is in fact the entire safety mechanism working.',
      },
      {
        h: 'How it works',
        p: [
          'This is Raft, a consensus algorithm published in 2014 explicitly because the previous standard was so notoriously hard to understand. It runs on a fake clock that ticks in fixed steps from a fixed seed, so the same run with the same interventions plays out identically every time.',
          'That determinism is what makes the invariant checker meaningful: the safety rules are re-checked at every single tick, and a violation would stop the run and say which rule broke. Otherwise it would be decoration.',
        ],
      },
      {
        h: 'The honest limits',
        p: 'Election timeouts here are stretched to a second or two. Real ones are 150–300 milliseconds — correct, and far too fast to watch.',
      },
    ],
  },

  /* ─────────────────────────────────────────────────────────────────────── */
  'trace-explorer': {
    key: 'trace-explorer',
    title: 'Trace Explorer',
    href: 'projects/trace-explorer/index.html',
    colour: '#fb7185',
    tagline: 'Where a slow request actually spent its time, in sentences instead of charts.',
    plain: `One click on a website can touch a dozen separate services behind the scenes.
            When the page takes four seconds, which of them is to blame? This takes the
            timing records and answers that question in a sentence, rather than handing you
            a chart and wishing you luck.`,
    sections: [
      {
        h: 'In one sentence',
        p: 'A slow web request, broken down into which piece of the system was actually responsible for the delay.',
      },
      {
        h: 'What you are looking at',
        p: [
          'Every horizontal bar is one piece of work — a service calling another service, a database query, a cache lookup. Bars are nested: something that sits underneath another thing happened as part of it. Length is time.',
          'The highlighted path is the <b>critical path</b>: the specific chain of work that determined the total. Everything else happened alongside it and could have been instant without the page loading any faster.',
        ],
      },
      {
        h: 'Why this matters',
        p: [
          'The instinct when something is slow is to optimise whatever looks biggest. That is usually wrong. If six things run at the same time and one takes 900ms, making the other five twice as fast saves you nothing at all.',
          'The critical path is the answer to "what would actually help", and it is the thing a wall of coloured bars is worst at showing you.',
        ],
      },
      {
        h: 'How it works',
        p: [
          'It works backwards from the end of the request, at each step asking which child was the one still running when its parent finished. It also computes "self time" — how long a piece of work took that was not spent waiting for something it called — which is what separates a slow database from a service that is merely waiting on one.',
          'The analysis never looks at how these traces were generated. It only sees the shape of the timings, exactly as it would against real telemetry, so a problem has to be <i>discovered</i> rather than read off a label.',
        ],
      },
      {
        h: 'A bug worth mentioning',
        p: 'The first version double-counted time whenever two pieces of work overlapped, and reported critical paths adding up to more than the request took. It now emits segments that tile the request exactly — no gaps, no overlaps — and a test asserts that. Plausible-looking numbers are the dangerous kind.',
      },
    ],
  },

  /* ─────────────────────────────────────────────────────────────────────── */
  'diff-forge': {
    key: 'diff-forge',
    title: 'Diff Forge',
    href: 'projects/diff-forge/index.html',
    colour: '#fbbf24',
    tagline: 'How software works out what changed — and where it gives up and asks you.',
    plain: `When two people edit the same document, something has to work out what each of
            them changed and combine it. Usually that works silently. Occasionally it stops
            and says "merge conflict", which is the screen programmers hate most. This shows
            what is actually happening in both cases.`,
    sections: [
      {
        h: 'In one sentence',
        p: 'Two versions of a document go in; what changed, and whether two sets of changes can be safely combined, comes out.',
      },
      {
        h: 'What you are looking at',
        p: [
          'Two panes of text, and the differences between them worked out live as you type in either one. Both are editable — change anything and everything recalculates.',
          'The three-way view adds a third pane: the version both people <b>started</b> from. That is the piece that makes automatic merging possible at all, and it is the piece most people have never seen.',
        ],
      },
      {
        h: 'Why this matters',
        p: [
          'This runs every time anyone saves code anywhere. Getting it wrong does not produce an error — it produces a file that looks fine and has silently lost somebody\'s work.',
          'A conflict is not a malfunction. It is the tool correctly refusing to guess: you both changed the same lines, differently, and no amount of cleverness can determine which of you meant it.',
        ],
      },
      {
        h: 'Two ways of doing it',
        p: [
          'The classic method finds the smallest possible set of changes that turns one text into the other. Mathematically optimal, and it sometimes produces nonsense — it will happily match up every stray closing bracket in a file because that is technically fewer edits.',
          'The other method first finds lines that appear <b>exactly once</b> in both texts and treats those as fixed anchors, then works on the gaps between them. Often a larger set of changes, and almost always the one a human would have written. You can switch between them and see the difference on the same input.',
        ],
      },
    ],
  },

  /* ─────────────────────────────────────────────────────────────────────── */
  'oklch-studio': {
    key: 'oklch-studio',
    title: 'OKLCH Studio',
    href: 'projects/oklch-studio/index.html',
    colour: '#f472b6',
    tagline: 'Building a colour palette that survives contact with an accessibility checker.',
    plain: `Picking colours for a product sounds like a matter of taste, and mostly is not.
            The maths computers have used for colour since the 1990s does not match how eyes
            work, which is why palettes look uneven and why text sometimes fails a
            readability check for no obvious reason. This builds palettes in newer maths that
            does match, and audits every combination as you go.`,
    sections: [
      {
        h: 'In one sentence',
        p: 'A tool for building a set of colours that look evenly spaced to a human, and checking that text on them is actually readable.',
      },
      {
        h: 'What you are looking at',
        p: [
          'A grid of swatches: each row is one colour family, running from very light to very dark. Below, every pairing of text colour and background colour is scored for readability, with the failures called out.',
          'Change a hue or a vividness and the whole grid rebuilds, re-audited.',
        ],
      },
      {
        h: 'Why this matters',
        p: [
          'The usual way of describing colour to a computer is three numbers for red, green and blue. Those numbers do not correspond to what you see: pure yellow and pure blue are the same "brightness" arithmetically and wildly different to an eye. Build a palette that way and it comes out lumpy, with some steps invisible and others jarring.',
          'It also matters legally. Public sector services in the UK and EU are required to meet a contrast standard, and "it looked fine to me" is not a defence. Roughly one in twelve men has some form of colour vision deficiency.',
        ],
      },
      {
        h: 'How it works',
        p: [
          'Colours are generated in OKLCH, a way of describing colour built to match human perception — a step in lightness looks like a step in lightness. Screens cannot display everything that space can describe, so anything out of reach is pulled back to the nearest displayable colour by narrowing in on the boundary, and the tool reports how much vividness that cost rather than silently clipping.',
          'Contrast is then scored two ways: the official WCAG ratio that audits are run against, and APCA, a newer measure that handles dark backgrounds far better. They disagree, sometimes sharply, and both are shown because pretending there is one right answer here would be a lie.',
        ],
      },
    ],
  },
};

/** The six, in the order they should be presented. */
export const BRIEFING_ORDER = [
  'regex-lab', 'query-planner', 'raft-lab', 'trace-explorer', 'diff-forge', 'oklch-studio',
];
