'use strict';
const fs = require('fs');
const path = require('path');
const { ipcMain, dialog, shell, app } = require('electron');
const { StorageError, IMAGE_MIME, LIMITS, validateDesignJson } = require('./storage');

const ORIGIN = 'app://canvaset/';
const MAX_EXPORT_BYTES = 400 * 1024 * 1024;

const realDialogs = {
  open: (win, opts) => dialog.showOpenDialog(win, opts).then((r) => (r.canceled ? [] : r.filePaths)),
  save: (win, opts) => dialog.showSaveDialog(win, opts).then((r) => (r.canceled ? null : r.filePath)),
};

function isObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function str(v, name, max = 4096) {
  if (typeof v !== 'string' || v.length > max) throw new StorageError('BAD_ARG', `Argumen "${name}" tidak valid.`);
  return v;
}

function registerIpc({ storage, getWindow, location, dialogs }) {
  const dlg = () => global.__canvasetTestDialogs || dialogs || realDialogs;

  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (event, payload) => {
      try {
        const url = event.senderFrame ? event.senderFrame.url : '';
        if (!url.startsWith(ORIGIN)) throw new StorageError('UNTRUSTED', 'Permintaan IPC dari sumber yang tidak dipercaya ditolak.');
        const p = payload === undefined ? {} : payload;
        if (!isObject(p)) throw new StorageError('BAD_ARG', 'Format permintaan tidak valid.');
        return { ok: true, data: await fn(p) };
      } catch (e) {
        return { ok: false, error: { code: e.code || 'ERROR', message: e.message || 'Terjadi kesalahan.' } };
      }
    });
  };

  handle('app:info', () => ({
    version: app.getVersion(),
    dataDir: storage.root,
    portable: location.portable,
    mode: location.mode,
    platform: process.platform,
    warnings: storage.warnings.splice(0),
  }));

  handle('settings:get', () => storage.getSettings());
  handle('settings:set', (p) => storage.setSettings(p.patch));

  handle('library:list', () => ({ items: storage.list(), collections: storage.collections() }));

  handle('item:create', (p) => storage.create({
    type: p.type, title: p.title, ext: p.ext, collection: p.collection || null, content: p.content,
  }));
  handle('item:read', (p) => storage.read(str(p.id, 'id')));
  handle('item:write', (p) => storage.write(str(p.id, 'id'), p.content, { thumb: p.thumb }));
  handle('item:rename', (p) => storage.rename(str(p.id, 'id'), p.title));
  handle('item:convert', (p) => storage.convertNote(str(p.id, 'id'), p.ext));
  handle('item:meta', (p) => storage.setMeta(str(p.id, 'id'), isObject(p.patch) ? p.patch : {}));
  handle('item:duplicate', (p) => storage.duplicate(str(p.id, 'id')));
  handle('item:delete', (p) => storage.remove(str(p.id, 'id')));
  handle('item:reveal', (p) => {
    shell.showItemInFolder(storage.pathOf(str(p.id, 'id')));
    return true;
  });

  handle('collection:create', (p) => storage.createCollection(p.name));
  handle('collection:rename', (p) => storage.renameCollection(str(p.id, 'id'), p.name));
  handle('collection:delete', (p) => storage.deleteCollection(str(p.id, 'id')));

  handle('draft:write', (p) => storage.writeDraft(str(p.id, 'id'), p.content));
  handle('draft:clear', (p) => { storage.clearDraft(str(p.id, 'id')); return true; });
  handle('draft:list', () => storage.listDrafts());
  handle('draft:restore', (p) => storage.restoreDraft(str(p.id, 'id')));

  handle('search:query', (p) => storage.search(p.q, 40));

  /* ---------------------------- aset gambar ---------------------------- */
  handle('asset:add', (p) => {
    const buf = Buffer.from(p.data);
    return storage.addAsset(buf, str(p.mime, 'mime', 100));
  });
  handle('asset:read', (p) => {
    const { data, mime } = storage.readAsset(str(p.assetId, 'assetId', 100));
    return { data, mime };
  });
  handle('asset:pick', async () => {
    const files = await dlg().open(getWindow(), {
      title: 'Pilih gambar',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Gambar', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }],
    });
    const out = [];
    for (const f of files.slice(0, 20)) {
      const ext = path.extname(f).toLowerCase();
      const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' }[ext];
      if (!mime) continue;
      const st = fs.statSync(f);
      if (st.size > LIMITS.assetBytes) throw new StorageError('TOO_LARGE', `"${path.basename(f)}" terlalu besar (maksimum 25 MB).`);
      out.push({ ...storage.addAsset(fs.readFileSync(f), mime), name: path.basename(f) });
    }
    return out;
  });

  /* ---------------------------- impor / ekspor ---------------------------- */
  handle('note:import', async (p) => {
    const files = await dlg().open(getWindow(), {
      title: 'Impor catatan',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Teks / Markdown', extensions: ['txt', 'md', 'markdown'] }],
    });
    const created = [];
    const skipped = [];
    for (const f of files.slice(0, 50)) {
      const ext = path.extname(f).toLowerCase();
      const st = fs.statSync(f);
      if (st.size > LIMITS.noteBytes) { skipped.push(`${path.basename(f)} (lebih dari 10 MB)`); continue; }
      const content = fs.readFileSync(f, 'utf8').replace(/^﻿/, '');
      created.push(storage.create({
        type: 'note', title: path.basename(f, ext), ext: ext === '.txt' ? '.txt' : '.md', collection: p.collection || null, content,
      }));
    }
    return { created, skipped };
  });

  handle('note:export', async (p) => {
    const { meta, content } = storage.read(str(p.id, 'id'));
    const target = await dlg().save(getWindow(), {
      title: 'Ekspor catatan',
      defaultPath: `${meta.title}${meta.ext}`,
      filters: [{ name: meta.ext === '.txt' ? 'Teks' : 'Markdown', extensions: [meta.ext.slice(1)] }],
    });
    if (!target) return { saved: false };
    fs.writeFileSync(target, content, 'utf8');
    return { saved: true, path: target };
  });

  handle('file:saveAs', async (p) => {
    const data = p.data;
    const isText = typeof data === 'string';
    const size = isText ? Buffer.byteLength(data) : (data && data.byteLength) || 0;
    if (!size) throw new StorageError('BAD_ARG', 'Tidak ada data untuk disimpan.');
    if (size > MAX_EXPORT_BYTES) throw new StorageError('TOO_LARGE', 'Hasil ekspor terlalu besar.');
    const filters = Array.isArray(p.filters) ? p.filters.slice(0, 3).map((f) => ({
      name: str(f.name, 'filter', 60), extensions: (f.extensions || []).slice(0, 4).map((e) => str(e, 'ext', 10)),
    })) : [];
    const target = await dlg().save(getWindow(), { title: 'Simpan', defaultPath: str(p.suggestedName || 'berkas', 'name', 200), filters });
    if (!target) return { saved: false };
    fs.writeFileSync(target, isText ? data : Buffer.from(data));
    return { saved: true, path: target };
  });

  /* Proyek desain: ekspor/impor sebagai satu berkas .canvaset dengan aset tertanam */
  handle('design:exportProject', async (p) => {
    const { meta, content } = storage.read(str(p.id, 'id'));
    if (meta.type !== 'design') throw new StorageError('BAD_TYPE', 'Item ini bukan desain.');
    const doc = JSON.parse(content);
    doc.meta = { ...(doc.meta || {}), title: meta.title };
    const embedded = {};
    for (const el of doc.elements) {
      if (el.type === 'image' && el.assetId && !embedded[el.assetId]) {
        try { const a = storage.readAsset(el.assetId); embedded[el.assetId] = { mime: a.mime, base64: a.data.toString('base64') }; } catch (_) { /* aset hilang */ }
      }
    }
    doc.embeddedAssets = embedded;
    const target = await dlg().save(getWindow(), {
      title: 'Ekspor proyek desain',
      defaultPath: `${meta.title}.canvaset`,
      filters: [{ name: 'Proyek Canvaset', extensions: ['canvaset'] }],
    });
    if (!target) return { saved: false };
    fs.writeFileSync(target, JSON.stringify(doc));
    return { saved: true, path: target };
  });

  handle('design:importProject', async (p) => {
    const files = await dlg().open(getWindow(), {
      title: 'Impor proyek desain',
      properties: ['openFile'],
      filters: [{ name: 'Proyek Canvaset', extensions: ['canvaset'] }],
    });
    if (!files.length) return { created: [] };
    const st = fs.statSync(files[0]);
    if (st.size > LIMITS.designBytes * 2) throw new StorageError('TOO_LARGE', 'Berkas proyek terlalu besar.');
    const text = fs.readFileSync(files[0], 'utf8');
    const doc = validateDesignJson(text);
    const remap = {};
    for (const [oldId, a] of Object.entries(doc.embeddedAssets || {})) {
      if (!a || !IMAGE_MIME[a.mime] || typeof a.base64 !== 'string') continue;
      const res = storage.addAsset(Buffer.from(a.base64, 'base64'), a.mime);
      remap[oldId] = res.assetId;
    }
    delete doc.embeddedAssets;
    for (const el of doc.elements) if (el.type === 'image' && remap[el.assetId]) el.assetId = remap[el.assetId];
    const title = (doc.meta && doc.meta.title) || path.basename(files[0], path.extname(files[0]));
    const meta = storage.create({ type: 'design', title, collection: p.collection || null, content: JSON.stringify(doc) });
    return { created: [meta] };
  });

  handle('shell:openExternal', (p) => {
    let u;
    try { u = new URL(str(p.url, 'url', 2048)); } catch (_) { throw new StorageError('BAD_ARG', 'Tautan tidak valid.'); }
    if (!['http:', 'https:', 'mailto:'].includes(u.protocol)) throw new StorageError('BAD_ARG', 'Hanya tautan http, https, dan mailto yang dapat dibuka.');
    shell.openExternal(u.toString());
    return true;
  });
  handle('shell:openDataDir', async () => {
    const err = await shell.openPath(storage.root);
    if (err) throw new StorageError('OPEN_FAILED', `Tidak dapat membuka folder: ${err}`);
    return true;
  });

  ipcMain.on('app:flushed', () => { /* ditangani di main.js */ });
}

module.exports = { registerIpc };
