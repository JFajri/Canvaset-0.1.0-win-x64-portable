// Parser Markdown ringan untuk pratinjau. Murni (tanpa DOM) dan AMAN:
// semua teks di-escape lebih dulu, hanya tautan http/https/mailto/# yang diizinkan,
// gambar eksternal tidak dimuat (privasi + offline).
import { escapeHtml } from '../shared/util.js';

const SAFE_URL = /^(https?:\/\/|mailto:|#)/i;
const ITEM_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const HR_RE = /^ {0,3}([-*_])( *\1){2,} *$/;
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE_RE = /^ {0,3}(```|~~~)\s*([\w+-]*)\s*$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function emphasis(s) {
  return s
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
    .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1<em>$2</em>');
}

export function renderInline(text) {
  const stash = [];
  const keep = (html) => { stash.push(html); return `\u0000${stash.length - 1}\u0000`; };
  let s = escapeHtml(text);
  s = s.replace(/`([^`\n]+)`/g, (_, c) => keep(`<code>${c}</code>`));
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]*)(?:\s+&quot;[^)]*&quot;)?\)/g, (_, alt) => keep(`<span class="md-img">[gambar: ${alt}]</span>`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]*)(?:\s+&quot;[^)]*&quot;)?\)/g, (_, label, url) => {
    if (!SAFE_URL.test(url)) return keep(emphasis(label));
    return keep(`<a href="${url}" data-link="1">${emphasis(label)}</a>`);
  });
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<\u0000]*[^\s<.,;:!?)'"&\u0000])/g, (_, pre, url) => `${pre}${keep(`<a href="${url}" data-link="1">${url}</a>`)}`);
  s = emphasis(s);
  for (let i = 0; i < 4 && /\u0000\d+\u0000/.test(s); i++) s = s.replace(/\u0000(\d+)\u0000/g, (_, n) => stash[+n]);
  return s;
}

function splitRow(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
}

function indentOf(str) { return str.replace(/\t/g, '    ').length; }

function renderList(lines, i, to, base) {
  const first = ITEM_RE.exec(lines[i]);
  const indent0 = indentOf(first[1]);
  const ordered = /\d/.test(first[2]);
  let html = `<${ordered ? 'ol' : 'ul'} data-line="${base + i}">`;
  while (i < to) {
    const m = ITEM_RE.exec(lines[i]);
    if (!m) break;
    const ind = indentOf(m[1]);
    if (ind < indent0) break;
    if (/\d/.test(m[2]) !== ordered && ind === indent0) break;
    let text = m[3];
    let cls = '';
    let box = '';
    const task = /^\[( |x|X)\]\s+(.*)$/.exec(text);
    if (task) {
      cls = ' class="task"';
      box = `<input type="checkbox" disabled${task[1] === ' ' ? '' : ' checked'}> `;
      text = task[2];
    }
    i++;
    let sub = '';
    if (i < to) {
      const n = ITEM_RE.exec(lines[i]);
      if (n && indentOf(n[1]) > ind) { const r = renderList(lines, i, to, base); sub = r.html; i = r.next; }
    }
    html += `<li${cls}>${box}${renderInline(text)}${sub}</li>`;
  }
  html += ordered ? '</ol>' : '</ul>';
  return { html, next: i };
}

function startsBlock(lines, i) {
  const l = lines[i];
  return HEADING_RE.test(l) || FENCE_RE.test(l) || HR_RE.test(l) || ITEM_RE.test(l) || /^\s{0,3}>/.test(l)
    || (l.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes('-'));
}

function blocks(lines, from, to, base) {
  let html = '';
  let i = from;
  while (i < to) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const code = [];
      let j = i + 1;
      while (j < to && !new RegExp(`^ {0,3}${fence[1]}\\s*$`).test(lines[j])) code.push(lines[j++]);
      html += `<pre data-line="${base + i}"><code>${escapeHtml(code.join('\n'))}</code></pre>`;
      i = j + 1;
      continue;
    }

    const hd = HEADING_RE.exec(line);
    if (hd) {
      const lvl = hd[1].length;
      html += `<h${lvl} data-line="${base + i}">${renderInline(hd[2])}</h${lvl}>`;
      i++;
      continue;
    }

    if (HR_RE.test(line)) { html += '<hr>'; i++; continue; }

    if (/^\s{0,3}>/.test(line)) {
      const inner = [];
      let j = i;
      while (j < to && /^\s{0,3}>/.test(lines[j])) { inner.push(lines[j].replace(/^\s{0,3}>\s?/, '')); j++; }
      html += `<blockquote data-line="${base + i}">${blocks(inner, 0, inner.length, base + i)}</blockquote>`;
      i = j;
      continue;
    }

    if (ITEM_RE.test(line)) {
      const r = renderList(lines, i, to, base);
      html += r.html;
      i = r.next;
      continue;
    }

    if (line.includes('|') && i + 1 < to && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''));
      let j = i + 2;
      let body = '';
      while (j < to && lines[j].trim() && lines[j].includes('|')) {
        const cells = splitRow(lines[j]);
        body += `<tr>${head.map((_, k) => `<td${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${renderInline(cells[k] || '')}</td>`).join('')}</tr>`;
        j++;
      }
      html += `<table data-line="${base + i}"><thead><tr>${head.map((c, k) => `<th${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${renderInline(c)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
      i = j;
      continue;
    }

    const para = [line];
    let j = i + 1;
    while (j < to && lines[j].trim() && !startsBlock(lines, j)) para.push(lines[j++]);
    html += `<p data-line="${base + i}">${para.map(renderInline).join('<br>')}</p>`;
    i = j;
  }
  return html;
}

export function renderMarkdown(src) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  return blocks(lines, 0, lines.length, 0);
}

/** Daftar heading untuk panel Outline: { level, text, line, offset }. Mengabaikan isi blok kode. */
export function extractHeadings(src) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let inFence = null;
  let offset = 0;
  lines.forEach((l, idx) => {
    const f = FENCE_RE.exec(l);
    if (f) { inFence = inFence === f[1] ? null : (inFence || f[1]); }
    else if (!inFence) {
      const m = HEADING_RE.exec(l);
      if (m) out.push({ level: m[1].length, text: m[2].replace(/[*_`~]/g, '').trim(), line: idx, offset });
    }
    offset += l.length + 1;
  });
  return out;
}
