# Arsitektur Canvaset

## Proses
- **Main** (`main/`): jendela, protokol `app://canvaset/`, IPC, penyimpanan. `storage.js` tidak bergantung pada Electron sehingga dapat diuji unit.
- **Preload** (`preload/preload.js`): mengekspos `window.canvaset` berisi fungsi bernama saja (bukan `ipcRenderer`).
- **Renderer** (`renderer/`): ES modules murni, tanpa framework dan tanpa bundler; DOM dibangun dengan helper `h()` (tanpa `innerHTML` untuk data pengguna).

## Keamanan
`sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`; CSP ketat; navigasi dan window.open dibatasi; permission handler menolak semua; IPC memverifikasi `senderFrame.url` berawalan origin app dan memvalidasi argumen; path divalidasi (ID aset berformat hash, nama file disanitasi untuk Windows); single-instance lock.

## Data (folder `CanvasetData/`)
`notes/` `designs/` `assets/` `backups/` `recovery/` `trash/` `config/`. Penulisan atomik (tmp + fsync + rename). Indeks `config/library.json` punya `.bak` dan dapat dibangun ulang dari isi folder. Backup per item (maks 8, interval 5 menit). Hapus = pindah ke `trash/`. Batas: catatan 10 MB, desain 50 MB, aset 25 MB, 5000 elemen.

## Format proyek desain
JSON `{format:'canvaset-design', version:1, meta, page{width,height,background}, elements[]}`. Elemen: `text, image, rect, ellipse, triangle, star, line, arrow`. Gambar direferensikan lewat `assetId` (hash sha1 16 hex + ekstensi) dan disimpan terpisah di `assets/`. Parsing menormalisasi ketat; versi lebih baru ditolak dengan pesan jelas. Ekspor proyek (`.canvaset`) menanam aset base64 agar bisa dipindah.

## Design Studio
- `model.js` (skema), `session.js` (seleksi, riwayat snapshot, operasi), `history.js`, `geometry.js`, `transform.js` (resize/rotasi/snap/hit-test, murni dan teruji).
- `render.js`: renderer SVG tunggal untuk layar, ekspor SVG, dan thumbnail. `text.js` membungkus teks via canvas `measureText` sehingga layar = ekspor.
- `export.js`: PNG/JPEG lewat Canvas 2D; SVG dengan font woff2 tertanam; batas 16384 px/sisi dan 64 MP.
- `canvas.js`: seluruh interaksi pointer. `panels.js`: layer dan properti. `view.js`: perangkaian, simpan otomatis, ekspor, pintasan.

## Writing Studio
Editor `textarea` (undo native tetap berfungsi; format diterapkan lewat `execCommand('insertText')`), parser Markdown sendiri yang meng-escape semua HTML, tautan hanya http/https/mailto, gambar eksternal tidak dimuat.

## Simpan otomatis (`shared/saver.js`)
Simpan berurutan tanpa tumpang tindih; draf pemulihan cepat (~300 ms) terpisah dari simpan utama; retry saat gagal; `flush()` saat pindah tampilan dan saat menutup jendela (timeout 4 dtk). Setelah crash, dialog pemulihan muncul saat start.

## Design system
Semua warna/ukuran/gerak di `renderer/styles/tokens.css` (gelap/terang, aksen dapat diatur). Font lokal (Inter, JetBrains Mono, Lora, Space Grotesk) dari `@fontsource`, tanpa CDN. Ikon garis tunggal (`ui/icons.js`), tanpa emoji.
