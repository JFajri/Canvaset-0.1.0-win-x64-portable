import { h, clear } from '../shared/util.js';
import { state, updateSettings, api } from '../shared/library.js';
import { toastError, toast } from './toast.js';
import { icon } from './icons.js';

const ACCENTS = ['#7c83ff', '#ff6b4a', '#2dd4a7', '#f5b83d', '#ff5fa2', '#4aa8ff'];

export class SettingsView {
  constructor(root) {
    this.root = root;
    this.panel = h('div', { class: 'panel fill settings' });
    root.append(this.panel);
  }

  async set(patch) {
    try { await updateSettings(patch); this.render(); } catch (e) { toastError(e, 'Gagal menyimpan pengaturan'); this.render(); }
  }

  row(title, desc, control) {
    return h('div', { class: 'set-row' }, h('div', { class: 'd' }, h('b', null, title), desc ? h('span', null, desc) : null), control);
  }

  seg(options, value, onPick, label) {
    return h('div', { class: 'seg', role: 'group', 'aria-label': label }, options.map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(value === v), onClick: () => onPick(v) }, l)));
  }

  select(options, value, onPick, label) {
    const s = h('select', { class: 'select', 'aria-label': label, onChange: (e) => onPick(e.target.value) }, options.map(([v, l]) => h('option', { value: v }, l)));
    s.value = String(value);
    return s;
  }

  render() {
    const s = state.settings;
    const info = state.info || {};
    const custom = !ACCENTS.includes(s.accent);
    clear(this.panel);
    this.panel.append(h('div', { class: 'settings-inner' },
      h('h1', null, 'Pengaturan'),

      h('section', { class: 'set-group' }, h('div', { class: 'sec-title' }, 'Tampilan'),
        this.row('Tema', 'Terang atau gelap', this.seg([['dark', 'Gelap'], ['light', 'Terang']], s.theme, (v) => this.set({ theme: v }), 'Tema')),
        this.row('Warna aksen', 'Dipakai untuk tombol utama dan penanda pilihan', h('div', { class: 'swatches' },
          ACCENTS.map((c) => h('button', { class: 'swatch', type: 'button', style: { background: c }, 'aria-label': `Aksen ${c}`, 'aria-pressed': String(s.accent === c), onClick: () => this.set({ accent: c }) })),
          h('input', { type: 'color', value: s.accent, 'aria-label': 'Warna aksen kustom', title: custom ? 'Warna kustom' : 'Pilih warna lain', onChange: (e) => this.set({ accent: e.target.value }) })))),

      h('section', { class: 'set-group' }, h('div', { class: 'sec-title' }, 'Menulis'),
        this.row('Font editor', 'Berlaku di Writing Studio', this.select([['sans', 'Inter (sans-serif)'], ['serif', 'Lora (serif)'], ['mono', 'JetBrains Mono']], s.editorFont, (v) => this.set({ editorFont: v }), 'Font editor')),
        this.row('Ukuran font', `${s.fontSize}px`, h('input', { type: 'range', min: '12', max: '28', step: '1', value: String(s.fontSize), style: { width: '190px' }, 'aria-label': 'Ukuran font', onChange: (e) => this.set({ fontSize: Number(e.target.value) }) })),
        this.row('Lebar area baca', `${s.readWidth}px`, h('input', { type: 'range', min: '480', max: '1200', step: '20', value: String(s.readWidth), style: { width: '190px' }, 'aria-label': 'Lebar area baca', onChange: (e) => this.set({ readWidth: Number(e.target.value) }) })),
        this.row('Format catatan baru', 'Bawaan saat membuat catatan', this.seg([['.md', 'Markdown'], ['.txt', 'Teks biasa']], s.defaultNoteExt, (v) => this.set({ defaultNoteExt: v }), 'Format catatan')),
        this.row('Jeda simpan otomatis', 'Waktu tunggu setelah berhenti mengetik', this.select([[600, '0,6 detik'], [1200, '1,2 detik (disarankan)'], [3000, '3 detik'], [8000, '8 detik']], s.autosaveMs, (v) => this.set({ autosaveMs: Number(v) }), 'Jeda simpan otomatis')),
        h('div', { style: { paddingTop: '14px' } }, h('div', { class: 'label', style: { marginBottom: '6px' } }, 'Pratinjau'),
          h('div', { class: 'preview-type selectable' }, 'Kreativitas tumbuh dari kebiasaan kecil: menulis sedikit setiap hari, merapikan ide, lalu mengubahnya menjadi desain. Ini contoh paragraf dengan font dan ukuran pilihan Anda.'))),

      h('section', { class: 'set-group' }, h('div', { class: 'sec-title' }, 'Data dan penyimpanan'),
        this.row('Mode penyimpanan', info.mode === 'portable' ? 'Portable: semua data berada di folder di samping aplikasi.' : info.mode === 'custom' ? 'Folder data kustom (CANVASET_DATA).' : 'Folder aplikasi tidak dapat ditulis, jadi data disimpan di folder pengguna.',
          h('span', { class: 'kbd' }, info.mode === 'portable' ? 'PORTABLE' : info.mode === 'custom' ? 'KUSTOM' : 'FALLBACK')),
        h('div', { style: { padding: '12px 0' } }, h('div', { class: 'label', style: { marginBottom: '6px' } }, 'Lokasi data'), h('div', { class: 'path-box' }, info.dataDir || '—')),
        h('div', { style: { display: 'flex', gap: '8px', paddingBottom: '8px', flexWrap: 'wrap' } },
          h('button', { class: 'btn', type: 'button', onClick: () => api.openDataDir().catch((e) => toastError(e)) }, icon('folder', 16), 'Buka folder data'),
          h('button', { class: 'btn', type: 'button', onClick: () => { navigator.clipboard && navigator.clipboard.writeText(info.dataDir || '').then(() => toast('Lokasi disalin.', { type: 'success' })).catch(() => {}); } }, icon('copy', 16), 'Salin lokasi')),
        h('p', { class: 'hint' }, 'Untuk backup atau pindah komputer, salin seluruh folder CanvasetData. Catatan berupa berkas .md/.txt biasa di dalam folder "notes".')),

      h('section', { class: 'set-group' }, h('div', { class: 'sec-title' }, 'Tentang'),
        this.row('Canvaset', `Versi ${info.version || '—'} · tanpa akun, tanpa telemetri, semua data tetap di komputer Anda`, null),
        this.row('Pintasan', 'Ctrl+P cari cepat · Ctrl+N baru · Ctrl+1/2/3 ganti ruang kerja · Ctrl+, pengaturan', null))));
  }
}
