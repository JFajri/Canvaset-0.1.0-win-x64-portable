import { h, clear, formatDate, formatBytes } from '../shared/util.js';
import { bus } from '../shared/bus.js';
import { state } from '../shared/library.js';
import { icon } from './icons.js';
import { thumbContent, noteLines } from './thumbs.js';
import { newDesignFlow, newNoteFlow, openItem, itemMenu, createCollectionFlow, renameCollectionFlow, deleteCollectionFlow, importNotesFlow, importDesignFlow } from './actions.js';
import { showMenu } from './menu.js';

export class LibraryView {
  constructor(root) {
    this.root = root;
    this.f = { type: 'all', collection: 'all', sort: 'updated', layout: 'grid', q: '' };
    this.side = h('aside', { class: 'panel lib-side', 'aria-label': 'Koleksi' });
    this.main = h('main', { class: 'panel fill', 'aria-label': 'Pustaka' });
    root.append(this.side, this.main);
    bus.on('library:changed', () => this.render());
    this.render();
  }

  setCollection(id) { this.f.collection = id || 'all'; this.render(); }

  filtered() {
    const q = this.f.q.trim().toLowerCase();
    let items = state.items.filter((i) => (this.f.type === 'all' || i.type === this.f.type)
      && (this.f.collection === 'all' || (this.f.collection === 'pinned' ? i.pinned : this.f.collection === 'none' ? !i.collection : i.collection === this.f.collection))
      && (!q || i.title.toLowerCase().includes(q) || (i.snippet || '').toLowerCase().includes(q)));
    const s = this.f.sort;
    items = items.sort((a, b) => (b.pinned - a.pinned) || (s === 'name' ? a.title.localeCompare(b.title, 'id') : s === 'opened' ? (b.opened || 0) - (a.opened || 0) : s === 'created' ? b.created - a.created : b.updated - a.updated));
    return items;
  }

  nav(id, label, ic, count, extra) {
    return h('button', { class: `lib-nav${this.f.collection === id ? ' active' : ''}`, type: 'button', 'aria-current': this.f.collection === id ? 'true' : null, onClick: () => { this.f.collection = id; this.render(); }, onContextmenu: extra ? (e) => { e.preventDefault(); extra({ x: e.clientX, y: e.clientY }); } : null },
      icon(ic, 16), h('span', { class: 'truncate' }, label), h('span', { class: 'n' }, String(count)));
  }

  render() {
    const all = state.items;
    clear(this.side);
    this.side.append(
      h('div', { class: 'panel-head' }, h('h2', null, 'Pustaka')),
      h('div', { class: 'list' },
        this.nav('all', 'Semua item', 'grid', all.length),
        this.nav('pinned', 'Disematkan', 'pin', all.filter((i) => i.pinned).length),
        this.nav('none', 'Tanpa koleksi', 'tag', all.filter((i) => !i.collection).length),
        h('div', { class: 'lib-label' }, 'Koleksi', h('span', { class: 'spacer' }),
          h('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', title: 'Koleksi baru', 'aria-label': 'Koleksi baru', onClick: () => createCollectionFlow() }, icon('plus', 15))),
        state.collections.map((c) => this.nav(c.id, c.name, 'folder', all.filter((i) => i.collection === c.id).length, (at) => showMenu([
          { label: 'Ganti nama…', icon: 'edit', onSelect: () => renameCollectionFlow(c) },
          { label: 'Hapus koleksi…', icon: 'trash', danger: true, onSelect: () => { if (this.f.collection === c.id) this.f.collection = 'all'; deleteCollectionFlow(c); } },
        ], at)))));

