import { h, clear, formatDate } from '../shared/util.js';
import { bus } from '../shared/bus.js';
import { state, recentItems } from '../shared/library.js';
import { icon } from './icons.js';
import { showMenu } from './menu.js';
import { thumbContent } from './thumbs.js';
import { newDesignFlow, newNoteFlow, importNotesFlow, importDesignFlow, openItem, itemMenu, createCollectionFlow } from './actions.js';

export class HomeView {
  constructor(root) {
    this.root = root;
    this.panel = h('div', { class: 'panel fill home' });
    root.append(this.panel);
    bus.on('library:changed', () => this.render());
    this.render();
  }

  render() {
    const items = state.items;
    const recents = recentItems(7);
    const pinned = items.filter((i) => i.pinned);
    const importBtn = h('button', { class: 'btn btn-lg', type: 'button', onClick: (e) => showMenu([
      { label: 'Impor catatan (.txt, .md)…', icon: 'note', onSelect: () => importNotesFlow().then((c) => c[0] && openItem(c[0].id)) },
      { label: 'Impor proyek desain (.canvaset)…', icon: 'design', onSelect: () => importDesignFlow().then((c) => c[0] && openItem(c[0].id)) },
    ], e.currentTarget) }, icon('upload', 18), 'Impor');

    const row = (it) => h('button', {
      class: 'row-item', type: 'button', onClick: () => openItem(it.id),
      onContextmenu: (e) => { e.preventDefault(); itemMenu(it, { x: e.clientX, y: e.clientY }); },
    },
    h('div', { class: 'row-thumb' }, thumbContent(it)),
    h('div', { class: 'row-main' }, h('b', { class: 'truncate' }, it.title), h('span', null, `${formatDate(it.updated)}${it.collection ? ` · ${(state.collections.find((c) => c.id === it.collection) || {}).name || ''}` : ''}`)),
    it.pinned ? h('span', { class: 'row-pin' }, icon('pin', 15)) : null,
    h('span', { class: 'row-kind' }, it.type === 'design' ? 'Desain' : it.ext.slice(1)));

    const recentBlock = recents.length
      ? h('div', null, recents.map(row))
      : h('div', { class: 'empty', style: { alignItems: 'flex-start', textAlign: 'left', padding: '24px 0' } },
        h('h3', null, 'Belum ada pekerjaan'),
        h('p', null, 'Mulai dengan desain kosong atau catatan baru. Semuanya tersimpan sebagai berkas di komputer Anda, tanpa akun dan tanpa internet.'));

    const colBlock = h('div', null,
      state.collections.map((c) => h('button', {
        class: 'col-link', type: 'button', onClick: () => bus.emit('navigate', { view: 'library', collection: c.id }),
      }, icon('folder', 16), h('span', { class: 'truncate' }, c.name), h('span', { class: 'n' }, String(items.filter((i) => i.collection === c.id).length)))),
      state.collections.length ? null : h('p', { class: 'hint', style: { padding: '6px 8px' } }, 'Kelompokkan desain dan catatan ke dalam koleksi, misalnya per klien atau mata kuliah.'),
      h('button', { class: 'col-link', type: 'button', onClick: () => createCollectionFlow() }, icon('plus', 16), 'Koleksi baru'));

    clear(this.panel);
    this.panel.append(h('div', { class: 'home-inner' },
      h('header', null,
        h('div', { class: 'eyebrow' }, 'Canvaset · ruang kerja kreatif lokal'),
        h('h1', null, 'Desain dan tulis ', h('br'), 'di satu tempat', h('em', null, '.')),
        h('div', { class: 'home-actions' },
          h('button', { class: 'btn btn-primary btn-lg', type: 'button', onClick: () => newDesignFlow() }, icon('design', 18), 'Desain baru'),
          h('button', { class: 'btn btn-lg', type: 'button', onClick: () => newNoteFlow() }, icon('note', 18), 'Catatan baru'),
          importBtn),
        h('button', { class: 'home-search', type: 'button', onClick: () => bus.emit('palette:open') }, icon('search', 17), h('span', null, 'Cari desain dan catatan…'), h('span', { class: 'kbd' }, 'Ctrl+P'))),
      h('div', { class: 'home-cols' },
        h('section', null,
          h('div', { class: 'sec-title' }, 'Terakhir dibuka', h('span', { class: 'spacer' }),
            items.length > 7 ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => bus.emit('navigate', { view: 'library' }) }, 'Lihat semua') : null),
          recentBlock),
        h('aside', { class: 'home-side' },
          pinned.length ? h('section', null, h('div', { class: 'sec-title' }, 'Disematkan'),
            pinned.slice(0, 6).map((it) => h('button', { class: 'col-link', type: 'button', onClick: () => openItem(it.id) }, icon(it.type === 'design' ? 'design' : 'note', 16), h('span', { class: 'truncate' }, it.title)))) : null,
          h('section', null, h('div', { class: 'sec-title' }, 'Koleksi'), colBlock)))));
  }
}
