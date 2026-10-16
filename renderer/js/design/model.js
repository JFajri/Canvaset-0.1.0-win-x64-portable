// Model dokumen desain — murni (tanpa DOM) agar bisa diuji di Node.
// Seluruh desain adalah data terstruktur; tidak ada yang "dipanggang" menjadi gambar.

export const FORMAT = 'canvaset-design';
export const VERSION = 1;
export const MAX_ELEMENTS = 5000;

export const PRESETS = [
  { id: 'presentation', group: 'Presentasi', name: 'Presentasi 16:9', w: 1920, h: 1080 },
  { id: 'ig-post', group: 'Media sosial', name: 'Post Instagram', w: 1080, h: 1080 },
  { id: 'ig-story', group: 'Media sosial', name: 'Story / Reels', w: 1080, h: 1920 },
  { id: 'fb-cover', group: 'Media sosial', name: 'Sampul Facebook', w: 1640, h: 624 },
  { id: 'yt-thumb', group: 'Thumbnail', name: 'Thumbnail YouTube', w: 1280, h: 720 },
  { id: 'poster-a3', group: 'Poster', name: 'Poster A3', w: 1123, h: 1587 },
  { id: 'a4', group: 'Dokumen', name: 'Dokumen A4', w: 794, h: 1123 },
  { id: 'letter', group: 'Dokumen', name: 'Letter', w: 816, h: 1056 },
];

export const FONT_STACKS = {
  sans: "'Inter','Segoe UI',Arial,sans-serif",
  serif: "'Lora',Georgia,'Times New Roman',serif",
  mono: "'JetBrains Mono',Consolas,'Courier New',monospace",
  display: "'Space Grotesk','Inter','Segoe UI',sans-serif",
};
export const FONT_LABELS = { sans: 'Inter (sans)', serif: 'Lora (serif)', mono: 'JetBrains Mono', display: 'Space Grotesk' };

export const TYPE_LABELS = {
  text: 'Teks', rect: 'Persegi', ellipse: 'Elips', triangle: 'Segitiga', star: 'Bintang', line: 'Garis', arrow: 'Panah', image: 'Gambar',
};
export const SHAPE_TYPES = ['rect', 'ellipse', 'triangle', 'star', 'line', 'arrow'];
export const ELEMENT_TYPES = ['text', 'image', ...SHAPE_TYPES];

let counter = 0;
export function newId(prefix = 'e') {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|none|transparent)$/;
export const isColor = (v) => typeof v === 'string' && COLOR_RE.test(v);
const num = (v, d, lo = -1e6, hi = 1e6) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

export function createDocument({ title = 'Desain tanpa judul', width = 1080, height = 1080, background = '#ffffff' } = {}) {
  return {
    format: FORMAT,
    version: VERSION,
    meta: { title, app: 'Canvaset', created: Date.now() },
    page: { width: num(width, 1080, 16, 16000), height: num(height, 1080, 16, 16000), background: isColor(background) ? background : '#ffffff' },
    elements: [],
  };
}

const COMMON = { x: 0, y: 0, w: 100, h: 100, rotation: 0, opacity: 1, locked: false, hidden: false };

const DEFAULTS = {
  rect: { ...COMMON, w: 240, h: 160, fill: '#7c83ff', stroke: 'none', strokeWidth: 2, radius: 0 },
  ellipse: { ...COMMON, w: 200, h: 200, fill: '#ff8a65', stroke: 'none', strokeWidth: 2 },
  triangle: { ...COMMON, w: 200, h: 180, fill: '#4ade80', stroke: 'none', strokeWidth: 2 },
  star: { ...COMMON, w: 200, h: 200, fill: '#fbbf24', stroke: 'none', strokeWidth: 2 },
  line: { ...COMMON, w: 240, h: 0, stroke: '#1a1d2e', strokeWidth: 6, fill: 'none' },
  arrow: { ...COMMON, w: 240, h: 0, stroke: '#1a1d2e', strokeWidth: 6, fill: 'none' },
  text: {
    ...COMMON, w: 420, h: 60, text: 'Klik dua kali untuk mengedit', fontFamily: 'sans', fontSize: 48, fontWeight: 600,
    italic: false, underline: false, align: 'left', lineHeight: 1.25, letterSpacing: 0, fill: '#1a1d2e',
  },
  image: { ...COMMON, w: 400, h: 300, assetId: '', fit: 'cover', radius: 0, naturalW: 0, naturalH: 0 },
};

export function makeElement(type, props = {}) {
  if (!DEFAULTS[type]) throw new Error(`Tipe elemen tidak dikenal: ${type}`);
  return { id: newId(), type, ...DEFAULTS[type], ...props };
}

