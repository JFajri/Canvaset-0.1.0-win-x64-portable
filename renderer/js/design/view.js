// Design Studio: menyatukan kanvas, sesi, panel layer/properti, simpan otomatis, ekspor.
import { h, clear, debounce } from '../shared/util.js';
import { bus } from '../shared/bus.js';
import { api, state, refreshLibrary, patchItem, getItem } from '../shared/library.js';
import { Saver } from '../shared/saver.js';
import { icon } from '../ui/icons.js';
import { showMenu } from '../ui/menu.js';
import { toast, toastError } from '../ui/toast.js';
import { confirmDialog, openDialog } from '../ui/dialog.js';
import { newDesignFlow, itemMenu, togglePin, deleteFlow, exportFlow, revealFlow, duplicateFlow, importDesignFlow } from '../ui/actions.js';
import { DesignSession } from './session.js';
import { CanvasController } from './canvas.js';
import { LayersPanel, PropsPanel } from './panels.js';
import { loadFonts, measureTextHeight } from './text.js';
import { makeThumbSvg } from './render.js';
import { renderDocToCanvas, canvasToBytes, exportSvg, checkExportSize, exportSize } from './export.js';
import { downloadName } from '../shared/util.js';

const SAVE_LABEL = { saved: 'Tersimpan', dirty: 'Belum tersimpan', saving: 'Menyimpan…', error: 'Gagal menyimpan' };
const SHAPES = [['rect', 'Persegi', 'R'], ['ellipse', 'Lingkaran', 'O'], ['triangle', 'Segitiga', ''], ['star', 'Bintang', ''], ['line', 'Garis', 'L'], ['arrow', 'Panah', '']];
const IMG_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];
const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

