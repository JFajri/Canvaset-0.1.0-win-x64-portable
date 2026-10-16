import { h, $ } from '../shared/util.js';

const root = () => $('#dialog-root');
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog modal generik.
 * buttons: [{ label, value, variant: 'primary'|'danger'|'ghost', validate?: () => boolean|Promise<boolean> }]
 * Mengembalikan Promise<value> — null jika dibatalkan (Esc / klik luar / tombol batal).
 */
export function openDialog({ title, description, body, buttons, wide = false, initialFocus, dismissable = true }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const titleId = `dlg-${Math.random().toString(36).slice(2, 8)}`;
    let closed = false;

    const close = (value) => {
      if (closed) return;
      closed = true;
      scrim.remove();
      document.removeEventListener('keydown', onKey, true);
      if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus();
      resolve(value);
    };

    const btnEls = (buttons || []).map((b) => h('button', {
      class: `btn ${b.variant === 'primary' ? 'btn-primary' : b.variant === 'danger' ? 'btn-danger' : b.variant === 'ghost' ? 'btn-ghost' : ''}`,
      type: 'button',
      dataset: { value: String(b.value) },
      onClick: async () => {
        if (b.validate && !(await b.validate())) return;
        close(b.value);
      },
    }, b.label));

    const dialog = h('div', { class: `dialog${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('div', { class: 'dialog-head' },
        h('h2', { id: titleId }, title),
        description ? h('p', null, description) : null),
      body ? h('div', { class: 'dialog-body' }, body) : null,
      btnEls.length ? h('div', { class: 'dialog-foot' }, btnEls) : null);

    const scrim = h('div', {
      class: 'scrim',
      onMousedown: (e) => { if (e.target === scrim && dismissable) close(null); },
    }, dialog);

    function onKey(e) {
      if (e.key === 'Escape' && dismissable) { e.stopPropagation(); close(null); return; }
      if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLSelectElement)) {
        const primary = dialog.querySelector('.btn-primary, .btn-danger');
        if (primary) { e.preventDefault(); primary.click(); }
        return;
      }
      if (e.key === 'Tab') {
        const items = Array.from(dialog.querySelectorAll(FOCUSABLE)).filter((x) => x.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!dialog.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKey, true);
    root().appendChild(scrim);

    const target = (initialFocus && dialog.querySelector(initialFocus))
      || dialog.querySelector('input:not([type=color]), select, textarea')
      || dialog.querySelector('.btn-primary, .btn-danger')
      || dialog.querySelector('button');
    if (target) { target.focus(); if (target.select && target.tagName === 'INPUT') target.select(); }
  });
}

export async function confirmDialog({ title, message, confirmLabel = 'Lanjutkan', cancelLabel = 'Batal', danger = false }) {
  const v = await openDialog({
    title, description: message,
    buttons: [
      { label: cancelLabel, value: false, variant: 'ghost' },
      { label: confirmLabel, value: true, variant: danger ? 'danger' : 'primary' },
    ],
  });
  return v === true;
}

export async function promptDialog({ title, label, value = '', placeholder = '', confirmLabel = 'Simpan', validate, description }) {
  const input = h('input', { class: 'input', type: 'text', value, placeholder, maxlength: '120', 'aria-label': label || title });
  const err = h('div', { class: 'error-text', hidden: true });
  const body = h('div', { class: 'field' }, label ? h('label', null, label) : null, input, err);
  const v = await openDialog({
    title, description, body, initialFocus: 'input',
    buttons: [
      { label: 'Batal', value: null, variant: 'ghost' },
      {
        label: confirmLabel, value: 'ok', variant: 'primary',
        validate: () => {
          const msg = validate ? validate(input.value.trim()) : (input.value.trim() ? null : 'Isian tidak boleh kosong.');
          err.hidden = !msg;
          err.textContent = msg || '';
          input.classList.toggle('is-invalid', !!msg);
          return !msg;
        },
      },
    ],
  });
  return v === 'ok' ? input.value.trim() : null;
}

export function alertDialog({ title, message, label = 'Mengerti' }) {
  return openDialog({ title, description: message, buttons: [{ label, value: true, variant: 'primary' }] });
}
