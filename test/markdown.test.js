'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const md = () => import('../renderer/js/writing/markdown.js');

test('heading, paragraf, tebal, miring, coret, kode inline', async () => {
  const { renderMarkdown } = await md();
  const h = renderMarkdown('# Judul\n\nIni **tebal**, *miring*, ~~coret~~ dan `kode`.');
  assert.match(h, /<h1 data-line="0">Judul<\/h1>/);
  assert.match(h, /<strong>tebal<\/strong>/);
  assert.match(h, /<em>miring<\/em>/);
  assert.match(h, /<del>coret<\/del>/);
  assert.match(h, /<code>kode<\/code>/);
});

test('HTML mentah di-escape (anti XSS)', async () => {
  const { renderMarkdown } = await md();
  const h = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
  assert.ok(!/<script/i.test(h));
  assert.ok(!/<img/i.test(h));
  assert.match(h, /&lt;script&gt;/);
});

test('tautan: hanya http/https/mailto/# yang menjadi <a>; javascript: dibuang', async () => {
  const { renderMarkdown } = await md();
  assert.match(renderMarkdown('[situs](https://contoh.id/a?x=1&y=2)'), /<a href="https:\/\/contoh\.id\/a\?x=1&amp;y=2" data-link="1">situs<\/a>/);
  assert.ok(!/<a /.test(renderMarkdown('[klik](javascript:alert(1))')));
  assert.ok(!/<a /.test(renderMarkdown('[klik](data:text/html;base64,AAAA)')));
  assert.match(renderMarkdown('[surel](mailto:a@b.co)'), /<a href="mailto:a@b\.co"/);
  // upaya keluar dari atribut href
  const evil = renderMarkdown('[x](https://a.b"onmouseover="alert(1))');
  assert.ok(!/onmouseover="/.test(evil));
  // label berisi HTML
  const lab = renderMarkdown('[<img src=x onerror=alert(1)>](https://a.b)');
  assert.ok(!/<img/.test(lab));
});

test('tautan telanjang otomatis dan gambar eksternal tidak dimuat', async () => {
  const { renderMarkdown } = await md();
  assert.match(renderMarkdown('Kunjungi https://contoh.id/halaman.'), /<a href="https:\/\/contoh\.id\/halaman" data-link="1">/);
  const img = renderMarkdown('![logo](https://tracker.example/pixel.png)');
  assert.ok(!/<img/.test(img));
  assert.match(img, /\[gambar: logo\]/);
});

test('daftar bertingkat, berurutan, dan daftar tugas', async () => {
  const { renderMarkdown } = await md();
  const h = renderMarkdown('- satu\n  - bersarang\n- dua\n\n1. a\n2. b\n\n- [x] selesai\n- [ ] belum');
  assert.match(h, /<ul[^>]*><li>satu<ul[^>]*><li>bersarang<\/li><\/ul><\/li><li>dua<\/li><\/ul>/);
  assert.match(h, /<ol[^>]*><li>a<\/li><li>b<\/li><\/ol>/);
  assert.match(h, /<li class="task"><input type="checkbox" disabled checked> selesai<\/li>/);
  assert.match(h, /<li class="task"><input type="checkbox" disabled> belum<\/li>/);
});

test('blok kode menjaga isi apa adanya dan tidak memproses markdown di dalamnya', async () => {
  const { renderMarkdown } = await md();
  const h = renderMarkdown('```js\nconst a = "**bukan tebal**" < 3;\n```');
  assert.match(h, /<pre[^>]*><code>const a = &quot;\*\*bukan tebal\*\*&quot; &lt; 3;<\/code><\/pre>/);
  assert.ok(!/<strong>/.test(h));
});

test('kutipan, garis pemisah, dan tabel', async () => {
  const { renderMarkdown } = await md();
  const h = renderMarkdown('> kutipan **penting**\n\n---\n\n| A | B |\n|:--|--:|\n| 1 | 2 |');
  assert.match(h, /<blockquote[^>]*><p[^>]*>kutipan <strong>penting<\/strong><\/p><\/blockquote>/);
  assert.match(h, /<hr>/);
  assert.match(h, /<th style="text-align:left">A<\/th><th style="text-align:right">B<\/th>/);
  assert.match(h, /<td style="text-align:right">2<\/td>/);
});

test('baris baru dalam paragraf dipertahankan (cocok untuk catatan)', async () => {
  const { renderMarkdown } = await md();
  assert.match(renderMarkdown('baris satu\nbaris dua'), /baris satu<br>baris dua/);
});

test('extractHeadings memberi posisi dan melewati isi blok kode', async () => {
  const { extractHeadings } = await md();
  const src = '# A\ntext\n```\n# bukan heading\n```\n## B **tebal**\n';
  const hs = extractHeadings(src);
  assert.deepEqual(hs.map((x) => [x.level, x.text, x.line]), [[1, 'A', 0], [2, 'B tebal', 5]]);
  assert.equal(src.slice(hs[1].offset, hs[1].offset + 2), '##');
});

test('masukan sangat besar/aneh tidak membuat parser hang atau error', async () => {
  const { renderMarkdown } = await md();
  const t0 = Date.now();
  renderMarkdown('*'.repeat(20000));
  renderMarkdown(('- a\n' + '  '.repeat(50) + '- b\n').repeat(500));
  renderMarkdown('[' .repeat(5000) + ']('.repeat(5000));
  assert.ok(Date.now() - t0 < 4000);
});
