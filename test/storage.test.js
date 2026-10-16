'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Storage, sanitizeFileName, validateDesignJson } = require('../main/storage');

function tmpStorage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canvaset-test-'));
  return { dir, s: new Storage(dir).init() };
}
function design(extra = {}) {
  return JSON.stringify({
    format: 'canvaset-design', version: 1, meta: {}, page: { width: 800, height: 600, background: '#ffffff' },
    elements: [{ id: 'e1', type: 'text', text: 'Halo dunia kreatif', x: 0, y: 0, w: 100, h: 20 }], ...extra,
  });
}

test('sanitizeFileName menghapus karakter terlarang dan nama cadangan Windows', () => {
  assert.equal(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j'), 'abcdefghij');
  assert.equal(sanitizeFileName('CON'), '_CON');
  assert.equal(sanitizeFileName('   '), 'Tanpa judul');
  assert.equal(sanitizeFileName('nama...'), 'nama');
  assert.ok(sanitizeFileName('x'.repeat(300)).length <= 80);
});

test('buat, baca, tulis catatan; berkas terbuka (.md) ada di folder notes', () => {
  const { dir, s } = tmpStorage();
  const m = s.create({ type: 'note', title: 'Catatan Rapat', ext: '.md', content: '# Judul' });
  assert.equal(m.file, 'Catatan Rapat.md');
  assert.equal(fs.readFileSync(path.join(dir, 'notes', 'Catatan Rapat.md'), 'utf8'), '# Judul');
  s.write(m.id, '# Judul\nisi baru');
  assert.equal(s.read(m.id).content, '# Judul\nisi baru');
  assert.ok(s.getMeta(m.id).snippet.includes('isi baru'));
});

test('judul kembar mendapat nama berkas unik', () => {
  const { s } = tmpStorage();
  const a = s.create({ type: 'note', title: 'Sama', content: '' });
  const b = s.create({ type: 'note', title: 'Sama', content: '' });
  assert.notEqual(a.file, b.file);
  assert.equal(b.file, 'Sama (2).md');
});

test('rename mengganti nama berkas fisik dan judul', () => {
  const { dir, s } = tmpStorage();
  const m = s.create({ type: 'note', title: 'Lama', content: 'x' });
  const r = s.rename(m.id, 'Baru / Bagus');
  assert.equal(r.title, 'Baru / Bagus');
  assert.ok(fs.existsSync(path.join(dir, 'notes', r.file)));
  assert.ok(!fs.existsSync(path.join(dir, 'notes', 'Lama.md')));
});

test('convertNote mengubah .md <-> .txt', () => {
  const { dir, s } = tmpStorage();
  const m = s.create({ type: 'note', title: 'Uji', ext: '.md', content: 'x' });
  const c = s.convertNote(m.id, '.txt');
  assert.equal(c.ext, '.txt');
  assert.ok(fs.existsSync(path.join(dir, 'notes', 'Uji.txt')));
});

test('ID tidak valid / path traversal ditolak', () => {
  const { s } = tmpStorage();
  assert.throws(() => s.read('../../etc/passwd'), /ID item tidak valid/);
  assert.throws(() => s.write('n_zzzz', 'x'), /ID item tidak valid/);
  assert.throws(() => s.readAsset('../x.png'), /ID aset tidak valid/);
  assert.throws(() => s.readAsset('abcdef0123456789.exe'), /ID aset tidak valid/);
});

test('hapus memindahkan ke trash, bukan menghapus permanen', () => {
  const { dir, s } = tmpStorage();
  const m = s.create({ type: 'note', title: 'Hapus aku', content: 'penting' });
  s.remove(m.id);
  assert.throws(() => s.read(m.id), /tidak ditemukan/);
  const trash = fs.readdirSync(path.join(dir, 'trash'));
  assert.equal(trash.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'trash', trash[0]), 'utf8'), 'penting');
});

test('draf pemulihan: muncul jika lebih baru dari berkas, hilang setelah simpan', async () => {
  const { s } = tmpStorage();
  const m = s.create({ type: 'note', title: 'Draf', content: 'lama' });
  await new Promise((r) => setTimeout(r, 30));
  s.writeDraft(m.id, 'lama + perubahan belum tersimpan');
  assert.equal(s.listDrafts().length, 1);
  assert.equal(s.read(m.id).recovery.content, 'lama + perubahan belum tersimpan');
  s.restoreDraft(m.id);
  assert.equal(s.read(m.id).content, 'lama + perubahan belum tersimpan');
  assert.equal(s.listDrafts().length, 0);
  s.writeDraft(m.id, 'draf lain');
  s.write(m.id, 'simpan normal');
  assert.equal(s.listDrafts().length, 0);
});

test('berkas yang dijatuhkan manual ke folder notes muncul setelah init ulang', () => {
  const { dir, s } = tmpStorage();
  fs.writeFileSync(path.join(dir, 'notes', 'dari-luar.txt'), 'halo');
  s.flush();
  const s2 = new Storage(dir).init();
  const found = s2.list().find((i) => i.file === 'dari-luar.txt');
  assert.ok(found);
  assert.equal(found.ext, '.txt');
});

test('berkas yang hilang dibuang dari indeks dengan peringatan', () => {
  const { dir, s } = tmpStorage();
  const m = s.create({ type: 'note', title: 'Hilang', content: 'x' });
  s.flush();
  fs.unlinkSync(path.join(dir, 'notes', m.file));
  const s2 = new Storage(dir).init();
  assert.equal(s2.list().length, 0);
  assert.ok(s2.warnings.some((w) => w.includes('Hilang.md')));
});

