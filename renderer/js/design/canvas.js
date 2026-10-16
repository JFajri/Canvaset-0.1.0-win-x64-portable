// Pengendali kanvas: render SVG + semua interaksi pointer. Tidak mengenal panel/properti.
import { svgEl, NS, SvgRenderer } from './render.js';
import { elementCorners, elementBounds, unionBounds, rectsIntersect, normRect, rotatePoint } from './geometry.js';
import { HANDLES, resizeBox, angleFromPointer, snapAngle, snapMove, hitTest } from './transform.js';
import { FONT_STACKS } from './model.js';
import { layoutText } from './text.js';

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
const HANDLE = 9;
const HIT = 9;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];
function cursorFor(handle, rotation) {
  const [hx, hy] = HANDLES[handle];
  const base = hx !== 0 && hy === 0 ? 0 : hx === 0 ? 2 : (hx === hy ? 1 : 3);
  const steps = Math.round(((rotation % 180) + 180) % 180 / 45);
  return CURSORS[(base + steps) % 4];
}

export class CanvasController {
  constructor({ container, session, env, onView = () => {}, onTool = () => {}, onContext = () => {}, onTextEdit = () => {} }) {
    this.container = container;
    this.session = session;
    this.env = env;
    this.onView = onView; this.onTool = onTool; this.onContext = onContext; this.onTextEdit = onTextEdit;
    this.zoom = 1; this.panX = 0; this.panY = 0;
    this.tool = 'select';
    this.snap = true;
    this.space = false;
    this.autoFit = true;
    this.inter = null;
    this.hoverId = null;
    this.editing = null;
    this.guides = [];
    this.ghost = null;
    this.raf = 0;
    this.build();
    this.unsub = [
      session.on('change', () => this.requestRender()),
      session.on('selection', () => this.requestRender()),
    ];
    this.ro = new ResizeObserver(() => { if (this.autoFit) this.fit(false); else this.requestRender(); });
    this.ro.observe(container);
    this.fit(false);
  }

  /* ------------------------------------------------------------ DOM */
  build() {
    this.svg = svgEl('svg', { class: 'stage', width: '100%', height: '100%' });
    const defs = svgEl('defs', null,
      svgEl('filter', { id: 'page-shadow', x: '-10%', y: '-10%', width: '120%', height: '120%' }, svgEl('feDropShadow', { dx: 0, dy: 6, stdDeviation: 14, 'flood-color': '#000', 'flood-opacity': 0.35 })),
      this.pageClip = svgEl('clipPath', { id: 'page-clip-live' }, this.pageClipRect = svgEl('rect')));
    this.world = svgEl('g', { class: 'world' });
    this.pageShadow = svgEl('rect', { filter: 'url(#page-shadow)', fill: '#000' });
    this.pageRect = svgEl('rect', { class: 'page' });
    this.content = svgEl('g', { 'clip-path': 'url(#page-clip-live)' });
    this.world.append(this.pageShadow, this.pageRect, this.content);
    this.overlay = svgEl('g', { class: 'overlay' });
    this.svg.append(defs, this.world, this.overlay);
    this.hud = document.createElement('div');
    this.hud.className = 'hud';
    this.hud.hidden = true;
    this.container.append(this.svg, this.hud);
    this.renderer = new SvgRenderer(this.content, this.env);

    const s = this.svg;
    s.addEventListener('pointerdown', (e) => this.onDown(e));
    s.addEventListener('pointermove', (e) => this.onMove(e));
    s.addEventListener('pointerup', (e) => this.onUp(e));
    s.addEventListener('pointercancel', (e) => this.onUp(e, true));
    s.addEventListener('dblclick', (e) => this.onDbl(e));
    s.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    s.addEventListener('contextmenu', (e) => this.onCtx(e));
    s.addEventListener('pointerleave', () => { if (!this.inter && this.hoverId) { this.hoverId = null; this.requestRender(); } });
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.unsub.forEach((u) => u());
    this.ro.disconnect();
    this.stopTextEdit(true);
    this.svg.remove(); this.hud.remove();
    if (this.editor) this.editor.remove();
  }

