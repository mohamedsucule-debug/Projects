import { test, assert } from './harness.mjs';
import { generate, summarize, findings, criticalPath, criticalSpans, absolutize, selfTime, percentile, rankOf } from '../projects/trace-explorer/engine.js';

const traces = generate(200, 11);

test('generation is deterministic for a seed', () => {
  const a = generate(30, 4).map((t) => t.duration.toFixed(6)).join();
  const b = generate(30, 4).map((t) => t.duration.toFixed(6)).join();
  assert.equal(a, b);
  assert.ok(generate(30, 5).map((t) => t.duration.toFixed(6)).join() !== a, 'a different seed should differ');
});

test('every span tree is well formed', () => {
  for (const t of traces) {
    assert.equal(t.root.parent, null, `${t.id} has a parented root`);
    assert.equal(t.spans.filter((s) => s.parent === null).length, 1, `${t.id} has more than one root`);
    for (const s of t.spans) {
      assert.ok(s.dur >= 0, `${t.id}/${s.op} has negative duration`);
      if (s.parent) {
        const p = t.byId.get(s.parent);
        assert.ok(p, `${s.id} points at a missing parent`);
        assert.ok(s.start >= -1e-9, `${s.id} starts before its parent`);
        assert.ok(s.start + s.dur <= p.dur + 1e-6, `${s.id} outlives its parent`);
      }
    }
  }
});

test('self time never exceeds duration and never goes negative', () => {
  for (const t of traces) {
    for (const s of t.spans) {
      const self = selfTime(s);
      assert.ok(self >= -1e-9, `${s.id} has negative self time`);
      assert.ok(self <= s.dur + 1e-9, `${s.id} has more self time than duration`);
    }
  }
});

test('self time subtracts the union of children, not their sum', () => {
  // two children that overlap completely should only be subtracted once
  const span = {
    dur: 100, start: 0,
    children: [{ start: 10, dur: 50, children: [] }, { start: 20, dur: 30, children: [] }],
  };
  assert.close(selfTime(span), 50, 1e-9);
});

test('the critical path tiles the trace exactly', () => {
  // The property that makes the path meaningful: its segments cover the whole
  // trace, edge to edge, with no gaps and no double counting.
  for (const t of traces) {
    const segs = [...criticalPath(t)].sort((a, b) => a.from - b.from);
    const total = segs.reduce((sum, s) => sum + (s.to - s.from), 0);
    assert.close(total, t.duration, 1e-6,
      `${t.id}: segments cover ${total.toFixed(4)}ms of a ${t.duration.toFixed(4)}ms trace`);
    assert.close(segs[0].from, 0, 1e-6, `${t.id} does not start at the trace start`);
    for (let i = 1; i < segs.length; i++) {
      assert.close(segs[i].from, segs[i - 1].to, 1e-6, `${t.id} has a gap or overlap at segment ${i}`);
    }
  }
});

test('the critical path attributes time to real spans, root included', () => {
  for (const t of traces) {
    const spans = criticalSpans(t);
    assert.ok(spans.some((c) => c.span.id === t.root.id), `${t.id} lost its root`);
    for (const c of spans) {
      assert.ok(t.byId.has(c.span.id), `${t.id} cites a span that is not in the trace`);
      assert.ok(c.time > 0 && c.time <= t.duration + 1e-9, `${c.span.op} was attributed ${c.time}ms`);
    }
  }
});

test('absolute timings are consistent and inside the trace', () => {
  for (const t of traces.slice(0, 40)) {
    const abs = absolutize(t);
    assert.equal(abs.get(t.root.id), 0);
    for (const s of t.spans) {
      const start = abs.get(s.id);
      assert.ok(start >= -1e-9 && start + s.dur <= t.duration + 1e-6, `${s.id} falls outside the trace`);
    }
  }
});

test('no finding claims more of a trace than exists', () => {
  for (const t of traces) {
    for (const f of findings(t)) {
      assert.ok(f.share >= 0 && f.share <= 1.0001, `"${f.title}" claims ${(f.share * 100).toFixed(0)}% of ${t.id}`);
      assert.ok(f.spans.length > 0, `"${f.title}" cites no spans`);
      for (const id of f.spans) assert.ok(t.byId.has(id), `"${f.title}" cites a span not in the trace`);
    }
  }
});

test('sequential repetition is detected and parallel fan-out is not mistaken for it', () => {
  const all = traces.flatMap((t) => findings(t));
  const sequential = all.filter((f) => /sequential calls/.test(f.title));
  const parallel = all.filter((f) => /parallel calls/.test(f.title));
  assert.ok(sequential.length > 0, 'the N+1 pathology should be found in this sample');
  assert.ok(parallel.length > 0, 'the benign fan-out should be recognised too');
  assert.ok(sequential.some((f) => f.severity === 'high'), 'a large N+1 should be high severity');
  assert.ok(parallel.every((f) => f.severity === 'info'), 'overlapping calls are not a defect');
});

test('a retry is reported with the cost of both attempts', () => {
  const retry = traces.flatMap((t) => findings(t)).find((f) => /retry/.test(f.title));
  assert.ok(retry, 'no retry found in this sample');
  assert.equal(retry.severity, 'high');
  assert.equal(retry.spans.length, 2);
});

test('percentiles are ordered and bounded by the data', () => {
  const s = summarize(traces);
  assert.ok(s.p50 <= s.p95 && s.p95 <= s.p99 && s.p99 <= s.max);
  assert.equal(s.n, traces.length);
  assert.ok(s.errorRate >= 0 && s.errorRate <= 1);
  const sorted = [1, 2, 3, 4, 5];
  assert.equal(percentile(sorted, 0), 1);
  assert.equal(percentile(sorted, 1), 5);
  assert.equal(percentile(sorted, 0.5), 3);
});

test('endpoint and service rollups cover every span', () => {
  const s = summarize(traces);
  assert.equal(s.byEndpoint.reduce((a, e) => a + e.n, 0), traces.length);
  assert.equal(s.byService.reduce((a, v) => a + v.n, 0), traces.reduce((a, t) => a + t.spans.length, 0));
  // Self time totals *work*, not wall time: concurrent spans mean the fleet
  // does more work than the clock shows, and that gap is real, not an error.
  const totalSelf = s.byService.reduce((a, v) => a + v.self, 0);
  const totalDur = traces.reduce((a, t) => a + t.duration, 0);
  assert.ok(totalSelf >= totalDur * 0.99, 'work should be at least wall time');
  assert.ok(totalSelf <= totalDur * 3, 'but not implausibly more');
});

test('a traces rank matches its position in the sample', () => {
  const sorted = [...traces].sort((a, b) => a.duration - b.duration);
  assert.close(rankOf(sorted[0], traces), 0, 0.01);
  assert.close(rankOf(sorted[sorted.length - 1], traces), 1, 0.01);
});
