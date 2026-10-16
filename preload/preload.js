'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Hanya fungsi bernama yang diekspos ke UI; tidak ada akses filesystem atau ipcRenderer mentah.
async function call(channel, payload) {
  const res = await ipcRenderer.invoke(channel, payload);
  if (!res || !res.ok) {
    const err = new Error(res && res.error ? res.error.message : 'Terjadi kesalahan yang tidak diketahui.');
    err.code = res && res.error ? res.error.code : 'ERROR';
    throw err;
  }
  return res.data;
}

contextBridge.exposeInMainWorld('canvaset', {
  appInfo: () => call('app:info'),
  getSettings: () => call('settings:get'),
  setSettings: (patch) => call('settings:set', { patch }),

  listLibrary: () => call('library:list'),
  createItem: (p) => call('item:create', p),
  readItem: (id) => call('item:read', { id }),
  writeItem: (id, content, thumb) => call('item:write', { id, content, thumb }),
  renameItem: (id, title) => call('item:rename', { id, title }),
  convertNote: (id, ext) => call('item:convert', { id, ext }),
  setItemMeta: (id, patch) => call('item:meta', { id, patch }),
  duplicateItem: (id) => call('item:duplicate', { id }),
  deleteItem: (id) => call('item:delete', { id }),
  revealItem: (id) => call('item:reveal', { id }),

  createCollection: (name) => call('collection:create', { name }),
  renameCollection: (id, name) => call('collection:rename', { id, name }),
  deleteCollection: (id) => call('collection:delete', { id }),

  writeDraft: (id, content) => call('draft:write', { id, content }),
  clearDraft: (id) => call('draft:clear', { id }),
  listDrafts: () => call('draft:list'),
  restoreDraft: (id) => call('draft:restore', { id }),

  search: (q) => call('search:query', { q }),

  addAsset: (data, mime) => call('asset:add', { data, mime }),
  readAsset: (assetId) => call('asset:read', { assetId }),
  pickImages: () => call('asset:pick'),

  importNotes: (collection) => call('note:import', { collection }),
  exportNote: (id) => call('note:export', { id }),
  saveFile: (p) => call('file:saveAs', p),
  exportDesignProject: (id) => call('design:exportProject', { id }),
  importDesignProject: (collection) => call('design:importProject', { collection }),

  openExternal: (url) => call('shell:openExternal', { url }),
  openDataDir: () => call('shell:openDataDir'),

  onFlushRequest: (cb) => ipcRenderer.on('app:flush', () => {
    Promise.resolve()
      .then(cb)
      .catch(() => {})
      .finally(() => ipcRenderer.send('app:flushed'));
  }),
});
