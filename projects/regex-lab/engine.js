/* ─────────────────────────────────────────────────────────────────────────
   regex-lab/engine.js — a regular expression engine, from source text to
   automaton, written so every intermediate stage can be drawn on screen.

   Pipeline:  parse → AST → Thompson NFA → (a) parallel simulation
                                        → (b) backtracking search
                                        → (c) subset-construction DFA

   Nothing here touches the DOM. Everything is deterministic and testable.
   ───────────────────────────────────────────────────────────────────────── */

/* ── 1. Parser ─────────────────────────────────────────────────────────────
   Recursive descent over the classic grammar:
     alt  := cat ('|' cat)*
     cat  := rep*
     rep  := atom ( '*' | '+' | '?' | '{m,n}' ) '?'?
     atom := '(' alt ')' | '[' class ']' | '.' | '^' | '$' | escape | char
   Every node carries [from,to] source offsets so the editor can highlight
   the exact slice of pattern responsible for a step in the trace.
──────────────────────────────────────────────────────────────────────────── */

export class ParseError extends Error {
  constructor(msg, at) { super(msg); this.at = at; }
}

const CLASS_SHORTHAND = {
  d: { neg: false, ranges: [[48, 57]] },
  D: { neg: true,  ranges: [[48, 57]] },
  w: { neg: false, ranges: [[48, 57], [65, 90], [95, 95], [97, 122]] },
  W: { neg: true,  ranges: [[48, 57], [65, 90], [95, 95], [97, 122]] },
  s: { neg: false, ranges: [[9, 13], [32, 32]] },
  S: { neg: true,  ranges: [[9, 13], [32, 32]] },
};
const ESCAPE_LITERAL = { n: 10, r: 13, t: 9, f: 12, v: 11, 0: 0 };

