/* ─────────────────────────────────────────────────────────────────────────
   query-planner/engine.js — a cost-based query optimiser for a small SQL
   dialect: tokenise, parse, estimate, enumerate join orders, pick a plan.

   The interesting output is not the plan. It is *why* that plan: every node
   carries the arithmetic that produced its row estimate and its cost, so the
   UI can show the derivation instead of a number you have to trust.
   ───────────────────────────────────────────────────────────────────────── */

/* ── Cost constants ────────────────────────────────────────────────────────
   Same shape as PostgreSQL's: sequential page reads are the unit, everything
   else is priced relative to one. Exposed so the UI can show the model. */
export const COST = {
  seqPage: 1.0,
  randomPage: 4.0,
  cpuTuple: 0.01,
  cpuOperator: 0.0025,
  cpuHash: 0.015,
  rowsPerPage: 64,
};

/* ── 1. Tokeniser ─────────────────────────────────────────────────────── */
const KEYWORDS = new Set(['select', 'from', 'where', 'join', 'inner', 'left', 'on', 'and', 'or',
  'group', 'by', 'order', 'asc', 'desc', 'limit', 'as', 'count', 'sum', 'avg', 'min', 'max', 'like', 'not', 'in']);

export function tokenize(sql) {
  const out = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && sql[i + 1] === '-') { while (i < sql.length && sql[i] !== '\n') i++; continue; }
    const start = i;
    if (/[A-Za-z_]/.test(c)) {
      while (i < sql.length && /[A-Za-z0-9_.]/.test(sql[i])) i++;
      const text = sql.slice(start, i);
      out.push({ t: KEYWORDS.has(text.toLowerCase()) ? 'kw' : 'ident', v: text, at: start });
      continue;
    }
    if (/[0-9]/.test(c)) {
      while (i < sql.length && /[0-9.]/.test(sql[i])) i++;
      out.push({ t: 'num', v: parseFloat(sql.slice(start, i)), at: start });
      continue;
    }
    if (c === "'") {
      i++;
      while (i < sql.length && sql[i] !== "'") i++;
      i++;
      out.push({ t: 'str', v: sql.slice(start + 1, i - 1), at: start });
      continue;
    }
    const two = sql.slice(i, i + 2);
    if (['>=', '<=', '<>', '!='].includes(two)) { out.push({ t: 'op', v: two === '!=' ? '<>' : two, at: start }); i += 2; continue; }
    if ('=<>'.includes(c)) { out.push({ t: 'op', v: c, at: start }); i++; continue; }
    if ('(),*'.includes(c)) { out.push({ t: c, v: c, at: start }); i++; continue; }
    throw new SqlError(`unexpected character '${c}'`, start);
  }
  out.push({ t: 'eof', v: '', at: sql.length });
  return out;
}

export class SqlError extends Error {
  constructor(msg, at) { super(msg); this.at = at; }
}

