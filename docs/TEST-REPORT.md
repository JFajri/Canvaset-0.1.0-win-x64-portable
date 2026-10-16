# Laporan pengujian (hasil nyata, 16 Okt 2026)

Lingkungan: Linux, Node 22, Electron 44.7.2 di bawah Xvfb, resolusi jendela 1366×768. **Windows tidak tersedia** — tidak ada pengujian pada Windows.

## Unit — `npm test`: 66 lulus, 0 gagal
storage (20), design model/sesi (13), markdown (10), saver (6), format (8), transform (9).

## E2E Electron nyata — `npm run test:e2e`: 7 lulus, 0 gagal
- Writing: alur lengkap (buat, ketik, format, simpan otomatis ke disk, undo/redo, pratinjau, cari, ganti nama, ubah format, pin); impor/ekspor TXT/MD lewat dialog; pemulihan setelah proses dimatikan paksa (SIGKILL).
- Design: edit (persegi, teks, gambar, hex warna, geser keyboard, undo/redo, rotasi, urutan layer, sembunyi, multi-select, hapus), simpan lalu buka ulang dari Pustaka dan verifikasi isi berkas; ekspor PNG (dimensi dan piksel diverifikasi), PNG 2×, JPEG, SVG (font tertanam, tanpa skrip/referensi luar), penolakan ukuran ekspor melebihi batas; pemulihan desain setelah SIGKILL.
- Integrasi: Beranda, pencarian global (isi catatan dan teks dalam desain), pin, koleksi, tema terang tersimpan antar sesi, **tidak ada permintaan jaringan keluar**, tanpa galat konsol, tanpa luapan horizontal/vertikal di 1366×768 pada semua tampilan.

## Bug yang ditemukan dan diperbaiki lewat pengujian
Enter di pencarian global bisa membuka item salah jika ditekan sebelum hasil pencarian selesai (kini menunggu pencarian). Beberapa bug lain tercatat di riwayat pengembangan (Saver, Beranda kosong).

## Build
`npm run build:portable` menghasilkan ZIP 150 MB dengan `Canvaset.exe` + `resources/app` + `CanvasetData/`. Terverifikasi: isi ZIP; layout `resources/app` berjalan mandiri (tanpa node_modules) di Electron Linux. **Belum terverifikasi:** `Canvaset.exe` di Windows 10/11.

## Belum diuji
Windows nyata, DPI tinggi/multi-monitor, aksesibilitas pembaca layar, dokumen dengan ribuan elemen (hanya batas yang diuji unit), font non-Latin.
