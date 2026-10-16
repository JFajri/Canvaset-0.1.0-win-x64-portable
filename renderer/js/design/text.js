// Tata letak teks berbasis canvas. Layar, ekspor SVG, dan ekspor PNG memakai hasil yang sama,
// sehingga yang terlihat di editor = yang diekspor.
import { FONT_STACKS } from './model.js';
import { wrapText } from './text-wrap.js';

export const FONT_FACES = [
  { family: 'Inter', weight: 400, style: 'normal', file: 'inter-latin-400-normal.woff2' },
  { family: 'Inter', weight: 500, style: 'normal', file: 'inter-latin-500-normal.woff2' },
  { family: 'Inter', weight: 600, style: 'normal', file: 'inter-latin-600-normal.woff2' },
  { family: 'Inter', weight: 700, style: 'normal', file: 'inter-latin-700-normal.woff2' },
  { family: 'Inter', weight: 400, style: 'italic', file: 'inter-latin-400-italic.woff2' },
  { family: 'Lora', weight: 400, style: 'normal', file: 'lora-latin-400-normal.woff2' },
  { family: 'Lora', weight: 700, style: 'normal', file: 'lora-latin-700-normal.woff2' },
  { family: 'Lora', weight: 400, style: 'italic', file: 'lora-latin-400-italic.woff2' },
  { family: 'JetBrains Mono', weight: 400, style: 'normal', file: 'jetbrains-mono-latin-400-normal.woff2' },
  { family: 'JetBrains Mono', weight: 700, style: 'normal', file: 'jetbrains-mono-latin-700-normal.woff2' },
  { family: 'Space Grotesk', weight: 500, style: 'normal', file: 'space-grotesk-latin-500-normal.woff2' },
  { family: 'Space Grotesk', weight: 700, style: 'normal', file: 'space-grotesk-latin-700-normal.woff2' },
];

export const FAMILY_NAME = { sans: 'Inter', serif: 'Lora', mono: 'JetBrains Mono', display: 'Space Grotesk' };

let fontsReady = null;
export function loadFonts() {
  if (!fontsReady) {
    fontsReady = Promise.all(FONT_FACES.map((f) => document.fonts.load(`${f.style} ${f.weight} 16px "${f.family}"`, 'Aa').catch(() => null))).then(() => true);
  }
  return fontsReady;
}

export function fontString(el) {
  return `${el.italic ? 'italic ' : ''}${el.fontWeight} ${el.fontSize}px ${FONT_STACKS[el.fontFamily] || FONT_STACKS.sans}`;
}

let ctx = null;
const metricCache = new Map();
const layoutCache = new Map();

function getCtx() {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d');
  return ctx;
}

function metricsFor(font, size) {
  let m = metricCache.get(font);
  if (!m) {
    const c = getCtx();
    c.font = font;
    const tm = c.measureText('Hg');
    m = {
      ascent: tm.fontBoundingBoxAscent ?? size * 0.9,
      descent: tm.fontBoundingBoxDescent ?? size * 0.25,
    };
    if (metricCache.size > 200) metricCache.clear();
    metricCache.set(font, m);
  }
  return m;
}

/** → { lines, lh, height, font, baselines[] } */
export function layoutText(el) {
  const font = fontString(el);
  const key = `${font}|${el.letterSpacing}|${el.lineHeight}|${Math.round(el.w * 100)}|${el.text}`;
  const hit = layoutCache.get(key);
  if (hit) return hit;
  const c = getCtx();
  c.font = font;
  c.letterSpacing = `${el.letterSpacing || 0}px`;
  const lines = wrapText((s) => c.measureText(s).width, el.text, el.w);
  const lh = el.fontSize * el.lineHeight;
  const { ascent, descent } = metricsFor(font, el.fontSize);
  const first = (lh - (ascent + descent)) / 2 + ascent;
  const out = {
    lines, lh, font, height: Math.max(1, lines.length * lh),
    baselines: lines.map((_, i) => i * lh + first),
  };
  if (layoutCache.size > 600) layoutCache.clear();
  layoutCache.set(key, out);
  return out;
}

export const measureTextHeight = (el) => layoutText(el).height;

export function measureLineWidth(el, text) {
  const c = getCtx();
  c.font = fontString(el);
  c.letterSpacing = `${el.letterSpacing || 0}px`;
  return c.measureText(text).width;
}

/** Berkas font terdekat untuk kombinasi (family, weight, italic) — dipakai saat menanam font di SVG. */
export function pickFace(family, weight, italic) {
  const name = FAMILY_NAME[family] || 'Inter';
  const style = italic ? 'italic' : 'normal';
  const pool = FONT_FACES.filter((f) => f.family === name);
  const sameStyle = pool.filter((f) => f.style === style);
  const cand = sameStyle.length ? sameStyle : pool;
  return cand.reduce((best, f) => (Math.abs(f.weight - weight) < Math.abs(best.weight - weight) ? f : best), cand[0]);
}
