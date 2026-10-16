import { $, h } from './shared/util.js';
import { bus } from './shared/bus.js';
import { api, state, refreshLibrary, applySettings, getItem } from './shared/library.js';
import { icon, brandMark } from './ui/icons.js';
import { toast, toastError } from './ui/toast.js';
import { openDialog, confirmDialog } from './ui/dialog.js';
import { closeMenu } from './ui/menu.js';
import { openPalette } from './ui/palette.js';
import { newDesignFlow, newNoteFlow } from './ui/actions.js';
import { HomeView } from './ui/home-view.js';
import { LibraryView } from './ui/library-view.js';
import { SettingsView } from './ui/settings-view.js';
import { WritingView } from './writing/view.js';
import { DesignView } from './design/view.js';

const VIEWS = [
  { id: 'home', label: 'Beranda', icon: 'home', key: '1' },
  { id: 'design', label: 'Design Studio', icon: 'design', key: '2' },
  { id: 'writing', label: 'Writing Studio', icon: 'note', key: '3' },
  { id: 'library', label: 'Pustaka', icon: 'folder', key: '4' },
];

const views = {};
let current = null; // belum ada tampilan aktif sampai go() pertama

function buildShell() {
  const rail = $('#rail');
  const brand = h('div', { class: 'rail-brand', title: 'Canvaset' }, brandMark(32));
  rail.append(brand);
  const mk = (v, tip) => h('button', { class: 'rail-btn', type: 'button', dataset: { view: v.id, tip: tip || v.label }, 'aria-label': v.label, onClick: () => go(v.id) }, icon(v.icon, 21));
  for (const v of VIEWS) rail.append(mk(v, `${v.label}  (Ctrl+${v.key})`));
  rail.append(h('div', { class: 'grow' }));
  rail.append(h('button', { class: 'rail-btn', type: 'button', dataset: { tip: 'Cari cepat  (Ctrl+P)' }, 'aria-label': 'Cari cepat', onClick: () => openPalette() }, icon('search', 21)));
  rail.append(h('button', { class: 'rail-btn', id: 'theme-btn', type: 'button', dataset: { tip: 'Ganti tema' }, 'aria-label': 'Ganti tema', onClick: toggleTheme }, icon('sun', 21)));
  rail.append(h('button', { class: 'rail-btn', type: 'button', dataset: { view: 'settings', tip: 'Pengaturan  (Ctrl+,)' }, 'aria-label': 'Pengaturan', onClick: () => go('settings') }, icon('settings', 21)));

  const container = $('#views');
  for (const id of ['home', 'design', 'writing', 'library', 'settings']) {
    const el = h('section', { class: 'view', id: `view-${id}`, 'aria-label': id });
    container.append(el);
    views[id] = { el };
  }
  views.home.inst = new HomeView(views.home.el);
  views.library.inst = new LibraryView(views.library.el);
  views.settings.inst = new SettingsView(views.settings.el);
  views.writing.inst = new WritingView(views.writing.el);
  views.design.inst = new DesignView(views.design.el);
  syncThemeBtn();
}

function syncThemeBtn() {
  const b = $('#theme-btn');
  if (!b) return;
  b.replaceChildren(icon(state.settings.theme === 'dark' ? 'sun' : 'moon', 21));
  b.dataset.tip = state.settings.theme === 'dark' ? 'Beralih ke tema terang' : 'Beralih ke tema gelap';
}

async function toggleTheme() {
  try {
    const { updateSettings } = await import('./shared/library.js');
    await updateSettings({ theme: state.settings.theme === 'dark' ? 'light' : 'dark' });
  } catch (e) { toastError(e); }
}

/** Pindah tampilan. Menyimpan perubahan studio yang sedang aktif lebih dulu. */
async function go(view, opts = {}) {
  closeMenu();
  if (view === current && !opts.id && !opts.collection) { return; }
  const leaving = views[current] && views[current].inst;
  if (leaving && leaving.flush && view !== current) {
    const ok = await leaving.flush();
    if (ok === false) toast('Beberapa perubahan belum tersimpan. Draf pemulihan sudah dibuat.', { type: 'error' });
  }
  current = view;
  for (const [id, v] of Object.entries(views)) v.el.classList.toggle('active', id === view);
  for (const b of document.querySelectorAll('.rail-btn[data-view]')) {
    const on = b.dataset.view === view;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  const inst = views[view].inst;
  if (view === 'library' && opts.collection) inst.setCollection(opts.collection);
  if (view === 'writing' && opts.id) await inst.open(opts.id);
  if (view === 'design' && opts.id) await inst.open(opts.id);
  if (inst && inst.onShow) inst.onShow();
}

bus.on('navigate', (d) => go(d.view, d));
bus.on('palette:open', () => openPalette());
bus.on('settings:changed', syncThemeBtn);

/* ---------------------------------------------------------------- pintasan global */
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return;
  const k = e.key.toLowerCase();
  const dialogOpen = !!$('#dialog-root').firstChild;
  if (dialogOpen) return;
  if (k === 'p' && !e.shiftKey) { e.preventDefault(); openPalette(); return; }
  if (k === 'f' && e.shiftKey) { e.preventDefault(); openPalette(); return; }
  if (k === ',') { e.preventDefault(); go('settings'); return; }
  const v = VIEWS.find((x) => x.key === e.key);
  if (v && !e.shiftKey) { e.preventDefault(); go(v.id); return; }
  if (k === 'n' && !e.shiftKey) {
    e.preventDefault();
    if (current === 'design') newDesignFlow(); else newNoteFlow();
    return;
  }
  const inst = views[current] && views[current].inst;
  if (inst && inst.handleShortcut && inst.handleShortcut(e)) return;
}, false);

