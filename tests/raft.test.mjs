import { test, assert } from './harness.mjs';
import { Cluster, run, CFG } from '../projects/raft-lab/engine.js';

const settled = (seed = 7, ms = 9000) => run(new Cluster(5, seed), ms);
const allChecksPass = (c) => c.check().every((k) => k.ok);
const leaderOf = (c) => c.nodes.find((n) => n.role === 'leader' && n.alive);

test('a cluster elects exactly one leader', () => {
  for (const seed of [1, 7, 42, 1234, 99999]) {
    const c = settled(seed);
    const leaders = c.nodes.filter((n) => n.role === 'leader');
    assert.equal(leaders.length, 1, `seed ${seed} produced ${leaders.length} leaders`);
    assert.ok(leaders[0].term >= 1);
  }
});

test('entries accepted by the leader commit on every node', () => {
  const c = settled();
  run(c, 400, [{ at: c.now + 10, do: (x) => { x.client('a'); x.client('b'); x.client('c'); } }]);
  run(c, 4000);
  for (const n of c.nodes) {
    assert.deep(n.log.map((e) => e.value), ['a', 'b', 'c'], `s${n.id} has the wrong log`);
    assert.equal(n.commitIndex, 3, `s${n.id} committed ${n.commitIndex} of 3`);
  }
});

test('a write to an isolated leader never commits', () => {
  const c = settled();
  run(c, 3000, [{ at: c.now + 10, do: (x) => x.client('committed') }]);
  const old = leaderOf(c).id;
  c.setPartition(old, 1);
  c.setPartition((old + 1) % 5, 1);
  run(c, 9000, [{ at: c.now + 600, do: (x) => x.clientTo(old, 'ghost') }]);

  const isolated = c.nodes[old];
  assert.ok(isolated.log.some((e) => e.value === 'ghost'), 'the isolated leader should still accept the write');
  assert.equal(isolated.commitIndex, 1, 'but it must never commit it — it has no quorum');
  const majority = c.nodes.filter((n) => n.partition === 0);
  for (const n of majority) assert.ok(!n.log.some((e) => e.value === 'ghost'), `s${n.id} should never have seen it`);
  assert.ok(allChecksPass(c), 'safety invariants must hold across a partition');
});

test('the majority side elects a new leader in a higher term', () => {
  const c = settled();
  const old = leaderOf(c).id;
  const oldTerm = c.nodes[old].term;
  c.setPartition(old, 1);
  c.setPartition((old + 1) % 5, 1);
  run(c, 12000);
  const majorityLeader = c.nodes.find((n) => n.partition === 0 && n.role === 'leader');
  assert.ok(majorityLeader, 'the majority should have elected someone');
  assert.ok(majorityLeader.term > oldTerm, 'the new leader must hold a higher term');
  assert.ok(allChecksPass(c));
});

test('an uncommitted tail is overwritten once the network heals', () => {
  const c = settled();
  run(c, 3000, [{ at: c.now + 10, do: (x) => { x.client('a'); x.client('b'); } }]);
  const old = leaderOf(c).id;
  c.setPartition(old, 1);
  c.setPartition((old + 1) % 5, 1);
  run(c, 9000, [{ at: c.now + 600, do: (x) => x.clientTo(old, 'ghost') }]);
  c.healPartitions();
  run(c, 12000, [{ at: c.now + 3000, do: (x) => x.client('real') }]);

  const logs = c.nodes.map((n) => n.log.map((e) => e.value).join(','));
  assert.equal(new Set(logs).size, 1, `logs diverged: ${JSON.stringify(logs)}`);
  assert.ok(logs[0].endsWith('real'), `expected the new write to land, got ${logs[0]}`);
  assert.ok(allChecksPass(c));
});

test('a minority cannot make progress at all', () => {
  const c = settled();
  for (const id of [0, 1, 2]) c.kill(id);
  const before = Math.max(...c.nodes.map((n) => n.commitIndex));
  run(c, 12000, [{ at: c.now + 2000, do: (x) => x.client('doomed') }]);
  const after = Math.max(...c.nodes.map((n) => n.commitIndex));
  assert.equal(after, before, 'two of five nodes must not be able to commit anything');
  assert.ok(allChecksPass(c));
});

test('the cluster recovers after the leader crashes', () => {
  const c = settled();
  run(c, 2000, [{ at: c.now + 10, do: (x) => x.client('before') }]);
  const old = leaderOf(c).id;
  c.kill(old);
  run(c, 12000, [{ at: c.now + 5000, do: (x) => x.client('after') }]);
  const fresh = leaderOf(c);
  assert.ok(fresh && fresh.id !== old, 'a surviving node should have taken over');
  const survivors = c.nodes.filter((n) => n.alive);
  for (const n of survivors) {
    assert.ok(n.log.some((e) => e.value === 'after'), `s${n.id} is missing the post-crash write`);
  }
  assert.ok(survivors.every((n) => n.commitIndex >= 2), 'both writes should be committed');
});

test('safety invariants hold at every tick of a chaotic run', () => {
  const c = new Cluster(5, 31);
  const script = [
    { at: 4000, do: (x) => x.client('a') },
    { at: 6000, do: (x) => x.setPartition(0, 1) },
    { at: 6100, do: (x) => x.setPartition(1, 1) },
    { at: 9000, do: (x) => x.client('b') },
    { at: 14000, do: (x) => x.kill(2) },
    { at: 19000, do: (x) => x.healPartitions() },
    { at: 21000, do: (x) => x.revive(2) },
    { at: 26000, do: (x) => x.client('c') },
  ];
  const pending = [...script];
  let violations = 0;
  while (c.now < 40000) {
    while (pending.length && pending[0].at <= c.now) pending.shift().do(c);
    c.tick(20);
    if (!allChecksPass(c)) violations++;
  }
  assert.equal(violations, 0, `${violations} ticks violated a safety property`);
  // and it should still be a working cluster afterwards
  assert.ok(leaderOf(c), 'no leader after the chaos');
});

test('the same seed and script replay identically', () => {
  const script = [{ at: 3000, do: (x) => x.client('x') }, { at: 5000, do: (x) => x.kill(1) }];
  const a = run(new Cluster(5, 5150), 15000, script.map((s) => ({ ...s })));
  const b = run(new Cluster(5, 5150), 15000, script.map((s) => ({ ...s })));
  assert.deep(a.snapshot(), b.snapshot(), 'a seeded run must be reproducible');
  assert.deep(a.events.map((e) => e.text), b.events.map((e) => e.text));
});

test('election timeouts are randomised, so split votes resolve', () => {
  const c = new Cluster(5, 3);
  const timeouts = new Set(c.nodes.map((n) => n.electionAt.toFixed(3)));
  assert.equal(timeouts.size, 5, 'every node should draw its own timeout');
  for (const n of c.nodes) {
    assert.ok(n.electionAt >= CFG.electionMin && n.electionAt <= CFG.electionMax);
  }
});