/* ── 2. Parser ─────────────────────────────────────────────────────────────
   SELECT <items> FROM <rel> [JOIN <rel> ON <pred>]… [WHERE <pred>]
   [GROUP BY …] [ORDER BY … [ASC|DESC]] [LIMIT n]
─────────────────────────────────────────────────────────────────────────── */
export function parse(sql) {
  const tk = tokenize(sql);
  let p = 0;
  const peek = () => tk[p];
  const is = (t, v) => tk[p].t === t && (v === undefined || String(tk[p].v).toLowerCase() === v);
  const kw = (v) => is('kw', v);
  const take = () => tk[p++];
  const expect = (t, v) => {
    if (!is(t, v)) throw new SqlError(`expected ${v || t}, found '${tk[p].v || 'end of query'}'`, tk[p].at);
    return take();
  };

  const colref = () => {
    const tok = expect('ident');
    const [a, b] = String(tok.v).split('.');
    return b ? { rel: a, col: b, text: tok.v } : { rel: null, col: a, text: tok.v };
  };

  function selectItems() {
    const items = [];
    do {
      if (is('*')) { take(); items.push({ kind: 'star' }); continue; }
      if (is('kw') && ['count', 'sum', 'avg', 'min', 'max'].includes(String(peek().v).toLowerCase())) {
        const fn = String(take().v).toLowerCase();
        expect('(');
        let arg = null;
        if (is('*')) take(); else arg = colref();
        expect(')');
        let alias = null;
        if (kw('as')) { take(); alias = String(expect('ident').v); }
        items.push({ kind: 'agg', fn, arg, alias: alias || `${fn}(${arg ? arg.text : '*'})` });
        continue;
      }
      const c = colref();
      let alias = null;
      if (kw('as')) { take(); alias = String(expect('ident').v); }
      items.push({ kind: 'col', ref: c, alias: alias || c.text });
    } while (is(',') && take());
    return items;
  }

  function relation() {
    const name = String(expect('ident').v);
    let alias = name;
    if (kw('as')) { take(); alias = String(expect('ident').v); }
    else if (is('ident')) alias = String(take().v);
    return { name, alias };
  }

  function predicate() {
    // flat AND/OR list — enough for a planner, and OR is treated as a
    // non-pushable filter, which is the honest behaviour anyway
    const terms = [];
    let connector = 'and';
    for (;;) {
      const left = is('num') || is('str') ? { lit: take().v } : colref();
      let op = '=';
      if (is('op')) op = String(take().v);
      else if (kw('like')) { take(); op = 'like'; }
      else throw new SqlError('expected a comparison operator', peek().at);
      const right = is('num') || is('str') ? { lit: take().v } : colref();
      terms.push({ left, op, right, connector });
      if (kw('and')) { connector = 'and'; take(); continue; }
      if (kw('or')) { connector = 'or'; take(); continue; }
      break;
    }
    return terms;
  }

  expect('kw', 'select');
  const items = selectItems();
  expect('kw', 'from');
  const rels = [relation()];
  const joinPreds = [];
  while (is(',') || kw('join') || kw('inner') || kw('left')) {
    if (is(',')) { take(); rels.push(relation()); continue; }
    if (kw('inner') || kw('left')) take();
    expect('kw', 'join');
    rels.push(relation());
    expect('kw', 'on');
    joinPreds.push(...predicate());
  }
  let where = [];
  if (kw('where')) { take(); where = predicate(); }
  let groupBy = [];
  if (kw('group')) { take(); expect('kw', 'by'); do { groupBy.push(colref()); } while (is(',') && take()); }
  let orderBy = null;
  if (kw('order')) {
    take(); expect('kw', 'by');
    const ref = colref();
    let dir = 'asc';
    if (kw('asc') || kw('desc')) dir = String(take().v).toLowerCase();
    orderBy = { ref, dir };
  }
  let limit = null;
  if (kw('limit')) { take(); limit = expect('num').v; }
  if (!is('eof')) throw new SqlError(`unexpected '${peek().v}'`, peek().at);

  return { items, rels, preds: [...joinPreds, ...where], groupBy, orderBy, limit };
}

/* ── 3. Statistics & selectivity ───────────────────────────────────────────
   Every estimate returns its own explanation string. An estimate you cannot
   audit is just a rumour.
─────────────────────────────────────────────────────────────────────────── */
const DEFAULT_SEL = { '=': 0.05, '<>': 0.95, '<': 0.33, '>': 0.33, '<=': 0.33, '>=': 0.33, like: 0.2 };

