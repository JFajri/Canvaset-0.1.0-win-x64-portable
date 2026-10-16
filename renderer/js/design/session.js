// Sesi desain: dokumen + seleksi + riwayat + operasi pengeditan. Tanpa DOM.
import { makeElement, newId, parseDocument, serializeDocument } from './model.js';
import { History } from './history.js';
import { elementBounds, unionBounds } from './geometry.js';

let clipboard = null; // salinan elemen untuk Ctrl+C / Ctrl+V (internal aplikasi)
let pasteCount = 0;

export class DesignSession {
  /**
   * @param doc dokumen ter-normalisasi
   * @param opts.measureText (el) => tinggi px, opsional (dipasok renderer; di Node dilewati)
   */
  constructor(doc, { measureText = null } = {}) {
    this.doc = doc;
    this.measureText = measureText;
    this.selection = new Set();
    this.history = new History();
    this.listeners = new Map();
    this._normalize();
    this.history.reset(this._snap());
    this.savedSnap = this.history.current();
    this.dirty = false;
  }

  static fromText(text, opts) { return new DesignSession(parseDocument(text), opts); }

  /* ------------------------------- event ------------------------------- */
  on(evt, fn) {
    if (!this.listeners.has(evt)) this.listeners.set(evt, new Set());
    this.listeners.get(evt).add(fn);
    return () => this.listeners.get(evt).delete(fn);
  }

  emit(evt, data) {
    const s = this.listeners.get(evt);
    if (s) for (const fn of Array.from(s)) fn(data);
  }

  /* ------------------------------- state ------------------------------- */
  get elements() { return this.doc.elements; }
  get(id) { return this.doc.elements.find((e) => e.id === id) || null; }
  selected() { return this.doc.elements.filter((e) => this.selection.has(e.id)); }
  serialize() { return serializeDocument(this.doc); }

  _snap() { return JSON.stringify({ page: this.doc.page, elements: this.doc.elements }); }

  _normalize() {
    for (const el of this.doc.elements) {
      if (el.type === 'text' && this.measureText) el.h = Math.max(1, Math.ceil(this.measureText(el)));
      if (el.type === 'line' || el.type === 'arrow') el.h = 0;
      if (el.type !== 'line' && el.type !== 'arrow') { el.w = Math.max(1, el.w); el.h = Math.max(1, el.h); }
      else el.w = Math.max(1, el.w);
    }
  }

  _prune() {
    const ids = new Set(this.doc.elements.map((e) => e.id));
    for (const id of Array.from(this.selection)) if (!ids.has(id)) this.selection.delete(id);
  }

  /**
   * Mengubah dokumen. commit=false untuk pembaruan "langsung" saat drag (tanpa langkah undo);
   * panggil commit() saat interaksi selesai.
   */
  apply(fn, { commit = true, key = null } = {}) {
    fn(this.doc);
    this._normalize();
    this._prune();
    if (commit) this.commit(key);
    else { this.dirty = true; }
    this.emit('change', { live: !commit });
  }

  commit(key = null) {
    const snap = this._snap();
    const pushed = this.history.push(snap, key);
    this.dirty = snap !== this.savedSnap;
    if (pushed) this.emit('commit');
    return pushed;
  }

  markSaved() { this.savedSnap = this._snap(); this.dirty = false; }

  _restore(snap) {
    const s = JSON.parse(snap);
    this.doc.page = s.page;
    this.doc.elements = s.elements;
    this._prune();
    this.dirty = snap !== this.savedSnap;
    this.emit('change', { reason: 'history' });
  }

  undo() { const s = this.history.undo(); if (s) this._restore(s); return !!s; }
  redo() { const s = this.history.redo(); if (s) this._restore(s); return !!s; }

  /* ------------------------------- seleksi ------------------------------- */
  select(ids, { add = false, toggle = false } = {}) {
    const next = add || toggle ? new Set(this.selection) : new Set();
    for (const id of ids) {
      if (!this.get(id)) continue;
      if (toggle && next.has(id)) next.delete(id); else next.add(id);
    }
    this.selection = next;
    this.emit('selection');
  }

  clearSelection() { if (this.selection.size) { this.selection = new Set(); this.emit('selection'); } }
  selectAll() { this.select(this.doc.elements.filter((e) => !e.locked && !e.hidden).map((e) => e.id)); }

  /* ------------------------------- operasi ------------------------------- */
  addElement(type, props = {}, { select = true } = {}) {
    if (this.doc.elements.length >= 5000) throw new Error('Jumlah elemen mencapai batas 5000.');
    const el = makeElement(type, props);
    this.apply((d) => { d.elements.push(el); });
    if (select) this.select([el.id]);
    return el;
  }

  /** Menyimpan elemen utuh (mis. hasil duplikasi); id dibuat baru jika bentrok. */
  addRaw(elements, { select = true } = {}) {
    const ids = [];
    this.apply((d) => {
      for (const e of elements) {
        const copy = { ...structuredClone(e), id: newId() };
        d.elements.push(copy);
        ids.push(copy.id);
      }
    });
    if (select) this.select(ids);
    return ids;
  }

  setProps(ids, patch, { key = null, commit = true } = {}) {
    const set = new Set(ids);
    this.apply((d) => {
      for (const el of d.elements) {
        if (!set.has(el.id)) continue;
        for (const [k, v] of Object.entries(patch)) {
          if (k === 'type' || k === 'id') continue;
          el[k] = v;
        }
      }
    }, { key: key || `props:${Object.keys(patch).join(',')}`, commit });
  }