export function parse(src) {
  let i = 0;
  let groups = 0;

  const peek = () => src[i];
  const eof = () => i >= src.length;
  const eat = (c) => { if (src[i] !== c) throw new ParseError(`expected ${c}`, i); i++; };

  function alt() {
    const from = i;
    const kids = [cat()];
    while (peek() === '|') { i++; kids.push(cat()); }
    return kids.length === 1 ? kids[0] : { t: 'alt', kids, from, to: i };
  }

  function cat() {
    const from = i;
    const kids = [];
    while (!eof() && peek() !== '|' && peek() !== ')') kids.push(rep());
    if (kids.length === 0) return { t: 'empty', from, to: i };
    return kids.length === 1 ? kids[0] : { t: 'cat', kids, from, to: i };
  }

  function rep() {
    let node = atom();
    for (;;) {
      const c = peek();
      let min, max;
      if (c === '*') { min = 0; max = Infinity; i++; }
      else if (c === '+') { min = 1; max = Infinity; i++; }
      else if (c === '?') { min = 0; max = 1; i++; }
      else if (c === '{') {
        const close = src.indexOf('}', i);
        const body = close < 0 ? null : src.slice(i + 1, close);
        if (!body || !/^\d+(,\d*)?$/.test(body)) break;   // a literal '{'
        const [a, b] = body.split(',');
        min = +a;
        max = b === undefined ? +a : b === '' ? Infinity : +b;
        if (min > max) throw new ParseError('quantifier {m,n} needs m <= n', i);
        if (max !== Infinity && max > 64) throw new ParseError('{m,n} is capped at 64 here', i);
        i = close + 1;
      } else break;
      let lazy = false;
      if (peek() === '?') { lazy = true; i++; }
      if (node.t === 'anchor') throw new ParseError('nothing to repeat', node.from);
      node = { t: 'rep', kid: node, min, max, lazy, from: node.from, to: i };
    }
    return node;
  }

  function atom() {
    const from = i;
    const c = peek();
    if (c === undefined) throw new ParseError('unexpected end of pattern', i);
    if (c === '*' || c === '+' || c === '?') throw new ParseError('nothing to repeat', i);
    if (c === '(') {
      i++;
      let idx = null;
      if (src.startsWith('?:', i)) i += 2;
      else idx = ++groups;
      const kid = alt();
      eat(')');
      return { t: 'group', kid, idx, from, to: i };
    }
    if (c === '[') return charClass();
    if (c === '.') { i++; return { t: 'any', from, to: i }; }
    if (c === '^' || c === '$') { i++; return { t: 'anchor', k: c, from, to: i }; }
    if (c === '\\') {
      i++;
      const e = src[i];
      if (e === undefined) throw new ParseError('trailing backslash', i);
      i++;
      if (CLASS_SHORTHAND[e]) return { t: 'class', ...structuredClone(CLASS_SHORTHAND[e]), src: '\\' + e, from, to: i };
      if (e === 'b' || e === 'B') return { t: 'anchor', k: e, from, to: i };
      if (ESCAPE_LITERAL[e] !== undefined) return { t: 'char', c: ESCAPE_LITERAL[e], from, to: i };
      return { t: 'char', c: e.codePointAt(0), from, to: i };
    }
    i++;
    return { t: 'char', c: c.codePointAt(0), from, to: i };
  }

  function charClass() {
    const from = i;
    eat('[');
    let neg = false;
    if (peek() === '^') { neg = true; i++; }
    const ranges = [];
    let first = true;
    while (!eof() && (peek() !== ']' || first)) {
      first = false;
      const lo = classChar();
      if (lo.ranges) { ranges.push(...(lo.neg ? invert(lo.ranges) : lo.ranges)); continue; }
      if (peek() === '-' && src[i + 1] !== ']' && i + 1 < src.length) {
        i++;
        const hi = classChar();
        if (hi.ranges) throw new ParseError('cannot use a shorthand class as a range end', i);
        if (hi.c < lo.c) throw new ParseError('range is reversed', i);
        ranges.push([lo.c, hi.c]);
      } else ranges.push([lo.c, lo.c]);
    }
    if (eof()) throw new ParseError('unterminated character class', from);
    eat(']');
    if (!ranges.length) throw new ParseError('empty character class', from);
    return { t: 'class', neg, ranges: normalize(ranges), src: src.slice(from, i), from, to: i };
  }

  function classChar() {
    if (peek() === '\\') {
      i++;
      const e = src[i]; i++;
      if (CLASS_SHORTHAND[e]) return structuredClone(CLASS_SHORTHAND[e]);
      if (ESCAPE_LITERAL[e] !== undefined) return { c: ESCAPE_LITERAL[e] };
      return { c: e.codePointAt(0) };
    }
    const c = src[i]; i++;
    return { c: c.codePointAt(0) };
  }

  const ast = alt();
  if (!eof()) throw new ParseError(`unexpected '${peek()}'`, i);
  return { ast, groups };
}

const MAXC = 0x10ffff;
function normalize(ranges) {
  const s = [...ranges].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of s) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else out.push([...r]);
  }
  return out;
}
function invert(ranges) {
  const n = normalize(ranges);
  const out = [];
  let at = 0;
  for (const [lo, hi] of n) { if (lo > at) out.push([at, lo - 1]); at = hi + 1; }
  if (at <= MAXC) out.push([at, MAXC]);
  return out;
}
const inRanges = (code, ranges) => ranges.some(([lo, hi]) => code >= lo && code <= hi);

/* ── 2. Thompson construction ──────────────────────────────────────────────
   Each AST node becomes a fragment with one entry and one exit state.
   Transitions are tagged so the renderer can label every edge honestly.
──────────────────────────────────────────────────────────────────────────── */