  /* ------------------------------------------------------------ koordinat */
  rect() { return this.svg.getBoundingClientRect(); }
  toWorld(cx, cy) { const r = this.rect(); return { x: (cx - r.left - this.panX) / this.zoom, y: (cy - r.top - this.panY) / this.zoom }; }
  toScreen(x, y) { return { x: this.panX + x * this.zoom, y: this.panY + y * this.zoom }; }

  /* ------------------------------------------------------------ viewport */
  setTool(t) {
    if (this.tool === t) return;
    this.tool = t;
    this.svg.dataset.tool = t;
    this.onTool(t);
    this.requestRender();
  }

  fit(manual = true, padding = 56) {
    const r = this.rect();
    if (!r.width || !r.height) return;
    const p = this.session.doc.page;
    const z = clamp(Math.min((r.width - padding * 2) / p.width, (r.height - padding * 2) / p.height), MIN_ZOOM, 2);
    this.zoom = z;
    this.panX = (r.width - p.width * z) / 2;
    this.panY = (r.height - p.height * z) / 2;
    if (manual) this.autoFit = true;
    this.viewChanged();
  }

  setZoom(z, anchor) {
    z = clamp(z, MIN_ZOOM, MAX_ZOOM);
    const r = this.rect();
    const a = anchor || { x: r.width / 2, y: r.height / 2 };
    const wx = (a.x - this.panX) / this.zoom; const wy = (a.y - this.panY) / this.zoom;
    this.zoom = z;
    this.panX = a.x - wx * z; this.panY = a.y - wy * z;
    this.autoFit = false;
    this.viewChanged();
  }

  zoomBy(f) { this.setZoom(this.zoom * f); }

  zoomToSelection() {
    const sel = this.session.selected();
    if (!sel.length) { this.fit(); return; }
    const b = unionBounds(sel);
    const r = this.rect();
    const pad = 80;
    const z = clamp(Math.min((r.width - pad * 2) / Math.max(1, b.w), (r.height - pad * 2) / Math.max(1, b.h)), MIN_ZOOM, 4);
    this.zoom = z;
    this.panX = r.width / 2 - (b.x + b.w / 2) * z;
    this.panY = r.height / 2 - (b.y + b.h / 2) * z;
    this.autoFit = false;
    this.viewChanged();
  }

  viewChanged() { this.onView({ zoom: this.zoom }); this.requestRender(); }

