'use strict';
// E2E Writing Studio — menjalankan aplikasi Electron sungguhan.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { launch } = require('./launch');

const SHOTS = process.env.SHOTS_DIR || '';
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
const ctrl = (k) => `Control+${k}`;

test('Writing Studio: alur lengkap (buat, ketik, format, simpan otomatis, buka ulang, ekspor/impor)', async (t) => {
  const { app, page, dir, errors } = await launch();
  try {
    // --- buat catatan baru lewat dialog
    await page.click('.rail-btn[data-view="writing"]');
    await page.click('button[aria-label="Catatan baru"]');
    await page.fill('.dialog input[aria-label="Judul catatan"]', 'Rencana Proyek');
    await page.click('.dialog .btn-primary');
    await page.waitForSelector('.editor-text');
    assert.equal(await page.inputValue('#view-writing .title-input'), 'Rencana Proyek');

    // --- ketik teks, format dengan toolbar dan pintasan
    await page.click('.editor-text');
    await page.keyboard.type('Judul besar');
    await page.keyboard.press('Home');
    await page.click('button[aria-label^="Heading"]');
    assert.equal(await page.inputValue('.editor-text'), '## Judul besar');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Kata ');
    await page.keyboard.press(ctrl('b'));
    await page.keyboard.type('tebal');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await page.click('button[aria-label="Daftar poin"]');
    await page.keyboard.type('satu');
    await page.keyboard.press('Enter'); // lanjut daftar otomatis
    await page.keyboard.type('dua');
    const v1 = await page.inputValue('.editor-text');
    assert.equal(v1, '## Judul besar\nKata **tebal**\n- satu\n- dua');

    // --- status simpan: dirty → saved
    await page.waitForFunction(() => document.querySelector('#view-writing .save-status').dataset.state === 'saved', null, { timeout: 8000 });
    const file = path.join(dir, 'notes', 'Rencana Proyek.md');
    assert.equal(fs.readFileSync(file, 'utf8'), v1);

    // --- undo bawaan (Ctrl+Z) mengembalikan langkah terakhir
    await page.keyboard.press(ctrl('z'));
    assert.notEqual(await page.inputValue('.editor-text'), v1);
    await page.keyboard.press(ctrl('y'));
    assert.equal(await page.inputValue('.editor-text'), v1);

    // --- pratinjau
    await page.click('.seg button[data-mode="split"]');
    await page.waitForSelector('.md-preview h2');
    assert.equal(await page.textContent('.md-preview h2'), 'Judul besar');
    assert.equal(await page.textContent('.md-preview strong'), 'tebal');
    assert.equal(await page.locator('.md-preview li').count(), 2);
    await shot(page, 'writing-split');

    // --- statistik
    assert.match(await page.textContent('.statusbar'), /\d+ kata/);

    // --- cari di dokumen
    await page.keyboard.press(ctrl('f'));
    await page.fill('.findbar input', 'satu');
    assert.match(await page.textContent('.findbar .count'), /1 dari 1/);
    await page.fill('.findbar input', 'zzz');
    assert.match(await page.textContent('.findbar .count'), /Tidak ada hasil/);
    await page.keyboard.press('Escape');

    // --- tutup & buka ulang melalui daftar dokumen
    await page.click('.rail-btn[data-view="home"]');
    await page.click('.rail-btn[data-view="writing"]');
    await page.click('.doc-row:has-text("Selamat datang")');
    await page.waitForFunction(() => document.querySelector('#view-writing .title-input').value === 'Selamat datang');
    await page.click('.doc-row:has-text("Rencana Proyek")');
    await page.waitForFunction(() => document.querySelector('#view-writing .title-input').value === 'Rencana Proyek');
    assert.equal(await page.inputValue('.editor-text'), v1);

    // --- ganti nama lewat judul → berkas ikut berganti
    await page.click('#view-writing .title-input');
    await page.fill('#view-writing .title-input', 'Rencana Final');
    await page.keyboard.press('Enter');
    await page.waitForFunction((d) => true, null);
    await page.waitForTimeout(400);
    assert.ok(fs.existsSync(path.join(dir, 'notes', 'Rencana Final.md')));
    assert.ok(!fs.existsSync(file));

    // --- ubah ke .txt (mode Notepad) → toolbar hilang
    await page.click('#view-writing button[aria-label="Menu lainnya"]');
    await page.click('.menu-item:has-text("teks biasa")');
    await page.waitForTimeout(300);
    assert.ok(fs.existsSync(path.join(dir, 'notes', 'Rencana Final.txt')));
    assert.equal(await page.locator('#view-writing .editor-toolbar').isVisible(), false);

    // --- pin
    await page.click('#view-writing button[aria-label="Sematkan"]');
    await page.waitForSelector('.doc-group:has-text("Disematkan")');
    await shot(page, 'writing-plain');
  } finally {
    await app.close();
  }
  assert.deepEqual(errors, []);
});

