# Fitur: selesai dan belum

## Selesai (teruji, lihat TEST-REPORT)
- Mode portable + fallback AppData, penyimpanan atomik, indeks dengan pemulihan, backup, trash, draf pemulihan crash.
- Writing Studio: buat/ubah nama/hapus/duplikat, `.md`↔`.txt`, toolbar Markdown, pratinjau, cari di dokumen, outline, statistik, simpan otomatis, impor/ekspor TXT/MD.
- Design Studio: semua elemen di atas, layer (urut/kunci/sembunyi/nama/seret), multi-select (marquee, Ctrl+klik, Ctrl+A), snap + pemandu, undo/redo (batas 100 langkah), zoom 5–800% dan pan, rotasi, align, salin/tempel/duplikat, tempel/seret gambar, simpan/buka, ekspor PNG/JPEG/SVG, ekspor/impor proyek `.canvaset`.
- Beranda, Pustaka, koleksi, pin, terbaru, pencarian global, pengaturan, tema gelap/terang.

## Keterbatasan yang diketahui
- **ZIP Windows dibuat tetapi `.exe` belum diuji di Windows.** Tidak ditandatangani (SmartScreen akan memperingatkan).
- "Rich text" di Writing Studio = Markdown + pratinjau (bukan editor WYSIWYG).
- Multi-select: dapat digeser, disejajarkan, dihapus, diatur properti bersama, tetapi **belum bisa di-resize/rotasi sebagai grup**.
- Belum ada: grup elemen, gradien/bayangan, kurva/pen tool, banyak halaman per proyek, font impor pengguna, ekspor PDF, sinkronisasi/kolaborasi (sengaja tidak ada), pemeriksa ejaan kustom, pembaruan otomatis.
- Teks desain hanya satu gaya per kotak teks.
- Tampilan sengaja dasar; dapat disetel ulang lewat `tokens.css` sesuai arahan pengguna.
