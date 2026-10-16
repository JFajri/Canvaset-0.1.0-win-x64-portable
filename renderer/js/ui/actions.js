// Alur aksi bersama (dipakai Home, Pustaka, daftar catatan, pencarian).
import { h } from '../shared/util.js';
import { bus } from '../shared/bus.js';
import { api, state, refreshLibrary, getItem } from '../shared/library.js';
import { openDialog, confirmDialog, promptDialog } from './dialog.js';
import { toast, toastError } from './toast.js';
import { showMenu } from './menu.js';
import { PRESETS, createDocument, serializeDocument } from '../design/model.js';

export function openItem(id) {
  const it = getItem(id);
  if (!it) { toast('Item tidak ditemukan.', { type: 'error' }); return; }
  bus.emit('navigate', { view: it.type === 'note' ? 'writing' : 'design', id });
}

function collectionSelect(value) {
  const sel = h('select', { class: 'select', 'aria-label': 'Koleksi' },
    h('option', { value: '' }, 'Tanpa koleksi'),
    state.collections.map((c) => h('option', { value: c.id }, c.name)));
  sel.value = value || '';
  return sel;
}

/* ---------------------------------------------------------------- catatan baru */
export async function newNoteFlow({ collection = null } = {}) {
  const name = h('input', { class: 'input', type: 'text', value: 'Catatan baru', maxlength: '120', 'aria-label': 'Judul catatan' });
  let ext = state.settings.defaultNoteExt;
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Format' });
  const mk = (val, label) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(ext === val), onClick: () => { ext = val; refreshSeg(); } }, label);
    return b;
  };
  const bMd = mk('.md', 'Markdown (.md)');
  const bTxt = mk('.txt', 'Teks biasa (.txt)');
  const refreshSeg = () => { bMd.setAttribute('aria-pressed', String(ext === '.md')); bTxt.setAttribute('aria-pressed', String(ext === '.txt')); };
  seg.append(bMd, bTxt);
  const col = collectionSelect(collection);
  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
    h('div', { class: 'field' }, h('label', null, 'Judul'), name),
    h('div', { class: 'field' }, h('label', null, 'Format berkas'), seg,
      h('span', { class: 'hint' }, 'Markdown mendukung format dan pratinjau. Teks biasa seperti Notepad. Keduanya berkas terbuka yang bisa dibuka aplikasi lain.')),
    h('div', { class: 'field' }, h('label', null, 'Koleksi'), col));
  const v = await openDialog({
    title: 'Catatan baru', body, initialFocus: 'input',
    buttons: [{ label: 'Batal', value: null, variant: 'ghost' }, { label: 'Buat catatan', value: 'ok', variant: 'primary' }],
  });
  if (v !== 'ok') return null;
  try {
    const meta = await api.createItem({ type: 'note', title: name.value.trim() || 'Catatan baru', ext, collection: col.value || null, content: '' });
    await refreshLibrary();
    openItem(meta.id);
    return meta;
  } catch (e) { toastError(e, 'Gagal membuat catatan'); return null; }
}