/** Membersihkan satu elemen dari berkas (nilai di luar jangkauan, tipe warna, dll.). */
function normalizeElement(raw, usedIds) {
  if (!raw || typeof raw !== 'object' || !ELEMENT_TYPES.includes(raw.type)) return null;
  const base = DEFAULTS[raw.type];
  const el = { ...base };
  el.type = raw.type;
  let id = typeof raw.id === 'string' && /^[\w-]{1,40}$/.test(raw.id) ? raw.id : newId();
  while (usedIds.has(id)) id = newId();
  usedIds.add(id);
  el.id = id;
  el.x = num(raw.x, 0); el.y = num(raw.y, 0);
  el.w = num(raw.w, base.w, 0, 20000); el.h = num(raw.h, base.h, 0, 20000);
  el.rotation = num(raw.rotation, 0, -3600, 3600);
  el.opacity = num(raw.opacity, 1, 0, 1);
  el.locked = raw.locked === true; el.hidden = raw.hidden === true;
  if (typeof raw.name === 'string') el.name = raw.name.slice(0, 80);
  for (const k of ['fill', 'stroke']) if (k in base) el[k] = isColor(raw[k]) ? raw[k] : base[k];
  if ('strokeWidth' in base) el.strokeWidth = num(raw.strokeWidth, base.strokeWidth, 0, 200);
  if ('radius' in base) el.radius = num(raw.radius, 0, 0, 5000);
  if (raw.type === 'text') {
    el.text = typeof raw.text === 'string' ? raw.text.slice(0, 20000) : '';
    el.fontFamily = FONT_STACKS[raw.fontFamily] ? raw.fontFamily : 'sans';
    el.fontSize = num(raw.fontSize, 48, 4, 1000);
    el.fontWeight = raw.fontWeight === 700 || raw.fontWeight === 600 || raw.fontWeight === 500 ? raw.fontWeight : 400;
    el.italic = raw.italic === true; el.underline = raw.underline === true;
    el.align = ['left', 'center', 'right'].includes(raw.align) ? raw.align : 'left';
    el.lineHeight = num(raw.lineHeight, 1.25, 0.8, 3);
    el.letterSpacing = num(raw.letterSpacing, 0, -20, 100);
    el.w = Math.max(10, el.w);
  }
  if (raw.type === 'image') {
    el.assetId = typeof raw.assetId === 'string' && /^[a-f0-9]{16}\.(png|jpg|webp|gif|svg)$/.test(raw.assetId) ? raw.assetId : '';
    el.fit = ['cover', 'contain', 'fill'].includes(raw.fit) ? raw.fit : 'cover';
    el.naturalW = num(raw.naturalW, 0, 0, 100000); el.naturalH = num(raw.naturalH, 0, 0, 100000);
  }
  if (raw.type === 'line' || raw.type === 'arrow') el.h = 0;
  return el;
}

/** Mengurai teks JSON menjadi dokumen yang sudah dinormalisasi. Melempar Error jika tidak valid. */
export function parseDocument(text) {
  let raw;
  try { raw = typeof text === 'string' ? JSON.parse(text) : text; } catch (_) { throw new Error('Berkas desain bukan JSON yang valid.'); }
  if (!raw || raw.format !== FORMAT) throw new Error('Berkas ini bukan proyek desain Canvaset.');
  if ((raw.version || 1) > VERSION) throw new Error('Proyek ini dibuat dengan versi Canvaset yang lebih baru.');
  const page = raw.page || {};
  const doc = createDocument({
    title: raw.meta && typeof raw.meta.title === 'string' ? raw.meta.title : 'Desain',
    width: page.width, height: page.height, background: page.background,
  });
  if (raw.meta && Number.isFinite(raw.meta.created)) doc.meta.created = raw.meta.created;
  const used = new Set();
  for (const r of (Array.isArray(raw.elements) ? raw.elements : []).slice(0, MAX_ELEMENTS)) {
    const el = normalizeElement(r, used);
    if (el) doc.elements.push(el);
  }
  return doc;
}

export function serializeDocument(doc) {
  // Tanpa cap waktu: keluaran harus stabil agar perubahan nyata dapat dideteksi dengan membandingkan string.
  return JSON.stringify({
    format: FORMAT, version: VERSION,
    meta: doc.meta,
    page: doc.page,
    elements: doc.elements,
  });
}

export function layerLabel(el) {
  if (el.name) return el.name;
  if (el.type === 'text') return (el.text || '').replace(/\s+/g, ' ').trim().slice(0, 28) || 'Teks kosong';
  return TYPE_LABELS[el.type] || el.type;
}
