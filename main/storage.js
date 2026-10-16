'use strict';
/**
 * Storage — lapisan penyimpanan berbasis file, tanpa dependensi Electron
 * (agar dapat diuji dengan `node --test`).
 *
 * Struktur folder data:
 *   notes/      catatan .md / .txt (file terbuka, bisa dibuka aplikasi lain)
 *   designs/    proyek desain .canvaset (JSON)
 *   assets/     gambar yang dipakai desain (nama = hash isi)
 *   backups/    salinan versi lama per item
 *   recovery/   draf pemulihan jika aplikasi tertutup tidak normal
 *   trash/      item yang dihapus (tidak langsung hilang permanen)
 *   config/     library.json (indeks) dan settings.json
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LIMITS = {
  noteBytes: 10 * 1024 * 1024,
  designBytes: 50 * 1024 * 1024,
  assetBytes: 25 * 1024 * 1024,
  thumbChars: 60 * 1024,
  titleChars: 120,
  collectionName: 60,
  elements: 5000,
};
const BACKUP_KEEP = 8;
const BACKUP_MIN_INTERVAL_MS = 5 * 60 * 1000;
const NOTE_EXTS = ['.md', '.txt'];
const DESIGN_EXT = '.canvaset';
const IMAGE_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
};
const ASSET_ID_RE = /^[a-f0-9]{16}\.(png|jpg|webp|gif|svg)$/;
const ID_RE = /^[nd]_[a-f0-9]{8,16}$/;
const ELEMENT_TYPES = new Set(['text', 'rect', 'ellipse', 'triangle', 'star', 'line', 'arrow', 'image']);

const DEFAULT_SETTINGS = {
  theme: 'dark',
  accent: '#7c83ff',
  editorFont: 'sans',
  fontSize: 16,
  readWidth: 760,
  defaultNoteExt: '.md',
  autosaveMs: 1200,
  firstRunDone: false,
};
const SETTING_RULES = {
  theme: (v) => v === 'dark' || v === 'light',
  accent: (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v),
  editorFont: (v) => ['sans', 'serif', 'mono'].includes(v),
  fontSize: (v) => Number.isFinite(v) && v >= 12 && v <= 28,
  readWidth: (v) => Number.isFinite(v) && v >= 480 && v <= 1400,
  defaultNoteExt: (v) => NOTE_EXTS.includes(v),
  autosaveMs: (v) => Number.isFinite(v) && v >= 500 && v <= 10000,
  firstRunDone: (v) => typeof v === 'boolean',
};

class StorageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
  }
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function sanitizeFileName(title) {
  let s = String(title == null ? '' : title)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  if (s.length > 80) s = s.slice(0, 80).trim();
  if (!s || RESERVED.test(s)) s = s ? `_${s}` : 'Tanpa judul';
  return s;
}

function atomicWrite(file, data) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, data);
    try { fs.fsyncSync(fd); } catch (_) { /* beberapa FS tidak mendukung */ }
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { /* abaikan */ }
    throw e;
  }
}

function newId(type) {
  return `${type === 'design' ? 'd' : 'n'}_${crypto.randomBytes(5).toString('hex')}`;
}

function validateDesignJson(text) {
  let doc;
  try { doc = JSON.parse(text); } catch (_) { throw new StorageError('INVALID_DESIGN', 'Berkas desain bukan JSON yang valid.'); }
  if (!doc || typeof doc !== 'object' || doc.format !== 'canvaset-design') {
    throw new StorageError('INVALID_DESIGN', 'Berkas ini bukan proyek desain Canvaset.');
  }
  const p = doc.page;
  if (!p || !Number.isFinite(p.width) || !Number.isFinite(p.height) || p.width < 16 || p.height < 16 || p.width > 16000 || p.height > 16000) {
    throw new StorageError('INVALID_DESIGN', 'Ukuran halaman desain tidak valid.');
  }
  if (!Array.isArray(doc.elements) || doc.elements.length > LIMITS.elements) {
    throw new StorageError('INVALID_DESIGN', `Jumlah elemen tidak valid (maksimum ${LIMITS.elements}).`);
  }
  for (const el of doc.elements) {
    if (!el || typeof el.id !== 'string' || !ELEMENT_TYPES.has(el.type)) {
      throw new StorageError('INVALID_DESIGN', 'Ada elemen desain yang rusak.');
    }
  }
  return doc;
}

