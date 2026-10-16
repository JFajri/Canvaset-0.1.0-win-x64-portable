import { h, clear, $, debounce, escapeHtml } from '../shared/util.js';
import { api, state, recentItems } from '../shared/library.js';
import { icon } from './icons.js';
import { openItem } from './actions.js';

let open = false;

/** Pencarian global (judul + isi catatan + teks di dalam desain). */
export function openPalette() {
  if (open) return;
  open = true;
  const prevFocus = document.activeElement;
  let results = [];
  let sel = 0;
  let seq = 0;

  const input = h('input', { type: 'text', placeholder: 'Cari desain dan catatan…', 'aria-label': 'Pencarian global', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'palette-list', spellcheck: 'false' });
  const list = h('div', { class: 'palette-list', id: 'palette-list', role: 'listbox' });
  const foot = h('div', { class: 'palette-foot' }, h('span', null, '↑↓ pilih'), h('span', null, 'Enter buka'), h('span', null, 'Esc tutup'));
  const box = h('div', { class: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Pencarian global' }, input, list, foot);
  const scrim = h('div', { class: 'scrim', style: { alignItems: 'flex-start' }, onMousedown: (e) => { if (e.target === scrim) close(); } }, box);

  const close = () => {
    if (!open) return;
    open = false;
    scrim.remove();
    document.removeEventListener('keydown', onKey, true);
    if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus();
  };

  const go = (r) => { if (!r) return; close(); openItem(r.id); };

  function draw(label) {
    clear(list);
    if (!results.length) {
      list.append(h('div', { class: 'empty', style: { padding: '28px' } }, h('p', null, label || 'Tidak ada hasil.')));
      return;
    }
    if (!input.value.trim()) list.append(h('div', { class: 'menu-label' }, 'Terakhir dibuka'));
    results.forEach((r, i) => {
      const row = h('button', { class: `palette-row${i === sel ? ' sel' : ''}`, type: 'button', role: 'option', 'aria-selected': String(i === sel), onClick: () => go(r), onMousemove: () => { if (sel !== i) { sel = i; mark(); } } },
        h('span', { class: 'ic' }, icon(r.type === 'design' ? 'design' : 'note', 17)),
        h('span', { class: 'tx' }, h('b', { class: 'truncate' }, r.title), h('span', { class: 'truncate' }, r.snippet || (r.type === 'design' ? 'Desain' : 'Catatan'))));
      list.append(row);
    });
  }

  function mark() {
    list.querySelectorAll('.palette-row').forEach((el, i) => { el.classList.toggle('sel', i === sel); el.setAttribute('aria-selected', String(i === sel)); if (i === sel) el.scrollIntoView({ block: 'nearest' }); });
  }

  let inflight = Promise.resolve();
  const run = debounce(() => {
    inflight = (async () => {
      const q = input.value.trim();
      const my = ++seq;
      if (!q) { results = recentItems(8).map((i) => ({ id: i.id, type: i.type, title: i.title, snippet: i.type === 'note' ? i.snippet : '' })); sel = 0; draw('Belum ada item.'); return; }
      try {
        const r = await api.search(q);
        if (my !== seq) return;
        results = r; sel = 0; draw(`Tidak ada hasil untuk “${q}”.`);
      } catch (e) { results = []; draw(`Pencarian gagal: ${e.message}`); }
    })();
  }, 90);

  input.addEventListener('input', run);
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (results.length) { sel = (sel + 1) % results.length; mark(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (results.length) { sel = (sel - 1 + results.length) % results.length; mark(); } }
    else if (e.key === 'Enter') { e.preventDefault(); run.flush(); inflight.then(() => go(results[sel])); }
    else if (e.key === 'Tab') { e.preventDefault(); }
  }
  document.addEventListener('keydown', onKey, true);
  $('#dialog-root').appendChild(scrim);
  input.focus();
  run();
  run.flush();
}
