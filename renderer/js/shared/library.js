// State klien: pustaka (daftar item + koleksi) dan pengaturan. Sumber kebenaran tetap di proses utama.
import { bus } from './bus.js';
import { contrastInk } from './util.js';

export const api = window.canvaset;

export const state = {
  items: [],
  collections: [],
  settings: null,
  info: null,
};

export async function refreshLibrary() {
  const r = await api.listLibrary();
  state.items = r.items;
  state.collections = r.collections;
  bus.emit('library:changed');
}

export const getItem = (id) => state.items.find((i) => i.id === id) || null;
export const getCollection = (id) => state.collections.find((c) => c.id === id) || null;

/** Memperbarui satu item secara lokal (mis. setelah simpan otomatis) tanpa memuat ulang semuanya. */
export function patchItem(meta) {
  const i = state.items.findIndex((x) => x.id === meta.id);
  if (i >= 0) state.items[i] = { ...state.items[i], ...meta };
  else state.items.unshift(meta);
  bus.emit('library:changed');
}

export function dropItem(id) {
  state.items = state.items.filter((i) => i.id !== id);
  bus.emit('library:changed');
}

export function recentItems(n = 8) {
  return [...state.items].sort((a, b) => (b.opened || 0) - (a.opened || 0)).slice(0, n);
}

const EDITOR_FONTS = {
  sans: "'Inter', 'Segoe UI', system-ui, sans-serif",
  serif: "'Lora', Georgia, 'Times New Roman', serif",
  mono: "'JetBrains Mono', Consolas, 'Courier New', monospace",
};

export function applySettings(settings) {
  state.settings = settings;
  const root = document.documentElement;
  root.setAttribute('data-theme', settings.theme);
  root.style.setProperty('--accent', settings.accent);
  root.style.setProperty('--accent-ink', contrastInk(settings.accent));
  root.style.setProperty('--editor-font', EDITOR_FONTS[settings.editorFont] || EDITOR_FONTS.sans);
  root.style.setProperty('--editor-size', `${settings.fontSize}px`);
  root.style.setProperty('--read-width', `${settings.readWidth}px`);
  bus.emit('settings:changed', settings);
}

export async function updateSettings(patch) {
  const s = await api.setSettings(patch);
  applySettings(s);
  return s;
}
