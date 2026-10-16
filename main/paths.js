'use strict';
const fs = require('fs');
const path = require('path');

function isWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Menentukan folder data.
 *  1. CANVASET_DATA (untuk pengujian / pengguna mahir)
 *  2. Mode portable: folder "CanvasetData" di samping executable
 *  3. Fallback aman: folder AppData pengguna jika folder executable tidak dapat ditulis
 */
function resolveDataDir({ env, isPackaged, execPath, appRoot, userDataFallback }) {
  if (env.CANVASET_DATA) {
    const dir = path.resolve(env.CANVASET_DATA);
    if (isWritable(dir)) return { dir, portable: false, mode: 'custom' };
  }
  const base = isPackaged ? path.dirname(execPath) : appRoot;
  const portableDir = path.join(base, 'CanvasetData');
  if (isWritable(portableDir)) return { dir: portableDir, portable: true, mode: 'portable' };
  const fallback = path.join(userDataFallback, 'Canvaset', 'CanvasetData');
  fs.mkdirSync(fallback, { recursive: true });
  return { dir: fallback, portable: false, mode: 'fallback' };
}

module.exports = { resolveDataDir, isWritable };
