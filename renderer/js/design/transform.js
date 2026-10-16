// Matematika transformasi murni: resize terhadap handle (dengan rotasi), sudut rotasi, snap, hit-test.
import { rotatePoint } from './geometry.js';

export const HANDLES = {
  nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0],
};

/**
 * Mengubah ukuran kotak dengan menyeret `handle` ke `pointer` (koordinat halaman).
 * Sisi/sudut seberang tetap diam di halaman walau elemen diputar.
 */
export function resizeBox(box, rotation, handle, pointer, { keepAspect = false, minW = 4, minH = 4 } = {}) {
  const [hx, hy] = HANDLES[handle];
  const c0 = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const q = rotation ? rotatePoint(pointer.x, pointer.y, c0.x, c0.y, -rotation) : pointer;
  const ax = hx === 1 ? box.x : box.x + box.w;
  const ay = hy === 1 ? box.y : box.y + box.h;
  let w = hx === 0 ? box.w : (q.x - ax) * hx;
  let h = hy === 0 ? box.h : (q.y - ay) * hy;
  w = Math.max(minW, w);
  h = Math.max(minH, h);
  if (keepAspect && hx !== 0 && hy !== 0 && box.w > 0 && box.h > 0) {
    const s = Math.max(w / box.w, h / box.h);
    w = Math.max(minW, box.w * s);
    h = Math.max(minH, box.h * s);
  }
  const cx = hx === 0 ? c0.x : ax + (hx * w) / 2;
  const cy = hy === 0 ? c0.y : ay + (hy * h) / 2;
  const c1 = rotation ? rotatePoint(cx, cy, c0.x, c0.y, rotation) : { x: cx, y: cy };
  return { x: c1.x - w / 2, y: c1.y - h / 2, w, h };
}

/** Sudut (derajat) dari pusat ke pointer, dengan 0° = handle di atas. */
export function angleFromPointer(center, pointer) {
  return (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI + 90;
}

export function normAngle(deg) {
  let a = ((deg % 360) + 360) % 360;
  if (a > 180) a -= 360;
  return a;
}

/** Shift = kelipatan 15°; tanpa Shift menempel ke kelipatan 45° jika dekat (±3°). */
export function snapAngle(deg, shift) {
  const a = normAngle(deg);
  if (shift) return normAngle(Math.round(a / 15) * 15);
  const n = Math.round(a / 45) * 45;
  return Math.abs(a - n) <= 3 ? normAngle(n) : a;
}

/* ------------------------------ snap saat memindah ------------------------------ */
function bestDelta(values, targets, threshold) {
  let best = null;
  for (const v of values) for (const t of targets) {
    const d = t - v;
    if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
  }
  return best ?? 0;
}

/**
 * box: kotak selimut elemen yang dipindah. others: [{x,y,w,h}] kotak elemen lain. page: {width,height}.
 * Mengembalikan { dx, dy, guides } — guides: garis bantu {axis:'x'|'y', pos, from, to}.
 */
export function snapMove(box, others, page, threshold) {
  const xs = (b) => [b.x, b.x + b.w / 2, b.x + b.w];
  const ys = (b) => [b.y, b.y + b.h / 2, b.y + b.h];
  const pageBox = { x: 0, y: 0, w: page.width, h: page.height };
  const targets = [pageBox, ...others];
  const dx = bestDelta(xs(box), targets.flatMap(xs), threshold);
  const dy = bestDelta(ys(box), targets.flatMap(ys), threshold);
  const moved = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
  const guides = [];
  const eps = 0.5;
  const seenX = new Set(); const seenY = new Set();
  for (const t of targets) {
    for (const tx of xs(t)) for (const mx of xs(moved)) {
      if (Math.abs(tx - mx) < eps && !seenX.has(Math.round(tx * 10))) {
        seenX.add(Math.round(tx * 10));
        guides.push({ axis: 'x', pos: tx, from: Math.min(t.y, moved.y), to: Math.max(t.y + t.h, moved.y + moved.h) });
      }
    }
    for (const ty of ys(t)) for (const my of ys(moved)) {
      if (Math.abs(ty - my) < eps && !seenY.has(Math.round(ty * 10))) {
        seenY.add(Math.round(ty * 10));
        guides.push({ axis: 'y', pos: ty, from: Math.min(t.x, moved.x), to: Math.max(t.x + t.w, moved.x + moved.w) });
      }
    }
  }
  return { dx, dy, guides };
}

/* ------------------------------ hit-test ------------------------------ */
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1; const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function pointInElement(el, x, y, tol = 0) {
  const c = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
  const p = el.rotation ? rotatePoint(x, y, c.x, c.y, -el.rotation) : { x, y };
  if (el.type === 'line' || el.type === 'arrow') {
    return distToSegment(p.x, p.y, el.x, el.y, el.x + el.w, el.y) <= Math.max(tol, (el.strokeWidth || 2) / 2 + tol);
  }
  return p.x >= el.x - tol && p.x <= el.x + el.w + tol && p.y >= el.y - tol && p.y <= el.y + el.h + tol;
}

/** Elemen paling atas di titik tersebut (abaikan tersembunyi/terkunci). */
export function hitTest(elements, x, y, tol = 0) {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.hidden || el.locked) continue;
    if (pointInElement(el, x, y, tol)) return el;
  }
  return null;
}

/** Posisi penyisipan di doc.elements setelah seret layer. n = jumlah elemen, from = indeks asal, gap = celah tampilan (0 = paling atas). */
export function dropIndex(n, from, gap) {
  const insertAt = n - gap;
  return from < insertAt ? insertAt - 1 : insertAt;
}