export function selectivity(pred, catalog, resolve) {
  const lc = pred.left.lit === undefined ? resolve(pred.left) : null;
  const rc = pred.right.lit === undefined ? resolve(pred.right) : null;

  if (lc && rc) {                                     // join predicate
    const a = colStats(catalog, lc), b = colStats(catalog, rc);
    const ndv = Math.max(a?.ndv || 100, b?.ndv || 100, 1);
    return { sel: 1 / ndv, why: `join on ${lc.rel}.${lc.col} = ${rc.rel}.${rc.col}: 1 / max(ndv) = 1/${ndv}` };
  }
  const col = lc || rc;
  const lit = pred.left.lit !== undefined ? pred.left.lit : pred.right.lit;
  const st = col ? colStats(catalog, col) : null;
  if (!st) return { sel: DEFAULT_SEL[pred.op] ?? 0.1, why: `no statistics: default ${(DEFAULT_SEL[pred.op] ?? 0.1)}` };

  if (pred.op === '=') {
    if (st.ndv <= 0) return { sel: 0.05, why: 'no distinct-value estimate' };
    return { sel: 1 / st.ndv, why: `${col.rel}.${col.col} has ${st.ndv} distinct values: 1/${st.ndv}` };
  }
  if (['<', '>', '<=', '>='].includes(pred.op) && typeof lit === 'number' && st.min !== undefined) {
    const span = st.max - st.min || 1;
    const below = Math.min(1, Math.max(0, (lit - st.min) / span));
    const sel = pred.op[0] === '<' ? below : 1 - below;
    return { sel: Math.max(0.001, sel), why: `range over [${st.min}, ${st.max}]: ${(sel * 100).toFixed(1)}% of the span` };
  }
  const sel = DEFAULT_SEL[pred.op] ?? 0.1;
  return { sel, why: `${pred.op}: default ${sel}` };
}

function colStats(catalog, ref) {
  const t = catalog[ref.rel];
  return t?.cols?.[ref.col];
}

/* ── 4. Access paths ───────────────────────────────────────────────────── */
function scanPaths(rel, catalog, preds, resolve) {
  // `catalog` here is keyed by alias (see the proxy in plan()) so that the
  // statistics a predicate asks for and the table it scans agree.
  const table = catalog[rel.alias] || catalog[rel.name];
  if (!table) throw new SqlError(`unknown table '${rel.name}'`, 0);
  const pages = Math.max(1, Math.ceil(table.rows / COST.rowsPerPage));

  const local = preds.filter((p) => predRels(p, resolve).length === 1 && predRels(p, resolve)[0] === rel.alias);
  let sel = 1;
  const reasons = [];
  for (const p of local) {
    const s = selectivity(p, catalog, resolve);
    sel *= s.sel;
    reasons.push(`${fmtPred(p)} → ${s.why}`);
  }
  const rows = Math.max(1, Math.round(table.rows * sel));

  const paths = [];
  const seqCost = pages * COST.seqPage + table.rows * COST.cpuTuple + table.rows * local.length * COST.cpuOperator;
  paths.push({
    op: 'Seq Scan', rel: rel.alias, table: rel.name, rows, cost: seqCost, startup: 0, kids: [],
    sorted: null,
    detail: {
      'table rows': table.rows,
      pages,
      'filters': local.length ? local.map(fmtPred).join(' AND ') : 'none',
      'selectivity': sel.toFixed(4),
      'cost': `${pages} pages x ${COST.seqPage} + ${table.rows} rows x ${COST.cpuTuple}`,
    },
    why: reasons,
  });

  for (const idx of table.indexes || []) {
    const lead = idx.cols[0];
    const usable = local.filter((p) => {
      const r = [p.left, p.right].find((s) => s.lit === undefined);
      const rr = r && resolve(r);
      return rr && rr.col === lead && ['=', '<', '>', '<=', '>='].includes(p.op);
    });
    if (!usable.length) continue;
    let isel = 1;
    for (const p of usable) isel *= selectivity(p, catalog, resolve).sel;
    const idxRows = Math.max(1, Math.round(table.rows * isel));
    const height = Math.max(1, Math.ceil(Math.log2(Math.max(2, table.rows)) / 4));
    const covering = (idx.cols.length >= 1) && idx.covering;
    const fetch = covering ? idxRows * COST.cpuTuple : idxRows * COST.randomPage * clusterFactor(idx, idxRows, table.rows);
    const cost = height * COST.randomPage + idxRows * COST.cpuOperator + fetch;
    // remaining local predicates still have to be re-checked on the rows we fetch
    const rest = local.filter((p) => !usable.includes(p));
    let restSel = 1;
    for (const p of rest) restSel *= selectivity(p, catalog, resolve).sel;
    paths.push({
      op: covering ? 'Index Only Scan' : 'Index Scan', rel: rel.alias, table: rel.name,
      rows: Math.max(1, Math.round(idxRows * restSel)),
      cost, startup: height * COST.randomPage, kids: [],
      sorted: { rel: rel.alias, col: lead, dir: 'asc' },
      index: idx.name || idx.cols.join('+'),
      detail: {
        'index': `${idx.name || idx.cols.join('+')} (${idx.cols.join(', ')})`,
        'matched': usable.map(fmtPred).join(' AND '),
        'index rows': idxRows,
        'heap fetches': covering ? 'none — index covers the query' : `${idxRows} x ${COST.randomPage} random page`,
        'rechecked': rest.length ? rest.map(fmtPred).join(' AND ') : 'none',
      },
      why: [`index on ${idx.cols.join(', ')} answers ${usable.map(fmtPred).join(' AND ')}`],
    });
  }
  return paths;
}

