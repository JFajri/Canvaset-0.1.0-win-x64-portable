// Panel Layer dan panel Properti kontekstual.
import { h, clear } from '../shared/util.js';
import { icon } from '../ui/icons.js';
import { PRESETS, FONT_LABELS, layerLabel, TYPE_LABELS } from './model.js';
import { dropIndex } from './transform.js';
import { elementBounds } from './geometry.js';

const SWATCHES = ['#1a1d2e', '#ffffff', '#7c83ff', '#ff6b4a', '#2dd4a7', '#f5b83d', '#ff5fa2', '#4aa8ff'];
const WEIGHTS = [[400, 'Reguler'], [500, 'Medium'], [600, 'Semibold'], [700, 'Tebal']];
const TYPE_ICON = { text: 'text', rect: 'rect', ellipse: 'ellipse', triangle: 'triangle', star: 'star', line: 'line', arrow: 'arrow', image: 'image' };
const fmt = (n) => String(Math.round(n * 100) / 100);

/* ===================================================================== Layer */
export class LayersPanel {
  constructor(root, session, { onMenu }) {
    this.root = root;
    this.s = session;
    this.onMenu = onMenu;
    this.sig = '';
    this.list = h('div', { class: 'layer-list', role: 'listbox', 'aria-label': 'Layer', 'aria-multiselectable': 'true' });
    this.count = h('span', { class: 'muted' });
    root.append(h('div', { class: 'panel-head' }, h('h2', null, 'Layer'), this.count), this.list);
    this.unsub = [session.on('commit', () => this.render()), session.on('selection', () => this.render()), session.on('change', (d) => { if (!d || !d.live) this.render(); })];
    this.render();
  }

  destroy() { this.unsub.forEach((u) => u()); clear(this.root); }

  signature() {
    return this.s.elements.map((e) => `${e.id}${e.hidden ? 'h' : ''}${e.locked ? 'l' : ''}${e.name || ''}${e.type === 'text' ? e.text.slice(0, 30) : ''}${this.s.selection.has(e.id) ? 's' : ''}`).join('|');
  }

  render() {
    const sig = this.signature();
    if (sig === this.sig) return;
    this.sig = sig;
    const els = this.s.elements;
    this.count.textContent = els.length ? String(els.length) : '';
    clear(this.list);
    if (!els.length) {
      this.list.append(h('div', { class: 'empty' }, h('p', null, 'Belum ada elemen. Tambahkan teks, bentuk, atau gambar dari toolbar.')));
      return;
    }
    const n = els.length;
    for (let i = n - 1; i >= 0; i--) {
      const el = els[i];
      const sel = this.s.selection.has(el.id);
      const nameEl = h('span', { class: 'layer-name truncate' }, layerLabel(el));
      const row = h('div', {
        class: `layer${sel ? ' sel' : ''}${el.hidden ? ' off' : ''}`, role: 'option', 'aria-selected': String(sel), tabindex: '0', draggable: 'true', dataset: { id: el.id },
        onClick: (e) => { if (el.locked && !e.shiftKey && !e.ctrlKey && !e.metaKey) { this.s.selection = new Set([el.id]); this.s.emit('selection'); return; } this.s.select([el.id], { toggle: e.ctrlKey || e.metaKey || e.shiftKey }); },
        onDblclick: () => this.rename(el, nameEl),
        onContextmenu: (e) => { e.preventDefault(); if (!this.s.selection.has(el.id)) this.s.select([el.id]); this.onMenu(e, el); },
        onKeydown: (e) => {
          if (e.key === 'Enter') { e.preventDefault(); this.s.select([el.id]); }
          else if (e.key === 'F2') { e.preventDefault(); this.rename(el, nameEl); }
          else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const rows = Array.from(this.list.querySelectorAll('.layer'));
            const nx = rows[rows.indexOf(e.currentTarget) + (e.key === 'ArrowDown' ? 1 : -1)];
            if (nx) nx.focus();
          }
        },
        onDragstart: (e) => { e.dataTransfer.setData('text/plain', el.id); e.dataTransfer.effectAllowed = 'move'; this.dragId = el.id; },
        onDragend: () => { this.dragId = null; this.clearDrop(); },
        onDragover: (e) => {
          if (!this.dragId) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          const after = e.clientY > r.top + r.height / 2;
          this.dropGap = (n - 1 - i) + (after ? 1 : 0);
          this.clearDrop();
          e.currentTarget.classList.add(after ? 'drop-after' : 'drop-before');
        },
        onDrop: (e) => {
          e.preventDefault();
          const id = this.dragId;
          this.clearDrop();
          if (!id) return;
          const from = this.s.elements.findIndex((x) => x.id === id);
          if (from < 0) return;
          const to = dropIndex(this.s.elements.length, from, this.dropGap);
          if (to !== from) this.s.moveToIndex(id, to);
        },
      },
      h('span', { class: 'layer-ic' }, icon(TYPE_ICON[el.type] || 'rect', 15)),
      nameEl,
      h('button', { class: 'btn btn-ghost btn-icon btn-sm layer-btn', type: 'button', title: el.hidden ? 'Tampilkan' : 'Sembunyikan', 'aria-label': `${el.hidden ? 'Tampilkan' : 'Sembunyikan'} ${layerLabel(el)}`, onClick: (e) => { e.stopPropagation(); this.s.toggleHidden([el.id]); } }, icon(el.hidden ? 'eyeoff' : 'eye', 15)),
      h('button', { class: `btn btn-ghost btn-icon btn-sm layer-btn${el.locked ? ' on' : ''}`, type: 'button', title: el.locked ? 'Buka kunci' : 'Kunci', 'aria-label': `${el.locked ? 'Buka kunci' : 'Kunci'} ${layerLabel(el)}`, onClick: (e) => { e.stopPropagation(); this.s.toggleLock([el.id]); } }, icon(el.locked ? 'lock' : 'unlock', 15)));
      this.list.append(row);
    }
    const first = this.list.querySelector('.layer.sel');
    if (first) first.scrollIntoView({ block: 'nearest' });
  }

  clearDrop() { for (const r of this.list.querySelectorAll('.drop-before,.drop-after')) r.classList.remove('drop-before', 'drop-after'); }

  rename(el, nameEl) {
    const input = h('input', { class: 'input input-sm', type: 'text', value: layerLabel(el), maxlength: '80', 'aria-label': 'Nama layer' });
    nameEl.replaceWith(input);
    input.focus(); input.select();
    const done = (ok) => { if (ok) this.s.rename(el.id, input.value); else { this.sig = ''; this.render(); } };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { input.blur(); } if (e.key === 'Escape') { input.dataset.cancel = '1'; input.blur(); } });
    input.addEventListener('blur', () => done(input.dataset.cancel !== '1'));
  }
}