/* ---------------------------------------------------------------- desain baru */
export async function newDesignFlow({ collection = null } = {}) {
  let preset = PRESETS[1];
  const name = h('input', { class: 'input', type: 'text', value: 'Desain baru', maxlength: '120', 'aria-label': 'Nama desain' });
  const wIn = h('input', { class: 'input', type: 'number', min: '16', max: '16000', value: String(preset.w), 'aria-label': 'Lebar (px)' });
  const hIn = h('input', { class: 'input', type: 'number', min: '16', max: '16000', value: String(preset.h), 'aria-label': 'Tinggi (px)' });
  const err = h('div', { class: 'error-text', hidden: true });
  const col = collectionSelect(collection);
  const grid = h('div', { class: 'preset-grid', role: 'radiogroup', 'aria-label': 'Ukuran desain' });
  const cards = [];

  const select = (p) => {
    preset = p;
    if (p) { wIn.value = String(p.w); hIn.value = String(p.h); }
    cards.forEach((c) => c.el.setAttribute('aria-checked', String(c.p === p)));
  };
  const addCard = (p, label, dims) => {
    const max = 40;
    const ratio = p ? p.w / p.h : 1;
    const tw = ratio >= 1 ? max : Math.round(max * ratio);
    const th = ratio >= 1 ? Math.round(max / ratio) : max;
    const el = h('button', { class: 'preset', type: 'button', role: 'radio', 'aria-checked': String(p === preset), onClick: () => select(p) },
      h('span', { class: 'preset-shape' }, h('span', { style: { width: `${Math.max(14, tw)}px`, height: `${Math.max(10, th)}px` } })),
      h('span', { class: 'preset-name' }, label),
      h('span', { class: 'preset-dim' }, dims));
    cards.push({ p, el });
    grid.appendChild(el);
  };
  for (const p of PRESETS) addCard(p, p.name, `${p.w} × ${p.h}`);
  addCard(null, 'Ukuran kustom', 'Atur sendiri');
  const onDims = () => {
    const w = Number(wIn.value); const hh = Number(hIn.value);
    const match = PRESETS.find((p) => p.w === w && p.h === hh) || null;
    preset = match;
    cards.forEach((c) => c.el.setAttribute('aria-checked', String(c.p === match || (!match && c.p === null))));
  };
  wIn.addEventListener('input', onDims); hIn.addEventListener('input', onDims);

  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
    h('div', { class: 'field' }, h('label', null, 'Nama'), name),
    h('div', { class: 'field' }, h('label', null, 'Ukuran'), grid),
    h('div', { class: 'row-2' },
      h('div', { class: 'field' }, h('label', null, 'Lebar (px)'), wIn),
      h('div', { class: 'field' }, h('label', null, 'Tinggi (px)'), hIn),
      h('div', { class: 'field' }, h('label', null, 'Koleksi'), col)),
    err);
  const v = await openDialog({
    title: 'Desain baru', wide: true, body, initialFocus: 'input',
    buttons: [
      { label: 'Batal', value: null, variant: 'ghost' },
      {
        label: 'Buat desain', value: 'ok', variant: 'primary',
        validate: () => {
          const w = Number(wIn.value); const hh = Number(hIn.value);
          const ok = Number.isInteger(w) && Number.isInteger(hh) && w >= 16 && hh >= 16 && w <= 16000 && hh <= 16000;
          err.hidden = ok;
          err.textContent = ok ? '' : 'Ukuran harus bilangan bulat antara 16 dan 16000 px.';
          return ok;
        },
      },
    ],
  });
  if (v !== 'ok') return null;
  try {
    const title = name.value.trim() || 'Desain baru';
    const doc = createDocument({ title, width: Number(wIn.value), height: Number(hIn.value) });
    const meta = await api.createItem({ type: 'design', title, collection: col.value || null, content: serializeDocument(doc) });
    await refreshLibrary();
    openItem(meta.id);
    return meta;
  } catch (e) { toastError(e, 'Gagal membuat desain'); return null; }
}

/* ---------------------------------------------------------------- aksi item */
export async function renameFlow(item) {
  const t = await promptDialog({ title: 'Ganti nama', label: 'Nama baru', value: item.title, confirmLabel: 'Ganti nama' });
  if (!t || t === item.title) return;
  try {
    await api.renameItem(item.id, t);
    await refreshLibrary();
    bus.emit('item:renamed', { id: item.id, title: t });
  } catch (e) { toastError(e, 'Gagal mengganti nama'); }
}

export async function deleteFlow(item) {
  const ok = await confirmDialog({
    title: `Hapus “${item.title}”?`,
    message: 'Berkas dipindahkan ke folder "trash" di dalam folder data, jadi masih bisa dipulihkan secara manual.',
    confirmLabel: 'Hapus', danger: true,
  });
  if (!ok) return false;
  try {
    bus.emit('item:before-delete', { id: item.id });
    await api.deleteItem(item.id);
    await refreshLibrary();
    bus.emit('item:deleted', { id: item.id });
    toast(`“${item.title}” dihapus.`);
    return true;
  } catch (e) { toastError(e, 'Gagal menghapus'); return false; }
}

export async function togglePin(item) {
  try {
    await api.setItemMeta(item.id, { pinned: !item.pinned });
    await refreshLibrary();
  } catch (e) { toastError(e); }
}

export async function moveToCollection(item, collectionId) {
  try {
    await api.setItemMeta(item.id, { collection: collectionId });
    await refreshLibrary();
  } catch (e) { toastError(e); }
}

export async function duplicateFlow(item) {
  try {
    const m = await api.duplicateItem(item.id);
    await refreshLibrary();
    toast(`Dibuat salinan: “${m.title}”.`);
  } catch (e) { toastError(e, 'Gagal menduplikasi'); }
}

