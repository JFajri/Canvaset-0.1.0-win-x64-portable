'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const load = (p) => import(`../renderer/js/design/${p}.js`);

test('createDocument + serialize + parseDocument bolak-balik tanpa kehilangan struktur', async () => {
  const { createDocument, makeElement, serializeDocument, parseDocument } = await load('model');
  const doc = createDocument({ title: 'Poster', width: 800, height: 600, background: '#112233' });
  doc.elements.push(makeElement('text', { text: 'Halo', x: 10, y: 20 }));
  doc.elements.push(makeElement('rect', { fill: '#ff0000', radius: 12 }));
  doc.elements.push(makeElement('image', { assetId: 'abcdef0123456789.png', naturalW: 640, naturalH: 480 }));
  const back = parseDocument(serializeDocument(doc));
  assert.equal(back.page.width, 800);
  assert.equal(back.page.background, '#112233');
  assert.equal(back.elements.length, 3);
  assert.equal(back.elements[0].text, 'Halo');
  assert.equal(back.elements[1].radius, 12);
  assert.equal(back.elements[2].assetId, 'abcdef0123456789.png');
  assert.deepEqual(back.elements.map((e) => e.type), ['text', 'rect', 'image']);
});

test('parseDocument menormalisasi data jelek dan menolak berkas asing', async () => {
  const { parseDocument, FORMAT } = await load('model');
  assert.throws(() => parseDocument('bukan json'), /bukan JSON/);
  assert.throws(() => parseDocument('{"format":"lain"}'), /bukan proyek desain/);
  assert.throws(() => parseDocument(JSON.stringify({ format: FORMAT, version: 99, page: {}, elements: [] })), /lebih baru/);
  const doc = parseDocument(JSON.stringify({
    format: FORMAT, version: 1, page: { width: 'x', height: 99999, background: 'javascript:1' },
    elements: [
      { id: 'a', type: 'rect', x: 'abc', opacity: 5, fill: 'url(#x)', w: 50, h: 50 },
      { id: 'a', type: 'rect', w: 10, h: 10 },
      { id: 'z', type: 'script' },
      { id: 't', type: 'text', text: 'x', fontFamily: 'Comic', fontSize: -5 },
      { id: 'i', type: 'image', assetId: '../../etc/passwd' },
    ],
  }));
  assert.equal(doc.page.width, 1080);
  assert.equal(doc.page.height, 16000);
  assert.equal(doc.page.background, '#ffffff');
  assert.equal(doc.elements.length, 4);
  assert.equal(doc.elements[0].opacity, 1);
  assert.equal(doc.elements[0].x, 0);
  assert.notEqual(doc.elements[0].fill, 'url(#x)');
  assert.notEqual(doc.elements[0].id, doc.elements[1].id);
  assert.equal(doc.elements[2].fontFamily, 'sans');
  assert.ok(doc.elements[2].fontSize >= 4);
  assert.equal(doc.elements[3].assetId, '');
});

test('sesi: tambah, ubah, hapus, undo, redo', async () => {
  const { DesignSession } = await load('session');
  const { createDocument } = await load('model');
  const s = new DesignSession(createDocument());
  const a = s.addElement('rect', { x: 10, y: 10 });
  assert.equal(s.elements.length, 1);
  assert.ok(s.selection.has(a.id));
  s.setProps([a.id], { fill: '#00ff00' });
  assert.equal(s.get(a.id).fill, '#00ff00');
  s.deleteSelected();
  assert.equal(s.elements.length, 0);
  assert.equal(s.selection.size, 0);
  s.undo();
  assert.equal(s.elements.length, 1);
  assert.equal(s.get(a.id).fill, '#00ff00');
  s.undo();
  assert.equal(s.get(a.id).fill, '#7c83ff');
  s.undo();
  assert.equal(s.elements.length, 0);
  assert.equal(s.undo(), false);
  s.redo(); s.redo(); s.redo();
  assert.equal(s.elements.length, 0);
  assert.equal(s.redo(), false);
});

test('perubahan berurutan dengan key sama digabung menjadi satu langkah undo', async () => {
  const { DesignSession } = await load('session');
  const { createDocument } = await load('model');
  const s = new DesignSession(createDocument());
  const a = s.addElement('rect');
  for (let i = 1; i <= 5; i++) s.setProps([a.id], { opacity: 1 - i * 0.1 }, { key: 'opacity' });
  assert.equal(s.history.size, 3); // awal, tambah, satu langkah opacity
  s.undo();
  assert.equal(s.get(a.id).opacity, 1);
});

test('update langsung (commit=false) tidak menambah langkah undo sampai commit()', async () => {
  const { DesignSession } = await load('session');
  const { createDocument } = await load('model');
  const s = new DesignSession(createDocument());
  const a = s.addElement('rect', { x: 0 });
  const before = s.history.size;
  for (let i = 0; i < 20; i++) s.moveBy([a.id], 1, 0, { commit: false });
  assert.equal(s.history.size, before);
  assert.equal(s.dirty, true);
  s.commit();
  assert.equal(s.history.size, before + 1);
  assert.equal(s.get(a.id).x, 20);
  s.undo();
  assert.equal(s.get(a.id).x, 0);
});

test('dirty kembali false jika undo ke keadaan yang sudah tersimpan', async () => {
  const { DesignSession } = await load('session');
  const { createDocument } = await load('model');
  const s = new DesignSession(createDocument());
  s.addElement('rect');
  s.markSaved();
  assert.equal(s.dirty, false);
  s.addElement('ellipse');
  assert.equal(s.dirty, true);
  s.undo();
  assert.equal(s.dirty, false);
});

