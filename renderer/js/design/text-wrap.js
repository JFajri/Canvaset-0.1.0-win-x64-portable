// Pembungkus teks murni. `measure(str) → lebar px` dipasok pemanggil (canvas di aplikasi, palsu di uji).

/** Memecah satu paragraf menjadi baris-baris yang muat dalam maxW. */
export function wrapParagraph(measure, text, maxW) {
  if (text === '') return [''];
  const lines = [];
  const words = text.split(' ');
  let line = '';
  const flush = () => { lines.push(line); line = ''; };
  const pushWord = (word) => {
    // kata yang lebih lebar dari baris: pecah per karakter
    let chunk = '';
    for (const ch of Array.from(word)) {
      if (chunk && measure(chunk + ch) > maxW) { lines.push(chunk); chunk = ch; } else chunk += ch;
    }
    line = chunk;
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const candidate = line === '' && i === 0 ? w : `${line} ${w}`;
    if (measure(candidate) <= maxW || (line === '' && i === 0 && w === '')) { line = candidate; continue; }
    if (line !== '') {
      flush();
      if (measure(w) <= maxW) { line = w; continue; }
      pushWord(w);
    } else pushWord(w);
  }
  flush();
  return lines;
}

/** Seluruh teks (dengan baris baru eksplisit) → daftar baris. */
export function wrapText(measure, text, maxW) {
  const out = [];
  for (const para of String(text).replace(/\r\n?/g, '\n').split('\n')) out.push(...wrapParagraph(measure, para, Math.max(1, maxW)));
  return out;
}
