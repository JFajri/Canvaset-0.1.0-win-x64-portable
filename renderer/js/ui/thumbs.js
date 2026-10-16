import { h } from '../shared/util.js';
import { icon } from './icons.js';

export const thumbUrl = (item) => (item.thumb ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(item.thumb)}` : null);

/** Isi kotak pratinjau: gambar mini desain, atau potongan awal teks catatan. */
export function thumbContent(item) {
  if (item.type === 'design') {
    const u = thumbUrl(item);
    return u ? h('img', { src: u, alt: '', draggable: 'false' }) : icon('design', 22);
  }
  return icon('note', 22);
}

export function noteLines(item) {
  return h('div', { class: 'note-lines' }, (item.snippet || '').slice(0, 220) || 'Catatan kosong');
}
