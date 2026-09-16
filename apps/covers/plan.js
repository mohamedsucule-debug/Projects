/* ───────────────────────────────────────────────────────────────────────────
   covers/plan.js — drawing the room.

   Geometry only: metres to pixels, table outlines, and where the chairs go.
   No state, no events, no colours — those belong to whatever is drawing, and
   keeping them out means the layout can be checked without a browser.

   The chairs matter more than they look. A floor plan of bare rectangles reads
   as a spreadsheet with rounded corners; the moment there are four chairs
   round a four-top, a host can see the room. They are also how you tell a
   two-top from a four-top at a glance without reading the number — which is
   the entire job of a floor plan during service.
   ─────────────────────────────────────────────────────────────────────────── */

import { ROOM, TABLES, byId, seats } from './floor.js';

/** Metres → pixels for a given drawing width, with a margin for the walls. */
export function scaleFor(width, height, pad = 0.55) {
  const s = Math.min(width / (ROOM.w + pad * 2), height / (ROOM.h + pad * 2));
  return {
    s,
    x: (m) => (m + pad) * s,
    y: (m) => (m + pad) * s,
    len: (m) => m * s,
    width: (ROOM.w + pad * 2) * s,
    height: (ROOM.h + pad * 2) * s,
  };
}

/**
 * Where the chairs go round a table.
 *
 * Round tables get them spread evenly, starting from the top so a two-top
 * reads as two people facing each other rather than one above the other.
 * Rectangles get them along the long sides first and then the ends, which is
 * how anybody actually lays up a table — and the ends are the seats you gain
 * when two tables are pushed together.
 */
export function chairs(t) {
  const out = [];
  const n = t.seats;

  if (t.shape === 'stool') {
    for (let i = 0; i < n; i++) {
      out.push({ x: t.x + (i - (n - 1) / 2) * 0.55, y: t.y + 0.42, a: 0 });
    }
    return out;
  }

  if (t.shape === 'round') {
    const r = t.w / 2 + 0.30;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      out.push({ x: t.x + Math.cos(a) * r, y: t.y + Math.sin(a) * r, a: a + Math.PI / 2 });
    }
    return out;
  }

  const along = t.w >= t.h;
  const longSide = along ? t.w : t.h;
  const perSide = Math.min(Math.ceil(n / 2), Math.max(1, Math.floor(longSide / 0.62)));
  const ends = n - perSide * 2;

  for (const side of [-1, 1]) {
    for (let i = 0; i < perSide; i++) {
      const o = (i - (perSide - 1) / 2) * (longSide / Math.max(perSide, 1)) * 0.86;
      if (along) out.push({ x: t.x + o, y: t.y + side * (t.h / 2 + 0.30), a: side > 0 ? 0 : Math.PI });
      else out.push({ x: t.x + side * (t.w / 2 + 0.30), y: t.y + o, a: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
    }
  }
  for (let i = 0; i < Math.max(0, ends); i++) {
    const side = i % 2 ? 1 : -1;
    if (along) out.push({ x: t.x + side * (t.w / 2 + 0.30), y: t.y, a: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
    else out.push({ x: t.x, y: t.y + side * (t.h / 2 + 0.30), a: side > 0 ? 0 : Math.PI });
  }
  return out.slice(0, n);
}

/**
 * The outline of a set of tables pushed together.
 *
 * Two joined tables are drawn as ONE table, because that is what they are once
 * they are pushed together — drawing two rectangles touching leaves a seam
 * down the middle of a party of eight and makes the floor plan lie about the
 * room. The union is taken as the bounding box of the group, which is exact
 * for the runs this room allows (tables only join in a straight line).
 */
export function outline(tableIds) {
  const group = tableIds.map((id) => byId.get(id)).filter(Boolean);
  if (!group.length) return null;
  const x0 = Math.min(...group.map((t) => t.x - t.w / 2));
  const x1 = Math.max(...group.map((t) => t.x + t.w / 2));
  const y0 = Math.min(...group.map((t) => t.y - t.h / 2));
  const y1 = Math.max(...group.map((t) => t.y + t.h / 2));
  const round = group.length === 1 && group[0].shape === 'round';
  return {
    x: x0, y: y0, w: x1 - x0, h: y1 - y0,
    cx: (x0 + x1) / 2, cy: (y0 + y1) / 2,
    round,
    /* A run of pushed-together tables gets softened corners rather than the
       full radius of a round table, so it still reads as a made-up long table
       rather than a lozenge. */
    r: round ? Math.min(x1 - x0, y1 - y0) / 2 : (group.length > 1 ? 0.10 : 0.07),
  };
}

/**
 * Every chair round a joined group.
 *
 * Two things happen when tables are pushed together, and the drawing has to do
 * both or it contradicts the model sitting next to it. Chairs that end up
 * inside the joined footprint are now under another table, so they go — and
 * the ends of the run, which were nobody's seat while the tables were apart,
 * become seats, which is why a four and a four is a nine.
 *
 * Getting only the first half right draws eight chairs round a table the
 * system will happily sell to nine people, and somebody counting chairs on
 * the screen is right and the software is wrong.
 */
export function groupChairs(tableIds) {
  const group = tableIds.map((id) => byId.get(id)).filter(Boolean);
  if (group.length < 2) return group.flatMap(chairs);

  const box = outline(tableIds);
  const kept = group.flatMap(chairs).filter((c) =>
    c.x < box.x + 0.02 || c.x > box.x + box.w - 0.02 ||
    c.y < box.y + 0.02 || c.y > box.y + box.h - 0.02);

  const wide = box.w >= box.h;
  const gained = seats(group) - kept.length;
  for (let i = 0; i < gained; i++) {
    const side = i % 2 ? 1 : -1;
    const step = Math.floor(i / 2) * 0.62;
    kept.push(wide
      ? { x: box.cx + side * (box.w / 2 + 0.30), y: box.cy + step, a: side > 0 ? -Math.PI / 2 : Math.PI / 2 }
      : { x: box.cx + step, y: box.cy + side * (box.h / 2 + 0.30), a: side > 0 ? 0 : Math.PI });
  }
  return kept;
}

/** A table's own label position — the middle, unless it is a stool. */
export function labelAt(t) {
  return t.shape === 'stool' ? { x: t.x, y: t.y - 0.05 } : { x: t.x, y: t.y };
}

/** Which table, if any, is under a point in room coordinates. */
export function tableAt(mx, my, slack = 0.34) {
  let best = null, bestD = Infinity;
  for (const t of TABLES) {
    const dx = Math.max(Math.abs(mx - t.x) - t.w / 2, 0);
    const dy = Math.max(Math.abs(my - t.y) - t.h / 2, 0);
    const d = Math.hypot(dx, dy);
    /* A slack radius, so a drop that lands on a chair or just beside a table
       counts as that table. Requiring a hit on the table top exactly is
       precise, correct, and infuriating to use. */
    if (d < slack && d < bestD) { best = t; bestD = d; }
  }
  return best;
}
