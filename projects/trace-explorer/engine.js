/* ─────────────────────────────────────────────────────────────────────────
   trace-explorer/engine.js — a synthetic distributed-tracing backend:
   generate traces from a service topology, then analyse them.

   The analysis never looks at how a trace was generated. Findings are derived
   from span shape alone — exactly as they would have to be against real
   telemetry — so a pathology the generator injects has to be *discovered*,
   not read off a label.
   ───────────────────────────────────────────────────────────────────────── */

import { rng } from '../../shared/lab.js';

export const SERVICES = {
  gateway:   { hue: 200, tier: 'edge' },
  auth:      { hue: 265, tier: 'service' },
  catalog:   { hue: 150, tier: 'service' },
  inventory: { hue: 35,  tier: 'service' },
  checkout:  { hue: 330, tier: 'service' },
  search:    { hue: 95,  tier: 'service' },
  postgres:  { hue: 15,  tier: 'datastore' },
  redis:     { hue: 0,   tier: 'datastore' },
  elastic:   { hue: 55,  tier: 'datastore' },
  payments:  { hue: 300, tier: 'external' },
};

export const serviceColor = (name, l = 0.7, c = 0.14) =>
  `oklch(${l} ${c} ${SERVICES[name]?.hue ?? 240})`;

/* ── generation ─────────────────────────────────────────────────────────── */

/** Log-normal-ish latency: mostly near `typical`, occasionally much worse. */
const lat = (r, typical, spread = 0.4) => {
  const u = Math.max(1e-6, r());
  const v = Math.max(1e-6, r());
  const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(0.2, typical * Math.exp(g * spread));
};

class TraceBuilder {
  constructor(id, endpoint, startedAt) {
    this.id = id;
    this.endpoint = endpoint;
    this.startedAt = startedAt;
    this.spans = [];
    this.seq = 0;
  }
  span(service, op, parent, start, dur, attrs = {}, status = 'ok') {
    const s = {
      id: `${this.id}-${this.seq++}`,
      parent: parent ? parent.id : null,
      service, op, start, dur, status, attrs,
      depth: parent ? parent.depth + 1 : 0,
    };
    this.spans.push(s);
    return s;
  }
  finish() {
    const root = this.spans[0];
    root.dur = Math.max(root.dur, ...this.spans.map((s) => s.start + s.dur)) - root.start;
    const byId = new Map(this.spans.map((s) => [s.id, s]));
    for (const s of this.spans) s.children = this.spans.filter((c) => c.parent === s.id);
    return {
      id: this.id,
      endpoint: this.endpoint,
      startedAt: this.startedAt,
      duration: root.dur,
      spans: this.spans,
      root,
      byId,
      status: this.spans.some((s) => s.status === 'error') ? 'error' : 'ok',
    };
  }
}

/* Each endpoint is a little script. The pathologies (an N+1 loop, a retry
   after an external error, an unexplained pause) are injected with a
   probability, not on a schedule — so the trace list looks like real traffic:
   mostly fine, occasionally not. */