export function compile(ast) {
  const states = [];
  const node = () => (states.push({ id: states.length, out: [] }), states.length - 1);
  const edge = (a, b, tr) => states[a].out.push({ to: b, ...tr });

  function build(n) {
    switch (n.t) {
      case 'empty': { const s = node(); return { in: s, out: s }; }
      case 'char': {
        const a = node(), b = node();
        edge(a, b, { kind: 'char', code: n.c, label: pretty(n.c), ast: n });
        return { in: a, out: b };
      }
      case 'any': {
        const a = node(), b = node();
        edge(a, b, { kind: 'any', label: '.', ast: n });
        return { in: a, out: b };
      }
      case 'class': {
        const a = node(), b = node();
        edge(a, b, { kind: 'class', neg: n.neg, ranges: n.ranges, label: n.src || (n.neg ? '[^..]' : '[..]'), ast: n });
        return { in: a, out: b };
      }
      case 'anchor': {
        const a = node(), b = node();
        edge(a, b, { kind: 'anchor', k: n.k, label: n.k === 'b' ? '\\b' : n.k === 'B' ? '\\B' : n.k, ast: n });
        return { in: a, out: b };
      }
      case 'group': {
        const f = build(n.kid);
        return { in: f.in, out: f.out };
      }
      case 'cat': {
        let first = null, prev = null;
        for (const k of n.kids) {
          const f = build(k);
          if (first === null) first = f.in; else edge(prev, f.in, { kind: 'eps', label: 'e' });
          prev = f.out;
        }
        return { in: first, out: prev };
      }
      case 'alt': {
        const a = node(), b = node();
        for (const k of n.kids) {
          const f = build(k);
          edge(a, f.in, { kind: 'eps', label: 'e' });
          edge(f.out, b, { kind: 'eps', label: 'e' });
        }
        return { in: a, out: b };
      }
      case 'rep': {
        const { min, max, lazy } = n;
        const entry = node();
        let cur = entry;
        for (let r = 0; r < min; r++) {                    // the required copies
          const f = build(n.kid);
          edge(cur, f.in, { kind: 'eps', label: 'e' });
          cur = f.out;
        }
        const exit = node();
        if (max === Infinity) {
          const loop = node();
          edge(cur, loop, { kind: 'eps', label: 'e' });
          const f = build(n.kid);
          // The *order* of these two epsilon edges is the greedy/lazy
          // decision: a backtracker tries the first edge it is handed.
          const take = { kind: 'eps', label: 'e', pref: lazy ? 1 : 0 };
          const skip = { kind: 'eps', label: 'e', pref: lazy ? 0 : 1 };
          if (lazy) { edge(loop, exit, skip); edge(loop, f.in, take); }
          else { edge(loop, f.in, take); edge(loop, exit, skip); }
          edge(f.out, loop, { kind: 'eps', label: 'e' });
        } else {
          let chain = cur;
          const outs = [chain];
          for (let r = 0; r < max - min; r++) {
            const f = build(n.kid);
            edge(chain, f.in, { kind: 'eps', label: 'e' });
            chain = f.out;
            outs.push(chain);
          }
          for (const o of outs) edge(o, exit, { kind: 'eps', label: 'e' });
        }
        return { in: entry, out: exit };
      }
      default: throw new Error('unknown node ' + n.t);
    }
  }

  const frag = build(ast);
  return { states, start: frag.in, accept: frag.out };
}

export const pretty = (code) => {
  const map = { 10: '\\n', 13: '\\r', 9: '\\t', 32: 'SP' };
  return map[code] ?? String.fromCodePoint(code);
};

const WORD = (c) => c !== undefined && /[0-9A-Za-z_]/.test(c);

/** Does a single transition accept the character at `pos`? */
export function accepts(tr, input, pos) {
  const ch = input[pos];
  switch (tr.kind) {
    case 'eps': return { ok: true, consume: 0 };
    case 'anchor': {
      const before = pos > 0 ? input[pos - 1] : undefined;
      const after = input[pos];
      if (tr.k === '^') return { ok: pos === 0, consume: 0 };
      if (tr.k === '$') return { ok: pos === input.length, consume: 0 };
      const b = WORD(before) !== WORD(after);
      return { ok: tr.k === 'b' ? b : !b, consume: 0 };
    }
    case 'any': return { ok: ch !== undefined && ch !== '\n', consume: 1 };
    case 'char': return { ok: ch !== undefined && ch.codePointAt(0) === tr.code, consume: 1 };
    case 'class': {
      if (ch === undefined) return { ok: false, consume: 1 };
      const hit = inRanges(ch.codePointAt(0), tr.ranges);
      return { ok: tr.neg ? !hit : hit, consume: 1 };
    }
  }
  return { ok: false, consume: 0 };
}