function collectDesignText(doc) {
  const out = [];
  for (const el of doc.elements || []) {
    if (el.type === 'text' && typeof el.text === 'string') out.push(el.text);
    if (typeof el.name === 'string') out.push(el.name);
  }
  return out.join('\n');
}

function makeSnippet(text) {
  return String(text).replace(/[#>*_`\[\]\-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
}

class Storage {
  constructor(root) {
    this.root = path.resolve(root);
    this.dirs = {
      notes: path.join(this.root, 'notes'),
      designs: path.join(this.root, 'designs'),
      assets: path.join(this.root, 'assets'),
      backups: path.join(this.root, 'backups'),
      recovery: path.join(this.root, 'recovery'),
      trash: path.join(this.root, 'trash'),
      config: path.join(this.root, 'config'),
    };
    this.indexFile = path.join(this.dirs.config, 'library.json');
    this.settingsFile = path.join(this.dirs.config, 'settings.json');
    this.index = { version: 1, items: {}, collections: {} };
    this._backupClock = new Map();
    this._indexTimer = null;
    this._searchCache = new Map();
    this.warnings = [];
  }

  init() {
    for (const d of Object.values(this.dirs)) fs.mkdirSync(d, { recursive: true });
    this._loadIndex();
    this._reconcile();
    this.flush();
    return this;
  }

  /* ------------------------------ indeks ------------------------------ */
  _loadIndex() {
    const tryRead = (file) => {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || typeof parsed.items !== 'object') throw new Error('format');
      return { version: 1, items: parsed.items || {}, collections: parsed.collections || {} };
    };
    if (fs.existsSync(this.indexFile)) {
      try { this.index = tryRead(this.indexFile); return; } catch (_) {
        this.warnings.push('Indeks pustaka rusak; mencoba memulihkan dari cadangan.');
        try { fs.copyFileSync(this.indexFile, `${this.indexFile}.corrupt-${Date.now()}`); } catch (_) { /* abaikan */ }
      }
      const bak = `${this.indexFile}.bak`;
      if (fs.existsSync(bak)) {
        try { this.index = tryRead(bak); return; } catch (_) { /* lanjut dibangun ulang */ }
      }
    }
    this.index = { version: 1, items: {}, collections: {} };
  }

  _saveIndexNow() {
    if (this._indexTimer) { clearTimeout(this._indexTimer); this._indexTimer = null; }
    if (fs.existsSync(this.indexFile)) {
      try { fs.copyFileSync(this.indexFile, `${this.indexFile}.bak`); } catch (_) { /* abaikan */ }
    }
    atomicWrite(this.indexFile, JSON.stringify(this.index));
  }

  _saveIndexSoon() {
    if (this._indexTimer) return;
    this._indexTimer = setTimeout(() => {
      this._indexTimer = null;
      try { this._saveIndexNow(); } catch (e) { this.warnings.push(`Gagal menyimpan indeks: ${e.message}`); }
    }, 400);
    if (this._indexTimer.unref) this._indexTimer.unref();
  }

  flush() {
    if (this._indexTimer) this._saveIndexNow();
    else if (!fs.existsSync(this.indexFile)) this._saveIndexNow();
  }

  /** Samakan indeks dengan isi folder (berkas baru muncul, berkas hilang dibuang). */
  _reconcile() {
    const known = { note: new Set(), design: new Set() };
    for (const [id, it] of Object.entries(this.index.items)) {
      const dir = it.type === 'design' ? this.dirs.designs : this.dirs.notes;
      if (!fs.existsSync(path.join(dir, it.file))) {
        delete this.index.items[id];
        this.warnings.push(`Berkas "${it.file}" tidak ditemukan; dihapus dari pustaka.`);
      } else known[it.type].add(it.file);
    }
    const scan = (dir, type, exts) => {
      for (const f of fs.readdirSync(dir)) {
        const ext = path.extname(f).toLowerCase();
        if (!exts.includes(ext) || known[type].has(f) || f.includes('.tmp-')) continue;
        const full = path.join(dir, f);
        let st;
        try { st = fs.statSync(full); } catch (_) { continue; }
        if (!st.isFile()) continue;
        const id = newId(type);
        this.index.items[id] = {
          id, type, title: path.basename(f, ext), file: f, ext, pinned: false, collection: null,
          created: st.birthtimeMs || st.mtimeMs, updated: st.mtimeMs, opened: 0, size: st.size, snippet: '',
        };
      }
    };
    scan(this.dirs.notes, 'note', NOTE_EXTS);
    scan(this.dirs.designs, 'design', [DESIGN_EXT]);
    for (const it of Object.values(this.index.items)) {
      if (it.collection && !this.index.collections[it.collection]) it.collection = null;
    }
  }

  /* ------------------------------ utilitas ------------------------------ */
  _dirFor(type) { return type === 'design' ? this.dirs.designs : this.dirs.notes; }

  _resolve(it) {
    const full = path.resolve(this._dirFor(it.type), it.file);
    if (!full.startsWith(this._dirFor(it.type) + path.sep)) throw new StorageError('PATH', 'Lokasi berkas tidak valid.');
    return full;
  }

  _get(id) {
    if (typeof id !== 'string' || !ID_RE.test(id)) throw new StorageError('BAD_ID', 'ID item tidak valid.');
    const it = this.index.items[id];
    if (!it) throw new StorageError('NOT_FOUND', 'Item tidak ditemukan. Mungkin sudah dihapus atau dipindahkan.');
    return it;
  }

  _uniqueFile(dir, base, ext, ignoreFile) {
    let name = `${base}${ext}`;
    let n = 2;
    while (fs.existsSync(path.join(dir, name)) && name !== ignoreFile) {
      name = `${base} (${n++})${ext}`;
    }
    return name;
  }

  _cleanTitle(title) {
    const t = String(title == null ? '' : title).replace(/[\u0000-\u001f]/g, '').trim().slice(0, LIMITS.titleChars);
    return t || 'Tanpa judul';
  }

  _backup(it, full) {
    const last = this._backupClock.get(it.id) || 0;
    if (Date.now() - last < BACKUP_MIN_INTERVAL_MS || !fs.existsSync(full)) return;
    const dir = path.join(this.dirs.backups, it.id);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(full, path.join(dir, `${stamp}${it.ext}`));
    this._backupClock.set(it.id, Date.now());
    const files = fs.readdirSync(dir).sort();
    while (files.length > BACKUP_KEEP) {
      try { fs.unlinkSync(path.join(dir, files.shift())); } catch (_) { break; }
    }
  }

  /* ------------------------------ item ------------------------------ */
  list() {
    return Object.values(this.index.items).map((it) => ({ ...it })).sort((a, b) => b.updated - a.updated);
  }

  getMeta(id) { return { ...this._get(id) }; }

  create({ type, title, ext, collection, content }) {
    if (type !== 'note' && type !== 'design') throw new StorageError('BAD_TYPE', 'Jenis item tidak dikenal.');
    const cleanTitle = this._cleanTitle(title);
    const dir = this._dirFor(type);
    let fileExt;
    let body;
    if (type === 'note') {
      fileExt = NOTE_EXTS.includes(ext) ? ext : '.md';
      body = typeof content === 'string' ? content : '';
      if (Buffer.byteLength(body) > LIMITS.noteBytes) throw new StorageError('TOO_LARGE', 'Isi catatan terlalu besar (maksimum 10 MB).');
    } else {
      fileExt = DESIGN_EXT;
      if (typeof content !== 'string') throw new StorageError('INVALID_DESIGN', 'Isi desain tidak ada.');
      validateDesignJson(content);
      body = content;
    }
    if (collection && !this.index.collections[collection]) throw new StorageError('NOT_FOUND', 'Koleksi tidak ditemukan.');
    const file = this._uniqueFile(dir, sanitizeFileName(cleanTitle), fileExt);
    atomicWrite(path.join(dir, file), body);
    const id = newId(type);
    const now = Date.now();
    const it = {
      id, type, title: cleanTitle, file, ext: fileExt, pinned: false, collection: collection || null,
      created: now, updated: now, opened: now, size: Buffer.byteLength(body), snippet: type === 'note' ? makeSnippet(body) : '',
    };
    this.index.items[id] = it;
    this._saveIndexSoon();
    return { ...it };
  }

  read(id) {
    const it = this._get(id);
    const full = this._resolve(it);
    let content;
    try { content = fs.readFileSync(full, 'utf8'); } catch (e) {
      throw new StorageError('READ_FAILED', `Tidak dapat membuka berkas: ${e.code || e.message}`);
    }
    if (it.type === 'design') {
      try { validateDesignJson(content); } catch (e) {
        // Coba cadangan terbaru jika berkas utama rusak.
        const dir = path.join(this.dirs.backups, it.id);
        let restored = null;
        if (fs.existsSync(dir)) {
          for (const f of fs.readdirSync(dir).sort().reverse()) {
            try { const c = fs.readFileSync(path.join(dir, f), 'utf8'); validateDesignJson(c); restored = c; break; } catch (_) { /* coba berikutnya */ }
          }
        }
        if (!restored) throw e;
        content = restored;
        this.warnings.push(`Berkas "${it.file}" rusak; dibuka dari cadangan terbaru.`);
      }
    }
    it.opened = Date.now();
    this._saveIndexSoon();
    const draft = this._readDraft(id);
    const st = fs.statSync(full);
    const recovery = draft && draft.savedAt > st.mtimeMs && draft.content !== content ? draft : null;
    return { meta: { ...it }, content, recovery };
  }

  write(id, content, opts = {}) {
    const it = this._get(id);
    if (typeof content !== 'string') throw new StorageError('BAD_CONTENT', 'Isi berkas tidak valid.');
    const bytes = Buffer.byteLength(content);
    if (it.type === 'note' && bytes > LIMITS.noteBytes) throw new StorageError('TOO_LARGE', 'Catatan melebihi 10 MB dan tidak dapat disimpan.');
    if (it.type === 'design') {
      if (bytes > LIMITS.designBytes) throw new StorageError('TOO_LARGE', 'Desain melebihi 50 MB dan tidak dapat disimpan.');
      validateDesignJson(content);
    }
    const full = this._resolve(it);
    try { this._backup(it, full); } catch (_) { /* cadangan gagal tidak boleh menggagalkan simpan */ }
    try { atomicWrite(full, content); } catch (e) {
      throw new StorageError('WRITE_FAILED', `Gagal menulis berkas (${e.code || e.message}). Periksa ruang disk dan izin folder.`);
    }
    it.updated = Date.now();
    it.size = bytes;
    if (it.type === 'note') it.snippet = makeSnippet(content);
    if (it.type === 'design' && typeof opts.thumb === 'string' && opts.thumb.length <= LIMITS.thumbChars) it.thumb = opts.thumb;
    this._searchCache.delete(id);
    this._saveIndexSoon();
    this.clearDraft(id);
    return { ...it };
  }

  rename(id, title) {
    const it = this._get(id);
    const cleanTitle = this._cleanTitle(title);
    const dir = this._dirFor(it.type);
    const base = sanitizeFileName(cleanTitle);
    if (path.basename(it.file, it.ext) !== base) {
      const file = this._uniqueFile(dir, base, it.ext, it.file);
      if (file !== it.file) {
        try { fs.renameSync(this._resolve(it), path.join(dir, file)); } catch (e) {
          throw new StorageError('WRITE_FAILED', `Gagal mengganti nama berkas (${e.code || e.message}).`);
        }
        it.file = file;
      }
    }
    it.title = cleanTitle;
    it.updated = Date.now();
    this._searchCache.delete(id);
    this._saveIndexSoon();
    return { ...it };
  }

  /** Ubah ekstensi catatan (.txt <-> .md). */
  convertNote(id, ext) {
    const it = this._get(id);
    if (it.type !== 'note' || !NOTE_EXTS.includes(ext)) throw new StorageError('BAD_TYPE', 'Hanya catatan yang dapat diubah formatnya.');
    if (it.ext === ext) return { ...it };
    const file = this._uniqueFile(this.dirs.notes, sanitizeFileName(it.title), ext);
    fs.renameSync(this._resolve(it), path.join(this.dirs.notes, file));
    it.file = file;
    it.ext = ext;
    this._saveIndexSoon();
    return { ...it };
  }

  setMeta(id, patch) {
    const it = this._get(id);
    if (patch && typeof patch.pinned === 'boolean') it.pinned = patch.pinned;
    if (patch && 'collection' in patch) {
      if (patch.collection !== null && !this.index.collections[patch.collection]) throw new StorageError('NOT_FOUND', 'Koleksi tidak ditemukan.');
      it.collection = patch.collection;
    }
    this._saveIndexSoon();
    return { ...it };
  }

  duplicate(id) {
    const it = this._get(id);
    const { content } = this.read(id);
    const copy = this.create({
      type: it.type, title: `${it.title} (salinan)`, ext: it.ext, collection: it.collection, content,
    });
    if (it.thumb) { this.index.items[copy.id].thumb = it.thumb; }
    return this.getMeta(copy.id);
  }

  remove(id) {
    const it = this._get(id);
    const full = this._resolve(it);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    try {
      if (fs.existsSync(full)) fs.renameSync(full, path.join(this.dirs.trash, `${stamp}__${it.file}`));
    } catch (e) {
      throw new StorageError('WRITE_FAILED', `Gagal memindahkan ke tempat sampah (${e.code || e.message}).`);
    }
    delete this.index.items[id];
    this.clearDraft(id);
    this._searchCache.delete(id);
    this._saveIndexSoon();
    return true;
  }

  pathOf(id) { return this._resolve(this._get(id)); }

  /* ------------------------------ koleksi ------------------------------ */
  collections() { return Object.values(this.index.collections).sort((a, b) => a.created - b.created).map((c) => ({ ...c })); }

  createCollection(name) {
    const n = String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, LIMITS.collectionName);
    if (!n) throw new StorageError('BAD_NAME', 'Nama koleksi tidak boleh kosong.');
    if (Object.values(this.index.collections).some((c) => c.name.toLowerCase() === n.toLowerCase())) {
      throw new StorageError('DUPLICATE', 'Koleksi dengan nama itu sudah ada.');
    }
    const id = `c_${crypto.randomBytes(4).toString('hex')}`;
    this.index.collections[id] = { id, name: n, created: Date.now() };
    this._saveIndexSoon();
    return { ...this.index.collections[id] };
  }

  renameCollection(id, name) {
    const c = this.index.collections[id];
    if (!c) throw new StorageError('NOT_FOUND', 'Koleksi tidak ditemukan.');
    const n = String(name || '').trim().slice(0, LIMITS.collectionName);
    if (!n) throw new StorageError('BAD_NAME', 'Nama koleksi tidak boleh kosong.');
    c.name = n;
    this._saveIndexSoon();
    return { ...c };
  }

  deleteCollection(id) {
    if (!this.index.collections[id]) throw new StorageError('NOT_FOUND', 'Koleksi tidak ditemukan.');
    delete this.index.collections[id];
    for (const it of Object.values(this.index.items)) if (it.collection === id) it.collection = null;
    this._saveIndexSoon();
    return true;
  }

  /* ------------------------------ draf pemulihan ------------------------------ */
  _draftFile(id) { return path.join(this.dirs.recovery, `${id}.json`); }

  writeDraft(id, content) {
    this._get(id);
    if (typeof content !== 'string' || content.length > 60 * 1024 * 1024) return false;
    atomicWrite(this._draftFile(id), JSON.stringify({ id, content, savedAt: Date.now() }));
    return true;
  }

  _readDraft(id) {
    try { return JSON.parse(fs.readFileSync(this._draftFile(id), 'utf8')); } catch (_) { return null; }
  }

  clearDraft(id) {
    if (!ID_RE.test(id)) return;
    try { fs.unlinkSync(this._draftFile(id)); } catch (_) { /* tidak ada draf */ }
  }

  listDrafts() {
    const out = [];
    for (const f of fs.readdirSync(this.dirs.recovery)) {
      if (!f.endsWith('.json')) continue;
      const id = f.slice(0, -5);
      const it = this.index.items[id];
      if (!it) { try { fs.unlinkSync(path.join(this.dirs.recovery, f)); } catch (_) { /* abaikan */ } continue; }
      const draft = this._readDraft(id);
      if (!draft) continue;
      let diskContent = null;
      let mtime = 0;
      try { const full = this._resolve(it); diskContent = fs.readFileSync(full, 'utf8'); mtime = fs.statSync(full).mtimeMs; } catch (_) { /* hilang */ }
      if (diskContent === draft.content || draft.savedAt <= mtime) { this.clearDraft(id); continue; }
      out.push({ id, title: it.title, type: it.type, savedAt: draft.savedAt });
    }
    return out;
  }

  restoreDraft(id) {
    const draft = this._readDraft(id);
    if (!draft) throw new StorageError('NOT_FOUND', 'Draf pemulihan tidak ditemukan.');
    return this.write(id, draft.content);
  }

  /* ------------------------------ aset gambar ------------------------------ */
  addAsset(buffer, mime) {
    const ext = IMAGE_MIME[mime];
    if (!ext) throw new StorageError('BAD_MIME', 'Format gambar tidak didukung. Gunakan PNG, JPEG, WebP, GIF, atau SVG.');
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new StorageError('BAD_CONTENT', 'Berkas gambar kosong.');
    if (buffer.length > LIMITS.assetBytes) throw new StorageError('TOO_LARGE', 'Gambar terlalu besar (maksimum 25 MB).');
    const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 16);
    const assetId = `${hash}${ext}`;
    const full = path.join(this.dirs.assets, assetId);
    if (!fs.existsSync(full)) atomicWrite(full, buffer);
    return { assetId, mime, bytes: buffer.length };
  }

  readAsset(assetId) {
    if (typeof assetId !== 'string' || !ASSET_ID_RE.test(assetId)) throw new StorageError('BAD_ID', 'ID aset tidak valid.');
    const full = path.join(this.dirs.assets, assetId);
    let data;
    try { data = fs.readFileSync(full); } catch (_) { throw new StorageError('NOT_FOUND', 'Berkas gambar tidak ditemukan.'); }
    const ext = path.extname(assetId);
    const mime = Object.keys(IMAGE_MIME).find((m) => IMAGE_MIME[m] === ext);
    return { data, mime };
  }

  /* ------------------------------ pencarian ------------------------------ */
  search(query, limit = 40) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const results = [];
    for (const it of Object.values(this.index.items)) {
      let score = 0;
      let snippet = it.snippet || '';
      const title = it.title.toLowerCase();
      if (title === q) score += 100;
      else if (title.startsWith(q)) score += 60;
      else if (title.includes(q)) score += 40;
      let body = this._searchCache.get(it.id);
      if (body === undefined) {
        try {
          const raw = fs.readFileSync(this._resolve(it), 'utf8');
          body = it.type === 'design' ? collectDesignText(JSON.parse(raw)) : raw;
        } catch (_) { body = ''; }
        this._searchCache.set(it.id, body);
      }
      const at = body.toLowerCase().indexOf(q);
      if (at >= 0) {
        score += 10;
        const from = Math.max(0, at - 40);
        snippet = (from > 0 ? '…' : '') + body.slice(from, at + q.length + 80).replace(/\s+/g, ' ');
      }
      if (score > 0) results.push({ id: it.id, type: it.type, title: it.title, snippet, score, updated: it.updated, matchIn: title.includes(q) ? 'title' : 'content' });
    }
    results.sort((a, b) => b.score - a.score || b.updated - a.updated);
    return results.slice(0, limit);
  }

  /* ------------------------------ pengaturan ------------------------------ */
  getSettings() {
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(this.settingsFile, 'utf8')); } catch (_) { /* default */ }
    const out = { ...DEFAULT_SETTINGS };
    for (const [k, rule] of Object.entries(SETTING_RULES)) if (k in saved && rule(saved[k])) out[k] = saved[k];
    return out;
  }

  setSettings(patch) {
    const cur = this.getSettings();
    for (const [k, v] of Object.entries(patch || {})) {
      if (!(k in SETTING_RULES)) throw new StorageError('BAD_SETTING', `Pengaturan "${k}" tidak dikenal.`);
      if (!SETTING_RULES[k](v)) throw new StorageError('BAD_SETTING', `Nilai untuk "${k}" tidak valid.`);
      cur[k] = v;
    }
    atomicWrite(this.settingsFile, JSON.stringify(cur, null, 2));
    return cur;
  }
}

module.exports = {
  Storage, StorageError, LIMITS, IMAGE_MIME, DEFAULT_SETTINGS,
  sanitizeFileName, atomicWrite, validateDesignJson,
};
