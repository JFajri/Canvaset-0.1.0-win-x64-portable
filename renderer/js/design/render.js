// Renderer SVG: satu sumber untuk tampilan layar, ekspor SVG, dan thumbnail.
import { elementTransform, shapePath } from './geometry.js';
import { layoutText } from './text.js';
import { FONT_STACKS } from './model.js';

export const NS = 'http://www.w3.org/2000/svg';

export function svgEl(tag, attrs, ...kids) {
  const el = document.createElementNS(NS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v);
  for (const k of kids) if (k) el.appendChild(k);
  return el;
}

const paint = (v) => (!v || v === 'none' || v === 'transparent' ? 'none' : v);

/**
 * env: { assetUrl(assetId) → url|null, hideTextId?: id, thumb?: boolean }
 * Mengembalikan <g> untuk satu elemen (sudah memuat transform dan opasitas).
 */
export function buildElementNode(el, env) {
  const g = svgEl('g', { transform: elementTransform(el), 'data-id': el.id });
  if (el.opacity < 1) g.setAttribute('opacity', String(el.opacity));
  if (el.hidden) g.setAttribute('display', 'none');

  if (el.type === 'text') {
    if (env.hideTextId === el.id) return g;
    const L = layoutText(el);
    const anchor = el.align === 'center' ? 'middle' : el.align === 'right' ? 'end' : 'start';
    const x = el.align === 'center' ? el.w / 2 : el.align === 'right' ? el.w : 0;
    const t = svgEl('text', {
      fill: paint(el.fill), 'font-family': FONT_STACKS[el.fontFamily], 'font-size': el.fontSize, 'font-weight': el.fontWeight,
      'font-style': el.italic ? 'italic' : null, 'text-anchor': anchor, 'letter-spacing': el.letterSpacing || null,
      'text-decoration': el.underline ? 'underline' : null, 'xml:space': 'preserve',
    });
    L.lines.forEach((line, i) => {
      const ts = svgEl('tspan', { x, y: Math.round(L.baselines[i] * 100) / 100 });
      ts.textContent = line === '' ? '​' : line;
      t.appendChild(ts);
    });
    g.appendChild(t);
    return g;
  }

  if (el.type === 'image') {
    const url = el.assetId ? env.assetUrl(el.assetId) : null;
    if (!url) {
      if (env.thumb) g.appendChild(svgEl('rect', { width: el.w, height: el.h, fill: '#c8ccd8' }));
      else {
        g.appendChild(svgEl('rect', { width: el.w, height: el.h, fill: 'rgba(128,128,150,.18)', stroke: 'rgba(128,128,150,.7)', 'stroke-dasharray': '8 6', 'stroke-width': 2 }));
        const t = svgEl('text', { x: el.w / 2, y: el.h / 2, 'text-anchor': 'middle', fill: 'rgba(128,128,150,.95)', 'font-size': Math.max(12, Math.min(28, el.w / 10)), 'font-family': FONT_STACKS.sans });
        t.textContent = el.assetId ? 'Gambar tidak ditemukan' : 'Tanpa gambar';
        g.appendChild(t);
      }
      return g;
    }
    const r = Math.min(el.radius || 0, el.w / 2, el.h / 2);
    const cid = `cp-${el.id}`;
    g.appendChild(svgEl('clipPath', { id: cid }, svgEl('rect', { width: el.w, height: el.h, rx: r || null, ry: r || null })));
    g.appendChild(svgEl('image', {
      href: url, width: el.w, height: el.h, 'clip-path': `url(#${cid})`,
      preserveAspectRatio: el.fit === 'fill' ? 'none' : el.fit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice',
    }));
    return g;
  }

  const isLine = el.type === 'line' || el.type === 'arrow';
  g.appendChild(svgEl('path', {
    d: shapePath(el),
    fill: isLine ? 'none' : paint(el.fill),
    stroke: paint(el.stroke),
    'stroke-width': paint(el.stroke) === 'none' ? null : el.strokeWidth,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round',
  }));
  return g;
}

/** Sinkronisasi bertahap: hanya node yang berubah yang dibangun ulang. */
export class SvgRenderer {
  constructor(layer, env) {
    this.layer = layer;
    this.env = env;
    this.nodes = new Map();
  }

  sync(elements) {
    const seen = new Set();
    let prev = null;
    for (const el of elements) {
      seen.add(el.id);
      const url = el.type === 'image' && el.assetId ? (this.env.assetUrl(el.assetId) || '') : '';
      const sig = `${JSON.stringify(el)}|${url}|${this.env.hideTextId === el.id ? 'edit' : ''}`;
      let entry = this.nodes.get(el.id);
      if (!entry || entry.sig !== sig) {
        const node = buildElementNode(el, this.env);
        if (entry && entry.node.parentNode === this.layer) this.layer.replaceChild(node, entry.node);
        entry = { node, sig };
        this.nodes.set(el.id, entry);
      }
      const node = entry.node;
      if (node.parentNode !== this.layer || node.previousSibling !== prev) {
        this.layer.insertBefore(node, prev ? prev.nextSibling : this.layer.firstChild);
      }
      prev = node;
    }
    for (const [id, entry] of this.nodes) {
      if (!seen.has(id)) { if (entry.node.parentNode) entry.node.parentNode.removeChild(entry.node); this.nodes.delete(id); }
    }
  }
}

/** Dokumen → string SVG mandiri. opts: { assetUrl, fontCss, thumb, maxElements } */
export function docToSvgString(doc, opts = {}) {
  const { width, height, background } = doc.page;
  const root = svgEl('svg', { xmlns: NS, width, height, viewBox: `0 0 ${width} ${height}` });
  if (opts.fontCss) {
    const st = svgEl('style');
    st.textContent = opts.fontCss;
    root.appendChild(svgEl('defs', null, st));
  }
  root.appendChild(svgEl('clipPath', { id: 'page-clip' }, svgEl('rect', { width, height })));
  root.appendChild(svgEl('rect', { width, height, fill: paint(background) }));
  const content = svgEl('g', { 'clip-path': 'url(#page-clip)' });
  const env = { assetUrl: opts.assetUrl || (() => null), thumb: !!opts.thumb };
  const els = opts.maxElements ? doc.elements.slice(0, opts.maxElements) : doc.elements;
  for (const el of els) {
    if (el.hidden) continue;
    content.appendChild(buildElementNode(el, env));
  }
  root.appendChild(content);
  return new XMLSerializer().serializeToString(root);
}

/** SVG kecil untuk kartu di Beranda/Pustaka (tanpa gambar asli dan font tertanam). */
export function makeThumbSvg(doc) {
  const full = (n) => docToSvgString(doc, { thumb: true, maxElements: n });
  for (const n of [400, 120, 30]) {
    const s = full(n);
    if (s.length <= 60 * 1024) return s;
  }
  return docToSvgString({ ...doc, elements: [] }, { thumb: true });
}