const ENDPOINTS = [
  {
    name: 'POST /checkout', weight: 3,
    build(t, r) {
      const root = t.span('gateway', 'POST /checkout', null, 0, 0, { 'http.method': 'POST', 'http.route': '/checkout' });
      let at = lat(r, 1.5);
      const auth = t.span('auth', 'verify_token', root, at, lat(r, 9), { 'auth.method': 'jwt' });
      const cart = t.span('checkout', 'load_cart', root, at + 0.4, lat(r, 12));
      at = Math.max(auth.start + auth.dur, cart.start + cart.dur) + lat(r, 1);

      const nPlusOne = r() < 0.22;                   // the pathology
      const items = nPlusOne ? 6 + Math.floor(r() * 28) : 1;
      const inv = t.span('inventory', 'reserve_items', root, at, 0, { 'cart.items': items });
      let ia = 0.6;
      for (let i = 0; i < items; i++) {
        const q = t.span('postgres', 'SELECT stock', inv, ia, lat(r, nPlusOne ? 4 : 11), {
          'db.statement': 'SELECT qty FROM stock WHERE sku = $1',
          'db.rows': 1,
        });
        ia += q.dur + lat(r, 0.4, 0.25);             // strictly sequential
      }
      inv.dur = ia + lat(r, 1);
      at += inv.dur + lat(r, 0.8);

      const pay = t.span('payments', 'charge', root, at, 0, { 'payment.provider': 'stripe', 'net.peer': 'api.stripe.com' });
      const flaky = r() < 0.16;
      if (flaky) {
        const a1 = t.span('payments', 'POST /charges', pay, 0.5, lat(r, 210, 0.3), { 'http.status': 504 }, 'error');
        const a2 = t.span('payments', 'POST /charges', pay, a1.dur + lat(r, 28), lat(r, 120), { 'http.status': 201, 'retry.attempt': 2 });
        pay.dur = a2.start + a2.dur + 1;
        pay.attrs['retries'] = 1;
      } else {
        const a1 = t.span('payments', 'POST /charges', pay, 0.5, lat(r, 140, 0.3), { 'http.status': 201 });
        pay.dur = a1.start + a1.dur + 1;
      }
      at += pay.dur + lat(r, 1);

      const commit = t.span('postgres', 'COMMIT', root, at, lat(r, 7));
      at = commit.start + commit.dur;

      if (r() < 0.12) at += lat(r, 70, 0.5);         // an unexplained pause
      root.dur = at + lat(r, 1);
    },
  },
  {
    name: 'GET /product/:sku', weight: 5,
    build(t, r) {
      const root = t.span('gateway', 'GET /product/:sku', null, 0, 0, { 'http.route': '/product/:sku' });
      let at = lat(r, 1.2);
      const cat = t.span('catalog', 'get_product', root, at, 0);
      const cache = t.span('redis', 'GET sku', cat, 0.4, lat(r, 1.1, 0.3), { 'cache.key': 'sku:8812' });
      const hit = r() < 0.78;
      cache.attrs['cache.hit'] = hit;
      let ca = cache.start + cache.dur;
      if (!hit) {
        const db = t.span('postgres', 'SELECT product', cat, ca + 0.3, lat(r, 16), {
          'db.statement': 'SELECT * FROM products WHERE sku = $1', 'db.rows': 1,
        });
        ca = db.start + db.dur;
        const set = t.span('redis', 'SETEX sku', cat, ca + 0.2, lat(r, 0.9, 0.3));
        ca = set.start + set.dur;
      }
      cat.dur = ca + 0.5;
      cat.attrs['cache.hit'] = hit;
      root.dur = cat.start + cat.dur + lat(r, 1);
    },
  },
  {
    name: 'GET /search', weight: 4,
    build(t, r) {
      const root = t.span('gateway', 'GET /search', null, 0, 0, { 'http.route': '/search' });
      let at = lat(r, 1.4);
      const s = t.span('search', 'query', root, at, 0, { 'search.terms': 2 + Math.floor(r() * 3) });
      const es = t.span('elastic', 'search index=products', s, 0.5, lat(r, 34, 0.45), { 'es.shards': 6 });
      let sa = es.start + es.dur;
      // hydrate the hits — parallel, so the slowest one sets the pace
      const hits = 3 + Math.floor(r() * 6);
      let worst = 0;
      for (let i = 0; i < hits; i++) {
        const d = t.span('catalog', 'hydrate', s, sa + 0.3 + r() * 1.2, lat(r, 7, 0.5), { 'sku.index': i });
        worst = Math.max(worst, d.start + d.dur);
      }
      s.dur = worst + 0.6;
      s.attrs['hits'] = hits;
      root.dur = s.start + s.dur + lat(r, 1);
    },
  },
];

export function generate(count = 240, seed = 11) {
  const r = rng(seed);
  const pool = ENDPOINTS.flatMap((e) => Array(e.weight).fill(e));
  const traces = [];
  let clock = 0;
  for (let i = 0; i < count; i++) {
    clock += lat(r, 240, 0.9);
    const ep = pool[Math.floor(r() * pool.length)];
    const t = new TraceBuilder(`t${(i + 1).toString().padStart(4, '0')}`, ep.name, clock);
    ep.build(t, r);
    traces.push(t.finish());
  }
  return traces;
}

/* ── analysis ───────────────────────────────────────────────────────────── */

/** Time a span spent in itself rather than in something it called. */
export function selfTime(span) {
  const kids = (span.children || []).map((c) => [c.start, c.start + c.dur]).sort((a, b) => a[0] - b[0]);
  let covered = 0, cursor = -Infinity;
  for (const [a, b] of kids) {
    const from = Math.max(a, cursor);
    if (b > from) { covered += b - from; cursor = b; }
  }
  return Math.max(0, span.dur - covered);
}

