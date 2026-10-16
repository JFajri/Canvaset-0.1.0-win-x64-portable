'use strict';
// E2E integrasi: Beranda, Pustaka, pencarian global, pin, koleksi, tema, offline, kegigihan data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { launch } = require('./launch');

const SHOTS = process.env.SHOTS_DIR || '';
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
const noOverflow = async (page, where) => {
  const o = await page.evaluate(() => ({ x: document.documentElement.scrollWidth - window.innerWidth, y: document.documentElement.scrollHeight - window.innerHeight }));
  assert.ok(o.x <= 0 && o.y <= 0, `luapan di ${where}: ${JSON.stringify(o)}`);
};

test('Integrasi: buat, cari global, pin, koleksi, tema, offline, simpan antar sesi', async () => {
  let { app, page, dir, errors } = await launch();
  const external = [];
  const watch = (p) => p.on('request', (r) => { const u = r.url(); if (!/^(app:|data:|blob:|devtools:)/.test(u)) external.push(u); });
  watch(page);
  try {
    // Beranda awal (catatan sambutan dibuat otomatis)
    await page.waitForSelector('#view-home.active');
    await noOverflow(page, 'Beranda');
    await shot(page, 'home');

    // --- desain dengan teks
    await page.click('#view-home button:has-text("Desain baru")');
    await page.waitForSelector('.dialog');
    await page.fill('.dialog input[aria-label="Nama desain"]', 'Kartu Ulang Tahun');
    await page.click('.dialog .btn-primary');
    await page.waitForSelector('.stage');
    await page.keyboard.press('t');
    const box = await page.locator('.stage').boundingBox();
    await page.mouse.move(box.x + 200, box.y + 200); await page.mouse.down(); await page.mouse.move(box.x + 500, box.y + 260, { steps: 5 }); await page.mouse.up();
    await page.waitForSelector('.text-edit:not([hidden])');
    await page.keyboard.type('Selamat ulang tahun Budi');
    await page.keyboard.press('Control+Enter');
    await noOverflow(page, 'Design Studio');

    // --- catatan dengan isi
    await page.keyboard.press('Control+3');
    await page.waitForSelector('#view-writing.active');
    await page.keyboard.press('Control+n');
    await page.waitForSelector('.dialog');
    await page.fill('.dialog input[aria-label="Judul catatan"]', 'Daftar Belanja');
    await page.click('.dialog .btn-primary');
    await page.waitForSelector('.editor-text');
    await page.click('.editor-text');
    await page.keyboard.type('susu telur roti');
    await page.waitForFunction(() => document.querySelector('#view-writing .save-status').dataset.state === 'saved', null, { timeout: 8000 });
    await noOverflow(page, 'Writing Studio');

    // --- pencarian global: isi catatan dan teks di dalam desain
    await page.keyboard.press('Control+p');
    await page.waitForSelector('.palette');
    await page.fill('.palette input', 'telur');
    await page.waitForFunction(() => { const r = document.querySelectorAll('.palette-row'); return r.length === 1 && r[0].textContent.includes('Daftar Belanja'); });
    await page.fill('.palette input', 'Budi');
    await page.waitForFunction(() => { const r = document.querySelectorAll('.palette-row'); return r.length === 1 && r[0].textContent.includes('Kartu Ulang Tahun'); });
    await shot(page, 'palette');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#view-design.active .stage');
    assert.equal(await page.inputValue('#view-design .title-input'), 'Kartu Ulang Tahun');
    await page.waitForFunction(() => document.querySelectorAll('#view-design .layers-panel .layer').length === 1);

    // --- Pustaka: pin dan koleksi lewat menu konteks
    await page.keyboard.press('Control+4');
    await page.waitForSelector('#view-library.active .tile');
    await noOverflow(page, 'Pustaka');
    await page.click('#view-library .tile:has(b:text-is("Kartu Ulang Tahun"))', { button: 'right' });
    await page.click('.menu-item:has-text("Sematkan")');
    await page.waitForSelector('#view-library .tile:has(b:text-is("Kartu Ulang Tahun")) .pin');
    await page.click('#view-library .tile:has(b:text-is("Kartu Ulang Tahun"))', { button: 'right' });
    await page.click('.menu-item:has-text("Koleksi baru")');
    await page.fill('.dialog input', 'Acara');
    await page.click('.dialog .btn-primary');
    await page.waitForSelector('#view-library .lib-nav:has-text("Acara")');
    await page.click('#view-library .lib-nav:has-text("Acara")');
    assert.equal(await page.locator('#view-library .tile').count(), 1);
    await shot(page, 'library');

    // --- tema terang + pengaturan
    await page.click('#theme-btn');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await shot(page, 'library-light');
    await page.keyboard.press('Control+,');
    await page.waitForSelector('#view-settings.active');
    await noOverflow(page, 'Pengaturan');
    await shot(page, 'settings-light');
    await page.keyboard.press('Control+1');
    await page.waitForSelector('#view-home.active');
    assert.ok(await page.locator('#view-home .row-item:has-text("Kartu Ulang Tahun")').count() >= 1, 'Beranda menampilkan yang terakhir dibuka');
    await shot(page, 'home-light');

    assert.deepEqual(external, [], `permintaan jaringan keluar: ${external.join(', ')}`);
    assert.deepEqual(errors, [], errors.join(' | '));
  } finally { await app.close(); }

  // --- sesi baru dengan folder data yang sama: semuanya masih ada
  ({ app, page, errors } = await launch({ dataDir: dir }));
  try {
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light', 'tema tersimpan');
    await page.click('.rail-btn[data-view="library"]');
    await page.waitForSelector('#view-library .tile');
    await page.click('#view-library .lib-nav:has-text("Semua")').catch(() => {});
    assert.ok(await page.locator('#view-library .tile:has(b:text-is("Kartu Ulang Tahun"))').count() === 1);
    assert.ok(fs.existsSync(path.join(dir, 'config', 'library.json')));
    assert.deepEqual(errors, [], errors.join(' | '));
  } finally { await app.close(); }
});