  /* ------------------------------------------------------------ render */
  requestRender() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); });
  }

  render() {
    const doc = this.session.doc;
    const p = doc.page;
    this.world.setAttribute('transform', `translate(${this.panX} ${this.panY}) scale(${this.zoom})`);
    for (const r of [this.pageShadow, this.pageRect, this.pageClipRect]) { r.setAttribute('width', p.width); r.setAttribute('height', p.height); }
    this.pageRect.setAttribute('fill', p.background === 'transparent' ? 'none' : p.background);
    this.env.hideTextId = this.editing ? this.editing.id : null;
    this.renderer.sync(doc.elements);
    this.drawOverlay();
    if (this.editing) this.positionEditor();
  }

  drawOverlay() {
    const o = this.overlay;
    while (o.firstChild) o.removeChild(o.firstChild);
    const accent = 'var(--accent)';
    const sel = this.session.selected().filter((e) => !e.hidden);
    const poly = (pts, attrs) => svgEl('polygon', { points: pts.map((q) => `${q.x},${q.y}`).join(' '), fill: 'none', ...attrs });
    const scr = (el) => elementCorners(el).map((c) => this.toScreen(c.x, c.y));

    // hover
    if (this.hoverId && !this.inter && this.tool === 'select' && !this.session.selection.has(this.hoverId)) {
      const el = this.session.get(this.hoverId);
      if (el && !el.hidden) o.appendChild(poly(scr(el), { stroke: accent, 'stroke-width': 1.2, 'stroke-opacity': 0.7 }));
    }
    // seleksi
    for (const el of sel) {
      const pts = scr(el);
      if (el.type === 'line' || el.type === 'arrow') o.appendChild(svgEl('line', { x1: pts[0].x, y1: pts[0].y, x2: pts[1].x, y2: pts[1].y, stroke: accent, 'stroke-width': Math.max(1.5, el.strokeWidth * this.zoom + 2), 'stroke-opacity': 0.28, 'stroke-linecap': 'round' }));
      else o.appendChild(poly(pts, { stroke: accent, 'stroke-width': 1.5, 'stroke-dasharray': sel.length > 1 ? '5 4' : null }));
    }
    if (sel.length > 1) {
      const b = unionBounds(sel);
      const a = this.toScreen(b.x, b.y);
      o.appendChild(svgEl('rect', { x: a.x - 3, y: a.y - 3, width: b.w * this.zoom + 6, height: b.h * this.zoom + 6, fill: 'none', stroke: accent, 'stroke-width': 1, 'stroke-opacity': 0.8 }));
    }
    // handle (satu elemen, tidak terkunci)
    this.handleDefs = [];
    if (sel.length === 1 && !sel[0].locked && !this.editing && this.tool === 'select') {
      const el = sel[0];
      const c = scr(el);
      const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const pos = { nw: c[0], ne: c[1], se: c[2], sw: c[3], n: mid(c[0], c[1]), e: mid(c[1], c[2]), s: mid(c[2], c[3]), w: mid(c[3], c[0]) };
      if (el.type === 'line' || el.type === 'arrow') {
        this.handleDefs.push({ kind: 'lineEnd', end: 'start', ...c[0], cursor: 'move' }, { kind: 'lineEnd', end: 'end', ...c[1], cursor: 'move' });
      } else {
        const names = el.type === 'text' ? ['nw', 'ne', 'se', 'sw', 'e', 'w'] : Object.keys(pos);
        for (const n of names) this.handleDefs.push({ kind: 'resize', handle: n, ...pos[n], cursor: cursorFor(n, el.rotation) });
        const center = { x: (c[0].x + c[2].x) / 2, y: (c[0].y + c[2].y) / 2 };
        const tm = pos.n;
        const dx = tm.x - center.x; const dy = tm.y - center.y; const len = Math.hypot(dx, dy) || 1;
        const rp = { x: tm.x + (dx / len) * 26, y: tm.y + (dy / len) * 26 };
        o.appendChild(svgEl('line', { x1: tm.x, y1: tm.y, x2: rp.x, y2: rp.y, stroke: accent, 'stroke-width': 1 }));
        this.handleDefs.push({ kind: 'rotate', ...rp, cursor: 'grab' });
      }
      for (const d of this.handleDefs) {
        if (d.kind === 'rotate') o.appendChild(svgEl('circle', { cx: d.x, cy: d.y, r: 5.5, fill: 'var(--surface-1)', stroke: accent, 'stroke-width': 1.6 }));
        else if (d.kind === 'lineEnd') o.appendChild(svgEl('circle', { cx: d.x, cy: d.y, r: 5.5, fill: '#fff', stroke: accent, 'stroke-width': 1.8 }));
        else o.appendChild(svgEl('rect', { x: d.x - HANDLE / 2, y: d.y - HANDLE / 2, width: HANDLE, height: HANDLE, rx: 2, fill: '#fff', stroke: accent, 'stroke-width': 1.5 }));
      }
    }
    // panduan snap
    for (const g of this.guides) {
      const a = g.axis === 'x' ? this.toScreen(g.pos, g.from) : this.toScreen(g.from, g.pos);
      const b = g.axis === 'x' ? this.toScreen(g.pos, g.to) : this.toScreen(g.to, g.pos);
      o.appendChild(svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: '#ff3d71', 'stroke-width': 1, 'stroke-dasharray': '4 3' }));
    }
    // marquee / ghost
    if (this.ghost) {
      const g = this.ghost;
      if (g.line) o.appendChild(svgEl('line', { x1: g.a.x, y1: g.a.y, x2: g.b.x, y2: g.b.y, stroke: accent, 'stroke-width': 2, 'stroke-dasharray': '5 4' }));
      else o.appendChild(svgEl('rect', { x: g.x, y: g.y, width: g.w, height: g.h, fill: g.marquee ? 'var(--accent-soft)' : 'none', stroke: accent, 'stroke-width': 1.2, 'stroke-dasharray': g.marquee ? null : '5 4' }));
    }
  }

  setHud(text, e) {
    if (!text) { this.hud.hidden = true; return; }
    const r = this.container.getBoundingClientRect();
    this.hud.hidden = false;
    this.hud.textContent = text;
    this.hud.style.left = `${clamp(e.clientX - r.left + 14, 4, r.width - 120)}px`;
    this.hud.style.top = `${clamp(e.clientY - r.top + 16, 4, r.height - 30)}px`;
  }

  /* ------------------------------------------------------------ pointer */
  screenPt(e) { const r = this.rect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  hitHandle(e) {
    if (!this.handleDefs || !this.handleDefs.length) return null;
    const p = this.screenPt(e);
    let best = null; let bd = HIT;
    for (const d of this.handleDefs) {
      const dist = Math.hypot(d.x - p.x, d.y - p.y);
      if (dist <= bd) { best = d; bd = dist; }
    }
    return best;
  }

  onDown(e) {
    if (this.editing) { this.stopTextEdit(true); }
    this.svg.focus({ preventScroll: true });
    const mid = e.button === 1;
    if (e.button === 2) return;
    if (mid || this.tool === 'hand' || this.space) {
      e.preventDefault();
      this.svg.setPointerCapture(e.pointerId);
      this.inter = { type: 'pan', sx: e.clientX, sy: e.clientY, px: this.panX, py: this.panY };
      this.svg.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    this.svg.setPointerCapture(e.pointerId);
    const w = this.toWorld(e.clientX, e.clientY);
    const S = this.session;

    if (this.tool !== 'select') {
      this.inter = { type: 'create', tool: this.tool, start: w, sx: e.clientX, sy: e.clientY, moved: false };
      return;
    }

    const handle = this.hitHandle(e);
    if (handle) {
      const el = S.selected()[0];
      if (handle.kind === 'resize') this.inter = { type: 'resize', handle: handle.handle, el0: structuredClone(el), id: el.id, moved: false };
      else if (handle.kind === 'rotate') {
        const c = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
        this.inter = { type: 'rotate', id: el.id, c, a0: angleFromPointer(c, w), r0: el.rotation, moved: false };
      } else {
        const corners = elementCorners(el);
        const fixed = handle.end === 'start' ? corners[1] : corners[0];
        this.inter = { type: 'lineEnd', id: el.id, fixed, moved: false };
      }
      return;
    }

    const tol = 3 / this.zoom;
    const hit = hitTest(S.doc.elements, w.x, w.y, tol);
    if (hit) {
      if (e.shiftKey) { S.select([hit.id], { toggle: true }); this.inter = { type: 'none' }; return; }
      if (!S.selection.has(hit.id)) S.select([hit.id]);
      const ids = Array.from(S.selection);
      const start = new Map(S.doc.elements.filter((x) => ids.includes(x.id)).map((x) => [x.id, { x: x.x, y: x.y }]));
      const bounds = unionBounds(S.selected());
      this.inter = { type: 'move', start, bounds, p0: w, sx: e.clientX, sy: e.clientY, moved: false, ids };
      return;
    }
    if (!e.shiftKey) S.clearSelection();
    this.inter = { type: 'marquee', p0: w, add: e.shiftKey, base: new Set(S.selection), moved: false, sx: e.clientX, sy: e.clientY };
  }

  onMove(e) {
    const it = this.inter;
    if (!it) {
      if (this.tool === 'select' && !(e.buttons)) {
        const h = this.hitHandle(e);
        if (h) { this.svg.style.cursor = h.cursor; return; }
        const w = this.toWorld(e.clientX, e.clientY);
        const hit = hitTest(this.session.doc.elements, w.x, w.y, 3 / this.zoom);
        const id = hit ? hit.id : null;
        this.svg.style.cursor = this.space ? 'grab' : hit ? (this.session.selection.has(id) ? 'move' : 'default') : 'default';
        if (id !== this.hoverId) { this.hoverId = id; this.requestRender(); }
      } else if (this.tool === 'hand' || this.space) this.svg.style.cursor = 'grab';
      else if (this.tool !== 'select') this.svg.style.cursor = 'crosshair';
      return;
    }
    const S = this.session;
    const w = this.toWorld(e.clientX, e.clientY);

    if (it.type === 'pan') {
      this.panX = it.px + (e.clientX - it.sx); this.panY = it.py + (e.clientY - it.sy);
      this.autoFit = false;
      this.viewChanged();
      return;
    }

    if (it.type === 'move') {
      if (!it.moved && Math.hypot(e.clientX - it.sx, e.clientY - it.sy) < 3) return;
      it.moved = true;
      let dx = w.x - it.p0.x; let dy = w.y - it.p0.y;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      this.guides = [];
      if (this.snap && !e.altKey) {
        const others = S.doc.elements.filter((x) => !it.ids.includes(x.id) && !x.hidden).map((x) => elementBounds(x)).filter((b) => b.w >= 0);
        const box = { x: it.bounds.x + dx, y: it.bounds.y + dy, w: it.bounds.w, h: it.bounds.h };
        const sn = snapMove(box, others, S.doc.page, 6 / this.zoom);
        dx += sn.dx; dy += sn.dy;
        this.guides = sn.guides;
      }
      S.apply((d) => { for (const el of d.elements) { const s = it.start.get(el.id); if (s) { el.x = s.x + dx; el.y = s.y + dy; } } }, { commit: false });
      this.setHud(`X ${Math.round(it.bounds.x + dx)}  Y ${Math.round(it.bounds.y + dy)}`, e);
      return;
    }

    if (it.type === 'resize') {
      it.moved = true;
      this.applyResize(it, w, e);
      return;
    }

    if (it.type === 'lineEnd') {
      it.moved = true;
      let p = w;
      if (e.shiftKey) {
        const ang = Math.round((Math.atan2(p.y - it.fixed.y, p.x - it.fixed.x) * 180 / Math.PI) / 15) * 15 * Math.PI / 180;
        const len = Math.hypot(p.x - it.fixed.x, p.y - it.fixed.y);
        p = { x: it.fixed.x + Math.cos(ang) * len, y: it.fixed.y + Math.sin(ang) * len };
      }
      const patch = this.lineFrom(it.fixed, p, S.get(it.id));
      S.setProps([it.id], patch, { commit: false });
      this.setHud(`${Math.round(patch.w)} px`, e);
      return;
    }

    if (it.type === 'rotate') {
      it.moved = true;
      const a = snapAngle(angleFromPointer(it.c, w) - it.a0 + it.r0, e.shiftKey);
      S.setProps([it.id], { rotation: Math.round(a * 10) / 10 }, { commit: false });
      this.setHud(`${Math.round(a)}°`, e);
      return;
    }

    if (it.type === 'marquee') {
      if (!it.moved && Math.hypot(e.clientX - it.sx, e.clientY - it.sy) < 3) return;
      it.moved = true;
      const r = normRect(it.p0.x, it.p0.y, w.x, w.y);
      const a = this.toScreen(r.x, r.y);
      this.ghost = { marquee: true, x: a.x, y: a.y, w: r.w * this.zoom, h: r.h * this.zoom };
      const hits = S.doc.elements.filter((el) => !el.hidden && !el.locked && rectsIntersect(elementBounds(el), r)).map((el) => el.id);
      const ids = it.add ? [...it.base, ...hits] : hits;
      S.selection = new Set(ids);
      S.emit('selection');
      this.requestRender();
      return;
    }

    if (it.type === 'create') {
      if (!it.moved && Math.hypot(e.clientX - it.sx, e.clientY - it.sy) < 4) return;
      it.moved = true;
      let a = it.start; let b = w;
      if (this.tool === 'line' || this.tool === 'arrow') {
        if (e.shiftKey) {
          const ang = Math.round((Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI) / 15) * 15 * Math.PI / 180;
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          b = { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
        }
        const A = this.toScreen(a.x, a.y); const B = this.toScreen(b.x, b.y);
        this.ghost = { line: true, a: A, b: B };
        this.setHud(`${Math.round(Math.hypot(b.x - a.x, b.y - a.y))} px`, e);
      } else {
        let r = normRect(a.x, a.y, b.x, b.y);
        if (e.shiftKey && this.tool !== 'text') { const s = Math.max(r.w, r.h); r = { x: b.x < a.x ? a.x - s : a.x, y: b.y < a.y ? a.y - s : a.y, w: s, h: s }; }
        const A = this.toScreen(r.x, r.y);
        this.ghost = { x: A.x, y: A.y, w: r.w * this.zoom, h: r.h * this.zoom };
        it.rect = r;
        this.setHud(`${Math.round(r.w)} × ${Math.round(r.h)}`, e);
      }
      it.end = b;
      this.requestRender();
    }
  }

  lineFrom(a, b, el) {
    const len = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    const cx = (a.x + b.x) / 2; const cy = (a.y + b.y) / 2;
    const rot = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    return { x: cx - len / 2, y: cy, w: len, h: 0, rotation: Math.round(rot * 10) / 10 };
  }

  applyResize(it, w, e) {
    const S = this.session;
    const el0 = it.el0;
    const [hx, hy] = HANDLES[it.handle];
    const corner = hx !== 0 && hy !== 0;
    const isText = el0.type === 'text';
    const keep = isText ? corner : (el0.type === 'image' ? (corner && !e.shiftKey) : (corner && e.shiftKey));
    const box = { x: el0.x, y: el0.y, w: el0.w, h: el0.type === 'text' ? layoutText(el0).height : el0.h };
    const r = resizeBox(box, el0.rotation, it.handle, w, { keepAspect: keep, minW: isText ? 20 : 4, minH: isText ? 1 : 4 });
    const patch = { x: r.x, y: r.y, w: r.w };
    if (!isText) patch.h = r.h;
    if (isText && corner) {
      patch.fontSize = clamp(Math.round(el0.fontSize * (r.w / el0.w)), 4, 1000);
    }
    S.setProps([it.id], patch, { commit: false });
    if (isText && hy === -1) {
      // pertahankan sisi bawah ketika menyeret handle atas (tinggi teks otomatis)
      const cur = S.get(it.id);
      const dh = cur.h - box.h;
      S.setProps([it.id], { y: patch.y + (box.h - cur.h) + (r.h - box.h) + dh }, { commit: false });
    }
    const cur = S.get(it.id);
    this.setHud(`${Math.round(cur.w)} × ${Math.round(cur.h)}`, e);
  }

  onUp(e, cancelled) {
    const it = this.inter;
    this.inter = null;
    this.guides = [];
    this.ghost = null;
    this.setHud(null);
    try { this.svg.releasePointerCapture(e.pointerId); } catch (_) { /* tidak aktif */ }
    this.svg.style.cursor = this.tool === 'hand' || this.space ? 'grab' : this.tool === 'select' ? 'default' : 'crosshair';
    if (!it) return;
    const S = this.session;
    if (it.type === 'move' || it.type === 'resize' || it.type === 'rotate' || it.type === 'lineEnd') {
      if (it.moved && !cancelled) S.commit(it.type); else if (it.moved) S.undo();
    } else if (it.type === 'create' && !cancelled) {
      this.finishCreate(it, e);
    }
    this.requestRender();
  }

  finishCreate(it, e) {
    const S = this.session;
    const t = it.tool;
    const p = it.start;
    let el = null;
    if (t === 'text') {
      const w = it.moved && it.rect && it.rect.w > 30 ? it.rect.w : 420;
      const x = it.moved && it.rect ? it.rect.x : p.x;
      const y = it.moved && it.rect ? it.rect.y : p.y;
      el = S.addElement('text', { x: Math.round(x), y: Math.round(y), w: Math.round(w), text: 'Teks baru' });
    } else if (t === 'line' || t === 'arrow') {
      let patch;
      if (it.moved) patch = this.lineFrom(p, it.end, null);
      else patch = { x: p.x - 120, y: p.y, w: 240, h: 0, rotation: 0 };
      el = S.addElement(t, patch);
    } else {
      const defaults = { rect: [240, 160], ellipse: [200, 200], triangle: [200, 180], star: [200, 200] }[t] || [200, 200];
      const r = it.moved && it.rect && it.rect.w > 3 && it.rect.h > 3 ? it.rect : { x: p.x - defaults[0] / 2, y: p.y - defaults[1] / 2, w: defaults[0], h: defaults[1] };
      el = S.addElement(t, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });
    }
    this.setTool('select');
    if (el && el.type === 'text') setTimeout(() => this.startTextEdit(el.id, { selectAll: true }), 0);
  }

  onDbl(e) {
    if (this.tool !== 'select') return;
    const w = this.toWorld(e.clientX, e.clientY);
    const hit = hitTest(this.session.doc.elements, w.x, w.y, 3 / this.zoom);
    if (hit && hit.type === 'text') { this.session.select([hit.id]); this.startTextEdit(hit.id, {}); }
  }

  onCtx(e) {
    e.preventDefault();
    const w = this.toWorld(e.clientX, e.clientY);
    const hit = hitTest(this.session.doc.elements, w.x, w.y, 3 / this.zoom);
    if (hit && !this.session.selection.has(hit.id)) this.session.select([hit.id]);
    if (!hit) this.session.clearSelection();
    this.onContext(e, hit);
  }

  onWheel(e) {
    e.preventDefault();
    if (this.editing) return;
    if (e.ctrlKey || e.metaKey) {
      const f = Math.exp(-e.deltaY * 0.0016);
      this.setZoom(this.zoom * f, this.screenPt(e));
    } else {
      this.panX -= e.shiftKey ? e.deltaY : e.deltaX;
      this.panY -= e.shiftKey ? 0 : e.deltaY;
      this.autoFit = false;
      this.viewChanged();
    }
  }

  setSpace(on) {
    if (this.space === on) return;
    this.space = on;
    if (!this.inter) this.svg.style.cursor = on ? 'grab' : this.tool === 'select' ? 'default' : 'crosshair';
  }

  /* ------------------------------------------------------------ edit teks */
  startTextEdit(id, { selectAll = false } = {}) {
    const el = this.session.get(id);
    if (!el || el.type !== 'text' || el.locked) return;
    this.stopTextEdit(true);
    this.editing = { id, original: el.text };
    if (!this.editor) {
      this.editor = document.createElement('textarea');
      this.editor.className = 'text-edit';
      this.editor.spellcheck = false;
      this.editor.setAttribute('aria-label', 'Edit teks');
      this.editor.addEventListener('input', () => {
        if (!this.editing) return;
        this.session.setProps([this.editing.id], { text: this.editor.value }, { commit: false });
        this.positionEditor();
      });
      this.editor.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); this.stopTextEdit(false); }
        else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.stopTextEdit(true); }
      });
      this.editor.addEventListener('blur', () => { if (this.editing) this.stopTextEdit(true); });
      this.editor.addEventListener('pointerdown', (e) => e.stopPropagation());
      this.container.appendChild(this.editor);
    }
    this.editor.hidden = false;
    this.editor.value = el.text;
    this.requestRender();
    this.positionEditor();
    this.editor.focus();
    if (selectAll) this.editor.select(); else this.editor.setSelectionRange(this.editor.value.length, this.editor.value.length);
    this.onTextEdit(true);
  }

  positionEditor() {
    if (!this.editing || !this.editor) return;
    const el = this.session.get(this.editing.id);
    if (!el) { this.stopTextEdit(false); return; }
    const z = this.zoom;
    const p = this.toScreen(el.x, el.y);
    const ed = this.editor;
    ed.style.left = `${p.x}px`; ed.style.top = `${p.y}px`;
    ed.style.width = `${el.w * z}px`; ed.style.height = `${Math.max(el.h * z, el.fontSize * el.lineHeight * z)}px`;
    ed.style.fontFamily = FONT_STACKS[el.fontFamily];
    ed.style.fontSize = `${el.fontSize * z}px`;
    ed.style.fontWeight = String(el.fontWeight);
    ed.style.fontStyle = el.italic ? 'italic' : 'normal';
    ed.style.lineHeight = String(el.lineHeight);
    ed.style.letterSpacing = `${(el.letterSpacing || 0) * z}px`;
    ed.style.textAlign = el.align;
    ed.style.color = el.fill === 'none' ? 'inherit' : el.fill;
    ed.style.textDecoration = el.underline ? 'underline' : 'none';
    ed.style.opacity = String(el.opacity);
    ed.style.transform = el.rotation ? `rotate(${el.rotation}deg)` : 'none';
    ed.style.transformOrigin = '50% 50%';
  }

  stopTextEdit(commit) {
    if (!this.editing) return;
    const { id, original } = this.editing;
    this.editing = null;
    const ed = this.editor;
    if (ed) { ed.hidden = true; }
    const S = this.session;
    const el = S.get(id);
    if (el) {
      if (!commit) S.setProps([id], { text: original }, { commit: false });
      if (commit && el.text.trim() === '') S.deleteIds([id]);
      else S.commit(`text:${id}`);
    }
    this.onTextEdit(false);
    this.requestRender();
  }
}
