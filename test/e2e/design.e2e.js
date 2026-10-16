'use strict';
// E2E Design Studio — aplikasi Electron sungguhan.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { launch } = require('./launch');

const SHOTS = process.env.SHOTS_DIR || '';
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };

function crc32(buf) {
  let c; let crc = ~0;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return ~crc >>> 0;
}
function makePng(w, h, [r, g, b]) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { const o = y * (w * 3 + 1); for (let x = 0; x < w; x++) { raw[o + 1 + x * 3] = r; raw[o + 2 + x * 3] = g; raw[o + 3 + x * 3] = b; } }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const field = (page, label) => page.locator(`.props-body input[aria-label="${label}"]`);
const setNum = async (page, label, v) => { const f = field(page, label); await f.fill(String(v)); await f.press('Enter'); };
const layerCount = (page) => page.locator('.layers-panel .layer').count();
const stageBox = (page) => page.locator('.stage').boundingBox();
async function drag(page, a, b) {
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
}
async function newDesign(page, name = 'Poster Uji') {
  await page.click('.rail-btn[data-view="design"]');
  await page.click('#view-design .empty button:has-text("Desain baru")');
  await page.waitForSelector('.dialog');
  await page.fill('.dialog input[aria-label="Nama desain"]', name);
  await page.click('.dialog .btn-primary');
  await page.waitForSelector('.stage');
  await page.waitForTimeout(300);
}
const waitSaved = (page) => page.waitForFunction(() => document.querySelector('#view-design .save-status').dataset.state === 'saved', null, { timeout: 10000 });
async function pageGet(page, fn, arg) { return page.evaluate(fn, arg); }