/* ── 3a. Parallel simulation (Thompson / Pike) ──────────────────────────────
   Advance every reachable state at once. Linear in input x states, and it
   cannot blow up — which is the whole point of showing it beside (3b).
──────────────────────────────────────────────────────────────────────────── */

export function simulate(nfa, input) {
  const closure = (seed, pos) => {
    const set = new Set(), stack = [...seed], eps = [];
    while (stack.length) {
      const s = stack.pop();
      if (set.has(s)) continue;
      set.add(s);
      for (const tr of nfa.states[s].out) {
        if (tr.kind === 'eps' || tr.kind === 'anchor') {
          if (accepts(tr, input, pos).ok && !set.has(tr.to)) { stack.push(tr.to); eps.push([s, tr.to]); }
        }
      }
    }
    return { set, eps };
  };

  const frames = [];
  let { set: cur, eps } = closure([nfa.start], 0);
  let work = 0;
  frames.push({ pos: 0, states: [...cur].sort((a, b) => a - b), eps, took: [], accepting: cur.has(nfa.accept) });

  for (let pos = 0; pos < input.length; pos++) {
    const next = [], took = [];
    for (const s of cur) {
      for (const tr of nfa.states[s].out) {
        work++;
        if (tr.kind === 'eps' || tr.kind === 'anchor') continue;
        if (accepts(tr, input, pos).ok) { next.push(tr.to); took.push([s, tr.to, tr.label]); }
      }
    }
    const cl = closure(next, pos + 1);
    cur = cl.set;
    frames.push({
      pos: pos + 1, states: [...cur].sort((a, b) => a - b),
      eps: cl.eps, took, accepting: cur.has(nfa.accept), consumed: input[pos],
    });
    if (!cur.size) break;
  }

  const last = frames[frames.length - 1];
  return {
    frames,
    work,
    fullMatch: last.pos === input.length && last.accepting,
    longestPrefix: frames.reduce((best, f) => (f.accepting ? f.pos : best), -1),
    deadAt: last.states.length === 0 ? last.pos : null,
  };
}

/* ── 3b. Backtracking search ────────────────────────────────────────────────
   The algorithm shipped in PCRE, Python's re, and JavaScript's own RegExp:
   depth-first, greedy by default. Same language, same answers — and on a
   nested quantifier it costs exponential time. `steps` is the receipt.
──────────────────────────────────────────────────────────────────────────── */

export function backtrack(ast, input, { cap = 200000, traceCap = 500 } = {}) {
  let steps = 0, aborted = false, peakDepth = 0;
  const trace = [];
  const note = (node, pos, act, depth) => {
    if (trace.length < traceCap) trace.push({ node, pos, act, depth, step: steps });
  };

  function m(node, pos, depth, k) {
    if (aborted) return false;
    if (++steps > cap) { aborted = true; return false; }
    if (depth > peakDepth) peakDepth = depth;
    switch (node.t) {
      case 'empty': return k(pos);
      case 'char': {
        const ok = input[pos] !== undefined && input[pos].codePointAt(0) === node.c;
        note(node, pos, ok ? 'consume' : 'fail', depth);
        return ok ? k(pos + 1) : false;
      }
      case 'any': {
        const ok = input[pos] !== undefined && input[pos] !== '\n';
        note(node, pos, ok ? 'consume' : 'fail', depth);
        return ok ? k(pos + 1) : false;
      }
      case 'class': {
        const ch = input[pos];
        const hit = ch !== undefined && inRanges(ch.codePointAt(0), node.ranges);
        const ok = ch !== undefined && (node.neg ? !hit : hit);
        note(node, pos, ok ? 'consume' : 'fail', depth);
        return ok ? k(pos + 1) : false;
      }
      case 'anchor': {
        const ok = accepts({ kind: 'anchor', k: node.k }, input, pos).ok;
        note(node, pos, ok ? 'assert' : 'fail', depth);
        return ok ? k(pos) : false;
      }
      case 'group': return m(node.kid, pos, depth + 1, k);
      case 'cat': {
        const go = (idx, p) => (idx === node.kids.length ? k(p) : m(node.kids[idx], p, depth + 1, (np) => go(idx + 1, np)));
        return go(0, pos);
      }
      case 'alt': {
        for (const kid of node.kids) {
          note(kid, pos, 'try', depth);
          if (m(kid, pos, depth + 1, k)) return true;
          note(kid, pos, 'backtrack', depth);
        }
        return false;
      }
      case 'rep': {
        const { min, max, lazy } = node;
        const rec = (count, p) => {
          if (aborted) return false;
          const more = () => count < max && m(node.kid, p, depth + 1, (np) => (np === p ? false : rec(count + 1, np)));
          const stop = () => count >= min && k(p);
          if (lazy) { note(node, p, 'lazy', depth); return stop() || more(); }
          note(node, p, 'greedy', depth);
          return more() || stop();
        };
        return rec(0, pos);
      }
    }
    return false;
  }

  const matched = m(ast, 0, 0, (pos) => pos === input.length);
  return { matched, steps, aborted, peakDepth, trace };
}