// A rough correlation model: fetching many rows through an index degrades
// towards sequential access rather than staying fully random.
const clusterFactor = (idx, hit, total) => (idx.clustered ? 0.1 : Math.max(0.25, 1 - hit / Math.max(1, total)));

const fmtSide = (s) => (s.lit !== undefined ? (typeof s.lit === 'string' ? `'${s.lit}'` : s.lit) : s.text);
export const fmtPred = (p) => `${fmtSide(p.left)} ${p.op} ${fmtSide(p.right)}`;

function predRels(p, resolve) {
  const out = new Set();
  for (const s of [p.left, p.right]) if (s.lit === undefined) { const r = resolve(s); if (r) out.add(r.rel); }
  return [...out];
}

/* ── 5. Join enumeration (Selinger DP over subsets) ───────────────────── */
function joinPlans(left, right, preds, catalog, resolve) {
  const joinPreds = preds.filter((p) => {
    const rs = predRels(p, resolve);
    return rs.length === 2 &&
      ((left.rels.has(rs[0]) && right.rels.has(rs[1])) || (left.rels.has(rs[1]) && right.rels.has(rs[0])));
  });
  let sel = 1;
  const why = [];
  for (const p of joinPreds) {
    const s = selectivity(p, catalog, resolve);
    sel *= s.sel;
    why.push(`${fmtPred(p)} → ${s.why}`);
  }
  const rows = Math.max(1, Math.round(left.rows * right.rows * sel));
  const cross = joinPreds.length === 0;
  const cond = joinPreds.map(fmtPred).join(' AND ') || 'cross product';
  const out = [];

  // Hash join: build a table on the smaller side, stream the larger.
  const [build, probe] = left.rows <= right.rows ? [left, right] : [right, left];
  out.push({
    op: 'Hash Join', rows,
    cost: build.cost + probe.cost + build.rows * COST.cpuHash * 2 + probe.rows * COST.cpuHash + rows * COST.cpuTuple,
    startup: build.cost + build.rows * COST.cpuHash,
    kids: [build, probe], sorted: null, cond,
    detail: {
      'build side': `${[...build.rels].join(', ')} (${fmtRows(build.rows)} rows)`,
      'probe side': `${[...probe.rels].join(', ')} (${fmtRows(probe.rows)} rows)`,
      'condition': cond,
      'memory': `${fmtRows(build.rows)} rows hashed`,
    },
    why: [`hash the smaller input (${fmtRows(build.rows)} rows), stream the larger`, ...why],
  });

  // Nested loop: re-scan the inner side once per outer row. Cheap only when
  // the outer side is tiny or the inner side is an index probe.
  for (const [o, i] of [[left, right], [right, left]]) {
    const innerIsIndex = /Index/.test(i.op);
    const rescan = innerIsIndex ? i.startup + i.cost * 0.15 : i.cost;
    out.push({
      op: 'Nested Loop', rows,
      cost: o.cost + o.rows * rescan + rows * COST.cpuTuple,
      startup: o.startup,
      kids: [o, i], sorted: o.sorted, cond,
      detail: {
        'outer': `${[...o.rels].join(', ')} (${fmtRows(o.rows)} rows)`,
        'inner': `${[...i.rels].join(', ')} — ${innerIsIndex ? 'index probe per outer row' : 're-scanned per outer row'}`,
        'condition': cond,
        'cost': `${fmtRows(o.rows)} outer rows x ${rescan.toFixed(1)} per inner pass`,
      },
      why: [`${fmtRows(o.rows)} outer rows x one inner pass each`, ...why],
    });
  }

  // Parameterized nested loop: if the inner side is still a bare relation and
  // an index leads with the join column, we don't re-scan it per outer row —
  // we probe it. This is the difference between a query that takes 4ms and
  // the same query taking 40s, so it gets its own path.
  for (const [o, i] of [[left, right], [right, left]]) {
    if (i.kids.length || !i.rel) continue;
    const table = catalog[i.rel];
    for (const p of joinPreds) {
      const inner = [p.left, p.right].map(resolve).find((r) => r && r.rel === i.rel);
      if (!inner) continue;
      const idx = (table?.indexes || []).find((x) => x.cols[0] === inner.col);
      if (!idx) continue;
      const ndv = table.cols?.[inner.col]?.ndv || 100;
      const perOuter = Math.max(1, i.rows / ndv);
      const height = Math.max(1, Math.ceil(Math.log2(Math.max(2, table.rows)) / 4));
      const probe = height * COST.randomPage * 0.25 + perOuter * (idx.clustered ? COST.seqPage : COST.randomPage);
      out.push({
        op: 'Nested Loop', rows, cost: o.cost + o.rows * probe + rows * COST.cpuTuple, startup: o.startup,
        kids: [o, { ...i, op: 'Index Scan', index: idx.name || idx.cols.join('+'), rows: Math.round(perOuter), cost: probe, parameterized: `${inner.col} = outer.${inner.col}`, detail: { ...i.detail, 'index': idx.name || idx.cols.join('+'), 'probed with': `outer.${inner.col}`, 'rows per probe': perOuter.toFixed(1) }, why: [`probed once per outer row on ${idx.name || idx.cols.join('+')}`] }],
        sorted: o.sorted, cond, parameterized: true,
        detail: {
          'outer': `${[...o.rels].join(', ')} (${fmtRows(o.rows)} rows)`,
          'inner': `${i.rel} probed via ${idx.name || idx.cols.join('+')}`,
          'per probe': `${perOuter.toFixed(1)} rows, ~${probe.toFixed(2)} cost`,
          'condition': cond,
        },
        why: [o.rows === 1
          ? `one outer row, so one index probe — the inner table is never scanned`
          : `${fmtRows(o.rows)} outer rows, each answered by an index probe instead of a full scan of ${i.rel}`, ...why],
      });
    }
  }

  // Merge join: free if both sides already arrive sorted on the join key.
  if (!cross) {
    const sortCost = (side) => (side.sorted ? 0 : side.rows * Math.log2(Math.max(2, side.rows)) * COST.cpuOperator * 4);
    const sl = sortCost(left), sr = sortCost(right);
    out.push({
      op: 'Merge Join', rows,
      cost: left.cost + right.cost + sl + sr + (left.rows + right.rows) * COST.cpuTuple,
      startup: left.startup + right.startup + sl + sr,
      kids: [left, right], sorted: left.sorted, cond,
      detail: {
        'left sort': sl ? `sort ${fmtRows(left.rows)} rows (${sl.toFixed(0)})` : 'already sorted — free',
        'right sort': sr ? `sort ${fmtRows(right.rows)} rows (${sr.toFixed(0)})` : 'already sorted — free',
        'condition': cond,
      },
      why: [sl + sr === 0 ? 'both inputs already sorted on the key' : 'one sweep, after sorting', ...why],
    });
  }

  for (const plan of out) {
    plan.rels = new Set([...left.rels, ...right.rels]);
    plan.crossProduct = cross;
  }
  return out;
}