export async function exportFlow(item) {
  try {
    const r = item.type === 'note' ? await api.exportNote(item.id) : await api.exportDesignProject(item.id);
    if (r.saved) toast('Berkas diekspor.', { type: 'success' });
  } catch (e) { toastError(e, 'Gagal mengekspor'); }
}

export async function revealFlow(item) {
  try { await api.revealItem(item.id); } catch (e) { toastError(e); }
}

export async function createCollectionFlow() {
  const name = await promptDialog({
    title: 'Koleksi baru', label: 'Nama koleksi', placeholder: 'mis. Kuliah, Klien A, Ide', confirmLabel: 'Buat koleksi',
    validate: (v) => (!v ? 'Nama tidak boleh kosong.' : state.collections.some((c) => c.name.toLowerCase() === v.toLowerCase()) ? 'Koleksi dengan nama itu sudah ada.' : null),
  });
  if (!name) return null;
  try { const c = await api.createCollection(name); await refreshLibrary(); return c; } catch (e) { toastError(e); return null; }
}

export async function renameCollectionFlow(c) {
  const name = await promptDialog({ title: 'Ganti nama koleksi', label: 'Nama koleksi', value: c.name, confirmLabel: 'Simpan' });
  if (!name || name === c.name) return;
  try { await api.renameCollection(c.id, name); await refreshLibrary(); } catch (e) { toastError(e); }
}

export async function deleteCollectionFlow(c) {
  const ok = await confirmDialog({
    title: `Hapus koleksi “${c.name}”?`,
    message: 'Isinya tidak ikut terhapus; semua item akan kembali ke “Tanpa koleksi”.', confirmLabel: 'Hapus koleksi', danger: true,
  });
  if (!ok) return;
  try { await api.deleteCollection(c.id); await refreshLibrary(); } catch (e) { toastError(e); }
}

export async function importNotesFlow(collection = null) {
  try {
    const r = await api.importNotes(collection);
    await refreshLibrary();
    if (r.created.length) toast(`${r.created.length} catatan diimpor.`, { type: 'success', action: r.created.length === 1 ? { label: 'Buka', onClick: () => openItem(r.created[0].id) } : null });
    if (r.skipped.length) toast(`Dilewati: ${r.skipped.join(', ')}`, { type: 'error' });
    return r.created;
  } catch (e) { toastError(e, 'Gagal mengimpor'); return []; }
}

export async function importDesignFlow(collection = null) {
  try {
    const r = await api.importDesignProject(collection);
    await refreshLibrary();
    if (r.created.length) toast('Proyek desain diimpor.', { type: 'success', action: { label: 'Buka', onClick: () => openItem(r.created[0].id) } });
    return r.created;
  } catch (e) { toastError(e, 'Gagal mengimpor proyek'); return []; }
}

export function itemMenu(item, at) {
  const cols = state.collections;
  showMenu([
    { label: 'Buka', icon: item.type === 'note' ? 'note' : 'design', onSelect: () => openItem(item.id) },
    { label: 'Ganti nama…', icon: 'edit', onSelect: () => renameFlow(item) },
    { label: item.pinned ? 'Lepas sematan' : 'Sematkan', icon: 'pin', onSelect: () => togglePin(item) },
    { separator: true },
    { heading: 'Pindahkan ke koleksi' },
    ...cols.map((c) => ({ label: `${item.collection === c.id ? '✓ ' : ''}${c.name}`, icon: 'folder', onSelect: () => moveToCollection(item, c.id) })),
    ...(item.collection ? [{ label: 'Tanpa koleksi', icon: 'x', onSelect: () => moveToCollection(item, null) }] : []),
    { label: 'Koleksi baru…', icon: 'plus', onSelect: async () => { const c = await createCollectionFlow(); if (c) moveToCollection(item, c.id); } },
    { separator: true },
    { label: 'Duplikat', icon: 'copy', onSelect: () => duplicateFlow(item) },
    { label: item.type === 'note' ? 'Ekspor catatan…' : 'Ekspor proyek (.canvaset)…', icon: 'download', onSelect: () => exportFlow(item) },
    { label: 'Buka lokasi file', icon: 'folder', onSelect: () => revealFlow(item) },
    { separator: true },
    { label: 'Hapus…', icon: 'trash', danger: true, onSelect: () => deleteFlow(item) },
  ], at);
}