test('Writing Studio: impor dan ekspor TXT/Markdown lewat dialog berkas', async () => {
  const os = require('os');
  const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'canvaset-files-'));
  fs.writeFileSync(path.join(ext, 'catatan-luar.txt'), 'isi dari luar\nbaris dua');
  fs.writeFileSync(path.join(ext, 'dokumen.md'), '# Dari Markdown\n\nhalo');
  const { app, page, dir, errors } = await launch();
  try {
    await app.evaluate((_, files) => { global.__canvasetTestDialogs = { open: async () => files, save: async () => null }; }, [path.join(ext, 'catatan-luar.txt'), path.join(ext, 'dokumen.md')]);
    await page.click('.rail-btn[data-view="writing"]');
    await page.click('button[aria-label="Impor catatan"]');
    await page.waitForSelector('.doc-row:has-text("catatan-luar")');
    await page.waitForSelector('.doc-row:has-text("dokumen")');
    assert.equal(fs.readFileSync(path.join(dir, 'notes', 'catatan-luar.txt'), 'utf8'), 'isi dari luar\nbaris dua');
    assert.equal(fs.readFileSync(path.join(dir, 'notes', 'dokumen.md'), 'utf8'), '# Dari Markdown\n\nhalo');

    // ekspor ke lokasi pilihan
    const out = path.join(ext, 'hasil-ekspor.md');
    await app.evaluate((_, o) => { global.__canvasetTestDialogs = { open: async () => [], save: async () => o }; }, out);
    await page.click('.doc-row:has-text("dokumen")');
    await page.waitForFunction(() => document.querySelector('#view-writing .title-input').value === 'dokumen');
    await page.click('#view-writing button[aria-label="Menu lainnya"]');
    await page.click('.menu-item:has-text("Ekspor")');
    await page.waitForFunction((o) => true, null);
    await page.waitForTimeout(500);
    assert.equal(fs.readFileSync(out, 'utf8'), '# Dari Markdown\n\nhalo');
  } finally { await app.close(); }
  assert.deepEqual(errors, []);
});

test('Writing Studio: pemulihan setelah penutupan tidak normal (proses dimatikan paksa)', async () => {
  const os = require('os');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'canvaset-crash-'));
  let { app, page } = await launch({ dataDir: data });
  await page.click('.rail-btn[data-view="writing"]');
  await page.click('.doc-row:has-text("Selamat datang")');
  await page.waitForSelector('.editor-text');
  const original = await page.inputValue('.editor-text');
  await page.click('.editor-text');
  await page.keyboard.press(ctrl('End'));
  await page.keyboard.type('\n\nTEKS-YANG-BELUM-TERSIMPAN');
  // Draf ditulis cepat (≈300 ms) sebelum simpan utama (≈1,2 dtk). Tunggu draf lalu matikan proses.
  const draftDir = path.join(data, 'recovery');
  const t0 = Date.now();
  while (Date.now() - t0 < 3000 && !fs.readdirSync(draftDir).some((f) => f.endsWith('.json'))) await page.waitForTimeout(50);
  assert.ok(fs.readdirSync(draftDir).some((f) => f.endsWith('.json')), 'draf pemulihan harus tertulis');
  const pid = app.process().pid;
  process.kill(pid, 'SIGKILL');
  await new Promise((r) => setTimeout(r, 800));
  const onDisk = fs.readFileSync(path.join(data, 'notes', 'Selamat datang.md'), 'utf8');
  assert.ok(!onDisk.includes('TEKS-YANG-BELUM-TERSIMPAN') || onDisk !== original, 'berkas utama bisa saja belum terbarui');

  // Jalankan ulang aplikasi → dialog pemulihan
  ({ app, page } = await launch({ dataDir: data }));
  try {
    await page.waitForSelector('.dialog:has-text("Pemulihan")', { timeout: 8000 });
    await page.click('.dialog .btn-primary:has-text("Pulihkan semua")');
    await page.waitForTimeout(600);
    const restored = fs.readFileSync(path.join(data, 'notes', 'Selamat datang.md'), 'utf8');
    assert.ok(restored.includes('TEKS-YANG-BELUM-TERSIMPAN'));
  } finally { await app.close(); }
});