export class DesignView {
  constructor(root) {
    this.root = root;
    this.id = null;
    this.meta = null;
    this.session = null;
    this.saver = null;
    this.canvas = null;
    this.assets = new Map(); // assetId -> { url, img } | { failed }
    this.pending = new Map();
    this.env = { assetUrl: (id) => this.assetUrl(id), hideTextId: null };
    this.build();
    this.showEmpty();
    bus.on('library:changed', () => this.syncHeader());
    bus.on('item:before-delete', ({ id }) => { if (id === this.id) this.discardCurrent(); });
    bus.on('item:deleted', ({ id }) => { if (id === this.id) this.showEmpty(); });
    bus.on('item:renamed', ({ id, title }) => { if (id === this.id) { this.meta = { ...this.meta, title }; this.syncHeader(); } });
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => { if (e.key === ' ' && this.canvas) this.canvas.setSpace(false); });
    document.addEventListener('paste', (e) => this.onPaste(e));
    this.stage.addEventListener('dragover', (e) => { if (this.session && e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); this.stage.classList.add('dropping'); } });
    this.stage.addEventListener('dragleave', () => this.stage.classList.remove('dropping'));
    this.stage.addEventListener('drop', (e) => this.onDropFiles(e));
  }

  get active() { return this.root.classList.contains('active'); }

  /* ------------------------------------------------------------ DOM */
  build() {
    this.layersEl = h('aside', { class: 'panel layers-panel', 'aria-label': 'Layer' });
    this.propsEl = h('aside', { class: 'panel props-panel', 'aria-label': 'Properti' });

    this.titleIn = h('input', {
      class: 'title-input', type: 'text', maxlength: '120', 'aria-label': 'Judul desain', spellcheck: 'false',
      onBlur: () => this.commitTitle(),
      onKeydown: (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this.titleIn.blur(); }
        if (e.key === 'Escape') { this.titleIn.value = this.meta ? this.meta.title : ''; this.titleIn.blur(); }
      },
    });
    this.saveEl = h('span', { class: 'save-status', 'data-state': 'saved', role: 'status', 'aria-live': 'polite' }, SAVE_LABEL.saved);
    this.pinBtn = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Sematkan', 'aria-label': 'Sematkan', onClick: () => this.meta && togglePin(getItem(this.id) || this.meta) }, icon('pin'));
    this.undoBtn = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Urungkan (Ctrl+Z)', 'aria-label': 'Urungkan', onClick: () => this.undo() }, icon('undo'));
    this.redoBtn = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Ulangi (Ctrl+Y)', 'aria-label': 'Ulangi', onClick: () => this.redo() }, icon('redo'));
    this.exportBtn = h('button', { class: 'btn btn-primary', type: 'button', title: 'Ekspor (Ctrl+E)', onClick: () => this.exportDialog() }, icon('download', 16), 'Ekspor');
    this.moreBtn = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Menu lainnya', 'aria-label': 'Menu lainnya', onClick: (e) => this.moreMenu(e.currentTarget) }, icon('more'));
    this.layersToggle = h('button', { class: 'btn btn-ghost btn-icon is-on', type: 'button', title: 'Panel layer', 'aria-label': 'Tampilkan panel layer', onClick: () => this.togglePanel('layers') }, icon('sidebar'));
    this.propsToggle = h('button', { class: 'btn btn-ghost btn-icon is-on', type: 'button', title: 'Panel properti', 'aria-label': 'Tampilkan panel properti', onClick: () => this.togglePanel('props') }, icon('sidebarR'));

    const head = h('div', { class: 'editor-head d-top' },
      this.layersToggle, this.titleIn, this.saveEl, h('span', { class: 'spacer' }),
      this.pinBtn, this.undoBtn, this.redoBtn, this.exportBtn, this.moreBtn, this.propsToggle);

    this.toolBtns = {};
    const tbtn = (id, ic, title, fn) => {
      const b = h('button', { class: 'btn btn-ghost btn-icon tool', type: 'button', title, 'aria-label': title, 'aria-pressed': 'false', onClick: fn || (() => this.setTool(id)) }, icon(ic, 18));
      this.toolBtns[id] = b;
      return b;
    };
    this.shapeBtn = h('button', { class: 'btn btn-ghost btn-icon tool', type: 'button', title: 'Bentuk', 'aria-label': 'Bentuk', onClick: (e) => this.shapeMenu(e.currentTarget) }, icon('rect', 18), h('span', { class: 'caret' }, icon('down', 10)));
    this.snapBtn = h('button', { class: 'btn btn-ghost btn-icon is-on', type: 'button', title: 'Snap & pemandu', 'aria-label': 'Snap dan pemandu', 'aria-pressed': 'true', onClick: () => this.toggleSnap() }, icon('grid', 18));
    this.zoomBtn = h('button', { class: 'btn btn-ghost btn-sm zoom-btn', type: 'button', title: 'Zoom', 'aria-label': 'Zoom', onClick: (e) => this.zoomMenu(e.currentTarget) }, h('span', { class: 'zoom-val' }, '100%'), icon('down', 12));
    this.toolbar = h('div', { class: 'editor-toolbar d-tools', role: 'toolbar', 'aria-label': 'Alat desain' },
      tbtn('select', 'cursor', 'Pilih (V)'), tbtn('hand', 'hand', 'Geser kanvas (H)'),
      h('span', { class: 'tb-sep' }),
      tbtn('text', 'text', 'Teks (T)'), this.shapeBtn,
      h('button', { class: 'btn btn-ghost btn-icon tool', type: 'button', title: 'Gambar… (I)', 'aria-label': 'Tambah gambar', onClick: () => this.addImages() }, icon('image', 18)),
      h('span', { class: 'spacer' }),
      this.snapBtn, h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Pas ke layar (Shift+1)', 'aria-label': 'Pas ke layar', onClick: () => this.canvas && this.canvas.fit() }, icon('fit', 18)),
      this.zoomBtn);

    this.stage = h('div', { class: 'canvas-area', tabindex: '-1' });
    this.status = h('div', { class: 'd-status' },
      this.selInfo = h('span', null, ''), h('span', { class: 'spacer' }), this.pageInfo = h('span', { class: 'muted' }, ''));

    this.banner = h('div', { class: 'banner', hidden: true, role: 'alert' });
    this.editorWrap = h('div', { class: 'd-main', hidden: true }, this.toolbar, this.banner, this.stage, this.status);
    this.empty = h('div', { class: 'empty' },
      h('div', { class: 'icon-wrap' }, icon('design', 26)),
      h('h3', null, 'Belum ada desain yang dibuka'),
      h('p', null, 'Buat desain baru, atau buka salah satu dari Pustaka atau daftar di bawah.'),
      h('div', { class: 'row-gap' },
        h('button', { class: 'btn btn-primary', type: 'button', onClick: () => newDesignFlow() }, icon('plus', 16), 'Desain baru'),
        h('button', { class: 'btn', type: 'button', onClick: () => importDesignFlow().then((c) => c[0] && this.open(c[0].id)) }, icon('upload', 16), 'Impor proyek')),
      this.recentEl = h('div', { class: 'recent-designs' }));
    this.editorPanel = h('section', { class: 'panel fill editor-panel', 'aria-label': 'Editor desain' }, head, this.editorWrap, this.empty);
    this.head = head;
    this.root.append(this.layersEl, this.editorPanel, this.propsEl);
  }

  renderRecent() {
    clear(this.recentEl);
    const ds = state.items.filter((i) => i.type === 'design').sort((a, b) => b.updated - a.updated).slice(0, 6);
    if (!ds.length) return;
    this.recentEl.append(h('div', { class: 'doc-group' }, 'Desain terbaru'),
      ...ds.map((d) => h('button', { class: 'btn btn-ghost recent-row', type: 'button', onClick: () => this.open(d.id) }, icon('design', 16), h('span', { class: 'truncate' }, d.title))));
  }

  togglePanel(which) {
    const cls = which === 'layers' ? 'hide-layers' : 'hide-props';
    const off = this.root.classList.toggle(cls);
    (which === 'layers' ? this.layersToggle : this.propsToggle).classList.toggle('is-on', !off);
  }

  /* ------------------------------------------------------------ aset */
  assetUrl(id) {
    const a = this.assets.get(id);
    if (a && a.url) return a.url;
    if (!a && !this.pending.has(id)) this.loadAsset(id);
    return null;
  }

  loadAsset(id) {
    if (this.assets.has(id)) return Promise.resolve(this.assets.get(id));
    if (this.pending.has(id)) return this.pending.get(id);
    const p = (async () => {
      try {
        const { data, mime } = await api.readAsset(id);
        const url = URL.createObjectURL(new Blob([data], { type: mime }));
        const img = new Image();
        img.src = url;
        await img.decode();
        const entry = { url, img, w: img.naturalWidth, h: img.naturalHeight };
        this.assets.set(id, entry);
        return entry;
      } catch (_) {
        const entry = { failed: true };
        this.assets.set(id, entry);
        return entry;
      } finally {
        this.pending.delete(id);
        if (this.canvas) this.canvas.requestRender();
      }
    })();
    this.pending.set(id, p);
    return p;
  }

  async ensureAssets(doc) {
    const ids = new Set(doc.elements.filter((e) => e.type === 'image' && e.assetId).map((e) => e.assetId));
    await Promise.all(Array.from(ids).map((id) => this.loadAsset(id)));
  }

  getImage(id) { const a = this.assets.get(id); return a && a.img ? a.img : null; }

  async assetData(id) {
    try { const { data, mime } = await api.readAsset(id); return { mime, bytes: data instanceof Uint8Array ? data : new Uint8Array(data) }; } catch (_) { return null; }
  }

  resetAssets() {
    for (const a of this.assets.values()) if (a.url) URL.revokeObjectURL(a.url);
    this.assets.clear(); this.pending.clear();
  }

  /* ------------------------------------------------------------ buka / tutup */
  showEmpty() {
    this.teardown();
    this.id = null; this.meta = null;
    this.editorWrap.hidden = true;
    this.empty.hidden = false;
    this.head.classList.add('is-empty');
    this.root.classList.add('no-doc');
    this.renderRecent();
  }

  teardown() {
    if (this.saver) { this.saver.dispose(); this.saver = null; }
    if (this.canvas) { this.canvas.destroy(); this.canvas = null; }
    if (this.layers) { this.layers.destroy(); this.layers = null; }
    if (this.props) { this.props.destroy(); this.props = null; }
    if (this.session) this.session = null;
    this.resetAssets();
  }

  discardCurrent() { if (this.saver) { this.saver.dispose(); this.saver = null; } }

  async flush() {
    if (!this.saver) return true;
    if (this.canvas) this.canvas.stopTextEdit(true);
    this.pushNow();
    return this.saver.flush();
  }

  async open(id) {
    if (id === this.id && this.saver) return;
    if (this.saver && !(await this.flush())) {
      const go = await confirmDialog({
        title: 'Perubahan belum tersimpan',
        message: `Desain “${this.meta.title}” gagal disimpan (${this.saver.lastError || 'penyebab tidak diketahui'}). Draf pemulihan sudah dibuat dan akan ditawarkan saat desain dibuka lagi. Tetap pindah?`,
        confirmLabel: 'Tetap pindah', danger: true,
      });
      if (!go) return;
    }
    let res;
    try { res = await api.readItem(id); } catch (e) { toastError(e, 'Tidak dapat membuka desain'); await refreshLibrary(); return; }
    await loadFonts();
    let session;
    try { session = DesignSession.fromText(res.content, { measureText: measureTextHeight }); } catch (e) { toastError(e, 'Berkas desain rusak'); return; }
    this.teardown();
    this.id = id; this.meta = res.meta; this.session = session;
    patchItem(res.meta);
    this.empty.hidden = true; this.editorWrap.hidden = false;
    this.head.classList.remove('is-empty'); this.root.classList.remove('no-doc');
    session.markSaved();

    this.canvas = new CanvasController({
      container: this.stage, session, env: this.env,
      onView: ({ zoom }) => { this.zoomBtn.querySelector('.zoom-val').textContent = `${Math.round(zoom * 100)}%`; },
      onTool: (t) => this.syncTool(t),
      onContext: (e, hit) => this.canvasMenu(e, hit),
      onTextEdit: () => this.syncStatus(),
    });
    this.layers = new LayersPanel(clear(this.layersEl), session, { onMenu: (e, el) => this.canvasMenu(e, el) });
    this.props = new PropsPanel(clear(this.propsEl), session, {
      fit: () => this.canvas && this.canvas.fit(),
      replaceImage: (eid) => this.addImages(eid),
      editText: (eid) => this.canvas && this.canvas.startTextEdit(eid, {}),
    });
    this.pushContent = debounce(() => this.pushNow(), 160);
    const content = session.serialize();
    this.saver = new Saver({
      api, id, content, autosaveMs: state.settings.autosaveMs,
      getExtra: () => { try { return makeThumbSvg(session.doc); } catch (_) { return undefined; } },
      onState: ({ state: st, message }) => this.onSaveState(st, message),
      onSaved: (meta) => { this.meta = meta; patchItem(meta); },
    });
    session.on('change', () => { this.pushContent(); this.syncStatus(); });
    session.on('selection', () => this.syncStatus());
    session.on('commit', () => this.syncUndo());
    session.on('change', () => this.syncUndo());
    this.ensureAssets(session.doc).then(() => this.canvas && this.canvas.requestRender());
    this.onSaveState('saved');
    this.syncHeader(); this.syncStatus(); this.syncUndo(); this.syncTool('select');
    this.canvas.fit(false);
    this.showRecovery(res.recovery);
    this.stage.focus();
    bus.emit('design:opened', { id });
  }

  pushNow() {
    if (!this.saver || !this.session) return;
    this.saver.setContent(this.session.serialize());
  }

  showRecovery(draft) {
    clear(this.banner);
    if (!draft) { this.banner.hidden = true; return; }
    let doc = null;
    try { doc = DesignSession.fromText(draft.content, { measureText: measureTextHeight }); } catch (_) { /* draf tak terbaca */ }
    if (!doc) { api.clearDraft(this.id).catch(() => {}); this.banner.hidden = true; return; }
    this.banner.hidden = false;
    this.banner.append(icon('alert', 18),
      h('div', { class: 'grow' }, h('b', null, 'Perubahan yang belum tersimpan ditemukan'), h('div', { class: 'hint' }, 'Aplikasi tertutup sebelum sempat menyimpan. Pulihkan versi terakhir?')),
      h('button', { class: 'btn btn-sm', type: 'button', onClick: () => { this.banner.hidden = true; api.clearDraft(this.id).catch(() => {}); } }, 'Abaikan'),
      h('button', {
        class: 'btn btn-sm btn-primary', type: 'button',
        onClick: async () => {
          this.banner.hidden = true;
          await this.ensureAssets(doc.doc);
          this.session.apply((d) => { d.page = doc.doc.page; d.elements = doc.doc.elements; });
          this.session.clearSelection();
          this.canvas.fit(false);
          toast('Draf dipulihkan.', { type: 'success' });
        },
      }, 'Pulihkan'));
  }

  /* ------------------------------------------------------------ status */
  onSaveState(st, message) {
    this.saveEl.dataset.state = st;
    this.saveEl.textContent = SAVE_LABEL[st] || st;
    this.saveEl.title = st === 'error' && message ? message : '';
  }

  syncHeader() {
    if (!this.meta) return;
    const live = getItem(this.id) || this.meta;
    if (document.activeElement !== this.titleIn) this.titleIn.value = live.title;
    this.pinBtn.classList.toggle('is-on', !!live.pinned);
    this.pinBtn.title = live.pinned ? 'Lepas sematan' : 'Sematkan';
  }

  async commitTitle() {
    if (!this.meta) return;
    const t = this.titleIn.value.trim();
    const cur = (getItem(this.id) || this.meta).title;
    if (!t) { this.titleIn.value = cur; return; }
    if (t === cur) return;
    try {
      const m = await api.renameItem(this.id, t);
      this.meta = m; patchItem(m);
    } catch (e) { toastError(e, 'Gagal mengganti nama'); this.titleIn.value = cur; }
  }

  syncStatus() {
    if (!this.session) return;
    const S = this.session; const sel = S.selected(); const pg = S.doc.page;
    this.pageInfo.textContent = `${pg.width} × ${pg.height} px · ${S.elements.length} elemen`;
    if (!sel.length) this.selInfo.textContent = 'Tidak ada yang dipilih';
    else if (sel.length === 1) this.selInfo.textContent = `${Math.round(sel[0].w)} × ${Math.round(sel[0].h)} px`;
    else this.selInfo.textContent = `${sel.length} elemen dipilih`;
  }

  syncUndo() {
    if (!this.session) return;
    this.undoBtn.disabled = !this.session.history.canUndo;
    this.redoBtn.disabled = !this.session.history.canRedo;
  }

  syncTool(t) {
    for (const [id, b] of Object.entries(this.toolBtns)) { const on = id === t; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); }
    const isShape = SHAPES.some((s) => s[0] === t);
    this.shapeBtn.classList.toggle('is-on', isShape);
    this.shapeBtn.setAttribute('aria-pressed', String(isShape));
    if (isShape) { clear(this.shapeBtn); this.shapeBtn.append(icon(t, 18), h('span', { class: 'caret' }, icon('down', 10))); }
  }

  setTool(t) { if (this.canvas) this.canvas.setTool(t); }

  toggleSnap() {
    if (!this.canvas) return;
    this.canvas.snap = !this.canvas.snap;
    this.snapBtn.classList.toggle('is-on', this.canvas.snap);
    this.snapBtn.setAttribute('aria-pressed', String(this.canvas.snap));
    toast(this.canvas.snap ? 'Snap dan pemandu aktif.' : 'Snap dan pemandu mati.', { timeout: 1200 });
  }

  undo() { if (this.session && !(this.canvas && this.canvas.editing)) { this.session.undo(); this.canvas.requestRender(); } }
  redo() { if (this.session && !(this.canvas && this.canvas.editing)) { this.session.redo(); this.canvas.requestRender(); } }

  /* ------------------------------------------------------------ menu */
  shapeMenu(anchor) {
    showMenu(SHAPES.map(([id, label, kbd]) => ({ label, icon: id, kbd: kbd || undefined, onSelect: () => this.setTool(id) })), anchor);
  }

  zoomMenu(anchor) {
    if (!this.canvas) return;
    const c = this.canvas;
    showMenu([
      { label: 'Perbesar', icon: 'plus', kbd: 'Ctrl +', onSelect: () => c.zoomBy(1.25) },
      { label: 'Perkecil', icon: 'minus', kbd: 'Ctrl −', onSelect: () => c.zoomBy(0.8) },
      { separator: true },
      { label: 'Pas ke layar', icon: 'fit', kbd: 'Shift 1', onSelect: () => c.fit() },
      { label: 'Zoom ke pilihan', kbd: 'Shift 2', onSelect: () => c.zoomToSelection() },
      { label: '100%', kbd: 'Ctrl 0', onSelect: () => c.setZoom(1) },
      { label: '50%', onSelect: () => c.setZoom(0.5) },
      { label: '200%', onSelect: () => c.setZoom(2) },
    ], anchor);
  }

  moreMenu(anchor) {
    if (!this.meta) return;
    const item = getItem(this.id) || this.meta;
    showMenu([
      { label: 'Ekspor gambar…', icon: 'download', kbd: 'Ctrl E', onSelect: () => this.exportDialog() },
      { label: 'Ekspor proyek (.canvaset)…', icon: 'download', onSelect: async () => { if (await this.flush()) exportFlow(item); } },
      { separator: true },
      { label: 'Duplikat desain', icon: 'copy', onSelect: async () => { if (await this.flush()) duplicateFlow(item); } },
      { label: 'Tampilkan di folder', icon: 'folder', onSelect: () => revealFlow(item) },
      { separator: true },
      { label: 'Hapus desain…', icon: 'trash', danger: true, onSelect: () => deleteFlow(item) },
    ], anchor);
  }

  canvasMenu(e, hit) {
    const S = this.session; if (!S) return;
    const has = S.selection.size > 0;
    const items = has ? [
      { label: 'Salin', icon: 'copy', kbd: 'Ctrl C', onSelect: () => S.copy() },
      { label: 'Potong', kbd: 'Ctrl X', onSelect: () => S.cut() },
      { label: 'Tempel', kbd: 'Ctrl V', disabled: !S.hasClipboard(), onSelect: () => S.paste() },
      { label: 'Duplikat', kbd: 'Ctrl D', onSelect: () => S.duplicateSelected() },
      { separator: true },
      { label: 'Ke depan', icon: 'front', kbd: 'Ctrl Shift ]', onSelect: () => S.reorder('front') },
      { label: 'Maju satu layer', icon: 'up', kbd: 'Ctrl ]', onSelect: () => S.reorder('forward') },
      { label: 'Mundur satu layer', icon: 'down', kbd: 'Ctrl [', onSelect: () => S.reorder('backward') },
      { label: 'Ke belakang', icon: 'back', kbd: 'Ctrl Shift [', onSelect: () => S.reorder('back') },
      { separator: true },
      { label: S.selected().every((x) => x.locked) ? 'Buka kunci' : 'Kunci', icon: 'lock', onSelect: () => S.toggleLock(Array.from(S.selection)) },
      { label: 'Sembunyikan', icon: 'eyeoff', onSelect: () => S.toggleHidden(Array.from(S.selection)) },
      { separator: true },
      { label: 'Hapus', icon: 'trash', danger: true, kbd: 'Del', onSelect: () => S.deleteSelected() },
    ] : [
      { label: 'Tempel', kbd: 'Ctrl V', disabled: !S.hasClipboard(), onSelect: () => S.paste() },
      { label: 'Pilih semua', kbd: 'Ctrl A', onSelect: () => S.selectAll() },
      { label: 'Pas ke layar', icon: 'fit', onSelect: () => this.canvas.fit() },
    ];
    showMenu(items, { x: e.clientX, y: e.clientY });
  }

  /* ------------------------------------------------------------ gambar */
  async addImages(replaceId = null) {
    if (!this.session) return;
    let picked;
    try { picked = await api.pickImages(); } catch (e) { toastError(e, 'Gagal memilih gambar'); return; }
    if (!picked || !picked.length) return;
    await this.placeAssets(replaceId ? picked.slice(0, 1) : picked, replaceId);
  }

  async placeAssets(list, replaceId = null) {
    const S = this.session;
    for (const a of list) {
      const entry = await this.loadAsset(a.assetId);
      if (entry.failed) { toast('Gambar tidak dapat dibaca.', { type: 'error' }); continue; }
      const nw = entry.w || 400; const nh = entry.h || 300;
      if (replaceId && S.get(replaceId)) {
        S.setProps([replaceId], { assetId: a.assetId, naturalW: nw, naturalH: nh });
        continue;
      }
      const pg = S.doc.page;
      const k = Math.min(1, (pg.width * 0.6) / nw, (pg.height * 0.6) / nh);
      const w = Math.max(16, Math.round(nw * k)); const hh = Math.max(16, Math.round(nh * k));
      try {
        S.addElement('image', { assetId: a.assetId, w, h: hh, x: Math.round((pg.width - w) / 2), y: Math.round((pg.height - hh) / 2), naturalW: nw, naturalH: nh, fit: 'cover' });
      } catch (e) { toastError(e); }
    }
    this.canvas.requestRender();
  }

  async addFiles(files) {
    const out = [];
    for (const f of files) {
      if (!IMG_MIME.includes(f.type)) { toast(`“${f.name || 'Berkas'}” bukan gambar yang didukung.`, { type: 'error' }); continue; }
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        out.push(await api.addAsset(buf, f.type));
      } catch (e) { toastError(e, 'Gagal menambah gambar'); }
    }
    if (out.length) await this.placeAssets(out);
  }

  onDropFiles(e) {
    this.stage.classList.remove('dropping');
    if (!this.session || !e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    this.addFiles(Array.from(e.dataTransfer.files));
  }

  onPaste(e) {
    if (!this.active || !this.session || isTyping(e.target) || document.getElementById('dialog-root').firstChild) return;
    const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter((f) => f.type.startsWith('image/'));
    e.preventDefault();
    if (files.length) { this.addFiles(files); return; }
    this.session.paste();
  }

  /* ------------------------------------------------------------ ekspor */
  async exportDialog() {
    if (!this.session) return;
    if (this.canvas) this.canvas.stopTextEdit(true);
    const S = this.session;
    let format = 'png'; let scale = 1; let quality = 90;
    const info = h('div', { class: 'hint' });
    const err = h('div', { class: 'error-text', hidden: true });
    const qWrap = h('div', { class: 'field', hidden: true });
    const qVal = h('span', { class: 'muted' }, '90%');
    const qIn = h('input', { type: 'range', min: '40', max: '100', value: '90', 'aria-label': 'Kualitas JPEG', onInput: () => { quality = Number(qIn.value); qVal.textContent = `${quality}%`; } });
    qWrap.append(h('label', null, 'Kualitas ', qVal), qIn);
    const scaleSel = h('select', { class: 'select', 'aria-label': 'Skala', onChange: () => { scale = Number(scaleSel.value); refresh(); } },
      [0.5, 1, 2, 3, 4].map((v) => h('option', { value: String(v), selected: v === 1 }, `${v}×`)));
    const scaleWrap = h('div', { class: 'field' }, h('label', null, 'Skala'), scaleSel);
    const fmtBtns = {};
    const fmtSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Format' }, [['png', 'PNG'], ['jpeg', 'JPEG'], ['svg', 'SVG']].map(([id, label]) => (fmtBtns[id] = h('button', { type: 'button', 'aria-pressed': String(id === format), onClick: () => { format = id; refresh(); } }, label))));
    const refresh = () => {
      for (const [id, b] of Object.entries(fmtBtns)) b.setAttribute('aria-pressed', String(id === format));
      qWrap.hidden = format !== 'jpeg';
      scaleWrap.hidden = format === 'svg';
      const sc = format === 'svg' ? 1 : scale;
      const { w, h: hh } = exportSize(S.doc, sc);
      const problem = format === 'svg' ? null : checkExportSize(S.doc, sc);
      info.textContent = format === 'svg' ? `Vektor ${S.doc.page.width} × ${S.doc.page.height} (font dan gambar tertanam)` : `Hasil ${w} × ${hh} px`;
      err.hidden = !problem; err.textContent = problem || '';
    };
    refresh();
    const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
      h('div', { class: 'field' }, h('label', null, 'Format'), fmtSeg), scaleWrap, qWrap, info, err);
    const v = await openDialog({
      title: 'Ekspor desain', body,
      buttons: [{ label: 'Batal', value: null, variant: 'ghost' }, { label: 'Ekspor', value: 'ok', variant: 'primary', validate: () => format === 'svg' || !checkExportSize(S.doc, scale) }],
    });
    if (v !== 'ok') return;
    await this.runExport(format, format === 'svg' ? 1 : scale, quality / 100);
  }

  /** Ekspor dan simpan lewat dialog. Mengembalikan jalur berkas atau null. */
  async runExport(format, scale, quality, { silent = false } = {}) {
    const S = this.session;
    const title = (getItem(this.id) || this.meta).title;
    try {
      await loadFonts();
      await this.ensureAssets(S.doc);
      let data; let ext; let name; let filters;
      if (format === 'svg') {
        data = await exportSvg(S.doc, (id) => this.assetData(id));
        ext = 'svg'; filters = [{ name: 'SVG', extensions: ['svg'] }];
      } else {
        const err = checkExportSize(S.doc, scale);
        if (err) throw new Error(err);
        const jpeg = format === 'jpeg';
        const canvas = renderDocToCanvas(S.doc, (id) => this.getImage(id), scale, { opaque: jpeg });
        data = await canvasToBytes(canvas, jpeg ? 'image/jpeg' : 'image/png', quality);
        ext = jpeg ? 'jpg' : 'png'; filters = [{ name: jpeg ? 'JPEG' : 'PNG', extensions: [ext] }];
      }
      name = downloadName(title, ext);
      const r = await api.saveFile({ data, suggestedName: name, filters });
      if (r && r.saved) { if (!silent) toast('Ekspor selesai.', { type: 'success' }); return r.path; }
      return null;
    } catch (e) { toastError(e, 'Ekspor gagal'); return null; }
  }

  /* ------------------------------------------------------------ keyboard */
  onKey(e) {
    if (!this.active || !this.session || !this.canvas) return;
    if (document.getElementById('dialog-root').firstChild) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // kombinasi Ctrl lewat handleShortcut
    if (isTyping(e.target) || this.canvas.editing) return;
    const S = this.session;
    const k = e.key;
    if (k === ' ') { e.preventDefault(); this.canvas.setSpace(true); return; }
    if (k === 'Delete' || k === 'Backspace') { if (S.selection.size) { e.preventDefault(); S.deleteSelected(); } return; }
    if (k === 'Escape') { if (this.canvas.tool !== 'select') this.setTool('select'); else S.clearSelection(); return; }
    if (k === 'Enter') {
      const one = S.selected();
      if (one.length === 1 && one[0].type === 'text') { e.preventDefault(); this.canvas.startTextEdit(one[0].id, {}); }
      return;
    }
    if (k.startsWith('Arrow')) {
      if (!S.selection.size) return;
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      const dx = k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0;
      const dy = k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0;
      S.moveBy(Array.from(S.selection).filter((id) => { const el = S.get(id); return el && !el.locked; }), dx, dy, { key: 'nudge' });
      return;
    }
    if (e.shiftKey && k === '!') { this.canvas.fit(); return; }
    if (e.shiftKey && k === '@') { this.canvas.zoomToSelection(); return; }
    const map = { v: 'select', h: 'hand', t: 'text', r: 'rect', o: 'ellipse', l: 'line' };
    const t = map[k.toLowerCase()];
    if (t && !e.shiftKey) { this.setTool(t); return; }
    if (k.toLowerCase() === 'i' && !e.shiftKey) this.addImages();
  }

  handleShortcut(e) {
    if (!this.session || !this.canvas) return false;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return false;
    if (isTyping(e.target) || this.canvas.editing) {
      // di kolom teks tetap izinkan simpan dan ekspor
      const kk = e.key.toLowerCase();
      if (kk === 's' && !e.shiftKey) { e.preventDefault(); this.saveNow(); return true; }
      return false;
    }
    const S = this.session; const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); return true; }
    if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); this.redo(); return true; }
    if (k === 'c' && !e.shiftKey) { e.preventDefault(); if (S.copy()) toast('Disalin.', { timeout: 900 }); return true; }
    if (k === 'x' && !e.shiftKey) { e.preventDefault(); S.cut(); return true; }
    if (k === 'd' && !e.shiftKey) { e.preventDefault(); S.duplicateSelected(); return true; }
    if (k === 'a' && !e.shiftKey) { e.preventDefault(); S.selectAll(); return true; }
    if (k === 's' && !e.shiftKey) { e.preventDefault(); this.saveNow(); return true; }
    if (k === 'e' && !e.shiftKey) { e.preventDefault(); this.exportDialog(); return true; }
    if (e.key === ']' || e.key === '}') { e.preventDefault(); S.reorder(e.shiftKey ? 'front' : 'forward'); return true; }
    if (e.key === '[' || e.key === '{') { e.preventDefault(); S.reorder(e.shiftKey ? 'back' : 'backward'); return true; }
    if (e.key === '0') { e.preventDefault(); this.canvas.setZoom(1); return true; }
    if (e.key === '=' || e.key === '+') { e.preventDefault(); this.canvas.zoomBy(1.25); return true; }
    if (e.key === '-') { e.preventDefault(); this.canvas.zoomBy(0.8); return true; }
    return false;
  }

  async saveNow() {
    if (!this.saver) return;
    const ok = await this.flush();
    if (ok) toast('Tersimpan.', { type: 'success', timeout: 1200 });
  }
}
