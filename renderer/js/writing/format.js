// Operasi format Markdown sebagai fungsi murni.
// Setiap fungsi menerima (text, s, e) dan mengembalikan edit:
//   { from, to, insert, selStart, selEnd }
// from/to = rentang pada teks LAMA yang diganti; selStart/selEnd = seleksi pada teks BARU.

const HEAD_RE = /^#{1,6}\s+/;
const TASK_RE = /^(\s*)[-*+]\s+\[[ xX]\]\s+/;
const UL_RE = /^(\s*)[-*+]\s+/;
const OL_RE = /^(\s*)\d+[.)]\s+/;
const QUOTE_RE = /^>\s?/;

export function toggleWrap(text, s, e, mark, placeholder = 'teks') {
  const m = mark.length;
  const sel = text.slice(s, e);
  const wrapped = sel
    && text.slice(s - m, s) === mark
    && text.slice(e, e + m) === mark
    && !(mark === '*' && text[s - 2] === '*' && text[e + 1] === '*');
  if (wrapped) {
    return { from: s - m, to: e + m, insert: sel, selStart: s - m, selEnd: e - m };
  }
  if (sel.length >= 2 * m && sel.startsWith(mark) && sel.endsWith(mark) && !(mark === '*' && sel.startsWith('**'))) {
    const inner = sel.slice(m, sel.length - m);
    return { from: s, to: e, insert: inner, selStart: s, selEnd: s + inner.length };
  }
  if (sel) return { from: s, to: e, insert: mark + sel + mark, selStart: s + m, selEnd: e + m };
  return { from: s, to: s, insert: mark + placeholder + mark, selStart: s + m, selEnd: s + m + placeholder.length };
}

function lineRange(text, s, e) {
  const start = text.lastIndexOf('\n', s - 1) + 1;
  const probe = e > s && text[e - 1] === '\n' ? e - 1 : e;
  let end = text.indexOf('\n', probe);
  if (end === -1) end = text.length;
  return { start, end };
}

function strip(line) {
  return line.replace(HEAD_RE, '').replace(TASK_RE, '$1').replace(UL_RE, '$1').replace(OL_RE, '$1').replace(QUOTE_RE, '');
}

function hasKind(line, kind) {
  if (/^h[1-6]$/.test(kind)) return line.startsWith(`${'#'.repeat(Number(kind[1]))} `);
  if (kind === 'task') return TASK_RE.test(line);
  if (kind === 'ul') return UL_RE.test(line) && !TASK_RE.test(line);
  if (kind === 'ol') return OL_RE.test(line);
  if (kind === 'quote') return QUOTE_RE.test(line);
  return false;
}

/** kind: h1..h6 | ul | ol | task | quote */
export function toggleLinePrefix(text, s, e, kind) {
  const { start, end } = lineRange(text, s, e);
  const old = text.slice(start, end);
  const lines = old.split('\n');
  const content = lines.filter((l) => l.trim());
  const targets = content.length ? content : lines;
  const remove = targets.every((l) => hasKind(l, kind));
  let n = 0;
  const out = lines.map((l) => {
    if (!l.trim() && lines.length > 1) return l;
    const base = strip(l);
    if (remove) return base;
    n++;
    if (/^h[1-6]$/.test(kind)) return `${'#'.repeat(Number(kind[1]))} ${base}`;
    if (kind === 'ul') return `- ${base}`;
    if (kind === 'task') return `- [ ] ${base}`;
    if (kind === 'ol') return `${n}. ${base}`;
    return `> ${base}`;
  });
  const insert = out.join('\n');
  if (s === e) {
    const caret = Math.min(start + insert.length, Math.max(start, s + (insert.length - old.length)));
    return { from: start, to: end, insert, selStart: caret, selEnd: caret };
  }
  return { from: start, to: end, insert, selStart: start, selEnd: start + insert.length };
}

export function insertLink(text, s, e, url) {
  const label = text.slice(s, e) || 'teks tautan';
  const insert = `[${label}](${url})`;
  if (s === e) return { from: s, to: e, insert, selStart: s + 1, selEnd: s + 1 + label.length };
  return { from: s, to: e, insert, selStart: s + insert.length, selEnd: s + insert.length };
}

export function codeBlock(text, s, e) {
  const sel = text.slice(s, e);
  const needNl = s > 0 && text[s - 1] !== '\n';
  const pre = `${needNl ? '\n' : ''}\`\`\`\n`;
  if (!sel) return { from: s, to: e, insert: `${pre}\n\`\`\``, selStart: s + pre.length, selEnd: s + pre.length };
  const insert = `${pre}${sel}\n\`\`\``;
  return { from: s, to: e, insert, selStart: s + pre.length, selEnd: s + pre.length + sel.length };
}

export function insertHr(text, s, e) {
  const needNl = s > 0 && text[s - 1] !== '\n';
  const insert = `${needNl ? '\n' : ''}\n---\n\n`;
  return { from: s, to: e, insert, selStart: s + insert.length, selEnd: s + insert.length };
}

/** Enter di akhir baris daftar: lanjutkan item berikutnya; item kosong → akhiri daftar. */
export function continueList(text, pos) {
  if (pos < text.length && text[pos] !== '\n') return null;
  const start = text.lastIndexOf('\n', pos - 1) + 1;
  const line = text.slice(start, pos);
  const m = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/.exec(line);
  if (!m) return null;
  const [, indent, marker, task, content] = m;
  if (!content.trim()) return { from: start, to: pos, insert: '', selStart: start, selEnd: start };
  let next = marker;
  const num = /^(\d+)([.)])$/.exec(marker);
  if (num) next = `${Number(num[1]) + 1}${num[2]}`;
  const insert = `\n${indent}${next} ${task ? '[ ] ' : ''}`;
  return { from: pos, to: pos, insert, selStart: pos + insert.length, selEnd: pos + insert.length };
}

export function indentLines(text, s, e, outdent = false) {
  const { start, end } = lineRange(text, s, e);
  const old = text.slice(start, end);
  const lines = old.split('\n');
  let firstDelta = 0;
  let total = 0;
  const out = lines.map((l, i) => {
    let r = l;
    let d = 0;
    if (outdent) {
      const m = /^( {1,2}|\t)/.exec(l);
      if (m) { r = l.slice(m[0].length); d = -m[0].length; }
    } else if (l.length || lines.length === 1) { r = `  ${l}`; d = 2; }
    if (i === 0) firstDelta = d;
    total += d;
    return r;
  });
  const insert = out.join('\n');
  const selStart = Math.max(start, s + firstDelta);
  const selEnd = Math.max(selStart, e + total);
  return { from: start, to: end, insert, selStart, selEnd };
}

/** Terapkan edit pada string (dipakai untuk uji dan sebagai fallback). */
export function applyEdit(text, edit) {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}