/* ===================================================================== Properti */
export class PropsPanel {
  constructor(root, session, ctl) {
    this.root = root;
    this.s = session;
    this.ctl = ctl; // { fit(), replaceImage(id), canvas }
    this.fields = [];
    this.key = '';
    this.body = h('div', { class: 'props-body' });
    root.append(h('div', { class: 'panel-head' }, h('h2', null, 'Properti')), this.body);
    this.unsub = [
      session.on('selection', () => this.build()),
      session.on('change', () => { if (!this.build()) this.refresh(); }),
    ];
    this.build(true);
  }

  destroy() { this.unsub.forEach((u) => u()); clear(this.root); }

  selKey() {
    const sel = this.s.selected();
    const pg = this.s.doc.page;
    return sel.length ? sel.map((e) => `${e.id}:${e.type}:${e.locked ? 1 : 0}${e.hidden ? 1 : 0}`).join(',') : `page:${pg.width}x${pg.height}`;
  }

  /** Membangun ulang hanya jika bentuk panel berubah (pilihan berbeda). Mengembalikan true jika dibangun. */
  build(force) {
    const key = this.selKey();
    if (!force && key === this.key) return false;
    // jangan membongkar panel saat pengguna sedang mengetik di salah satu kolomnya (mis. mengubah lebar halaman)
    if (!force && this.body.contains(document.activeElement) && document.activeElement.matches('input[type=number],input[type=text]') && key.startsWith('page:') && this.key.startsWith('page:')) { return false; }
    this.key = key;
    this.fields = [];
    clear(this.body);
    const sel = this.s.selected();
    if (!sel.length) this.buildPage();
    else this.buildSelection(sel);
    return true;
  }

  refresh() {
    for (const f of this.fields) f.update();
  }

  /* ------------------------------------------------------------ pembangun kolom */
  section(title, ...kids) {
    return h('section', { class: 'prop-sec' }, title ? h('h3', null, title) : null, ...kids);
  }