/* ── 3c. Subset construction ───────────────────────────────────────────────
   Determinize over *character classes* rather than every code point: the
   pattern's own literals and class boundaries partition the alphabet, so a
   handful of representative characters is enough to build the table.
──────────────────────────────────────────────────────────────────────────── */

export function determinize(nfa, { maxStates = 400 } = {}) {
  const reps = new Set([' ']);
  for (const st of nfa.states) {
    for (const tr of st.out) {
      if (tr.kind === 'char') reps.add(String.fromCodePoint(tr.code));
      if (tr.kind === 'class') for (const [lo, hi] of tr.ranges) {
        if (lo <= MAXC) reps.add(String.fromCodePoint(lo));
        if (hi <= MAXC) reps.add(String.fromCodePoint(hi));
      }
      if (tr.kind === 'any') reps.add('x');
    }
  }
  const alphabet = [...reps].filter((c) => c.codePointAt(0) >= 32).sort();
  // A DFA state is a position-free object, so a zero-width assertion has no
  // home in this table. We follow assertions as epsilon and say so out loud:
  // the table then describes the pattern's *shape*, and the NFA simulation
  // (which does know the cursor position) stays the source of truth.
  let anchorsApproximated = false;
  const closure = (seed) => {
    const set = new Set(), stack = [...seed];
    while (stack.length) {
      const s = stack.pop();
      if (set.has(s)) continue;
      set.add(s);
      for (const tr of nfa.states[s].out) {
        if (tr.kind === 'eps') stack.push(tr.to);
        else if (tr.kind === 'anchor') { anchorsApproximated = true; stack.push(tr.to); }
      }
    }
    return [...set].sort((a, b) => a - b);
  };
  const key = (arr) => arr.join(',');
  const start = closure([nfa.start]);
  const table = new Map([[key(start), { id: 0, nfa: start, edges: {} }]]);
  const order = [table.get(key(start))];
  let truncated = false;

  for (let qi = 0; qi < order.length; qi++) {
    const q = order[qi];
    for (const ch of alphabet) {
      const next = [];
      for (const s of q.nfa) for (const tr of nfa.states[s].out) {
        if (tr.kind === 'eps' || tr.kind === 'anchor') continue;
        if (accepts(tr, ch, 0).ok) next.push(tr.to);
      }
      if (!next.length) continue;
      const cl = closure(next), k = key(cl);
      if (!table.has(k)) {
        if (table.size >= maxStates) { truncated = true; continue; }
        const st = { id: table.size, nfa: cl, edges: {} };
        table.set(k, st);
        order.push(st);
      }
      q.edges[ch] = table.get(k).id;
    }
  }
  return {
    states: order.map((s) => ({ id: s.id, nfa: s.nfa, edges: s.edges, accepting: s.nfa.includes(nfa.accept) })),
    alphabet,
    truncated,
    anchorsApproximated,
  };
}

/** One call for the UI: source text in, every stage out (or a parse error). */
export function build(pattern, input) {
  const { ast, groups } = parse(pattern);
  const nfa = compile(ast);
  return {
    ast, groups, nfa,
    sim: simulate(nfa, input),
    bt: backtrack(ast, input),
    dfa: determinize(nfa),
  };
}
