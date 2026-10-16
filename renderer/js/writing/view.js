import { h, $, clear, debounce, countWords, readingMinutes, formatDate, formatBytes } from '../shared/util.js';
import { bus } from '../shared/bus.js';
import { api, state, refreshLibrary, patchItem, getItem } from '../shared/library.js';
import { Saver } from '../shared/saver.js';
import { icon } from '../ui/icons.js';
import { showMenu } from '../ui/menu.js';
import { toast, toastError } from '../ui/toast.js';
import { confirmDialog, promptDialog } from '../ui/dialog.js';
import { newNoteFlow, importNotesFlow, itemMenu, togglePin, deleteFlow, exportFlow, revealFlow, duplicateFlow } from '../ui/actions.js';
import { renderMarkdown, extractHeadings } from './markdown.js';
import * as F from './format.js';

const SAVE_LABEL = { saved: 'Tersimpan', dirty: 'Belum tersimpan', saving: 'Menyimpan…', error: 'Gagal menyimpan' };

export class WritingView {
  constructor(root) {
    this.root = root;
    this.id = null;
    this.meta = null;
    this.saver = null;
    this.mode = 'write'; // write | split | preview
    this.filter = { q: '', collection: '' };
    this.find = { open: false, q: '', idx: -1 };
    this.build();
    bus.on('library:changed', () => { this.renderList(); this.syncHeader(); });
    bus.on('settings:changed', () => this.autosize());
    bus.on('item:before-delete', ({ id }) => { if (id === this.id) this.discardCurrent(); });
    bus.on('item:deleted', ({ id }) => { if (id === this.id) this.showEmpty(); });
    bus.on('item:renamed', ({ id, title }) => { if (id === this.id) { this.meta = { ...this.meta, title }; this.syncHeader(); } });
  }

  /* ------------------------------------------------------------ DOM */
  build() {
    const r = this.root;
    this.listEl = h('div', { class: 'doc-list', role: 'listbox', 'aria-label': 'Daftar catatan' });
    this.searchIn = h('input', { class: 'input input-sm', type: 'search', placeholder: 'Saring catatan…', 'aria-label': 'Saring catatan', onInput: (e) => { this.filter.q = e.target.value; this.renderList(); } });
    this.colSel = h('select', { class: 'select input-sm', 'aria-label': 'Filter koleksi', onChange: (e) => { this.filter.collection = e.target.value; this.renderList(); } });

    const docs = h('aside', { class: 'panel docs-panel', 'aria-label': 'Dokumen' },
      h('div', { class: 'panel-head docs-head' },
        h('h2', null, 'Catatan'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', title: 'Impor TXT / Markdown', 'aria-label': 'Impor catatan', onClick: () => importNotesFlow(this.filter.collection || null).then((c) => c[0] && this.open(c[0].id)) }, icon('upload', 16)),
        h('button', { class: 'btn btn-primary btn-icon btn-sm', type: 'button', title: 'Catatan baru (Ctrl+N)', 'aria-label': 'Catatan baru', onClick: () => newNoteFlow({ collection: this.filter.collection || null }) }, icon('plus', 16))),
      h('div', { class: 'docs-filter' }, this.searchIn),
      h('div', { class: 'docs-tools' }, this.colSel),
      this.listEl);

    /* editor */
    this.titleIn = h('input', {
      class: 'title-input', type: 'text', maxlength: '120', 'aria-label': 'Judul catatan', spellcheck: 'false',
      onBlur: () => this.commitTitle(),
      onKeydown: (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this.titleIn.blur(); this.ta.focus(); }
        if (e.key === 'Escape') { this.titleIn.value = this.meta ? this.meta.title : ''; this.titleIn.blur(); }
      },
    });
    this.saveEl = h('span', { class: 'save-status', 'data-state': 'saved', role: 'status', 'aria-live': 'polite' }, SAVE_LABEL.saved);
    this.pinBtn = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Sematkan', 'aria-label': 'Sematkan', onClick: () => this.meta && togglePin(getItem(this.id) || this.meta) }, icon('pin'));
    this.modeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Mode tampilan' },
      ['write:Tulis', 'split:Pisah', 'preview:Baca'].map((s) => {
        const [k, label] = s.split(':');
        return h('button', { type: 'button', dataset: { mode: k }, 'aria-pressed': 'false', onClick: () => this.setMode(k) }, label);
      }));
    this.findBtn = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Cari di dokumen (Ctrl+F)', 'aria-label': 'Cari di dokumen', onClick: () => this.toggleFind() }, icon('find'));
    this.docsBtn = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Tampilkan/sembunyikan daftar', 'aria-label': 'Tampilkan atau sembunyikan daftar catatan', onClick: () => this.root.classList.toggle('hide-docs') }, icon('sidebar'));
    this.sideBtn = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Tampilkan/sembunyikan panel samping', 'aria-label': 'Tampilkan atau sembunyikan panel samping', onClick: () => this.root.classList.toggle('hide-side') }, icon('sidebarR'));
    this.moreBtn = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Lainnya', 'aria-label': 'Menu lainnya', onClick: () => this.moreMenu() }, icon('more'));

