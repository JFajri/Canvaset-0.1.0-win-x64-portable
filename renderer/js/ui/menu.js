import { h } from '../shared/util.js';
import { icon } from './icons.js';

let active = null;

export function closeMenu() {
  if (!active) return;
  active.cleanup();
  active = null;
}

/**
 * items: [{ label, icon, kbd, danger, disabled, onSelect }, { separator: true }, { heading: 'Teks' }]
 * at: { x, y } atau elemen jangkar.
 */
export function showMenu(items, at) {
  closeMenu();
  const prevFocus = document.activeElement;
  const buttons = [];
  const menu = h('div', { class: 'menu', role: 'menu' }, items.map((it) => {
    if (it.separator) return h('div', { class: 'menu-sep', role: 'separator' });
    if (it.heading) return h('div', { class: 'menu-label' }, it.heading);
    const b = h('button', {
      class: `menu-item${it.danger ? ' danger' : ''}`, type: 'button', role: 'menuitem', disabled: !!it.disabled,
      onClick: () => { closeMenu(); if (it.onSelect) it.onSelect(); },
    }, it.icon ? icon(it.icon, 16) : null, h('span', null, it.label), it.kbd ? h('span', { class: 'kbd' }, it.kbd) : null);
    buttons.push(b);
    return b;
  }));
  document.body.appendChild(menu);

  let x; let y;
  if (at instanceof Element) {
    const r = at.getBoundingClientRect();
    x = r.left; y = r.bottom + 6;
  } else { x = at.x; y = at.y; }
  const mw = menu.offsetWidth; const mh = menu.offsetHeight;
  x = Math.max(8, Math.min(x, window.innerWidth - mw - 8));
  y = Math.max(8, Math.min(y, window.innerHeight - mh - 8));
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const onDown = (e) => { if (!menu.contains(e.target)) closeMenu(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const enabled = buttons.filter((b) => !b.disabled);
      if (!enabled.length) return;
      const i = enabled.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % enabled.length : (i <= 0 ? enabled.length - 1 : i - 1);
      enabled[next].focus();
    }
  };
  const onBlur = () => closeMenu();
  document.addEventListener('mousedown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', onBlur);
  active = {
    cleanup() {
      menu.remove();
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
      if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
    },
  };
  const first = buttons.find((b) => !b.disabled);
  if (first) first.focus({ preventScroll: true });
  return menu;
}