// Cegah jendela menavigasi ke berkas yang di-drop di luar area yang diizinkan.
for (const t of ['dragover', 'drop']) window.addEventListener(t, (e) => { if (!e.defaultPrevented) e.preventDefault(); });

window.addEventListener('error', (e) => { console.error(e.error || e.message); });
window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); toastError(e.reason instanceof Error ? e.reason : new Error(String(e.reason)), 'Terjadi kesalahan'); });

const WELCOME = `# Selamat datang di Canvaset

Canvaset adalah ruang kerja kreatif yang berjalan sepenuhnya di komputer Anda: **tanpa akun, tanpa internet, tanpa telemetri**.

## Dua ruang kerja

- **Design Studio** untuk poster, presentasi, dan konten media sosial.
- **Writing Studio** untuk catatan dan tulisan, dalam Markdown atau teks biasa.

## Mencoba menulis

Pilih teks lalu tekan **Ctrl+B** untuk menebalkan, atau *Ctrl+I* untuk memiringkan. Di bawah ini daftar tugas yang bisa Anda ubah:

- [x] Membuka Canvaset
- [ ] Membuat desain pertama
- [ ] Menyematkan catatan favorit

## Tentang data Anda

Catatan ini adalah berkas \`.md\` biasa di folder data aplikasi, sehingga bisa dibuka juga dengan aplikasi lain. Tekan **Ctrl+P** kapan saja untuk mencari seluruh desain dan catatan.
`;

async function recoverAtStartup() {
  let drafts = [];
  try { drafts = await api.listDrafts(); } catch (_) { return; }
  if (!drafts.length) return;
  const ok = await openDialog({
    title: 'Pemulihan setelah penutupan tidak normal',
    description: `Ditemukan ${drafts.length} dokumen dengan perubahan yang belum sempat tersimpan:`,
    body: h('ul', { class: 'selectable', style: { margin: 0, paddingLeft: '18px', color: 'var(--text-2)' } }, drafts.map((d) => h('li', null, `${d.title} (${d.type === 'design' ? 'desain' : 'catatan'})`))),
    buttons: [
      { label: 'Nanti saja', value: 'later', variant: 'ghost' },
      { label: 'Pulihkan semua', value: 'all', variant: 'primary' },
    ],
  });
  if (ok === 'all') {
    let n = 0;
    for (const d of drafts) { try { await api.restoreDraft(d.id); n++; } catch (e) { toastError(e, `Gagal memulihkan “${d.title}”`); } }
    await refreshLibrary();
    if (n) toast(`${n} dokumen dipulihkan.`, { type: 'success' });
  } else {
    toast('Draf tetap tersimpan; akan ditawarkan lagi saat dokumennya dibuka.');
  }
}

async function boot() {
  try {
    state.info = await api.appInfo();
    applySettings(await api.getSettings());
    await refreshLibrary();
    if (!state.settings.firstRunDone && state.items.length === 0) {
      try {
        await api.createItem({ type: 'note', title: 'Selamat datang', ext: '.md', content: WELCOME });
        await refreshLibrary();
      } catch (_) { /* tidak fatal */ }
    }
    if (!state.settings.firstRunDone) await api.setSettings({ firstRunDone: true }).then((s) => applySettings(s)).catch(() => {});
    buildShell();
    $('#boot').hidden = true;
    $('#app').hidden = false;
    await go('home');
    for (const w of state.info.warnings || []) toast(w, { type: 'error', timeout: 9000 });
    api.onFlushRequest(async () => {
      await Promise.all([views.writing.inst.flush(), views.design.inst.flush()]);
    });
    recoverAtStartup();
  } catch (e) {
    console.error(e);
    $('#boot').textContent = `Canvaset gagal dimulai: ${e.message}`;
  }
}

boot();
export { go, getItem };