    this.toolbar = h('div', { class: 'editor-toolbar', role: 'toolbar', 'aria-label': 'Format teks' }, [
      ['bold', 'Tebal (Ctrl+B)', () => this.fmt('bold')], ['italic', 'Miring (Ctrl+I)', () => this.fmt('italic')],
      ['heading', 'Heading (klik lagi: H2 → H3)', () => this.fmt('heading')],
      ['list', 'Daftar poin', () => this.fmt('ul')], ['listnum', 'Daftar angka', () => this.fmt('ol')],
      ['checklist', 'Daftar tugas', () => this.fmt('task')], ['quote', 'Kutipan', () => this.fmt('quote')],
      ['code', 'Kode (Ctrl+E)', () => this.fmt('code')], ['link', 'Tautan (Ctrl+K)', () => this.fmt('link')],
    ].map(([ic, title, fn]) => h('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', title, 'aria-label': title, onMousedown: (e) => e.preventDefault(), onClick: fn }, icon(ic, 17))));

    this.findIn = h('input', { class: 'input input-sm', type: 'search', placeholder: 'Cari…', 'aria-label': 'Kata yang dicari', onInput: () => { this.find.q = this.findIn.value; this.find.idx = -1; this.findNext(1, true); } });
    this.findCount = h('span', { class: 'count', 'aria-live': 'polite' });
    this.findBar = h('div', { class: 'findbar', hidden: true, role: 'search' },
      this.findIn, this.findCount,
      h('button', { class: 'btn btn-sm btn-icon', type: 'button', title: 'Sebelumnya (Shift+Enter)', 'aria-label': 'Hasil sebelumnya', onClick: () => this.findNext(-1) }, h('span', { style: { display: 'inline-flex', transform: 'rotate(180deg)' } }, icon('down', 15))),
      h('button', { class: 'btn btn-sm btn-icon', type: 'button', title: 'Berikutnya (Enter)', 'aria-label': 'Hasil berikutnya', onClick: () => this.findNext(1) }, icon('down', 15)),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-ghost btn-sm btn-icon', type: 'button', title: 'Tutup (Esc)', 'aria-label': 'Tutup pencarian', onClick: () => this.toggleFind(false) }, icon('x', 15)));
    this.findIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.findNext(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') { e.preventDefault(); this.toggleFind(false); }
    });

    this.banner = h('div', { class: 'banner', hidden: true, role: 'alert' });
    this.ta = h('textarea', {
      class: 'editor-text', spellcheck: 'false', 'aria-label': 'Isi catatan', placeholder: 'Mulai menulis…',
      onInput: () => this.onInput(), onKeydown: (e) => this.onKeydown(e),
    });
    this.scroll = h('div', { class: 'editor-scroll' }, h('div', { class: 'editor-sheet' }, this.ta));
    this.preview = h('div', { class: 'md-preview selectable', onClick: (e) => this.onPreviewClick(e) });
    this.previewPane = h('div', { class: 'pane-preview' }, this.preview);
    this.body = h('div', { class: 'editor-body mode-write' }, this.scroll, this.previewPane);

    this.wordsEl = h('span'); this.charsEl = h('span'); this.readEl = h('span'); this.posEl = h('span'); this.fmtEl = h('span');
    this.status = h('div', { class: 'statusbar' }, this.wordsEl, this.charsEl, this.readEl, h('span', { class: 'spacer' }), this.posEl, this.fmtEl);

    this.editorHead = h('div', { class: 'editor-head' }, this.docsBtn, this.titleIn, this.saveEl, h('span', { class: 'sep' }), this.modeSeg, this.findBtn, this.pinBtn, this.sideBtn, this.moreBtn);
    this.empty = h('div', { class: 'empty', style: { flex: '1' } },
      h('div', { class: 'icon-wrap' }, icon('note', 26)),
      h('h3', null, 'Belum ada catatan yang dibuka'),
      h('p', null, 'Pilih catatan dari daftar, atau mulai tulisan baru. Semua catatan disimpan sebagai berkas .md atau .txt di komputer Anda.'),
      h('div', { style: { display: 'flex', gap: '8px' } },
        h('button', { class: 'btn btn-primary', type: 'button', onClick: () => newNoteFlow({ collection: this.filter.collection || null }) }, icon('plus', 16), 'Catatan baru'),
        h('button', { class: 'btn', type: 'button', onClick: () => importNotesFlow().then((c) => c[0] && this.open(c[0].id)) }, icon('upload', 16), 'Impor berkas')));

    this.editorWrap = h('div', { style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: 0 } }, this.editorHead, this.toolbar, this.findBar, this.banner, this.body, this.status);
    const editor = h('main', { class: 'panel fill editor-panel', 'aria-label': 'Editor' }, this.editorWrap, this.empty);

    this.outlineEl = h('div', { class: 'outline', role: 'navigation', 'aria-label': 'Daftar isi' });
    this.infoEl = h('dl', { class: 'kv' });
    const side = h('aside', { class: 'panel side-panel', 'aria-label': 'Panel samping' },
      h('div', { class: 'panel-head' }, h('h2', null, 'Daftar isi')),
      h('div', { class: 'side-section', style: { borderBottom: 0 } }, this.outlineEl),
      h('div', { class: 'side-section', style: { marginTop: 'auto', borderTop: '1px solid var(--border)', borderBottom: 0 } }, h('h3', null, 'Informasi'), this.infoEl));

    r.append(docs, editor, side);
    this.renderPreviewSoon = debounce(() => this.renderPreview(), 140);
    this.renderStatsSoon = debounce(() => this.renderStats(), 120);
    this.ta.addEventListener('keyup', () => this.updatePos());
    this.ta.addEventListener('click', () => this.updatePos());
    this.ta.addEventListener('paste', () => setTimeout(() => this.autosize(), 0));
    this.showEmpty();
  }

  /* ------------------------------------------------------------ daftar */
  notes() {
    const q = this.filter.q.trim().toLowerCase();
    return state.items
      .filter((i) => i.type === 'note')
      .filter((i) => !this.filter.collection || (this.filter.collection === '__none' ? !i.collection : i.collection === this.filter.collection))
      .filter((i) => !q || i.title.toLowerCase().includes(q) || (i.snippet || '').toLowerCase().includes(q))
      .sort((a, b) => (b.pinned - a.pinned) || (b.updated - a.updated));
  }

  renderList() {
    const cur = this.colSel.value;
    clear(this.colSel);
    this.colSel.append(h('option', { value: '' }, 'Semua koleksi'), h('option', { value: '__none' }, 'Tanpa koleksi'),
      state.collections.map((c) => h('option', { value: c.id }, c.name)));
    this.colSel.value = Array.from(this.colSel.options).some((o) => o.value === cur) ? cur : '';
    this.filter.collection = this.colSel.value;

    clear(this.listEl);
    const notes = this.notes();
    if (!notes.length) {
      const any = state.items.some((i) => i.type === 'note');
      this.listEl.append(h('div', { class: 'empty' },
        h('h3', null, any ? 'Tidak ada hasil' : 'Belum ada catatan'),
        h('p', null, any ? 'Coba kata kunci atau koleksi lain.' : 'Buat catatan pertama Anda dengan tombol + di atas.')));
      return;
    }
    let lastPin = null;
    for (const n of notes) {
      if (lastPin !== n.pinned && (n.pinned || lastPin !== null)) this.listEl.append(h('div', { class: 'doc-group' }, n.pinned ? 'Disematkan' : 'Lainnya'));
      else if (lastPin === null && n.pinned) this.listEl.append(h('div', { class: 'doc-group' }, 'Disematkan'));
      lastPin = n.pinned;
      const row = h('button', {
        class: `doc-row${n.id === this.id ? ' active' : ''}`, type: 'button', role: 'option', 'aria-selected': String(n.id === this.id), dataset: { id: n.id },
        onClick: () => this.open(n.id),
        onContextmenu: (e) => { e.preventDefault(); itemMenu(getItem(n.id) || n, { x: e.clientX, y: e.clientY }); },
        onKeydown: (e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const rows = Array.from(this.listEl.querySelectorAll('.doc-row'));
            const i = rows.indexOf(e.currentTarget);
            const next = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
            if (next) next.focus();
          }
        },
      },
      h('div', { class: 't' }, n.pinned ? icon('pin', 13) : null, h('span', { class: 'truncate' }, n.title)),
      n.snippet ? h('div', { class: 's' }, n.snippet) : null,
      h('div', { class: 'm' }, h('span', null, formatDate(n.updated)), h('span', { class: 'badge' }, n.ext)));
      this.listEl.append(row);
    }
  }

  /* ------------------------------------------------------------ buka / tutup */
  showEmpty() {
    this.id = null; this.meta = null;
    if (this.saver) { this.saver.dispose(); this.saver = null; }
    this.editorWrap.hidden = true;
    this.empty.hidden = false;
    clear(this.outlineEl); clear(this.infoEl);
    this.renderList();
  }

  discardCurrent() {
    if (this.saver) { this.saver.dispose(); this.saver = null; }
  }

  async flush() {
    if (!this.saver) return true;
    return this.saver.flush();
  }

  async open(id) {
    if (id === this.id && this.saver) { this.ta.focus(); return; }
    if (this.saver && !(await this.flush())) {
      const go = await confirmDialog({
        title: 'Perubahan belum tersimpan',
        message: `Catatan “${this.meta.title}” gagal disimpan (${this.saver.lastError || 'penyebab tidak diketahui'}). Draf pemulihan sudah dibuat dan akan ditawarkan saat catatan dibuka lagi. Tetap pindah?`,
        confirmLabel: 'Tetap pindah', danger: true,
      });
      if (!go) return;
    }
    let res;
    try { res = await api.readItem(id); } catch (e) { toastError(e, 'Tidak dapat membuka catatan'); await refreshLibrary(); return; }
    if (this.saver) this.saver.dispose();
    this.id = id;
    this.meta = res.meta;
    patchItem(res.meta);
    this.editorWrap.hidden = false;
    this.empty.hidden = true;
    this.ta.value = res.content;
    this.saver = new Saver({
      api, id, content: res.content, autosaveMs: state.settings.autosaveMs,
      onState: ({ state: st, message }) => this.onSaveState(st, message),
      onSaved: (meta) => { this.meta = meta; patchItem(meta); this.renderInfo(); },
    });
    this.onSaveState('saved');
    this.applyFormatMode();
    this.showRecovery(res.recovery);
    this.syncHeader();
    this.renderList();
    this.renderStats(); this.renderOutline(); this.renderPreview(); this.autosize(); this.updatePos();
    this.scroll.scrollTop = 0;
    if (this.find.open) this.findNext(1, true);
    const active = this.listEl.querySelector('.doc-row.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
    if (!res.content) this.ta.focus();
    bus.emit('writing:opened', { id });
  }

  showRecovery(draft) {
    clear(this.banner);
    if (!draft) { this.banner.hidden = true; return; }
    const when = formatDate(draft.savedAt);
    this.banner.hidden = false;
    this.banner.append(
      icon('alert', 18),
      h('div', { class: 'grow' }, h('b', null, 'Perubahan yang belum tersimpan ditemukan'), h('div', { class: 'hint' }, `Aplikasi tertutup sebelum sempat menyimpan (${when}). Pulihkan versi terakhir?`)),
      h('button', { class: 'btn btn-sm', type: 'button', onClick: () => { this.banner.hidden = true; api.clearDraft(this.id).catch(() => {}); } }, 'Abaikan'),
      h('button', { class: 'btn btn-sm btn-primary', type: 'button', onClick: () => { this.ta.value = draft.content; this.banner.hidden = true; this.onInput(); toast('Draf dipulihkan.', { type: 'success' }); } }, 'Pulihkan'));
  }

  syncHeader() {
    if (!this.meta) return;
    const live = getItem(this.id) || this.meta;
    if (document.activeElement !== this.titleIn) this.titleIn.value = live.title;
    this.pinBtn.classList.toggle('is-on', !!live.pinned);
    this.pinBtn.title = live.pinned ? 'Lepas sematan' : 'Sematkan';
    this.fmtEl.textContent = live.ext === '.md' ? 'Markdown' : 'Teks biasa';
    this.renderInfo();
  }

  applyFormatMode() {
    const md = this.meta.ext === '.md';
    this.toolbar.hidden = !md;
    this.modeSeg.hidden = !md;
    if (!md) this.mode = 'write';
    this.ta.classList.toggle('mono-plain', !md);
    this.setMode(this.mode, true);
  }

  setMode(mode, silent) {
    this.mode = mode;
    this.body.className = `editor-body mode-${mode}`;
    for (const b of this.modeSeg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    if (mode !== 'write') this.renderPreview();
    if (!silent && mode !== 'preview') this.ta.focus();
  }

  /* ------------------------------------------------------------ penyuntingan */
  onInput() {
    if (!this.saver) return;
    this.saver.setContent(this.ta.value);
    this.autosize();
    this.renderStatsSoon();
    if (this.mode !== 'write') this.renderPreviewSoon();
    this.updatePos();
    if (this.meta.ext === '.md') this.outlineSoon();
  }

  get outlineSoon() { return this._outlineSoon || (this._outlineSoon = debounce(() => this.renderOutline(), 300)); }

  autosize() {
    const ta = this.ta;
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(ta.scrollHeight, this.scroll.clientHeight * 0.6)}px`;
  }

  onSaveState(st, message) {
    this.saveEl.dataset.state = st;
    this.saveEl.textContent = SAVE_LABEL[st] || st;
    this.saveEl.title = st === 'error' && message ? `${message} — mencoba lagi otomatis.` : '';
  }

  applyEdit(edit) {
    const ta = this.ta;
    ta.focus();
    ta.setSelectionRange(edit.from, edit.to);
    // execCommand menjaga riwayat undo bawaan textarea; setRangeText hanya cadangan.
    let ok = false;
    try {
      if (edit.insert === '') ok = edit.from < edit.to ? document.execCommand('delete') : true;
      else ok = document.execCommand('insertText', false, edit.insert);
    } catch (_) { ok = false; }
    if (!ok) {
      ta.setRangeText(edit.insert, edit.from, edit.to, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    ta.setSelectionRange(edit.selStart, edit.selEnd);
  }

  async fmt(kind) {
    if (!this.meta || this.meta.ext !== '.md') return;
    const ta = this.ta; const t = ta.value; const s = ta.selectionStart; const e = ta.selectionEnd;
    let edit;
    if (kind === 'bold') edit = F.toggleWrap(t, s, e, '**', 'teks tebal');
    else if (kind === 'italic') edit = F.toggleWrap(t, s, e, '*', 'teks miring');
    else if (kind === 'code') edit = e > s && t.slice(s, e).includes('\n') ? F.codeBlock(t, s, e) : F.toggleWrap(t, s, e, '`', 'kode');
    else if (kind === 'heading') {
      const ls = t.lastIndexOf('\n', s - 1) + 1;
      const m = /^(#{1,6}) /.exec(t.slice(ls, ls + 8));
      const lvl = m ? m[1].length : 0;
      edit = F.toggleLinePrefix(t, s, e, lvl === 0 ? 'h2' : lvl === 2 ? 'h3' : lvl === 3 ? 'h1' : lvl === 1 ? 'h2' : 'h2');
    } else if (kind === 'link') {
      const sel = t.slice(s, e);
      const asUrl = /^https?:\/\/\S+$/.test(sel);
      const url = await promptDialog({ title: 'Sisipkan tautan', label: 'Alamat (URL)', value: asUrl ? sel : 'https://', confirmLabel: 'Sisipkan', validate: (v) => (/^(https?:\/\/|mailto:)\S+$/i.test(v) ? null : 'Gunakan alamat yang diawali http://, https://, atau mailto:.') });
      if (!url) { ta.focus(); return; }
      // Jika yang dipilih sudah berupa URL, jadikan URL itu tautan berlabel "tautan".
      edit = asUrl ? { from: s, to: e, insert: `[tautan](${url})`, selStart: s + 1, selEnd: s + 7 } : F.insertLink(t, s, e, url);
    } else edit = F.toggleLinePrefix(t, s, e, kind);
    this.applyEdit(edit);
  }

  onKeydown(e) {
    const ta = this.ta;
    const md = this.meta && this.meta.ext === '.md';
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (md && k === 'b') { e.preventDefault(); this.fmt('bold'); return; }
      if (md && k === 'i') { e.preventDefault(); this.fmt('italic'); return; }
      if (md && k === 'k') { e.preventDefault(); this.fmt('link'); return; }
      if (md && k === 'e') { e.preventDefault(); this.fmt('code'); return; }
    }
    if (md && e.key === 'Enter' && !e.shiftKey && !mod && ta.selectionStart === ta.selectionEnd) {
      const edit = F.continueList(ta.value, ta.selectionStart);
      if (edit) { e.preventDefault(); this.applyEdit(edit); return; }
    }
    if (e.key === 'Tab' && !mod && !e.altKey) {
      const s = ta.selectionStart; const en = ta.selectionEnd; const t = ta.value;
      const ls = t.lastIndexOf('\n', s - 1) + 1;
      const inList = /^\s*([-*+]|\d+[.)])\s/.test(t.slice(ls, t.indexOf('\n', s) === -1 ? t.length : t.indexOf('\n', s)));
      const multi = s !== en && t.slice(s, en).includes('\n');
      if (multi || inList || e.shiftKey && s !== en) { e.preventDefault(); this.applyEdit(F.indentLines(t, s, en, e.shiftKey)); }
    }
  }

  async commitTitle() {
    if (!this.meta) return;
    const t = this.titleIn.value.trim();
    const live = getItem(this.id) || this.meta;
    if (!t) { this.titleIn.value = live.title; return; }
    if (t === live.title) return;
    try {
      await this.flush();
      const m = await api.renameItem(this.id, t);
      this.meta = m; patchItem(m);
    } catch (e) { toastError(e, 'Gagal mengganti nama'); this.titleIn.value = live.title; }
  }

  /* ------------------------------------------------------------ cari */
  toggleFind(open = !this.find.open) {
    if (!this.meta && open) return;
    this.find.open = open;
    this.findBar.hidden = !open;
    if (open) {
      const sel = this.ta.value.slice(this.ta.selectionStart, this.ta.selectionEnd);
      if (sel && !sel.includes('\n') && sel.length < 80) { this.findIn.value = sel; this.find.q = sel; }
      this.findIn.focus(); this.findIn.select();
      this.findNext(1, true);
    } else {
      this.findCount.textContent = '';
      if (this.meta) this.ta.focus();
    }
  }

  matches() {
    const q = this.find.q.toLowerCase();
    if (!q) return [];
    const t = this.ta.value.toLowerCase();
    const out = [];
    let i = t.indexOf(q);
    while (i !== -1 && out.length < 5000) { out.push(i); i = t.indexOf(q, i + Math.max(1, q.length)); }
    return out;
  }

  findNext(dir, fromCursor) {
    const ms = this.matches();
    const len = this.find.q.length;
    if (!ms.length) { this.findCount.textContent = this.find.q ? 'Tidak ada hasil' : ''; this.find.idx = -1; return; }
    if (fromCursor) {
      const pos = this.ta.selectionStart;
      const j = ms.findIndex((m) => m >= pos);
      this.find.idx = j === -1 ? 0 : j;
    } else this.find.idx = (this.find.idx + dir + ms.length) % ms.length;
    const at = ms[this.find.idx];
    this.findCount.textContent = `${this.find.idx + 1} dari ${ms.length}${ms.length >= 5000 ? '+' : ''}`;
    // Fokus sementara ke textarea agar tampilan menggulir ke hasil, lalu kembali ke kolom cari.
    const keep = document.activeElement;
    this.ta.focus({ preventScroll: true });
    this.ta.setSelectionRange(at, at + len);
    this.scrollToOffset(at);
    if (keep && keep !== this.ta) keep.focus({ preventScroll: true });
  }

  scrollToOffset(offset) {
    const t = this.ta.value.slice(0, offset);
    const line = t.split('\n').length - 1;
    const lh = parseFloat(getComputedStyle(this.ta).lineHeight) || 26;
    const wrapAdjust = this.measureWrapped(t);
    const y = (wrapAdjust ?? line * lh) + 24;
    const view = this.scroll.clientHeight;
    if (y < this.scroll.scrollTop + 40 || y > this.scroll.scrollTop + view - 60) this.scroll.scrollTop = Math.max(0, y - view / 3);
  }

  measureWrapped(textBefore) {
    if (!this._mirror) {
      this._mirror = h('div', { style: { position: 'absolute', visibility: 'hidden', pointerEvents: 'none', whiteSpace: 'pre-wrap', wordWrap: 'break-word', top: '0', left: '-9999px' } });
      document.body.appendChild(this._mirror);
    }
    const cs = getComputedStyle(this.ta);
    const m = this._mirror;
    m.style.width = `${this.ta.clientWidth}px`;
    m.style.font = cs.font; m.style.lineHeight = cs.lineHeight; m.style.letterSpacing = cs.letterSpacing; m.style.tabSize = cs.tabSize;
    m.textContent = `${textBefore}​`;
    return m.scrollHeight - (parseFloat(cs.lineHeight) || 0);
  }

  /* ------------------------------------------------------------ pratinjau & panel */
  renderPreview() {
    if (!this.meta || this.mode === 'write') return;
    // renderMarkdown meng-escape seluruh HTML mentah; tautan dibatasi http/https/mailto.
    this.preview.innerHTML = renderMarkdown(this.ta.value) || '<p class="muted">Pratinjau akan muncul di sini.</p>';
  }

  onPreviewClick(e) {
    const a = e.target.closest('a[data-link]');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href');
    if (href.startsWith('#')) return;
    api.openExternal(href).catch((err) => toastError(err));
  }

  renderStats() {
    const t = this.ta.value;
    const w = countWords(t);
    this.wordsEl.textContent = `${w.toLocaleString('id-ID')} kata`;
    this.charsEl.textContent = `${t.length.toLocaleString('id-ID')} karakter`;
    this.readEl.textContent = w ? `±${readingMinutes(w)} menit baca` : '';
    this.renderInfo();
  }

  updatePos() {
    const t = this.ta.value; const p = this.ta.selectionStart;
    const before = t.slice(0, p);
    const line = before.split('\n').length;
    const col = p - (before.lastIndexOf('\n') + 1) + 1;
    this.posEl.textContent = `Baris ${line}, Kolom ${col}`;
  }

  renderOutline() {
    clear(this.outlineEl);
    if (!this.meta) return;
    if (this.meta.ext !== '.md') { this.outlineEl.append(h('p', { class: 'hint' }, 'Daftar isi tersedia untuk catatan Markdown.')); return; }
    const hs = extractHeadings(this.ta.value);
    if (!hs.length) { this.outlineEl.append(h('p', { class: 'hint' }, 'Tambahkan heading (# Judul) untuk membuat daftar isi.')); return; }
    for (const x of hs) {
      this.outlineEl.append(h('button', { type: 'button', class: `l${x.level}`, onClick: () => { this.setMode(this.mode === 'preview' ? 'split' : this.mode, true); this.ta.focus(); this.ta.setSelectionRange(x.offset, x.offset); this.scrollToOffset(x.offset); } }, x.text || '(tanpa judul)'));
    }
  }

  renderInfo() {
    clear(this.infoEl);
    if (!this.meta) return;
    const live = getItem(this.id) || this.meta;
    const row = (k, v) => this.infoEl.append(h('dt', null, k), h('dd', null, v));
    row('Dibuat', formatDate(live.created));
    row('Diubah', formatDate(live.updated));
    row('Ukuran', formatBytes(new Blob([this.ta.value]).size));
    row('Berkas', live.file);
  }

  /* ------------------------------------------------------------ menu */
  moreMenu() {
    if (!this.meta) return;
    const live = getItem(this.id) || this.meta;
    showMenu([
      { label: 'Ganti nama', icon: 'edit', onSelect: () => { this.titleIn.focus(); this.titleIn.select(); } },
      { label: live.ext === '.md' ? 'Ubah ke teks biasa (.txt)' : 'Ubah ke Markdown (.md)', icon: 'note', onSelect: () => this.convert(live.ext === '.md' ? '.txt' : '.md') },
      { separator: true },
      { label: 'Ekspor…', icon: 'download', onSelect: async () => { await this.flush(); exportFlow(live); } },
      { label: 'Duplikat', icon: 'copy', onSelect: async () => { await this.flush(); duplicateFlow(live); } },
      { label: 'Buka lokasi file', icon: 'folder', onSelect: () => revealFlow(live) },
      { separator: true },
      { label: 'Hapus…', icon: 'trash', danger: true, onSelect: () => deleteFlow(live) },
    ], this.moreBtn);
  }

  async convert(ext) {
    try {
      await this.flush();
      const m = await api.convertNote(this.id, ext);
      this.meta = m; patchItem(m);
      this.applyFormatMode(); this.renderOutline();
      toast(`Format diubah ke ${ext === '.md' ? 'Markdown' : 'teks biasa'}.`);
    } catch (e) { toastError(e, 'Gagal mengubah format'); }
  }

  /* ------------------------------------------------------------ shortcut tingkat tampilan */
  handleShortcut(e) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return false;
    const k = e.key.toLowerCase();
    if (k === 'f' && !e.shiftKey) { e.preventDefault(); this.toggleFind(true); return true; }
    if (k === 's' && !e.shiftKey) { e.preventDefault(); this.saver && this.saver.save().then((ok) => ok && toast('Tersimpan.', { type: 'success', timeout: 1200 })); return true; }
    if (k === 'p' && e.shiftKey && this.meta && this.meta.ext === '.md') { e.preventDefault(); this.setMode(this.mode === 'write' ? 'split' : 'write'); return true; }
    return false;
  }
}