    if (this.f.collection !== 'all' && !['pinned', 'none'].includes(this.f.collection) && !state.collections.some((c) => c.id === this.f.collection)) this.f.collection = 'all';
    const title = this.f.collection === 'all' ? 'Semua item' : this.f.collection === 'pinned' ? 'Disematkan' : this.f.collection === 'none' ? 'Tanpa koleksi' : (state.collections.find((c) => c.id === this.f.collection) || {}).name;
    const items = this.filtered();
    const targetCol = !['all', 'pinned', 'none'].includes(this.f.collection) ? this.f.collection : null;

    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Jenis' }, [['all', 'Semua'], ['design', 'Desain'], ['note', 'Catatan']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(this.f.type === k), onClick: () => { this.f.type = k; this.render(); } }, l)));
    const sort = h('select', { class: 'select input-sm', style: { width: '170px' }, 'aria-label': 'Urutkan', onChange: (e) => { this.f.sort = e.target.value; this.render(); } },
      [['updated', 'Terakhir diubah'], ['opened', 'Terakhir dibuka'], ['created', 'Terbaru dibuat'], ['name', 'Nama (A–Z)']].map(([v, l]) => h('option', { value: v }, l)));
    sort.value = this.f.sort;
    const layout = h('div', { class: 'seg', role: 'group', 'aria-label': 'Tata letak' },
      h('button', { type: 'button', title: 'Kisi', 'aria-label': 'Tampilan kisi', 'aria-pressed': String(this.f.layout === 'grid'), onClick: () => { this.f.layout = 'grid'; this.render(); } }, icon('grid', 15)),
      h('button', { type: 'button', title: 'Daftar', 'aria-label': 'Tampilan daftar', 'aria-pressed': String(this.f.layout === 'list'), onClick: () => { this.f.layout = 'list'; this.render(); } }, icon('rows', 15)));
    const search = h('input', { class: 'input input-sm', type: 'search', placeholder: 'Saring…', value: this.f.q, 'aria-label': 'Saring pustaka', onInput: (e) => { this.f.q = e.target.value; this.renderBody(); } });
    const newMenu = h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: (e) => showMenu([
      { label: 'Desain baru', icon: 'design', onSelect: () => newDesignFlow({ collection: targetCol }) },
      { label: 'Catatan baru', icon: 'note', onSelect: () => newNoteFlow({ collection: targetCol }) },
      { separator: true },
      { label: 'Impor catatan…', icon: 'upload', onSelect: () => importNotesFlow(targetCol) },
      { label: 'Impor proyek desain…', icon: 'upload', onSelect: () => importDesignFlow(targetCol) },
    ], e.currentTarget) }, icon('plus', 15), 'Baru');

    clear(this.main);
    this.bodyEl = h('div', { class: 'lib-body' });
    this.main.append(h('div', { class: 'lib-main-head' }, h('h2', null, title), search, seg, sort, layout, newMenu), this.bodyEl);
    this.renderBody();
    if (document.activeElement === document.body && this.f.q) search.focus();
  }

  renderBody() {
    const items = this.filtered();
    clear(this.bodyEl);
    if (!items.length) {
      const hasAny = state.items.length > 0;
      this.bodyEl.append(h('div', { class: 'empty', style: { height: '100%' } },
        h('div', { class: 'icon-wrap' }, icon(hasAny ? 'search' : 'folder', 24)),
        h('h3', null, hasAny ? 'Tidak ada yang cocok' : 'Pustaka masih kosong'),
        h('p', null, hasAny ? 'Ubah saringan atau kata kunci untuk melihat item lain.' : 'Buat desain atau catatan pertama Anda; semuanya akan muncul di sini.')));
      return;
    }
    const ctx = (it) => (e) => { e.preventDefault(); itemMenu(it, { x: e.clientX, y: e.clientY }); };
    if (this.f.layout === 'list') {
      this.bodyEl.append(h('div', { class: 'lib-list' }, items.map((it) => h('button', { class: 'row-item', type: 'button', onClick: () => openItem(it.id), onContextmenu: ctx(it) },
        h('div', { class: 'row-thumb' }, thumbContent(it)),
        h('div', { class: 'row-main' }, h('b', { class: 'truncate' }, it.title), h('span', null, `${formatDate(it.updated)} · ${formatBytes(it.size || 0)}`)),
        it.pinned ? h('span', { class: 'row-pin' }, icon('pin', 15)) : null,
        h('span', { class: 'row-kind' }, it.type === 'design' ? 'Desain' : it.ext.slice(1))))));
      return;
    }
    this.bodyEl.append(h('div', { class: 'tiles' }, items.map((it) => h('button', { class: 'tile', type: 'button', onClick: () => openItem(it.id), onContextmenu: ctx(it) },
      h('div', { class: 'th' }, it.type === 'note' ? noteLines(it) : thumbContent(it), it.pinned ? h('span', { class: 'pin' }, icon('pin', 14)) : null),
      h('b', { class: 'truncate' }, it.title),
      h('div', { class: 'meta' }, h('span', null, it.type === 'design' ? 'Desain' : it.ext.slice(1).toUpperCase()), h('span', null, '·'), h('span', null, formatDate(it.updated)))))));
  }
}