  setPage(patch, { key = null } = {}) {
    this.apply((d) => { Object.assign(d.page, patch); }, { key: key || `page:${Object.keys(patch).join(',')}` });
  }

  moveBy(ids, dx, dy, { commit = true, key = null } = {}) {
    const set = new Set(ids);
    this.apply((d) => {
      for (const el of d.elements) if (set.has(el.id) && !el.locked) { el.x += dx; el.y += dy; }
    }, { commit, key });
  }

  deleteSelected() {
    if (!this.selection.size) return 0;
    const n = this.selection.size;
    const set = new Set(this.selection);
    this.apply((d) => { d.elements = d.elements.filter((e) => !set.has(e.id)); });
    return n;
  }

  deleteIds(ids) {
    const set = new Set(ids);
    this.apply((d) => { d.elements = d.elements.filter((e) => !set.has(e.id)); });
  }

  duplicateSelected() {
    const src = this.selected();
    if (!src.length) return [];
    const copies = src.map((e) => ({ ...structuredClone(e), x: e.x + 24, y: e.y + 24, locked: false }));
    return this.addRaw(copies);
  }

  copy() {
    const src = this.selected();
    if (!src.length) return false;
    clipboard = structuredClone(src);
    pasteCount = 0;
    return true;
  }

  cut() { if (!this.copy()) return false; this.deleteSelected(); return true; }

  paste() {
    if (!clipboard || !clipboard.length) return [];
    pasteCount++;
    const off = 24 * pasteCount;
    return this.addRaw(clipboard.map((e) => ({ ...structuredClone(e), x: e.x + off, y: e.y + off, locked: false })));
  }

  hasClipboard() { return !!(clipboard && clipboard.length); }

  toggleLock(ids) {
    const set = new Set(ids);
    const target = !this.doc.elements.filter((e) => set.has(e.id)).every((e) => e.locked);
    this.apply((d) => { for (const e of d.elements) if (set.has(e.id)) e.locked = target; });
    if (target) for (const id of ids) this.selection.delete(id);
    this.emit('selection');
  }

  toggleHidden(ids) {
    const set = new Set(ids);
    const target = !this.doc.elements.filter((e) => set.has(e.id)).every((e) => e.hidden);
    this.apply((d) => { for (const e of d.elements) if (set.has(e.id)) e.hidden = target; });
    if (target) for (const id of ids) this.selection.delete(id);
    this.emit('selection');
  }

  rename(id, name) {
    this.apply((d) => {
      const e = d.elements.find((x) => x.id === id);
      if (!e) return;
      const n = String(name || '').trim().slice(0, 80);
      if (n) e.name = n; else delete e.name;
    });
  }

  /** op: 'front' | 'back' | 'forward' | 'backward' */
  reorder(op, ids = Array.from(this.selection)) {
    const set = new Set(ids);
    if (!set.size) return;
    this.apply((d) => {
      const els = d.elements;
      if (op === 'front') d.elements = [...els.filter((e) => !set.has(e.id)), ...els.filter((e) => set.has(e.id))];
      else if (op === 'back') d.elements = [...els.filter((e) => set.has(e.id)), ...els.filter((e) => !set.has(e.id))];
      else if (op === 'forward') {
        for (let i = els.length - 2; i >= 0; i--) {
          if (set.has(els[i].id) && !set.has(els[i + 1].id)) [els[i], els[i + 1]] = [els[i + 1], els[i]];
        }
      } else if (op === 'backward') {
        for (let i = 1; i < els.length; i++) {
          if (set.has(els[i].id) && !set.has(els[i - 1].id)) [els[i], els[i - 1]] = [els[i - 1], els[i]];
        }
      }
    });
  }

  /** Memindahkan satu elemen ke indeks tertentu (drag di panel layer). */
  moveToIndex(id, index) {
    this.apply((d) => {
      const from = d.elements.findIndex((e) => e.id === id);
      if (from < 0) return;
      const [el] = d.elements.splice(from, 1);
      d.elements.splice(Math.max(0, Math.min(index, d.elements.length)), 0, el);
    });
  }

  /** kind: left | centerH | right | top | middleV | bottom. Satu elemen → rata terhadap halaman. */
  align(kind) {
    const sel = this.selected().filter((e) => !e.locked);
    if (!sel.length) return;
    const target = sel.length === 1
      ? { x: 0, y: 0, w: this.doc.page.width, h: this.doc.page.height }
      : unionBounds(sel);
    this.apply((d) => {
      for (const e of d.elements) {
        if (!sel.some((s) => s.id === e.id)) continue;
        const b = elementBounds(e);
        if (kind === 'left') e.x += target.x - b.x;
        else if (kind === 'right') e.x += target.x + target.w - (b.x + b.w);
        else if (kind === 'centerH') e.x += target.x + target.w / 2 - (b.x + b.w / 2);
        else if (kind === 'top') e.y += target.y - b.y;
        else if (kind === 'bottom') e.y += target.y + target.h - (b.y + b.h);
        else if (kind === 'middleV') e.y += target.y + target.h / 2 - (b.y + b.h / 2);
      }
    }, { key: null });
  }

  /** Ruang kosong terdekat untuk meletakkan elemen baru di tengah halaman. */
  centerPosition(w, h) {
    return { x: Math.round((this.doc.page.width - w) / 2), y: Math.round((this.doc.page.height - h) / 2) };
  }
}
