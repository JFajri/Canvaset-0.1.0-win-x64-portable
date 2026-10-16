'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const T = () => import('../renderer/js/design/transform.js');
const W = () => import('../renderer/js/design/text-wrap.js');
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('resizeBox tanpa rotasi: handle kanan-bawah, kiri-atas, dan sisi', async () => {
  const { resizeBox } = await T();
  const box = { x: 100, y: 100, w: 200, h: 100 };
  let r = resizeBox(box, 0, 'se', { x: 400, y: 300 });
  assert.deepEqual([r.x, r.y, r.w, r.h], [100, 100, 300, 200]);
  r = resizeBox(box, 0, 'nw', { x: 50, y: 50 });
  assert.deepEqual([r.x, r.y, r.w, r.h], [50, 50, 250, 150]);
  r = resizeBox(box, 0, 'e', { x: 350, y: 999 });
  assert.deepEqual([r.x, r.y, r.w, r.h], [100, 100, 250, 100]); // y diabaikan
  r = resizeBox(box, 0, 'n', { x: 0, y: 60 });
  assert.deepEqual([r.x, r.y, r.w, r.h], [100, 60, 200, 140]);
});

test('resizeBox: ukuran minimum dan tidak terbalik saat diseret melewati sisi seberang', async () => {
  const { resizeBox } = await T();
  const r = resizeBox({ x: 0, y: 0, w: 100, h: 100 }, 0, 'se', { x: -50, y: -50 }, { minW: 10, minH: 10 });
  assert.equal(r.w, 10); assert.equal(r.h, 10);
  assert.equal(r.x, 0); assert.equal(r.y, 0); // sudut kiri-atas tetap
});

test('resizeBox menjaga rasio untuk sudut (keepAspect)', async () => {
  const { resizeBox } = await T();
  const r = resizeBox({ x: 0, y: 0, w: 200, h: 100 }, 0, 'se', { x: 400, y: 120 }, { keepAspect: true });
  near(r.w / r.h, 2);
  assert.equal(r.w, 400);
});

test('resizeBox dengan rotasi 90°: sisi seberang tetap diam di halaman', async () => {
  const { resizeBox } = await T();
  const r = resizeBox({ x: 0, y: 0, w: 100, h: 50 }, 90, 'e', { x: 50, y: 125 });
  near(r.w, 150); near(r.h, 50); near(r.x, -25); near(r.y, 25);
});

test('rotasi: sudut dari pointer dan snap', async () => {
  const { angleFromPointer, snapAngle, normAngle } = await T();
  near(angleFromPointer({ x: 0, y: 0 }, { x: 0, y: -10 }), 0);
  near(angleFromPointer({ x: 0, y: 0 }, { x: 10, y: 0 }), 90);
  near(angleFromPointer({ x: 0, y: 0 }, { x: 0, y: 10 }), 180);
  near(normAngle(270), -90); near(normAngle(-190), 170);
  near(snapAngle(44, false), 45); near(snapAngle(40, false), 40);
  near(snapAngle(52, true), 45); near(snapAngle(8, true), 15); near(snapAngle(-97, true), -90);
});

test('snapMove menempel ke tepi/tengah halaman dan elemen lain, memberi garis bantu', async () => {
  const { snapMove } = await T();
  const page = { width: 1000, height: 800 };
  // tengah kotak (x:450..545, tengah 497.5) dekat tengah halaman 500
  let s = snapMove({ x: 452, y: 100, w: 95, h: 50 }, [], page, 8);
  near(s.dx, 500 - 499.5); // tengah kotak 499.5 → 500
  assert.ok(s.guides.some((g) => g.axis === 'x' && g.pos === 500));
  assert.equal(s.dy, 0);
  // tepi kiri dekat tepi elemen lain
  s = snapMove({ x: 203, y: 400, w: 60, h: 60 }, [{ x: 200, y: 0, w: 50, h: 50 }], page, 6);
  near(s.dx, -3);
  // di luar ambang → tidak menempel
  s = snapMove({ x: 300, y: 300, w: 60, h: 60 }, [{ x: 200, y: 0, w: 50, h: 50 }], page, 6);
  assert.equal(s.dx, 0); assert.equal(s.dy, 0);
  assert.deepEqual(s.guides, []);
});

test('hit-test: elemen teratas, melewati yang tersembunyi/terkunci, elemen berputar, garis', async () => {
  const { hitTest, pointInElement } = await T();
  const els = [
    { id: 'a', type: 'rect', x: 0, y: 0, w: 100, h: 100, rotation: 0 },
    { id: 'b', type: 'rect', x: 50, y: 50, w: 100, h: 100, rotation: 0 },
    { id: 'c', type: 'rect', x: 50, y: 50, w: 100, h: 100, rotation: 0, locked: true },
    { id: 'd', type: 'rect', x: 50, y: 50, w: 100, h: 100, rotation: 0, hidden: true },
  ];
  assert.equal(hitTest(els, 75, 75).id, 'b');
  assert.equal(hitTest(els, 10, 10).id, 'a');
  assert.equal(hitTest(els, 500, 500), null);
  // persegi panjang 100×20 diputar 90° di sekitar pusatnya (50,10): menjadi vertikal
  const r = { type: 'rect', x: 0, y: 0, w: 100, h: 20, rotation: 90 };
  assert.equal(pointInElement(r, 50, 55), true);
  assert.equal(pointInElement(r, 5, 10), false);
  const line = { type: 'line', x: 0, y: 100, w: 200, h: 0, rotation: 0, strokeWidth: 4 };
  assert.equal(pointInElement(line, 100, 103, 3), true);
  assert.equal(pointInElement(line, 100, 130, 3), false);
  assert.equal(pointInElement(line, 250, 100, 3), false);
});

test('dropIndex: seret layer ke celah tampilan menghasilkan indeks dokumen yang benar', async () => {
  const { dropIndex } = await T();
  // n=4, tampilan atas→bawah = indeks dok 3,2,1,0
  assert.equal(dropIndex(4, 0, 0), 3); // elemen paling bawah → paling atas
  assert.equal(dropIndex(4, 3, 4), 0); // paling atas → paling bawah
  assert.equal(dropIndex(4, 1, 1), 2); // naik satu langkah: tepat di bawah baris tampilan 0
  assert.equal(dropIndex(4, 2, 2), 2); // ke posisinya sendiri
});

test('wrapText: pembungkusan kata, paragraf kosong, kata terlalu panjang', async () => {
  const { wrapText, wrapParagraph } = await W();
  const m = (s) => Array.from(s).length * 10;
  assert.deepEqual(wrapParagraph(m, 'aku suka kopi hitam', 100), ['aku suka', 'kopi hitam']);
  assert.deepEqual(wrapParagraph(m, '', 100), ['']);
  assert.deepEqual(wrapParagraph(m, 'abcdefghijklmno', 50), ['abcde', 'fghij', 'klmno']);
  assert.deepEqual(wrapParagraph(m, 'ab abcdefghij cd', 50), ['ab', 'abcde', 'fghij', 'cd']);
  assert.deepEqual(wrapText(m, 'satu\n\ndua tiga', 40), ['satu', '', 'dua', 'tiga']);
  assert.deepEqual(wrapText(m, 'x', 0), ['x']);
  // tidak pernah menghasilkan baris lebih lebar dari batas (kecuali satu karakter)
  for (const line of wrapText(m, 'lorem ipsum dolor sit amet consectetur', 70)) assert.ok(m(line) <= 70, line);
});