test('indeks rusak dipulihkan dari .bak', () => {
  const { dir, s } = tmpStorage();
  s.create({ type: 'note', title: 'Satu', content: 'a' });
  s.flush();
  s.create({ type: 'note', title: 'Dua', content: 'b' });
  s.flush(); // membuat .bak berisi versi sebelumnya
  fs.writeFileSync(path.join(dir, 'config', 'library.json'), '{rusak');
  const s2 = new Storage(dir).init();
  assert.ok(s2.list().length >= 1);
  assert.ok(s2.warnings.some((w) => w.includes('Indeks pustaka rusak')));
});

test('validateDesignJson menolak berkas yang bukan desain atau rusak', () => {
  assert.throws(() => validateDesignJson('bukan json'), /bukan JSON/);
  assert.throws(() => validateDesignJson('{"format":"lain"}'), /bukan proyek desain/);
  assert.throws(() => validateDesignJson(design({ page: { width: 5, height: 5 } })), /Ukuran halaman/);
  assert.throws(() => validateDesignJson(design({ elements: [{ id: 'x', type: 'virus' }] })), /rusak/);
  assert.doesNotThrow(() => validateDesignJson(design()));
});

test('desain: simpan, baca ulang, dan tulis data tidak valid ditolak tanpa merusak berkas', () => {
  const { s } = tmpStorage();
  const m = s.create({ type: 'design', title: 'Poster', content: design() });
  s.write(m.id, design({ elements: [] }), { thumb: '<svg/>' });
  assert.equal(JSON.parse(s.read(m.id).content).elements.length, 0);
  assert.equal(s.getMeta(m.id).thumb, '<svg/>');
  assert.throws(() => s.write(m.id, '{"format":"x"}'));
  assert.equal(JSON.parse(s.read(m.id).content).elements.length, 0);
});

test('desain rusak dibuka dari cadangan terbaru', () => {
  const { dir, s } = tmpStorage();
  const m = s.create({ type: 'design', title: 'Rusak', content: design() });
  s.write(m.id, design()); // memicu cadangan versi sebelumnya
  fs.writeFileSync(path.join(dir, 'designs', m.file), 'RUSAK');
  const r = s.read(m.id);
  assert.equal(JSON.parse(r.content).format, 'canvaset-design');
  assert.ok(s.warnings.some((w) => w.includes('dibuka dari cadangan')));
});

test('aset: dedupe berdasarkan isi, tolak MIME asing dan berkas kosong', () => {
  const { s } = tmpStorage();
  const png = Buffer.from('iVBORw0KGgo=', 'base64');
  const a = s.addAsset(png, 'image/png');
  const b = s.addAsset(png, 'image/png');
  assert.equal(a.assetId, b.assetId);
  assert.match(a.assetId, /^[a-f0-9]{16}\.png$/);
  assert.deepEqual(s.readAsset(a.assetId).data, png);
  assert.throws(() => s.addAsset(png, 'application/x-msdownload'), /tidak didukung/);
  assert.throws(() => s.addAsset(Buffer.alloc(0), 'image/png'), /kosong/);
});

test('pencarian global menemukan judul, isi catatan, dan teks di dalam desain', () => {
  const { s } = tmpStorage();
  s.create({ type: 'note', title: 'Resep', content: 'campur tepung dan telur' });
  s.create({ type: 'design', title: 'Banner', content: design() });
  assert.equal(s.search('tepung')[0].title, 'Resep');
  assert.equal(s.search('kreatif')[0].title, 'Banner');
  assert.equal(s.search('banner')[0].matchIn, 'title');
  assert.deepEqual(s.search('tidak-ada-apa-apa'), []);
});

test('koleksi: buat, tetapkan, hapus mengembalikan item ke tanpa koleksi', () => {
  const { s } = tmpStorage();
  const c = s.createCollection('Kuliah');
  assert.throws(() => s.createCollection('kuliah'), /sudah ada/);
  const m = s.create({ type: 'note', title: 'N', content: '', collection: c.id });
  assert.equal(m.collection, c.id);
  s.deleteCollection(c.id);
  assert.equal(s.getMeta(m.id).collection, null);
  assert.throws(() => s.setMeta(m.id, { collection: 'c_tidakada' }), /Koleksi tidak ditemukan/);
});

test('pengaturan: nilai tidak valid ditolak, default tetap aman', () => {
  const { s } = tmpStorage();
  assert.equal(s.getSettings().theme, 'dark');
  assert.throws(() => s.setSettings({ theme: 'neon' }), /tidak valid/);
  assert.throws(() => s.setSettings({ hack: 1 }), /tidak dikenal/);
  assert.throws(() => s.setSettings({ accent: 'red' }), /tidak valid/);
  s.setSettings({ theme: 'light', fontSize: 18 });
  assert.equal(s.getSettings().theme, 'light');
  assert.equal(s.getSettings().fontSize, 18);
});

test('duplikasi menghasilkan item baru dengan isi sama', () => {
  const { s } = tmpStorage();
  const m = s.create({ type: 'note', title: 'Asli', content: 'isi' });
  const d = s.duplicate(m.id);
  assert.notEqual(d.id, m.id);
  assert.equal(s.read(d.id).content, 'isi');
  assert.match(d.title, /salinan/);
});

test('batas ukuran catatan ditegakkan', () => {
  const { s } = tmpStorage();
  const m = s.create({ type: 'note', title: 'Besar', content: '' });
  assert.throws(() => s.write(m.id, 'x'.repeat(10 * 1024 * 1024 + 1)), /10 MB/);
});
