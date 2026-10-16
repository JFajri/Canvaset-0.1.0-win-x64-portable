'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const F = () => import('../renderer/js/writing/format.js');

function run(fn, text, s, e, ...args) {
  const edit = fn(text, s, e, ...args);
  const out = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  return { out, sel: out.slice(edit.selStart, edit.selEnd), edit };
}

test('toggleWrap: bungkus, buka bungkus, dan placeholder', async () => {
  const { toggleWrap } = await F();
  assert.equal(run(toggleWrap, 'halo dunia', 5, 10, '**').out, 'halo **dunia**');
  assert.equal(run(toggleWrap, 'halo dunia', 5, 10, '**').sel, 'dunia');
  // tombol sama dua kali = kembali ke awal
  const t1 = run(toggleWrap, 'halo dunia', 5, 10, '**');
  const t2 = run(toggleWrap, t1.out, t1.edit.selStart, t1.edit.selEnd, '**');
  assert.equal(t2.out, 'halo dunia');
  assert.equal(t2.sel, 'dunia');
  // tanpa seleksi → placeholder terpilih
  const p = run(toggleWrap, 'x ', 2, 2, '*');
  assert.equal(p.out, 'x *teks*');
  assert.equal(p.sel, 'teks');
  // seleksi sudah memuat penanda
  assert.equal(run(toggleWrap, '**tebal**', 0, 9, '**').out, 'tebal');
});

test('toggleWrap: miring di dalam tebal tidak merusak tanda tebal', async () => {
  const { toggleWrap } = await F();
  const r = run(toggleWrap, '**a**', 2, 3, '*');
  assert.equal(r.out, '***a***');
});

test('toggleLinePrefix: heading, daftar, kutipan, dan toggling', async () => {
  const { toggleLinePrefix } = await F();
  assert.equal(run(toggleLinePrefix, 'Judul', 0, 0, 'h2').out, '## Judul');
  assert.equal(run(toggleLinePrefix, '## Judul', 3, 3, 'h2').out, 'Judul');
  assert.equal(run(toggleLinePrefix, '# Judul', 0, 0, 'h3').out, '### Judul');
  assert.equal(run(toggleLinePrefix, 'a\nb\nc', 0, 5, 'ul').out, '- a\n- b\n- c');
  assert.equal(run(toggleLinePrefix, '- a\n- b', 0, 7, 'ul').out, 'a\nb');
  assert.equal(run(toggleLinePrefix, 'a\nb', 0, 3, 'ol').out, '1. a\n2. b');
  assert.equal(run(toggleLinePrefix, '- a', 0, 3, 'ol').out, '1. a');
  assert.equal(run(toggleLinePrefix, 'a', 0, 1, 'quote').out, '> a');
  assert.equal(run(toggleLinePrefix, 'a', 0, 1, 'task').out, '- [ ] a');
  assert.equal(run(toggleLinePrefix, '- [x] a', 0, 7, 'task').out, 'a');
});

test('toggleLinePrefix: hanya baris yang tersentuh seleksi; baris kosong dilewati', async () => {
  const { toggleLinePrefix } = await F();
  assert.equal(run(toggleLinePrefix, 'satu\ndua\ntiga', 5, 8, 'ul').out, 'satu\n- dua\ntiga');
  assert.equal(run(toggleLinePrefix, 'a\n\nb', 0, 4, 'ul').out, '- a\n\n- b');
  // seleksi berakhir tepat di awal baris berikutnya tidak ikut mengubah baris itu
  assert.equal(run(toggleLinePrefix, 'a\nb', 0, 2, 'ul').out, '- a\nb');
});

test('toggleLinePrefix: posisi kursor tetap wajar', async () => {
  const { toggleLinePrefix } = await F();
  const r = toggleLinePrefix('Judul', 5, 5, 'h1');
  assert.equal(r.selStart, 7);
  assert.equal(r.selEnd, 7);
});

test('insertLink dan codeBlock', async () => {
  const { insertLink, codeBlock } = await F();
  assert.equal(run(insertLink, 'situs saya', 0, 5, 'https://a.id').out, '[situs](https://a.id) saya');
  const empty = run(insertLink, '', 0, 0, 'https://a.id');
  assert.equal(empty.out, '[teks tautan](https://a.id)');
  assert.equal(empty.sel, 'teks tautan');
  assert.equal(run(codeBlock, 'x = 1', 0, 5).out, '```\nx = 1\n```');
  assert.equal(run(codeBlock, 'awal akhir', 5, 5).out, 'awal \n```\n\n```akhir');
});

test('continueList: lanjut item, nomor bertambah, tugas baru kosong, item kosong mengakhiri daftar', async () => {
  const { continueList, applyEdit } = await F();
  let t = '- satu';
  assert.equal(applyEdit(t, continueList(t, t.length)), '- satu\n- ');
  t = '9. sembilan';
  assert.equal(applyEdit(t, continueList(t, t.length)), '9. sembilan\n10. ');
  t = '  - [x] selesai';
  assert.equal(applyEdit(t, continueList(t, t.length)), '  - [x] selesai\n  - [ ] ');
  t = 'paragraf\n- ';
  const e = continueList(t, t.length);
  assert.equal(applyEdit(t, e), 'paragraf\n');
  assert.equal(e.selStart, 9);
  assert.equal(continueList('teks biasa', 10), null);
  assert.equal(continueList('- tengah baris', 4), null); // kursor bukan di akhir baris
});

test('indentLines: indent dan outdent beberapa baris', async () => {
  const { indentLines } = await F();
  assert.equal(run(indentLines, '- a\n- b', 0, 7, false).out, '  - a\n  - b');
  assert.equal(run(indentLines, '  - a\n  - b', 0, 11, true).out, '- a\n- b');
  assert.equal(run(indentLines, '- a', 0, 0, true).out, '- a'); // tidak ada yang dihapus
});
