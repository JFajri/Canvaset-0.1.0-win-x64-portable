'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../renderer/js/shared/saver.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeApi({ failTimes = 0, delay = 0 } = {}) {
  const calls = { write: [], draft: [], clear: [] };
  let fails = failTimes;
  return {
    calls,
    async writeItem(id, content) {
      if (delay) await wait(delay);
      if (fails > 0) { fails--; throw new Error('disk penuh'); }
      calls.write.push(content);
      return { id, updated: Date.now() };
    },
    async writeDraft(id, content) { calls.draft.push(content); },
    async clearDraft(id) { calls.clear.push(id); },
  };
}

test('autosave menyimpan setelah jeda dan menggabungkan ketikan beruntun', async () => {
  const { Saver } = await load();
  const api = fakeApi();
  const states = [];
  const s = new Saver({ api, id: 'n_1', content: '', autosaveMs: 40, draftMs: 10, onState: (x) => states.push(x.state) });
  s.setContent('a'); s.setContent('ab'); s.setContent('abc');
  assert.equal(s.state, 'dirty');
  await wait(25);
  assert.deepEqual(api.calls.draft.at(-1), 'abc'); // draf tertulis lebih cepat
  await wait(120);
  assert.deepEqual(api.calls.write, ['abc']);
  assert.equal(s.state, 'saved');
  assert.ok(states.includes('saving'));
  assert.deepEqual(api.calls.clear, ['n_1']);
  s.dispose();
});

test('flush() menulis segera dan menunggu simpan yang sedang berjalan', async () => {
  const { Saver } = await load();
  const api = fakeApi({ delay: 30 });
  const s = new Saver({ api, id: 'n_1', content: '', autosaveMs: 10000 });
  s.setContent('satu');
  const p = s.flush();
  s.setContent('dua'); // berubah saat menyimpan
  await p;
  await s.flush();
  assert.equal(api.calls.write.at(-1), 'dua');
  assert.equal(s.dirty, false);
  s.dispose();
});

test('penyimpanan tidak pernah tumpang tindih dan hasil akhir adalah isi terbaru', async () => {
  const { Saver } = await load();
  let active = 0; let maxActive = 0; const written = [];
  const api = {
    async writeItem(id, c) { active++; maxActive = Math.max(maxActive, active); await wait(20); written.push(c); active--; return {}; },
    async writeDraft() {}, async clearDraft() {},
  };
  const s = new Saver({ api, id: 'n_1', content: '', autosaveMs: 5 });
  for (let i = 1; i <= 10; i++) { s.setContent(`v${i}`); await wait(8); }
  await s.flush();
  assert.equal(maxActive, 1);
  assert.equal(written.at(-1), 'v10');
});

test('gagal menyimpan: status error, data tetap ada, otomatis mencoba lagi sampai berhasil', async () => {
  const { Saver } = await load();
  const api = fakeApi({ failTimes: 2 });
  const msgs = [];
  const s = new Saver({ api, id: 'n_1', content: '', autosaveMs: 10, retryMs: 30, onState: (x) => msgs.push(x) });
  s.setContent('penting');
  await wait(25);
  assert.equal(s.state, 'error');
  assert.match(s.lastError, /disk penuh/);
  assert.equal(s.dirty, true);
  assert.equal(s.content, 'penting');
  await wait(200);
  assert.equal(s.state, 'saved');
  assert.deepEqual(api.calls.write, ['penting']);
  s.dispose();
});

test('mengetik lalu kembali ke isi tersimpan tidak memicu penulisan', async () => {
  const { Saver } = await load();
  const api = fakeApi();
  const s = new Saver({ api, id: 'n_1', content: 'asli', autosaveMs: 20 });
  s.setContent('asli!'); s.setContent('asli');
  await wait(60);
  assert.equal(api.calls.write.length, 0);
  assert.equal(s.state, 'saved');
  s.dispose();
});

test('flush saat gagal mengembalikan false (pemanggil tahu data belum aman)', async () => {
  const { Saver } = await load();
  const api = fakeApi({ failTimes: 99 });
  const s = new Saver({ api, id: 'n_1', content: '', autosaveMs: 5000, retryMs: 100000 });
  s.setContent('x');
  assert.equal(await s.flush(), false);
  s.dispose();
});
