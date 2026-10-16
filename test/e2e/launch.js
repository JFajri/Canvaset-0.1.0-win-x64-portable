'use strict';
// Pembantu E2E: menjalankan Electron sungguhan dengan folder data sementara.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron } = require('/opt/npm-tools/node_modules/playwright');

const ROOT = path.join(__dirname, '..', '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron');

async function launch({ dataDir, size = [1366, 768], extraEnv = {} } = {}) {
  const dir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'canvaset-e2e-'));
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: [ROOT, '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--window-size=${size[0]},${size[1]}`],
    env: { ...process.env, CANVASET_DATA: dir, ...extraEnv },
    timeout: 60000,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await app.evaluate(({ BrowserWindow }, s) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(s[0], s[1]); w.center(); }, size);
  await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  return { app, page, dir, errors };
}

module.exports = { launch, ROOT };
