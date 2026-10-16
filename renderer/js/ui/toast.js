import { h, $ } from '../shared/util.js';

/** Notifikasi singkat. type: 'info' | 'success' | 'error'. */
export function toast(message, { type = 'info', action, timeout } = {}) {
  const root = $('#toast-root');
  if (!root) return null;
  const el = h('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' },
    h('span', null, message),
    action ? h('button', { class: 'toast-action', type: 'button', onClick: () => { action.onClick(); dismiss(); } }, action.label) : null);
  const dismiss = () => el.remove();
  root.appendChild(el);
  const ms = timeout ?? (type === 'error' ? 7000 : action ? 6000 : 3200);
  setTimeout(dismiss, ms);
  while (root.children.length > 4) root.firstChild.remove();
  return dismiss;
}

export const toastError = (e, prefix) => {
  console.error(e);
  toast(prefix ? `${prefix}: ${e.message || e}` : (e.message || String(e)), { type: 'error' });
};