/**
 * The critical path: the chain of spans that, if any one were faster, would
 * make the whole trace faster. Walk back from the end of each span, taking the
 * child that finishes last, then continuing before it starts.
 */
export function criticalPath(trace) {
  const abs = absolutize(trace);
  const segments = [];
  const walk = (span, until) => {
    const from = abs.get(span.id);
    let cursor = until;
    const kids = (span.children || [])
      .map((k) => ({ k, s: abs.get(k.id), e: abs.get(k.id) + k.dur }))
      .sort((a, b) => b.e - a.e);
    // Fill the parent's interval backwards. Each child that was still running
    // at the cursor takes the path; the gaps between them are the parent's own
    // work. A child that overlaps the cursor is clipped rather than skipped —
    // otherwise concurrent children leave holes and the accounting leaks.
    for (const { k, s, e } of kids) {
      if (cursor <= from + 1e-9) break;
      if (k.dur <= 0 || s >= cursor) continue;
      const end = Math.min(e, cursor);
      if (end <= s + 1e-9) continue;
      if (end < cursor - 1e-9) segments.push({ span, from: end, to: cursor });
      walk(k, end);
      cursor = s;
    }
    if (cursor > from + 1e-9) segments.push({ span, from, to: cursor });
  };
  walk(trace.root, abs.get(trace.root.id) + trace.root.dur);
  return segments;
}

/** The spans on the critical path, with the time attributed to each. */
export function criticalSpans(trace) {
  const byId = new Map();
  for (const seg of criticalPath(trace)) {
    const cur = byId.get(seg.span.id) || { span: seg.span, time: 0 };
    cur.time += seg.to - seg.from;
    byId.set(seg.span.id, cur);
  }
  return [...byId.values()].sort((a, b) => b.time - a.time);
}

/** Absolute start time of a span (children carry times relative to a parent). */
export function absolutize(trace) {
  const abs = new Map();
  const walk = (span, base) => {
    const start = base + span.start;
    abs.set(span.id, start);
    for (const c of span.children || []) walk(c, start);
  };
  walk(trace.root, 0);
  return abs;
}

/* ── findings ───────────────────────────────────────────────────────────── */

/**
 * Turn a trace into sentences a person can act on. Each finding is derived
 * from span structure only, carries the evidence that produced it, and says
 * what share of the trace it accounts for — because "this is slow" without a
 * denominator is not a finding, it's a feeling.
 */
