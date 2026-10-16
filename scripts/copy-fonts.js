'use strict';
// Menyalin font woff2 (subset latin) dari paket @fontsource ke renderer/fonts
// dan membuat renderer/styles/fonts.css. Dijalankan sekali; hasilnya ikut di repositori
// sehingga aplikasi 100% offline.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'renderer', 'fonts');
fs.mkdirSync(OUT, { recursive: true });

const FAMILIES = [
  { pkg: 'inter', family: 'Inter', files: [[400, 'normal'], [500, 'normal'], [600, 'normal'], [700, 'normal'], [400, 'italic']] },
  { pkg: 'jetbrains-mono', family: 'JetBrains Mono', files: [[400, 'normal'], [700, 'normal']] },
  { pkg: 'lora', family: 'Lora', files: [[400, 'normal'], [700, 'normal'], [400, 'italic']] },
  { pkg: 'space-grotesk', family: 'Space Grotesk', files: [[500, 'normal'], [700, 'normal']] },
];

let css = '/* Dibuat oleh scripts/copy-fonts.js — font lokal, tanpa permintaan jaringan */\n';
for (const f of FAMILIES) {
  for (const [weight, style] of f.files) {
    const name = `${f.pkg}-latin-${weight}-${style}.woff2`;
    const src = path.join(ROOT, 'node_modules', '@fontsource', f.pkg, 'files', name);
    if (!fs.existsSync(src)) throw new Error(`Font tidak ditemukan: ${src}`);
    fs.copyFileSync(src, path.join(OUT, name));
    css += `@font-face{font-family:'${f.family}';font-style:${style};font-weight:${weight};font-display:swap;src:url('../fonts/${name}') format('woff2');}\n`;
  }
}
fs.writeFileSync(path.join(ROOT, 'renderer', 'styles', 'fonts.css'), css);
console.log('Font disalin:', fs.readdirSync(OUT).length, 'berkas');