  num(label, get, set, { min = -99999, max = 99999, step = 1, disabled = false, unit = '', key } = {}) {
    const input = h('input', { class: 'input input-sm', type: 'number', min: String(min), max: String(max), step: String(step), disabled, 'aria-label': label });
    const update = () => { if (document.activeElement !== input) { const v = get(); input.value = v === null || v === undefined ? '' : fmt(v); input.placeholder = v === null ? 'Beragam' : ''; } };
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (input.value === '' || !Number.isFinite(v)) return;
      set(Math.min(max, Math.max(min, v)), key || label);
    });
    input.addEventListener('blur', () => { this.fields.forEach((f) => f.update()); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); e.stopPropagation(); });
    this.fields.push({ update });
    update();
    return h('div', { class: 'field' }, h('label', null, `${label}${unit ? ` (${unit})` : ''}`), input);
  }

  color(label, get, set, { allowNone = false, key } = {}) {
    const native = h('input', { type: 'color', 'aria-label': `${label} (pemilih warna)` });
    const hex = h('input', { class: 'input input-sm hex', type: 'text', maxlength: '9', spellcheck: 'false', 'aria-label': `${label} (kode hex)` });
    const none = allowNone ? h('button', { class: 'btn btn-sm btn-icon', type: 'button', title: 'Tanpa warna', 'aria-label': `${label}: tanpa warna`, onClick: () => set('none', key || label) }, icon('x', 14)) : null;
    const norm = (v) => (/^#[0-9a-f]{6}$/i.test(v) ? v : /^#[0-9a-f]{3}$/i.test(v) ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : null);
    const update = () => {
      const v = get();
      const isNone = v === 'none' || v === 'transparent';
      if (document.activeElement !== hex) hex.value = v === null ? '' : isNone ? 'none' : v;
      native.value = norm(!isNone && v ? v.slice(0, 7) : '') || '#000000';
      native.classList.toggle('is-none', isNone);
      if (none) none.classList.toggle('is-on', isNone);
    };
    native.addEventListener('input', () => set(native.value, key || label));
    hex.addEventListener('change', () => {
      const t = hex.value.trim();
      if (allowNone && t.toLowerCase() === 'none') { set('none', key || label); return; }
      const v = norm(t.startsWith('#') ? t : `#${t}`);
      if (v) set(v, key || label); else update();
    });
    hex.addEventListener('keydown', (e) => { if (e.key === 'Enter') hex.blur(); e.stopPropagation(); });
    const sw = h('div', { class: 'swatch-row' }, SWATCHES.map((c) => h('button', { class: 'sw', type: 'button', style: { background: c }, title: c, 'aria-label': `${label}: ${c}`, onClick: () => set(c, key || label) })));
    this.fields.push({ update });
    update();
    return h('div', { class: 'field' }, h('label', null, label), h('div', { class: 'color-row' }, native, hex, none), sw);
  }

  select(label, options, get, set) {
    const sel = h('select', { class: 'select input-sm', 'aria-label': label, onChange: () => set(sel.value) }, options.map(([v, l]) => h('option', { value: String(v) }, l)));
    const update = () => { const v = get(); sel.value = String(v); };
    sel.addEventListener('keydown', (e) => e.stopPropagation());
    this.fields.push({ update });
    update();
    return h('div', { class: 'field' }, h('label', null, label), sel);
  }

  toggles(items) {
    const row = h('div', { class: 'seg' });
    for (const it of items) {
      const b = h('button', { type: 'button', title: it.title, 'aria-label': it.title, 'aria-pressed': 'false', onClick: () => it.set() }, it.icon ? icon(it.icon, 15) : it.label);
      row.append(b);
      this.fields.push({ update: () => b.setAttribute('aria-pressed', String(!!it.get())) });
    }
    this.fields.at(-1) && this.refresh();
    return row;
  }

  iconRow(items) {
    return h('div', { class: 'icon-row' }, items.map((it) => h('button', { class: 'btn btn-sm btn-icon', type: 'button', title: it.title, 'aria-label': it.title, disabled: !!it.disabled, onClick: it.run }, icon(it.icon, 16))));
  }

  /* ------------------------------------------------------------ halaman */
  buildPage() {
    const S = this.s; const pg = S.doc.page;
    const match = () => { const p = PRESETS.find((x) => x.w === pg.width && x.h === pg.height); return p ? p.id : 'custom'; };
    this.body.append(
      this.section('Halaman',
        this.select('Preset ukuran', [...PRESETS.map((p) => [p.id, `${p.name} · ${p.w}×${p.h}`]), ['custom', 'Kustom']], match, (v) => {
          const p = PRESETS.find((x) => x.id === v);
          if (p) { S.setPage({ width: p.w, height: p.h }, { key: 'page:size' }); this.ctl.fit(); }
        }),
        h('div', { class: 'grid-2' },
          this.num('Lebar', () => pg.width, (v) => { S.setPage({ width: Math.round(v) }, { key: 'page:w' }); this.ctl.fit(); }, { min: 16, max: 16000, unit: 'px' }),
          this.num('Tinggi', () => pg.height, (v) => { S.setPage({ height: Math.round(v) }, { key: 'page:h' }); this.ctl.fit(); }, { min: 16, max: 16000, unit: 'px' })),
        this.color('Latar halaman', () => pg.background, (v) => S.setPage({ background: v }, { key: 'page:bg' }))),
      this.section(null, h('p', { class: 'hint' }, 'Pilih elemen di kanvas untuk mengatur posisi, warna, dan teksnya. Klik kosong untuk kembali ke pengaturan halaman.')));
  }

  /* ------------------------------------------------------------ elemen */
  buildSelection(sel) {
    const S = this.s;
    const ids = sel.map((e) => e.id);
    const single = sel.length === 1 ? sel[0] : null;
    const live = () => ids.map((id) => S.get(id)).filter(Boolean);
    const common = (prop) => { const L = live(); if (!L.length) return null; const v = L[0][prop]; return L.every((e) => e[prop] === v) ? v : null; };
    const setAll = (patch, key) => S.setProps(ids, patch, { key: key ? `p:${key}` : null });
    const types = new Set(sel.map((e) => e.type));
    const all = (...t) => sel.every((e) => t.includes(e.type));
    const any = (...t) => sel.some((e) => t.includes(e.type));

    this.body.append(h('div', { class: 'sel-head' },
      h('span', { class: 'sel-ic' }, icon(single ? TYPE_ICON[single.type] : 'layers', 16)),
      h('b', null, single ? TYPE_LABELS[single.type] : `${sel.length} elemen dipilih`)));

    if (single) {
      const isText = single.type === 'text'; const isLine = single.type === 'line' || single.type === 'arrow';
      this.body.append(this.section('Posisi dan ukuran',
        h('div', { class: 'grid-2' },
          this.num('X', () => S.get(single.id)?.x, (v) => setAll({ x: v }, 'x'), { step: 1, unit: 'px' }),
          this.num('Y', () => S.get(single.id)?.y, (v) => setAll({ y: v }, 'y'), { step: 1, unit: 'px' }),
          this.num(isLine ? 'Panjang' : 'Lebar', () => S.get(single.id)?.w, (v) => setAll({ w: Math.max(isText ? 20 : 1, v) }, 'w'), { min: 1, unit: 'px' }),
          this.num('Tinggi', () => S.get(single.id)?.h, (v) => setAll({ h: Math.max(1, v) }, 'h'), { min: 1, disabled: isText || isLine, unit: 'px' }),
          this.num('Rotasi', () => S.get(single.id)?.rotation, (v) => setAll({ rotation: v }, 'rot'), { min: -360, max: 360, unit: '°' }))));
    }

    const look = [];
    if (any('rect', 'ellipse', 'triangle', 'star')) look.push(this.color('Isi', () => common('fill'), (v) => setAll({ fill: v }, 'fill'), { allowNone: true }));
    if (all('text')) look.push(this.color('Warna teks', () => common('fill'), (v) => setAll({ fill: v }, 'fill')));
    if (any('rect', 'ellipse', 'triangle', 'star', 'line', 'arrow')) {
      look.push(this.color(any('line', 'arrow') && !any('rect', 'ellipse', 'triangle', 'star') ? 'Warna garis' : 'Garis tepi', () => common('stroke'), (v) => setAll({ stroke: v }, 'stroke'), { allowNone: !all('line', 'arrow') }));
      look.push(this.num('Tebal garis', () => common('strokeWidth'), (v) => setAll({ strokeWidth: v }, 'sw'), { min: 0, max: 200, unit: 'px' }));
    }
    if (any('rect', 'image')) look.push(this.num('Sudut membulat', () => common('radius'), (v) => setAll({ radius: v }, 'radius'), { min: 0, max: 5000, unit: 'px' }));
    const opac = h('input', { type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'Opasitas' });
    const opacVal = h('span', { class: 'muted num-badge' });
    const updOp = () => { const v = common('opacity'); if (document.activeElement !== opac) opac.value = String(Math.round((v ?? 1) * 100)); opacVal.textContent = v === null ? 'Beragam' : `${Math.round(v * 100)}%`; };
    opac.addEventListener('input', () => setAll({ opacity: Number(opac.value) / 100 }, 'opacity'));
    this.fields.push({ update: updOp }); updOp();
    look.push(h('div', { class: 'field' }, h('label', null, 'Opasitas'), h('div', { class: 'range-row' }, opac, opacVal)));
    this.body.append(this.section('Tampilan', ...look));

    if (all('text')) {
      this.body.append(this.section('Teks',
        this.select('Font', Object.entries(FONT_LABELS), () => common('fontFamily') || 'sans', (v) => setAll({ fontFamily: v }, 'font')),
        h('div', { class: 'grid-2' },
          this.num('Ukuran', () => common('fontSize'), (v) => setAll({ fontSize: Math.max(4, Math.round(v)) }, 'fs'), { min: 4, max: 1000, unit: 'px' }),
          this.select('Ketebalan', WEIGHTS, () => common('fontWeight') || 400, (v) => setAll({ fontWeight: Number(v) }, 'fw'))),
        h('div', { class: 'row-between' },
          this.toggles([
            { icon: 'italic', title: 'Miring', get: () => common('italic'), set: () => setAll({ italic: !common('italic') }, 'it') },
            { icon: 'underline', title: 'Garis bawah', get: () => common('underline'), set: () => setAll({ underline: !common('underline') }, 'ul') },
          ]),
          this.toggles([
            { icon: 'alignL', title: 'Rata kiri', get: () => common('align') === 'left', set: () => setAll({ align: 'left' }, 'al') },
            { icon: 'alignC', title: 'Rata tengah', get: () => common('align') === 'center', set: () => setAll({ align: 'center' }, 'al') },
            { icon: 'alignR', title: 'Rata kanan', get: () => common('align') === 'right', set: () => setAll({ align: 'right' }, 'al') },
          ])),
        h('div', { class: 'grid-2' },
          this.num('Jarak baris', () => common('lineHeight'), (v) => setAll({ lineHeight: Math.min(3, Math.max(0.8, v)) }, 'lh'), { min: 0.8, max: 3, step: 0.05 }),
          this.num('Jarak huruf', () => common('letterSpacing'), (v) => setAll({ letterSpacing: v }, 'ls'), { min: -20, max: 100, step: 0.5, unit: 'px' })),
        single ? h('button', { class: 'btn btn-sm', type: 'button', onClick: () => this.ctl.editText(single.id) }, icon('edit', 15), 'Edit teks') : null));
    }

    if (all('image')) {
      this.body.append(this.section('Gambar',
        this.select('Penyesuaian', [['cover', 'Isi penuh (potong)'], ['contain', 'Muat seluruhnya'], ['fill', 'Regangkan']], () => common('fit') || 'cover', (v) => setAll({ fit: v }, 'fit')),
        single ? h('button', { class: 'btn btn-sm', type: 'button', onClick: () => this.ctl.replaceImage(single.id) }, icon('image', 15), 'Ganti gambar…') : null));
    }

    const first = live()[0];
    this.body.append(this.section('Susun',
      this.iconRow([
        { icon: 'oLeft', title: sel.length > 1 ? 'Rata kiri' : 'Rata kiri halaman', run: () => S.align('left') },
        { icon: 'oCenter', title: sel.length > 1 ? 'Rata tengah horizontal' : 'Tengah horizontal halaman', run: () => S.align('centerH') },
        { icon: 'oRight', title: sel.length > 1 ? 'Rata kanan' : 'Rata kanan halaman', run: () => S.align('right') },
        { icon: 'oTop', title: sel.length > 1 ? 'Rata atas' : 'Rata atas halaman', run: () => S.align('top') },
        { icon: 'oMiddle', title: sel.length > 1 ? 'Rata tengah vertikal' : 'Tengah vertikal halaman', run: () => S.align('middleV') },
        { icon: 'oBottom', title: sel.length > 1 ? 'Rata bawah' : 'Rata bawah halaman', run: () => S.align('bottom') },
      ]),
      this.iconRow([
        { icon: 'front', title: 'Bawa ke depan (Ctrl+Shift+])', run: () => S.reorder('front') },
        { icon: 'up', title: 'Maju satu layer (Ctrl+])', run: () => S.reorder('forward') },
        { icon: 'down', title: 'Mundur satu layer (Ctrl+[)', run: () => S.reorder('backward') },
        { icon: 'back', title: 'Kirim ke belakang (Ctrl+Shift+[)', run: () => S.reorder('back') },
      ]),
      this.iconRow([
        { icon: 'copy', title: 'Duplikat (Ctrl+D)', run: () => S.duplicateSelected() },
        { icon: first && first.locked ? 'lock' : 'unlock', title: 'Kunci', run: () => S.toggleLock(ids) },
        { icon: 'eyeoff', title: 'Sembunyikan', run: () => S.toggleHidden(ids) },
        { icon: 'trash', title: 'Hapus (Delete)', run: () => S.deleteSelected() },
      ])));
    void types; void elementBounds;
  }
}
