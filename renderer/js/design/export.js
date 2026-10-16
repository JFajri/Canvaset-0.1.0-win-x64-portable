// Ekspor: PNG/JPEG lewat Canvas 2D (font bawaan tampil benar), SVG dengan font tertanam.
import { shapePath } from './geometry.js';
import { layoutText, measureLineWidth, FONT_FACES, pickFace, FAMILY_NAME } from './text.js';
import { docToSvgString } from './render.js';
import { FONT_STACKS } from './model.js';

export const MAX_SIDE = 16384;
export const MAX_PIXELS = 64e6;

const paint = (v) => (!v || v === 'none' || v === 'transparent' ? null : v);

export function exportSize(doc, scale) {
  return { w: Math.round(doc.page.width * scale), h: Math.round(doc.page.height * scale) };
}

export function checkExportSize(doc, scale) {
  const { w, h } = exportSize(doc, scale);
  if (w > MAX_SIDE || h > MAX_SIDE) return `Ukuran hasil ${w} × ${h} px melebihi batas ${MAX_SIDE} px per sisi. Kecilkan skala.`;
  if (w * h > MAX_PIXELS) return `Hasil ${(w * h / 1e6).toFixed(0)} megapiksel melebihi batas ${(MAX_PIXELS / 1e6).toFixed(0)} MP. Kecilkan skala.`;
  return null;
}

function drawElement(ctx, el, getImage) {
  ctx.save();
  const cx = el.x + el.w / 2; const cy = el.y + el.h / 2;
  ctx.translate(cx, cy);
  if (el.rotation) ctx.rotate((el.rotation * Math.PI) / 180);
  ctx.translate(-el.w / 2, -el.h / 2);
  ctx.globalAlpha = el.opacity;

  if (el.type === 'text') {
    const L = layoutText(el);
    ctx.font = L.font;
    ctx.letterSpacing = `${el.letterSpacing || 0}px`;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = el.align;
    const fill = paint(el.fill);
    if (fill) {
      ctx.fillStyle = fill;
      const x = el.align === 'center' ? el.w / 2 : el.align === 'right' ? el.w : 0;
      L.lines.forEach((line, i) => {
        if (!line) return;
        ctx.fillText(line, x, L.baselines[i]);
        if (el.underline) {
          const w = measureLineWidth(el, line);
          const x0 = el.align === 'center' ? x - w / 2 : el.align === 'right' ? x - w : x;
          ctx.fillRect(x0, L.baselines[i] + el.fontSize * 0.1, w, Math.max(1, el.fontSize * 0.06));
        }
      });
    }
  } else if (el.type === 'image') {
    const img = el.assetId ? getImage(el.assetId) : null;
    if (img) {
      const nw = img.naturalWidth || el.w; const nh = img.naturalHeight || el.h;
      const r = Math.min(el.radius || 0, el.w / 2, el.h / 2);
      ctx.save();
      ctx.clip(new Path2D(shapePath({ type: 'rect', w: el.w, h: el.h, radius: r })));
      if (el.fit === 'fill') ctx.drawImage(img, 0, 0, el.w, el.h);
      else if (el.fit === 'contain') {
        const s = Math.min(el.w / nw, el.h / nh);
        ctx.drawImage(img, (el.w - nw * s) / 2, (el.h - nh * s) / 2, nw * s, nh * s);
      } else {
        const s = Math.max(el.w / nw, el.h / nh);
        const sw = el.w / s; const sh = el.h / s;
        ctx.drawImage(img, (nw - sw) / 2, (nh - sh) / 2, sw, sh, 0, 0, el.w, el.h);
      }
      ctx.restore();
    }
  } else {
    const p = new Path2D(shapePath(el));
    const isLine = el.type === 'line' || el.type === 'arrow';
    const fill = isLine ? null : paint(el.fill);
    const stroke = paint(el.stroke);
    if (fill) { ctx.fillStyle = fill; ctx.fill(p); }
    if (stroke && el.strokeWidth > 0) {
      ctx.strokeStyle = stroke; ctx.lineWidth = el.strokeWidth; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.stroke(p);
    }
  }
  ctx.restore();
}

/** getImage(assetId) → HTMLImageElement|null (sudah dimuat). */
export function renderDocToCanvas(doc, getImage, scale = 1, { opaque = false } = {}) {
  const { w, h } = exportSize(doc, scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas tidak dapat dibuat. Coba skala yang lebih kecil.');
  ctx.scale(w / doc.page.width, h / doc.page.height);
  if (opaque) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, doc.page.width, doc.page.height); }
  const bg = paint(doc.page.background);
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, doc.page.width, doc.page.height); }
  ctx.beginPath(); ctx.rect(0, 0, doc.page.width, doc.page.height); ctx.clip();
  for (const el of doc.elements) if (!el.hidden) drawElement(ctx, el, getImage);
  return canvas;
}

export function canvasToBytes(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) { reject(new Error('Gagal membuat berkas gambar. Coba skala yang lebih kecil.')); return; }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, mime, quality);
  });
}

const toBase64 = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/** CSS @font-face (data URI) untuk font yang benar-benar dipakai di dokumen. */
export async function buildFontCss(doc) {
  const used = new Map();
  for (const el of doc.elements) {
    if (el.type !== 'text' || el.hidden) continue;
    const face = pickFace(el.fontFamily, el.fontWeight, el.italic);
    used.set(face.file, face);
  }
  let css = '';
  for (const face of used.values()) {
    const res = await fetch(`fonts/${face.file}`);
    if (!res.ok) continue;
    const b64 = toBase64(new Uint8Array(await res.arrayBuffer()));
    css += `@font-face{font-family:'${face.family}';font-style:${face.style};font-weight:${face.weight};src:url(data:font/woff2;base64,${b64}) format('woff2');}\n`;
  }
  return css;
}

/** assetData(assetId) → { mime, bytes } | null */
export async function exportSvg(doc, assetData) {
  const urls = new Map();
  for (const el of doc.elements) {
    if (el.type === 'image' && el.assetId && !urls.has(el.assetId)) {
      const a = await assetData(el.assetId);
      if (a) urls.set(el.assetId, `data:${a.mime};base64,${toBase64(a.bytes)}`);
    }
  }
  const fontCss = await buildFontCss(doc);
  return docToSvgString(doc, { assetUrl: (id) => urls.get(id) || null, fontCss });
}

export { FONT_FACES, FAMILY_NAME, FONT_STACKS };