const fmtRows = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n));

/* ── 6. The planner ────────────────────────────────────────────────────── */
export function plan(sql, catalog) {
  const q = parse(sql);

  const byAlias = new Map(q.rels.map((r) => [r.alias, r]));
  const resolve = (ref) => {
    if (ref.rel) {
      const r = byAlias.get(ref.rel);
      return r ? { rel: r.alias, col: ref.col, table: r.name } : null;
    }
    const hit = q.rels.filter((r) => catalog[r.name]?.cols?.[ref.col]);
    if (hit.length === 0) return null;
    return { rel: hit[0].alias, col: ref.col, table: hit[0].name };
  };
  // the catalog is keyed by table name; estimates ask by alias
  const aliasCatalog = new Proxy({}, {
    get: (_, key) => {
      const r = byAlias.get(key);
      return r ? catalog[r.name] : catalog[key];
    },
    has: () => true,
  });
  const sel = (pred) => selectivity(pred, aliasCatalog, resolve);

  let considered = 0;
  const best = new Map();     // key: sorted alias list → cheapest plan
  const allForKey = new Map();

  for (const rel of q.rels) {
    const paths = scanPaths(rel, aliasCatalog, q.preds, resolve).map((p) => ({ ...p, rels: new Set([rel.alias]) }));
    considered += paths.length;
    paths.sort((a, b) => a.cost - b.cost);
    best.set(rel.alias, paths[0]);
    allForKey.set(rel.alias, paths);
  }

  const keyOf = (set) => [...set].sort().join(',');
  const subsets = [...best.keys()];
  for (let size = 2; size <= q.rels.length; size++) {
    const combos = combinations(q.rels.map((r) => r.alias), size);
    for (const combo of combos) {
      const key = combo.slice().sort().join(',');
      let bestPlan = null;
      const options = [];
      for (const split of properSplits(combo)) {
        const l = best.get(split[0].slice().sort().join(','));
        const r = best.get(split[1].slice().sort().join(','));
        if (!l || !r) continue;
        for (const cand of joinPlans(l, r, q.preds, aliasCatalog, resolve)) {
          considered++;
          options.push(cand);
          // a cross product is allowed only if nothing else connects
          if (!bestPlan || betterThan(cand, bestPlan)) bestPlan = cand;
        }
      }
      if (bestPlan) {
        best.set(key, bestPlan);
        options.sort((a, b) => a.cost - b.cost);
        // both halves of a split produce the same physical plan for
        // symmetric operators; show each distinct shape once
        const seen = new Set();
        allForKey.set(key, options.filter((o) => {
          const sig = o.op + '|' + o.cost.toFixed(2) + '|' + o.kids.map((k) => [...k.rels].sort().join('+')).sort().join('/');
          return seen.has(sig) ? false : (seen.add(sig), true);
        }).slice(0, 8));
      }
    }
  }

  const rootKey = q.rels.map((r) => r.alias).sort().join(',');
  let root = best.get(rootKey);
  if (!root) throw new SqlError('could not join these relations', 0);
  const alternatives = (allForKey.get(rootKey) || []).slice(0, 6);

  // residual predicates (OR terms, or anything spanning 3+ relations)
  const residual = q.preds.filter((p) => predRels(p, resolve).length === 0 || p.connector === 'or' && predRels(p, resolve).length > 1);

  if (q.groupBy.length || q.items.some((i) => i.kind === 'agg')) {
    const groups = q.groupBy.length
      ? Math.max(1, Math.round(Math.min(root.rows, q.groupBy.reduce((acc, g) => acc * (colStats(aliasCatalog, resolve(g) || {}) ?.ndv || 10), 1))))
      : 1;
    const hashed = q.groupBy.length > 0;
    root = {
      op: hashed ? 'HashAggregate' : 'Aggregate',
      rows: groups,
      cost: root.cost + root.rows * COST.cpuOperator * 3 + groups * COST.cpuTuple,
      startup: root.cost, kids: [root], sorted: null, rels: root.rels,
      detail: {
        'group keys': q.groupBy.map((g) => g.text).join(', ') || 'none — one row out',
        'input rows': fmtRows(root.rows),
        'estimated groups': fmtRows(groups),
      },
      why: [q.groupBy.length ? `distinct-value counts on ${q.groupBy.map((g) => g.text).join(', ')} give ${fmtRows(groups)} groups` : 'no GROUP BY: the whole input collapses to one row'],
    };
  }

  if (q.orderBy) {
    const already = root.sorted && root.sorted.col === q.orderBy.ref.col && q.orderBy.dir === 'asc';
    if (!already) {
      const c = root.rows * Math.log2(Math.max(2, root.rows)) * COST.cpuOperator * 4;
      root = {
        op: 'Sort', rows: root.rows, cost: root.cost + c, startup: root.cost + c,
        kids: [root], sorted: { col: q.orderBy.ref.col, dir: q.orderBy.dir }, rels: root.rels,
        detail: { 'key': `${q.orderBy.ref.text} ${q.orderBy.dir}`, 'method': root.rows > 50000 ? 'external merge' : 'quicksort, in memory', 'rows': fmtRows(root.rows) },
        why: [`n log n over ${fmtRows(root.rows)} rows — nothing below produced this order`],
      };
    } else {
      root = { ...root, why: [...(root.why || []), `ORDER BY ${q.orderBy.ref.text} satisfied for free by the index order`] };
    }
  }

  if (q.limit != null) {
    const frac = Math.min(1, q.limit / Math.max(1, root.rows));
    root = {
      op: 'Limit', rows: Math.min(root.rows, q.limit),
      cost: root.startup + (root.cost - root.startup) * frac,
      startup: root.startup, kids: [root], sorted: root.sorted, rels: root.rels,
      detail: { 'rows': q.limit, 'fraction of input': (frac * 100).toFixed(1) + '%' },
      why: [root.startup >= root.cost * 0.95
        ? 'the input must be fully materialised first, so LIMIT saves almost nothing'
        : `only ${(frac * 100).toFixed(1)}% of the input has to be produced`],
    };
  }

  totalise(root);
  return { query: q, root, considered, alternatives, residual, resolve, catalog, sel };
}

