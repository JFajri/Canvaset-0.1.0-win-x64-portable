// Geometri murni: sudut, batas, jalur bentuk. Dipakai renderer layar, ekspor SVG, dan ekspor PNG/JPEG.

const rad = (d) => (d * Math.PI) / 180;

export function rotatePoint(px, py, cx, cy, deg) {
  const a = rad(deg);
  const dx = px - cx; const dy = py - cy;
  return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
}

export function elementCenter(el) { return { x: el.x + el.w / 2, y: el.y + el.h / 2 }; }

/** Empat sudut (tl, tr, br, bl) setelah rotasi, dalam koordinat halaman. */
export function elementCorners(el) {
  const c = elementCenter(el);
  const pts = [[el.x, el.y], [el.x + el.w, el.y], [el.x + el.w, el.y + el.h], [el.x, el.y + el.h]];
  return pts.map(([x, y]) => (el.rotation ? rotatePoint(x, y, c.x, c.y, el.rotation) : { x, y }));
}

export function pointsBounds(pts) {
  let x1 = Infinity; let y1 = Infinity; let x2 = -Infinity; let y2 = -Infinity;
  for (const p of pts) { x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y); }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1, x2, y2 };
}

export function elementBounds(el) { return pointsBounds(elementCorners(el)); }

export function unionBounds(elements) {
  if (!elements.length) return null;
  return pointsBounds(elements.flatMap((e) => elementCorners(e)));
}

export function rectsIntersect(a, b) {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

export function normRect(x1, y1, x2, y2) {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

const f = (n) => Math.round(n * 1000) / 1000;

/** Jalur SVG (d) bentuk dalam koordinat lokal 0..w, 0..h. */
export function shapePath(el) {
  const w = el.w; const h = el.h;
  switch (el.type) {
    case 'rect': {
      const r = Math.min(el.radius || 0, w / 2, h / 2);
      if (r <= 0) return `M0 0H${f(w)}V${f(h)}H0Z`;
      return `M${f(r)} 0H${f(w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)}V${f(h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(h)}H${f(r)}A${f(r)} ${f(r)} 0 0 1 0 ${f(h - r)}V${f(r)}A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0Z`;
    }
    case 'ellipse':
      return `M0 ${f(h / 2)}A${f(w / 2)} ${f(h / 2)} 0 1 0 ${f(w)} ${f(h / 2)}A${f(w / 2)} ${f(h / 2)} 0 1 0 0 ${f(h / 2)}Z`;
    case 'triangle':
      return `M${f(w / 2)} 0L${f(w)} ${f(h)}L0 ${f(h)}Z`;
    case 'star': {
      const cx = w / 2; const cy = h / 2; const parts = [];
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI) / 5;
        const k = i % 2 === 0 ? 1 : 0.42;
        parts.push(`${i ? 'L' : 'M'}${f(cx + Math.cos(ang) * (w / 2) * k)} ${f(cy + Math.sin(ang) * (h / 2) * k)}`);
      }
      return `${parts.join('')}Z`;
    }
    case 'line':
      return `M0 0H${f(w)}`;
    case 'arrow': {
      const hs = Math.max(10, (el.strokeWidth || 2) * 3.2);
      return `M0 0H${f(w)}M${f(w - hs)} ${f(-hs * 0.6)}L${f(w)} 0L${f(w - hs)} ${f(hs * 0.6)}`;
    }
    default:
      return '';
  }
}

export function elementTransform(el) {
  const rot = el.rotation ? ` rotate(${f(el.rotation)} ${f(el.w / 2)} ${f(el.h / 2)})` : '';
  return `translate(${f(el.x)} ${f(el.y)})${rot}`;
}

export const normalizeAngle = (deg) => {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
};
