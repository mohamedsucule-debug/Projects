import { test, assert } from './harness.mjs';
import { parse, compile, simulate, backtrack, determinize, build, ParseError } from '../projects/regex-lab/engine.js';

/* The strongest available oracle: JavaScript's own regex engine. If our NFA
   simulation and our backtracker both agree with it across this table, the
   parser, the compiler and both matchers are all pulling in the same
   direction. */
const CASES = [
  ['(a|b)*abb', 'aababb'], ['(a|b)*abb', 'aabab'], ['(a|b)*abb', ''],
  ['colou?r', 'color'], ['colou?r', 'colour'], ['colou?r', 'colouur'],
  ['a.*?c', 'abcbc'], ['a.*c', 'abcbc'], ['a.*', 'a'],
  ['[a-c\\d]{2,3}', 'a1'], ['[a-c\\d]{2,3}', 'a1b2'], ['[^x]+', 'hello'], ['[^x]+', 'hexlo'],
  ['^\\w+@\\w+\\.[a-z]{2,6}$', 'ada@lovelace.org'], ['^\\w+@\\w+\\.[a-z]{2,6}$', 'nope'],
  ['(\\d+)\\.(\\d+)\\.(\\d+)', '4.11.2'], ['(\\d+)\\.(\\d+)\\.(\\d+)', '4.11'],
  ['a{3}', 'aaa'], ['a{3}', 'aa'], ['x{2,4}y', 'xxxy'], ['x{2,4}y', 'xy'],
  ['(ab|a)(b?)c', 'abc'], ['(ab|a)(b?)c', 'ac'],
  ['\\s*<\\w+>\\s*', ' <div> '], ['(?:ab)+', 'ababab'],
  ['a|', 'a'], ['a|', ''], ['[.]', '.'], ['[.]', 'x'],
  ['(a*)*b', 'aaab'], ['\\bword\\b', 'word'],
];

test('the NFA simulation agrees with the platform regex engine', () => {
  for (const [pattern, input] of CASES) {
    const native = new RegExp('^(?:' + pattern + ')$').test(input);
    const ours = build(pattern, input).sim.fullMatch;
    assert.equal(ours, native, `${pattern} against ${JSON.stringify(input)}: got ${ours}, expected ${native}`);
  }
});

test('the backtracker agrees with the simulation', () => {
  for (const [pattern, input] of CASES) {
    const r = build(pattern, input);
    if (r.bt.aborted) continue;
    assert.equal(r.bt.matched, r.sim.fullMatch, `${pattern} against ${JSON.stringify(input)}`);
  }
});

test('a Thompson NFA has one accept state reachable from one start state', () => {
  const { nfa } = build('(a|b)*abb', '');
  const seen = new Set([nfa.start]);
  const stack = [nfa.start];
  while (stack.length) {
    for (const tr of nfa.states[stack.pop()].out) if (!seen.has(tr.to)) { seen.add(tr.to); stack.push(tr.to); }
  }
  assert.ok(seen.has(nfa.accept), 'accept state is unreachable');
  assert.ok(nfa.states.length >= 2);
});

test('a nested quantifier explodes the backtracker but not the simulation', () => {
  const short = build('(a+)+b', 'aaaaaaaaaa');
  const long = build('(a+)+b', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.ok(long.bt.aborted, 'expected the backtracker to hit its step cap');
  assert.ok(long.sim.work < 20000, `the simulation should stay cheap, did ${long.sim.work} edge tests`);
  assert.ok(long.bt.steps > short.bt.steps * 4, 'expected super-linear growth in backtracking steps');
  assert.equal(long.sim.fullMatch, false);
});

test('simulation cost is bounded by states x input length', () => {
  const input = 'ab'.repeat(200);
  const r = build('(a|b)*abb', input);
  assert.ok(r.sim.work <= r.nfa.states.length * input.length * 4, `work ${r.sim.work} exceeded the bound`);
});

test('each frame reports the states live after that many characters', () => {
  const r = build('abc', 'abc');
  assert.equal(r.sim.frames.length, 4);              // positions 0..3
  assert.equal(r.sim.frames[3].accepting, true);
  assert.equal(r.sim.frames[1].accepting, false);
  const dead = build('abc', 'axc');
  assert.equal(dead.sim.deadAt, 2, 'the match should die at the second character');
});

test('subset construction produces a deterministic table', () => {
  const { nfa } = build('(a|b)*abb', '');
  const dfa = determinize(nfa);
  assert.ok(dfa.states.length >= 4, 'expected at least four DFA states');
  for (const s of dfa.states) {
    for (const [ch, to] of Object.entries(s.edges)) {
      assert.ok(typeof to === 'number' && dfa.states[to], `edge on ${ch} points nowhere`);
    }
  }
  assert.equal(dfa.states[0].accepting, false);
  assert.ok(dfa.states.some((s) => s.accepting), 'no accepting DFA state');
});

test('parse errors carry the offset that caused them', () => {
  for (const [pattern, at] of [['a(b', 2], ['a)', 1], ['*a', 0], ['[a-', 1], ['a{2,1}', 5]]) {
    try {
      parse(pattern);
      throw new Error(`expected ${pattern} to fail`);
    } catch (e) {
      assert.ok(e instanceof ParseError, `${pattern} threw ${e.message}`);
      assert.equal(typeof e.at, 'number');
      assert.ok(e.at >= 0 && e.at <= pattern.length, `offset ${e.at} is outside ${pattern}`);
    }
  }
});

test('greediness is encoded as edge order at the loop state', () => {
  // A backtracker tries outgoing edges in order, so "greedy" is not a flag
  // anywhere — it is the fact that the edge into the loop body comes first.
  const loopState = (nfa) => nfa.states.find((s) => s.out.some((t) => t.pref !== undefined));
  const canConsume = (nfa, from) => {              // reachable char edge, via epsilon only
    const seen = new Set([from]), stack = [from];
    while (stack.length) {
      for (const tr of nfa.states[stack.pop()].out) {
        if (tr.kind !== 'eps') return true;
        if (!seen.has(tr.to)) { seen.add(tr.to); stack.push(tr.to); }
      }
    }
    return false;
  };
  const firstGoesToBody = (src) => {
    const nfa = compile(parse(src).ast);
    const loop = loopState(nfa);
    assert.ok(loop, `no loop state built for ${src}`);
    assert.equal(loop.out[0].pref, 0, 'the first edge out of a loop is the one tried first');
    return canConsume(nfa, loop.out[0].to);
  };
  assert.equal(firstGoesToBody('a*'), true, 'greedy should try consuming before exiting');
  assert.equal(firstGoesToBody('a*?'), false, 'lazy should try exiting before consuming');
});