test('Design Studio: edit, undo/redo, layer, gambar, simpan dan buka ulang', async () => {
  const { app, page, dir, errors } = await launch();
  try {
    await newDesign(page);
    assert.equal(await page.inputValue('#view-design .title-input'), 'Poster Uji');
    assert.equal(await layerCount(page), 0);
    await shot(page, 'design-empty-doc');

    // --- gambar persegi dengan alat R
    const box = await stageBox(page);
    const cx = box.x + box.width / 2; const cy = box.y + box.height / 2;
    await page.keyboard.press('r');
    await drag(page, { x: cx - 120, y: cy - 60 }, { x: cx + 80, y: cy + 60 });
    assert.equal(await layerCount(page), 1);
    const w = Number(await field(page, 'Lebar').inputValue());
    assert.ok(w > 100, `lebar persegi wajar (${w})`);
    // alat kembali ke Pilih setelah menggambar
    assert.equal(await page.locator('.tool[aria-pressed="true"]').count(), 1);

    // --- ubah isi lewat kode hex
    const hex = page.locator('.props-body input[aria-label="Isi (kode hex)"]');
    await hex.fill('#ff0000'); await hex.press('Enter');
    assert.equal(await hex.inputValue(), '#ff0000');
    await setNum(page, 'X', 100); await setNum(page, 'Y', 100);
    await setNum(page, 'Lebar', 300); await setNum(page, 'Tinggi', 200);
    assert.equal(await field(page, 'X').inputValue(), '100');

    // --- teks: alat T, seret kotak, ketik
    await page.keyboard.press('t');
    await drag(page, { x: cx - 200, y: cy + 100 }, { x: cx + 100, y: cy + 160 });
    await page.waitForSelector('.text-edit:not([hidden])');
    await page.keyboard.type('Halo Dunia');
    await page.keyboard.press('Control+Enter');
    assert.equal(await layerCount(page), 2);
    assert.match(await page.locator('.layers-panel .layer').first().innerText(), /Halo Dunia/);

    // --- pindah dengan keyboard + undo/redo
    await page.click('.layers-panel .layer:has-text("Persegi")');
    await page.keyboard.press('Shift+ArrowRight');
    assert.equal(await field(page, 'X').inputValue(), '110');
    await page.keyboard.press('Control+z');
    assert.equal(await field(page, 'X').inputValue(), '100');
    await page.keyboard.press('Control+y');
    assert.equal(await field(page, 'X').inputValue(), '110');

    // --- rotasi
    await setNum(page, 'Rotasi', 45);
    assert.equal(await field(page, 'Rotasi').inputValue(), '45');

    // --- urutan layer: kirim persegi ke depan (Ctrl+Shift+])
    await page.locator('.stage').focus().catch(() => {});
    await page.keyboard.press('Control+Shift+]');
    assert.match(await page.locator('.layers-panel .layer').first().innerText(), /Persegi/);

    // --- sembunyikan lalu tampilkan
    await page.click('.layers-panel .layer:has-text("Persegi") button[aria-label^="Sembunyikan"]');
    assert.ok(await page.locator('.layers-panel .layer.off').count() === 1);
    await page.click('.layers-panel .layer:has-text("Persegi") button[aria-label^="Tampilkan"]');

    // --- gambar: pilih berkas uji lewat dialog palsu
    const img = path.join(os.tmpdir(), `uji-${Date.now()}.png`);
    fs.writeFileSync(img, makePng(40, 30, [0, 160, 0]));
    await app.evaluate((_, f) => { global.__canvasetTestDialogs = { open: async () => [f], save: async () => null }; }, img);
    await page.click('button[aria-label="Tambah gambar"]');
    await page.waitForFunction(() => document.querySelectorAll('#view-design .layers-panel .layer').length === 3);
    assert.ok(fs.readdirSync(path.join(dir, 'assets')).some((f) => f.endsWith('.png')));
    await shot(page, 'design-edit');

    // --- multi-select dan hapus
    await page.keyboard.press('Control+a');
    assert.match(await page.locator('.d-status').innerText(), /3 elemen dipilih/);
    await page.keyboard.press('Escape');
    assert.match(await page.locator('.d-status').innerText(), /Tidak ada yang dipilih/);
    await page.click('.layers-panel .layer:has-text("Gambar")');
    await page.keyboard.press('Delete');
    assert.equal(await layerCount(page), 2);
    await page.keyboard.press('Control+z');
    assert.equal(await layerCount(page), 3);

    // --- simpan, kembali ke Beranda, buka ulang dari Pustaka
    await waitSaved(page);
    const files = fs.readdirSync(path.join(dir, 'designs')).filter((f) => f.endsWith('.canvaset') || f.endsWith('.json'));
    assert.equal(files.length, 1);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'designs', files[0]), 'utf8'));
    assert.equal(saved.format, 'canvaset-design');
    assert.equal(saved.elements.length, 3);
    const rect = saved.elements.find((e) => e.type === 'rect');
    assert.equal(rect.fill, '#ff0000'); assert.equal(rect.rotation, 45); assert.equal(rect.x, 110);

    await page.click('.rail-btn[data-view="library"]');
    await page.click('#view-library button:has(b:text-is("Poster Uji"))');
    await page.waitForSelector('.stage');
    await page.waitForFunction(() => document.querySelectorAll('#view-design .layers-panel .layer').length === 3);

    // tidak ada luapan horizontal di 1366×768
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `luapan horizontal ${overflow}px`);
  } finally {
    assert.deepEqual(errors, [], `galat konsol: ${errors.join(' | ')}`);
    await app.close();
  }
});