function betterThan(a, b) {
  if (a.crossProduct !== b.crossProduct) return !a.crossProduct;
  return a.cost < b.cost;
}

/** Attach self-cost (cost minus children) so the UI can draw a cost share. */
function totalise(node) {
  for (const k of node.kids || []) totalise(k);
  const kidCost = (node.kids || []).reduce((s, k) => s + k.cost, 0);
  node.selfCost = Math.max(0, node.cost - kidCost);
  return node;
}

function* combinations(arr, k, start = 0, acc = []) {
  if (acc.length === k) { yield acc.slice(); return; }
  for (let i = start; i < arr.length; i++) { acc.push(arr[i]); yield* combinations(arr, k, i + 1, acc); acc.pop(); }
}

function* properSplits(list) {
  const n = list.length;
  for (let mask = 1; mask < (1 << n) - 1; mask++) {
    const a = [], b = [];
    for (let i = 0; i < n; i++) (mask & (1 << i) ? a : b).push(list[i]);
    if (a.length && b.length) yield [a, b];
  }
}

/* ── 7. A demo catalog ─────────────────────────────────────────────────── */
export const DEMO_CATALOG = {
  orders: {
    rows: 2_400_000,
    cols: {
      id: { ndv: 2_400_000 }, customer_id: { ndv: 180_000 },
      status: { ndv: 6 }, total: { ndv: 40_000, min: 1, max: 5000 },
      placed_at: { ndv: 900, min: 0, max: 900 },
    },
    indexes: [
      { name: 'orders_pkey', cols: ['id'], unique: true, clustered: true },
      { name: 'orders_customer_idx', cols: ['customer_id'] },
    ],
  },
  customers: {
    rows: 180_000,
    cols: { id: { ndv: 180_000 }, country: { ndv: 48 }, tier: { ndv: 4 }, signup_day: { ndv: 1200, min: 0, max: 1200 } },
    indexes: [
      { name: 'customers_pkey', cols: ['id'], unique: true, clustered: true },
      { name: 'customers_country_idx', cols: ['country'] },
    ],
  },
  line_items: {
    rows: 9_600_000,
    cols: { order_id: { ndv: 2_400_000 }, sku: { ndv: 22_000 }, qty: { ndv: 20, min: 1, max: 20 }, price: { ndv: 6000, min: 1, max: 900 } },
    indexes: [{ name: 'line_items_order_idx', cols: ['order_id'], clustered: true }],
  },
  products: {
    rows: 22_000,
    cols: { sku: { ndv: 22_000 }, category: { ndv: 32 }, supplier_id: { ndv: 900 } },
    indexes: [{ name: 'products_pkey', cols: ['sku'], unique: true, clustered: true }],
  },
};
