'use strict';
// Membuat ZIP portable Windows x64: runtime Electron resmi (diunduh via npm) + source aplikasi.
// Jalankan: npm run build:portable   (butuh internet ke registry npm dan GitHub releases, serta perintah `zip`)
// Catatan: skrip ini tidak dapat MENJALANKAN hasil .exe di Linux; pengujian .exe harus dilakukan di Windows.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
const NAME = `Canvaset-${pkg.version}-win-x64-portable`;
const OUT = path.join(ROOT, 'dist');
const STAGE = path.join(OUT, NAME);

const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
const copyDir = (a, b) => fs.cpSync(a, b, { recursive: true, filter: (s) => !/\.(map|log)$/.test(s) });

function fetchWindowsRuntime() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canvaset-winel-'));
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"winel","version":"1.0.0"}');
  const env = { ...process.env, npm_config_platform: 'win32', npm_config_arch: 'x64' };
  console.log(`Mengunduh runtime Electron ${electronVersion} untuk Windows x64…`);
  execFileSync('npm', ['i', `electron@${electronVersion}`, '--no-audit', '--no-fund'], { cwd: tmp, env, stdio: 'inherit' });
  const dist = path.join(tmp, 'node_modules', 'electron', 'dist');
  if (!fs.existsSync(path.join(dist, 'electron.exe'))) {
    execFileSync('node', [path.join(tmp, 'node_modules', 'electron', 'install.js')], { cwd: tmp, env, stdio: 'inherit' });
  }
  if (!fs.existsSync(path.join(dist, 'electron.exe'))) throw new Error('electron.exe tidak ditemukan setelah unduhan.');
  return { tmp, dist };
}

function main() {
  rm(STAGE); fs.mkdirSync(STAGE, { recursive: true });
  const { tmp, dist } = fetchWindowsRuntime();
  copyDir(dist, STAGE);
  rm(tmp);
  fs.renameSync(path.join(STAGE, 'electron.exe'), path.join(STAGE, 'Canvaset.exe'));
  rm(path.join(STAGE, 'resources', 'default_app.asar'));

  const app = path.join(STAGE, 'resources', 'app');
  fs.mkdirSync(app, { recursive: true });
  for (const d of ['main', 'preload', 'renderer']) copyDir(path.join(ROOT, d), path.join(app, d));
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, description: pkg.description, main: pkg.main, license: pkg.license }, null, 2));

  fs.mkdirSync(path.join(STAGE, 'CanvasetData'), { recursive: true });
  fs.writeFileSync(path.join(STAGE, 'CanvasetData', 'BACA-SAYA.txt'),
    'Folder ini berisi SEMUA data Canvaset Anda (catatan, desain, gambar, cadangan, pengaturan).\r\n' +
    'Untuk memindahkan ke komputer lain, salin seluruh folder Canvaset (atau hanya folder CanvasetData ini).\r\n' +
    'Saat memperbarui aplikasi, jangan hapus folder ini.\r\n');
  fs.copyFileSync(path.join(ROOT, 'README.md'), path.join(STAGE, 'README.md'));

  const zip = path.join(OUT, `${NAME}.zip`);
  rm(zip);
  execFileSync('zip', ['-r', '-q', '-9', zip, NAME], { cwd: OUT, stdio: 'inherit' });
  const mb = (fs.statSync(zip).size / 1048576).toFixed(1);
  console.log(`\nSelesai: ${zip} (${mb} MB)\nPERINGATAN: berkas .exe belum diuji di Windows oleh skrip ini.`);
}

main();