test('duplikat, salin, tempel menghasilkan elemen baru dengan id berbeda', async () => {
  const { DesignSession } = await load('session');
  const { createDocument } = await load('model');
  const s = new DesignSession(createDocument());
  const a = s.addElement('rect', { x: 100, y: 100 });
  const [d] = s.duplicateSelected();
  assert.notEqual(d, a.id);
  assert.equal(s.get(d).x, 124);
  assert.equal(s.elements.length, 2);
  s.copy();
  const pasted = s.paste();
  assert.equal(pasted.length, 1);
  assert.equal(s.elements.length, 3);
  assert.equal(new Set(s.elements.map((e) => e.id)).size, 3);
});

test('urutan layer: front, back, forward, backward', async () => {
  const { DesignSession } = await load('session');
  const { createDocument } = await load('model');
  const s = new DesignSession(createDocument());
  const [a, b, c] = ['rect', 'ellipse', 'star'].map((t) => s.addElement(t));
  const order = () => s.elements.map((e) => e.id);
  s.reorder('front', [a.id]);
  assert.deepEqual(order(), [b.id, c.id, a.id]);
  s.reorder('back', [a.id]);
  assert.deepEqual(order(), [a.id, b.id, c.id]);
  s.reorder('forward', [a.id]);
  assert.deepEqual(order(), [b.id, a.id, c.id]);
  s.reorder('backward', [c.id]);
  assert.deepEqual(order(), [b.id, c.id, a.id]);
  s.moveToIndex(a.id, 0);
  assert.deepEqual(order(), [a.id, b.id, c.id]);
});

test('kunci dan sembunyikan mengeluarkan elemen dari seleksi; elemen terkunci tidak ikut bergeser', async () => {
  const { DesignSession } = await load('session');
  const { createDocument } = await load('model');
  const s = new DesignSession(createDocument());
  const a = s.addElement('rect', { x: 0, y: 0 });
  s.toggleLock([a.id]);
  assert.equal(s.selection.size, 0);
  s.moveBy([a.id], 50, 50);
  assert.equal(s.get(a.id).x, 0);
  s.toggleLock([a.id]);
  s.moveBy([a.id], 50, 50);
  assert.equal(s.get(a.id).x, 50);
  s.toggleHidden([a.id]);
  assert.equal(s.get(a.id).hidden, true);
});

test('rata (align): satu elemen terhadap halaman, banyak elemen terhadap seleksi', async () => {
  const { DesignSession } = await load('session');
  const { createDocument } = await load('model');
  const s = new DesignSession(createDocument({ width: 1000, height: 800 }));
  const a = s.addElement('rect', { x: 10, y: 10, w: 100, h: 100 });
  s.align('centerH');
  assert.equal(s.get(a.id).x, 450);
  s.align('bottom');
  assert.equal(s.get(a.id).y, 700);
  const b = s.addElement('rect', { x: 0, y: 0, w: 50, h: 50 });
  s.select([a.id, b.id]);
  s.align('left');
  assert.equal(s.get(a.id).x, 0);
  assert.equal(s.get(b.id).x, 0);
});

test('seleksi dibersihkan otomatis saat elemen hilang lewat undo', async () => {
  const { DesignSession } = await load('session');
  const { createDocument } = await load('model');
  const s = new DesignSession(createDocument());
  const a = s.addElement('rect');
  s.undo();
  assert.equal(s.selection.has(a.id), false);
});

test('riwayat dibatasi jumlah langkah dan memori', async () => {
  const { History } = await load('history');
  const h = new History({ limit: 10 });
  h.reset('0');
  for (let i = 1; i <= 50; i++) h.push(String(i));
  assert.ok(h.size <= 10);
  assert.equal(h.current(), '50');
  let n = 0;
  while (h.undo()) n++;
  assert.equal(n, 9);

  const big = new History({ limit: 1000, budgetChars: 1000 });
  big.reset('a'.repeat(400));
  for (let i = 0; i < 10; i++) big.push(String(i).repeat(400));
  assert.ok(big.size <= 3);
});

test('geometri: batas elemen yang diputar dan jalur bentuk', async () => {
  const { elementBounds, shapePath, rotatePoint, unionBounds } = await load('geometry');
  const b = elementBounds({ x: 0, y: 0, w: 100, h: 20, rotation: 90 });
  assert.ok(Math.abs(b.w - 20) < 1e-6 && Math.abs(b.h - 100) < 1e-6);
  const p = rotatePoint(10, 0, 0, 0, 90);
  assert.ok(Math.abs(p.x) < 1e-9 && Math.abs(p.y - 10) < 1e-9);
  assert.match(shapePath({ type: 'rect', w: 10, h: 10, radius: 0 }), /^M0 0H10V10H0Z$/);
  assert.match(shapePath({ type: 'rect', w: 100, h: 50, radius: 999 }), /A25 25/); // radius dibatasi
  assert.equal((shapePath({ type: 'star', w: 100, h: 100 }).match(/[ML]/g) || []).length, 10);
  const u = unionBounds([{ x: 0, y: 0, w: 10, h: 10, rotation: 0 }, { x: 20, y: 30, w: 10, h: 10, rotation: 0 }]);
  assert.deepEqual([u.x, u.y, u.w, u.h], [0, 0, 30, 40]);
});