test('Design Studio: ekspor PNG, JPEG, SVG dan validasi ukuran', async () => {
  const { app, page, dir, errors } = await launch();
  try {
    await newDesign(page, 'Ekspor Uji');
    const box = await stageBox(page);
    const cx = box.x + box.width / 2; const cy = box.y + box.height / 2;
    await page.keyboard.press('r');
    await drag(page, { x: cx - 80, y: cy - 80 }, { x: cx + 80, y: cy + 80 });
    const hex = page.locator('.props-body input[aria-label="Isi (kode hex)"]');
    await hex.fill('#ff0000'); await hex.press('Enter');
    await setNum(page, 'X', 0); await setNum(page, 'Y', 0); await setNum(page, 'Lebar', 1080); await setNum(page, 'Tinggi', 540);
    await page.keyboard.press('t');
    await drag(page, { x: cx - 100, y: cy + 150 }, { x: cx + 100, y: cy + 200 });
    await page.waitForSelector('.text-edit:not([hidden])');
    await page.keyboard.type('Ekspor');
    await page.keyboard.press('Control+Enter');

    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'canvaset-out-'));
    const exportAs = async (name, pick) => {
      const target = path.join(out, name);
      await app.evaluate((_, o) => { global.__canvasetTestDialogs = { open: async () => [], save: async () => o }; }, target);
      await page.keyboard.press('Control+e');
      await page.waitForSelector('.dialog');
      await pick();
      await page.click('.dialog .btn-primary');
      await page.waitForFunction(() => !document.querySelector('.dialog'));
      await page.waitForFunction((t) => true, target);
      for (let i = 0; i < 40 && !fs.existsSync(target); i++) await page.waitForTimeout(100);
      assert.ok(fs.existsSync(target), `${name} dibuat`);
      return fs.readFileSync(target);
    };

    // PNG skala 1
    const png = await exportAs('a.png', async () => {});
    assert.deepEqual([...png.subarray(0, 4)], [137, 80, 78, 71]);
    assert.equal(png.readUInt32BE(16), 1080); assert.equal(png.readUInt32BE(20), 1080);
    // piksel di tengah persegi merah, dan putih di luar
    const px = await page.evaluate(async (b64) => {
      const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      return { red: Array.from(x.getImageData(500, 200, 1, 1).data), white: Array.from(x.getImageData(500, 1000, 1, 1).data) };
    }, png.toString('base64'));
    assert.deepEqual(px.red.slice(0, 3), [255, 0, 0]);
    assert.deepEqual(px.white.slice(0, 3), [255, 255, 255]);

    // PNG skala 2
    const png2 = await exportAs('b.png', async () => { await page.selectOption('.dialog select[aria-label="Skala"]', '2'); });
    assert.equal(png2.readUInt32BE(16), 2160);

    // JPEG
    const jpg = await exportAs('c.jpg', async () => { await page.click('.dialog .seg button:has-text("JPEG")'); });
    assert.deepEqual([...jpg.subarray(0, 3)], [0xff, 0xd8, 0xff]);

    // SVG
    const svg = (await exportAs('d.svg', async () => { await page.click('.dialog .seg button:has-text("SVG")'); })).toString('utf8');
    assert.match(svg, /^<svg[^>]*viewBox="0 0 1080 1080"/);
    assert.match(svg, /fill="#ff0000"/);
    assert.match(svg, /Ekspor/);
    assert.match(svg, /@font-face/); assert.match(svg, /data:font\/woff2;base64,/);
    assert.ok(!/<script|onload=|https?:\/\//i.test(svg.replace(/xmlns="[^"]*"/g, '')), 'SVG tanpa skrip atau referensi luar');

    // validasi ukuran: halaman 16000 px × skala 2 melebihi batas → pesan galat, tombol Ekspor tidak jalan
    await page.keyboard.press('Escape');
    await page.click('.canvas-area', { position: { x: 4, y: 4 } });
    await setNum(page, 'Lebar', 9000); await setNum(page, 'Tinggi', 9000);
    await page.keyboard.press('Control+e');
    await page.waitForSelector('.dialog');
    await page.selectOption('.dialog select[aria-label="Skala"]', '2');
    assert.match(await page.locator('.dialog .error-text').innerText(), /melebihi batas/);
    await page.click('.dialog .btn-primary');
    assert.ok(await page.locator('.dialog').count() === 1, 'dialog tetap terbuka saat ukuran tidak sah');
    await page.keyboard.press('Escape');
  } finally {
    assert.deepEqual(errors, [], `galat konsol: ${errors.join(' | ')}`);
    await app.close();
  }
});

test('Design Studio: pemulihan setelah proses dimatikan paksa', async () => {
  let { app, page, dir } = await launch();
  await newDesign(page, 'Draf Uji');
  await waitSaved(page);
  const box = await stageBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: box.x + 200, y: box.y + 150 }, { x: box.x + 320, y: box.y + 260 });
  assert.equal(await layerCount(page), 1);
  const draftDir = path.join(dir, 'recovery');
  const t0 = Date.now();
  while (Date.now() - t0 < 3000 && !fs.readdirSync(draftDir).some((f) => f.endsWith('.json'))) await page.waitForTimeout(50);
  assert.ok(fs.readdirSync(draftDir).some((f) => f.endsWith('.json')), 'draf pemulihan desain tertulis');
  process.kill(app.process().pid, 'SIGKILL');
  await new Promise((r) => setTimeout(r, 800));
  ({ app, page } = await launch({ dataDir: dir }));
  try {
    await page.waitForSelector('.dialog:has-text("Pemulihan")', { timeout: 8000 });
    await page.click('.dialog .btn-primary:has-text("Pulihkan semua")');
    await page.waitForTimeout(800);
    const f = fs.readdirSync(path.join(dir, 'designs'))[0];
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'designs', f), 'utf8'));
    assert.equal(saved.elements.length, 1, 'persegi yang belum tersimpan kembali');
  } finally { await app.close(); }
});
