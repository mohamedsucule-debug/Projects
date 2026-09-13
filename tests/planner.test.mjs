import { test, assert } from './harness.mjs';
import { plan, parse, tokenize, selectivity, SqlError, DEMO_CATALOG, COST } from '../projects/query-planner/engine.js';

const cat = () => structuredClone(DEMO_CATALOG);
const ops = (node, out = []) => { out.push(node.op); (node.kids || []).forEach((k) => ops(k, out)); return out; };
const leaves = (node, out = []) => {
  if (!node.kids?.length) out.push(node);
  else node.kids.forEach((k) => leaves(k, out));
  return out;
};

test('the parser handles the dialect it claims to', () => {
  const q = parse(`SELECT c.country, count(*) AS n FROM orders o JOIN customers c ON o.customer_id = c.id
                   WHERE o.status = 1 AND c.country = 3 GROUP BY c.country ORDER BY c.country DESC LIMIT 10`);
  assert.equal(q.rels.length, 2);
  assert.equal(q.rels[0].alias, 'o');
  assert.equal(q.preds.length, 3);
  assert.equal(q.groupBy.length, 1);
  assert.equal(q.orderBy.dir, 'desc');
  assert.equal(q.limit, 10);
  assert.equal(q.items.filter((i) => i.kind === 'agg').length, 1);
});

test('implicit joins in the FROM list parse like explicit ones', () => {
  const a = parse('SELECT * FROM orders o, customers c WHERE o.customer_id = c.id');
  const b = parse('SELECT * FROM orders o JOIN customers c ON o.customer_id = c.id');
  assert.equal(a.rels.length, b.rels.length);
  assert.equal(a.preds.length, b.preds.length);
});

test('syntax errors report where they happened', () => {
  for (const q of ['SELECT FROM x', 'SELECT * FROM', 'SELECT * FROM t WHERE', 'SELEC * FROM t']) {
    try {
      parse(q);
      throw new Error(`expected ${q} to fail`);
    } catch (e) {
      assert.ok(e instanceof SqlError, `${q} threw ${e.message}`);
      assert.ok(e.at >= 0 && e.at <= q.length);
    }
  }
});

test('row estimates follow from the statistics, not from vibes', () => {
  // orders has 2.4M rows and status has 6 distinct values, so status = 1
  // should be estimated at 2,400,000 / 6.
  const r = plan('SELECT * FROM orders o WHERE o.status = 1', cat());
  const scan = leaves(r.root)[0];
  assert.equal(scan.rows, Math.round(DEMO_CATALOG.orders.rows / DEMO_CATALOG.orders.cols.status.ndv));
});

test('a join estimate divides by the larger distinct-value count', () => {
  const r = plan('SELECT * FROM orders o JOIN customers c ON o.customer_id = c.id', cat());
  const expected = Math.round(DEMO_CATALOG.orders.rows * DEMO_CATALOG.customers.rows / DEMO_CATALOG.customers.cols.id.ndv);
  assert.close(r.root.rows, expected, expected * 0.02);
});

test('a point lookup uses the index; a wide scan does not', () => {
  const point = plan('SELECT * FROM customers c WHERE c.id = 42', cat());
  assert.ok(ops(point.root).some((o) => /Index/.test(o)), 'expected an index scan for an equality on the primary key');

  const wide = plan('SELECT * FROM orders o WHERE o.status = 1', cat());
  assert.ok(ops(wide.root).every((o) => !/Index/.test(o)), 'a 400k-row predicate should not go through an index');
});

test('removing the index changes the plan the optimiser picks', () => {
  const q = 'SELECT * FROM customers c JOIN orders o ON o.customer_id = c.id WHERE c.id = 42';
  const withIdx = plan(q, cat());
  const c2 = cat();
  c2.orders.indexes = c2.orders.indexes.filter((i) => i.name !== 'orders_customer_idx');
  const without = plan(q, c2);
  assert.ok(withIdx.root.cost < without.root.cost, 'the indexed plan should be cheaper');
  assert.ok(withIdx.root.cost * 50 < without.root.cost, 'and dramatically so — this is the whole point of the index');
});

test('every relation appears exactly once in the chosen plan', () => {
  const r = plan(`SELECT * FROM orders o JOIN line_items l ON o.id = l.order_id
                  JOIN products p ON l.sku = p.sku JOIN customers c ON o.customer_id = c.id`, cat());
  const rels = leaves(r.root).map((n) => n.rel).sort();
  assert.deep(rels, ['c', 'l', 'o', 'p']);
  assert.ok(r.considered > 50, `expected a real search, only costed ${r.considered} plans`);
});

test('costs are monotonic: a child never costs more than its parent', () => {
  const r = plan(`SELECT c.country, count(*) FROM orders o JOIN customers c ON o.customer_id = c.id
                  WHERE o.status = 1 GROUP BY c.country ORDER BY c.country LIMIT 5`, cat());
  const walk = (n) => {
    for (const k of n.kids || []) {
      assert.ok(k.cost <= n.cost + 1e-6, `${k.op} (${k.cost}) costs more than its parent ${n.op} (${n.cost})`);
      walk(k);
    }
  };
  walk(r.root);
});

test('self cost decomposes the total exactly', () => {
  const r = plan('SELECT * FROM orders o JOIN customers c ON o.customer_id = c.id', cat());
  const sum = (n) => n.selfCost + (n.kids || []).reduce((s, k) => s + sum(k), 0);
  assert.close(sum(r.root), r.root.cost, 1e-6);
});

test('LIMIT only discounts a plan that can stop early', () => {
  const sorted = plan('SELECT * FROM orders o WHERE o.total > 4000 ORDER BY o.total DESC LIMIT 10', cat());
  const limit = sorted.root;
  assert.equal(limit.op, 'Limit');
  // a sort must consume its whole input, so the limit saves nothing
  assert.close(limit.cost, limit.kids[0].cost, limit.cost * 0.05);
});

test('table size flips the join algorithm', () => {
  const q = 'SELECT * FROM customers c JOIN orders o ON o.customer_id = c.id WHERE c.country = 3';
  const at = (rows) => { const c = cat(); c.orders.rows = rows; return plan(q, c); };
  // A small inner side is cheap to re-probe per outer row; once it is large,
  // building a hash table once beats probing it a million times.
  assert.equal(at(500).root.op, 'Nested Loop');
  assert.equal(at(50_000).root.op, 'Hash Join');
  assert.equal(at(50_000_000).root.op, 'Hash Join');
  assert.ok(at(50_000_000).root.cost > at(500).root.cost * 100, 'more rows must cost more');
});

test('the cost model is exposed rather than hidden', () => {
  assert.ok(COST.randomPage > COST.seqPage, 'a random page read should cost more than a sequential one');
  assert.ok(COST.seqPage > COST.cpuTuple, 'I/O should dominate CPU per tuple');
});

test('selectivity explains itself', () => {
  const q = parse('SELECT * FROM orders o WHERE o.status = 1');
  const resolve = (ref) => ({ rel: 'orders', col: ref.col, table: 'orders' });
  const s = selectivity(q.preds[0], DEMO_CATALOG, resolve);
  assert.close(s.sel, 1 / 6, 1e-9);
  assert.ok(/6/.test(s.why), `the explanation should mention the distinct-value count, got: ${s.why}`);
});

test('the tokenizer keeps string literals whole', () => {
  const tk = tokenize("SELECT * FROM t WHERE name = 'ada lovelace'");
  const str = tk.find((t) => t.t === 'str');
  assert.equal(str.v, 'ada lovelace');
});