export function findings(trace) {
  const out = [];
  const abs = absolutize(trace);
  const total = trace.root.dur;

  // 1. Repeated sequential calls to the same operation — the N+1 shape.
  for (const parent of trace.spans) {
    const kids = parent.children || [];
    const groups = new Map();
    for (const k of kids) {
      const key = `${k.service}.${k.op}`;
      groups.set(key, [...(groups.get(key) || []), k]);
    }
    for (const [key, list] of groups) {
      if (list.length < 5) continue;
      const sorted = [...list].sort((a, b) => a.start - b.start);
      let overlap = 0;
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].start < sorted[i - 1].start + sorted[i - 1].dur - 0.01) overlap++;
      }
      const sum = list.reduce((s, k) => s + k.dur, 0);
      const sequential = overlap <= list.length * 0.2;
      // parallel work costs the slowest branch, not the sum — charging the
      // sum would let a finding claim more than 100% of the trace
      const cost = sequential ? sum : Math.max(...list.map((k) => k.dur));
      out.push({
        severity: sequential && sum / total > 0.25 ? 'high' : 'info',
        title: sequential
          ? `${list.length} sequential calls to ${key}`
          : `${list.length} parallel calls to ${key}`,
        body: sequential
          ? `Issued one after another from ${parent.service}.${parent.op}, totalling ${sum.toFixed(1)}ms — ${(sum / total * 100).toFixed(0)}% of the trace. A single batched query would collapse this to roughly one round trip.`
          : `Fanned out from ${parent.service}.${parent.op}. They overlap, so the cost is the slowest one (${Math.max(...list.map((k) => k.dur)).toFixed(1)}ms), not the sum.`,
        spans: list.map((k) => k.id),
        share: cost / total,
      });
    }
  }

  // 2. An error followed by a repeat of the same operation — a retry.
  for (const parent of trace.spans) {
    const kids = [...(parent.children || [])].sort((a, b) => a.start - b.start);
    for (let i = 0; i < kids.length - 1; i++) {
      if (kids[i].status !== 'error') continue;
      const next = kids[i + 1];
      if (next.op !== kids[i].op) continue;
      out.push({
        severity: 'high',
        title: `${kids[i].service}.${kids[i].op} failed, then succeeded on retry`,
        body: `The first attempt spent ${kids[i].dur.toFixed(0)}ms before failing (${kids[i].attrs['http.status'] ?? 'error'}), and the retry added ${next.dur.toFixed(0)}ms. The user paid for both: ${((kids[i].dur + next.dur) / total * 100).toFixed(0)}% of this request was the failure and its recovery.`,
        spans: [kids[i].id, next.id],
        share: (kids[i].dur + next.dur) / total,
      });
    }
  }

  // 3. Time inside a span that no child accounts for.
  for (const s of trace.spans) {
    const self = selfTime(s);
    if (!s.children?.length) continue;
    if (self / total > 0.2 && self > 20) {
      out.push({
        severity: 'warn',
        title: `${self.toFixed(0)}ms unaccounted for inside ${s.service}.${s.op}`,
        body: `This span is ${s.dur.toFixed(0)}ms long but its children only explain ${(s.dur - self).toFixed(0)}ms. The gap is work nobody instrumented — serialisation, a lock wait, a garbage collection pause, or a missing span.`,
        spans: [s.id],
        share: self / total,
      });
    }
  }

  // 4. One service dominating the critical path.
  const byService = new Map();
  for (const seg of criticalPath(trace)) {
    byService.set(seg.span.service, (byService.get(seg.span.service) || 0) + (seg.to - seg.from));
  }
  const [topService, topTime] = [...byService.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  if (topService && topTime / total > 0.45) {
    out.push({
      severity: 'info',
      title: `${topService} owns ${(topTime / total * 100).toFixed(0)}% of the critical path`,
      body: `Everything else in this trace is either parallel to ${topService} or too small to matter. Optimising anywhere else cannot move this request's latency.`,
      spans: [...new Set(criticalPath(trace).filter((g) => g.span.service === topService).map((g) => g.span.id))],
      share: topTime / total,
    });
  }

  // 5. A cache miss that cost a database read.
  const miss = trace.spans.find((s) => s.attrs?.['cache.hit'] === false && s.service === 'redis');
  if (miss) {
    const db = trace.spans.find((s) => s.service === 'postgres');
    if (db) out.push({
      severity: 'info',
      title: 'Cache miss, so the request paid for the database',
      body: `The lookup missed (${miss.dur.toFixed(1)}ms) and the fallback read took ${db.dur.toFixed(1)}ms — ${(db.dur / miss.dur).toFixed(0)}x the cost of a hit.`,
      spans: [miss.id, db.id],
      share: db.dur / total,
    });
  }

  const rank = { high: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || b.share - a.share);
}

/* ── fleet-level statistics ─────────────────────────────────────────────── */

export function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export function summarize(traces) {
  const durations = traces.map((t) => t.duration).sort((a, b) => a - b);
  const byEndpoint = new Map();
  const byService = new Map();
  for (const t of traces) {
    const e = byEndpoint.get(t.endpoint) || { n: 0, durs: [], errors: 0 };
    e.n++; e.durs.push(t.duration); if (t.status === 'error') e.errors++;
    byEndpoint.set(t.endpoint, e);
    for (const s of t.spans) {
      const v = byService.get(s.service) || { n: 0, self: 0, errors: 0 };
      v.n++; v.self += selfTime(s); if (s.status === 'error') v.errors++;
      byService.set(s.service, v);
    }
  }
  for (const e of byEndpoint.values()) e.durs.sort((a, b) => a - b);
  return {
    n: traces.length,
    p50: percentile(durations, 0.5),
    p95: percentile(durations, 0.95),
    p99: percentile(durations, 0.99),
    max: durations[durations.length - 1] || 0,
    errorRate: traces.filter((t) => t.status === 'error').length / Math.max(1, traces.length),
    byEndpoint: [...byEndpoint.entries()].map(([name, v]) => ({
      name, n: v.n, errors: v.errors,
      p50: percentile(v.durs, 0.5), p95: percentile(v.durs, 0.95), p99: percentile(v.durs, 0.99),
    })).sort((a, b) => b.p95 - a.p95),
    byService: [...byService.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.self - a.self),
  };
}

/** Which percentile of the fleet does this one trace sit at? */
export function rankOf(trace, traces) {
  const faster = traces.filter((t) => t.duration < trace.duration).length;
  return faster / Math.max(1, traces.length - 1);
}
