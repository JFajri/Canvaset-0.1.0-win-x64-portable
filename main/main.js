'use strict';
const { app, BrowserWindow, protocol, net, shell, Menu, session, ipcMain } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { resolveDataDir } = require('./paths');
const { Storage } = require('./storage');
const { registerIpc } = require('./ipc');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const ORIGIN = 'app://canvaset/';

const location = resolveDataDir({
  env: process.env,
  isPackaged: app.isPackaged,
  execPath: process.execPath,
  appRoot: path.join(__dirname, '..'),
  userDataFallback: app.getPath('appData'),
});
// Cache, localStorage Chromium, dll. ikut berada di folder data agar benar-benar portable.
app.setPath('userData', path.join(location.dir, 'config', 'electron'));

let win = null;
let storage = null;
let flushed = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}

function serveRenderer() {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const full = path.normalize(path.join(RENDERER_DIR, rel));
    if (!full.startsWith(RENDERER_DIR + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(full).toString());
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 840,
    minWidth: 1024,
    minHeight: 620,
    show: false,
    backgroundColor: '#0b0f1a',
    title: 'Canvaset',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (['http:', 'https:', 'mailto:'].includes(u.protocol)) shell.openExternal(u.toString());
    } catch (_) { /* abaikan */ }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) e.preventDefault();
  });

  // Beri kesempatan renderer menyimpan perubahan terakhir sebelum jendela ditutup.
  win.on('close', (e) => {
    if (flushed || !win || win.webContents.isDestroyed()) return;
    e.preventDefault();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      flushed = true;
      try { storage.flush(); } catch (_) { /* abaikan */ }
      if (win && !win.isDestroyed()) win.close();
    };
    ipcMain.once('app:flushed', finish);
    win.webContents.send('app:flush');
    setTimeout(finish, 4000);
  });
  win.on('closed', () => { win = null; });

  win.loadURL(`${ORIGIN}index.html`);
  return win;
}

if (gotLock) {
  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    Menu.setApplicationMenu(null);
    storage = new Storage(location.dir).init();
    serveRenderer();
    registerIpc({ storage, getWindow: () => win, location });
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (storage) storage.flush(); app.quit(); });
  app.on('before-quit', () => { if (storage) storage.flush(); });
}

module.exports = { getWindow: () => win, getStorage: () => storage };
