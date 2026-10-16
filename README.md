# Canvaset

Ruang kerja kreatif **portabel, offline-first, local-first** untuk Windows 10/11: **Design Studio** (desain grafis terstruktur ala Canva) dan **Writing Studio** (catatan TXT/Markdown) dalam satu aplikasi desktop. Tanpa akun, tanpa backend, tanpa telemetri, tanpa internet.

> Status jujur: aplikasi diuji nyata (unit + E2E di Electron, Linux). ZIP portable Windows dapat dibuat dengan `npm run build:portable`, tetapi **file .exe belum pernah dijalankan di Windows** oleh pengembang (lingkungan build tidak punya Windows/Wine). Lihat `docs/TEST-REPORT.md`.

## Fitur utama
- **Design Studio**: teks, gambar, bentuk (persegi, lingkaran, segitiga, bintang), garis, panah; layer (urut, kunci, sembunyi, ganti nama, seret); multi-select; snap dan pemandu; undo/redo; zoom/pan; rotasi; properti kontekstual; simpan/buka proyek; ekspor PNG/JPEG/SVG.
- **Writing Studio**: catatan `.md`/`.txt`, toolbar Markdown, pratinjau aman, cari di dokumen, outline, statistik kata, simpan otomatis, pemulihan crash, impor/ekspor.
- **Terpadu**: Beranda, Pustaka (grid/daftar, filter, urut), koleksi, pin, terbaru, pencarian global (Ctrl+P: judul, isi catatan, teks dalam desain), pengaturan (tema gelap/terang, aksen, font, interval simpan), buka lokasi file.
- Daftar lengkap selesai/belum: `docs/FITUR.md`.

## Menjalankan dari source
Syarat: Node.js 20+.
```
npm install
npm start
```
Pengujian:
```
npm test            # unit (66 tes)
npm run test:e2e    # E2E Electron nyata (Linux: butuh xvfb)
```

## Build ZIP portable Windows
Di mesin dengan internet (Linux/macOS/Windows dengan perintah `zip`):
```
npm install
npm run build:portable
```
Hasil: `dist/Canvaset-<versi>-win-x64-portable.zip`. Ekstrak di mana saja (flashdisk boleh) dan jalankan `Canvaset.exe`. Data tersimpan di `CanvasetData/` di samping exe; jika folder itu tidak dapat ditulis (mis. `Program Files`), aplikasi memakai `%APPDATA%\Canvaset\CanvasetData`. Variabel `CANVASET_DATA` dapat menimpa lokasi.

### Troubleshooting
- **SmartScreen memperingatkan "aplikasi tidak dikenal"**: exe tidak ditandatangani (code signing). Pilih *More info → Run anyway*.
- **Data tidak tersimpan / "Mode: fallback"** di Pengaturan: folder aplikasi read-only; pindahkan ke folder yang dapat ditulis.
- **Layar kosong saat dibuka di VM**: jalankan dengan `Canvaset.exe --disable-gpu`.
- **Build gagal mengunduh Electron**: pastikan akses ke registry npm dan github.com.
- **Berkas desain rusak**: Canvaset otomatis membuka cadangan terakhir (`CanvasetData/backups`).

## Backup dan pindah komputer
Seluruh data ada di satu folder `CanvasetData/`. Backup = salin folder itu. Pindah komputer = salin folder aplikasi atau hanya `CanvasetData/` ke komputer baru lalu jalankan. Memperbarui aplikasi = ganti file aplikasi, **pertahankan** `CanvasetData/`. Isi folder: `notes/` (.md/.txt, dapat dibuka di aplikasi lain), `designs/` (JSON), `assets/` (gambar), `backups/` (maks 8 per item), `recovery/` (draf), `trash/` (item terhapus), `config/`.

## Keamanan
Electron dengan `contextIsolation`, `sandbox`, `nodeIntegration` mati; protokol `app://` dengan CSP ketat; IPC hanya dari origin aplikasi dengan validasi argumen; tautan eksternal hanya http/https/mailto lewat dialog sistem; tidak ada permintaan jaringan (diuji).

## Dokumentasi
`docs/ARSITEKTUR.md`, `docs/RISET-REFERENSI.md`, `docs/FITUR.md`, `docs/TEST-REPORT.md`.

## Pintasan
Ctrl+1..4 pindah tampilan · Ctrl+P cari · Ctrl+N baru · Ctrl+S simpan · Ctrl+Z/Y undo/redo · Ctrl+C/X/V/D · Ctrl+A · Ctrl+]/[ urutan layer · Ctrl+E ekspor desain · V/H/T/R/O/L/I alat · Spasi geser · Shift+1 pas layar · Panah geser elemen (Shift = 10px).
