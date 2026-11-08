// Dialoge, Kontextmenüs, Toasts, Tooltips. Ersetzt prompt/alert/confirm.
'use strict';
(() => {
    const { el, $ } = WD;
    const root = () => $('overlayRoot');

    // --- Toasts ---
    let toastHost;
    function toast(msg, { type = 'info', ms, action } = {}) {
        if (!toastHost) { toastHost = el('div', { id: 'toasts' }); root().append(toastHost); }
        const t = el('div', { class: 'toast ' + type, role: 'status' }, msg);
        if (action) t.append(el('button', { onclick: () => { action.fn(); t.remove(); } }, action.label));
        toastHost.append(t);
        const life = ms !== undefined ? ms : (type === 'error' ? 8000 : 3000);
        if (life > 0) setTimeout(() => t.remove(), life);
        return t;
    }
    function busy(msg) {
        if (!toastHost) { toastHost = el('div', { id: 'toasts' }); root().append(toastHost); }
        const t = el('div', { class: 'toast' }, el('div', { class: 'busy-spin' }), msg);
        toastHost.append(t);
        return () => t.remove();
    }

    // --- Modale Dialoge ---
    function modal(build, { wide = false, onEscape } = {}) {
        const box = el('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' });
        const back = el('div', { class: 'modal-back' }, box);
        const close = () => { back.remove(); removeEventListener('keydown', onKey, true); };
        const onKey = e => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (onEscape) onEscape(); close(); }
            else e.stopPropagation();
        };
        addEventListener('keydown', onKey, true);
        // Ein Klick neben den Dialog schließt bewusst nichts; dafür gibt es die Knöpfe und Escape
        build(box, close);
        root().append(back);
        const first = box.querySelector('input[type=text]') || box.querySelector('button.primary') || box.querySelector('button');
        if (first) { first.focus(); if (first.select) first.select(); }
        return close;
    }
    const confirmDlg = (title, text, { ok = 'OK', cancel = 'Abbrechen', danger = false } = {}) => new Promise(res => {
        modal((box, close) => {
            box.append(el('h2', {}, title));
            if (text) box.append(el('p', {}, text));
            box.append(el('div', { class: 'modal-btns' },
                el('button', { onclick: () => { close(); res(false); } }, cancel),
                el('button', { class: danger ? 'danger primary' : 'primary', onclick: () => { close(); res(true); } }, ok)));
        }, { onEscape: () => res(false) });
    });
    const alertDlg = (title, text) => new Promise(res => {
        modal((box, close) => {
            box.append(el('h2', {}, title));
            if (text) box.append(el('p', {}, text));
            box.append(el('div', { class: 'modal-btns' }, el('button', { class: 'primary', onclick: () => { close(); res(); } }, 'OK')));
        }, { onEscape: () => res() });
    });
    const promptDlg = (title, value, { text, ok = 'OK', placeholder } = {}) => new Promise(res => {
        modal((box, close) => {
            const input = el('input', { type: 'text', value: value || '', placeholder });
            const submit = () => { close(); res(input.value.trim() || null); };
            input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
            box.append(el('h2', {}, title));
            if (text) box.append(el('p', {}, text));
            box.append(input, el('div', { class: 'modal-btns' },
                el('button', { onclick: () => { close(); res(null); } }, 'Abbrechen'),
                el('button', { class: 'primary', onclick: submit }, ok)));
        }, { onEscape: () => res(null) });
    });

    // --- Kontext-/Aufklappmenü ---
    let openMenuEl = null, openMenuOnClose = null;
    function closeMenu() {
        if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; }
        if (openMenuOnClose) { const f = openMenuOnClose; openMenuOnClose = null; f(); }
    }
    function menu(x, y, items, { onClose } = {}) {
        closeMenu();
        const box = el('div', { class: 'ctx-menu', role: 'menu' });
        items.filter(Boolean).forEach(it => {
            if (it.sep) { box.append(el('div', { class: 'ctx-sep' })); return; }
            if (it.colors) {
                const row = el('div', { class: 'ctx-colors' });
                it.colors.forEach(c => row.append(el('div', {
                    class: 'ctx-color', style: { background: c },
                    onclick: () => { closeMenu(); it.action(c); },
                })));
                box.append(row);
                return;
            }
            const row = el('div', {
                class: 'ctx-item' + (it.disabled ? ' disabled' : '') + (it.danger ? ' danger' : ''), role: 'menuitem',
                onclick: () => { closeMenu(); if (it.action) it.action(); },
            });
            if (it.checked !== undefined) row.append(el('span', { class: 'check' }, it.checked ? '✓' : ''));
            else if (it.icon) row.append(WD.icons.icon(it.icon));
            row.append(el('span', {}, it.label));
            if (it.shortcut) row.append(el('span', { class: 'sc' }, it.shortcut));
            box.append(row);
        });
        root().append(box);
        const r = box.getBoundingClientRect();
        box.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 6)) + 'px';
        box.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 6)) + 'px';
        openMenuEl = box;
        openMenuOnClose = onClose || null;
        return box;
    }
    addEventListener('pointerdown', e => {
        if (openMenuEl && !openMenuEl.contains(e.target) && !e.target.closest('.menu-btn')) closeMenu();
    }, true);
    addEventListener('keydown', e => {
        if (e.key === 'Escape' && openMenuEl) { e.stopPropagation(); closeMenu(); }
    }, true);

    // --- Tooltips (data-tip) ---
    let tipEl = null, tipTimer = null, tipFor = null;
    const hideTip = () => { clearTimeout(tipTimer); tipFor = null; if (tipEl) { tipEl.remove(); tipEl = null; } };
    document.addEventListener('pointerover', e => {
        const t = e.target.closest && e.target.closest('[data-tip]');
        if (t === tipFor) return;
        hideTip();
        if (!t) return;
        tipFor = t;
        tipTimer = setTimeout(() => {
            if (!t.isConnected) return;
            tipEl = el('div', { id: 'tooltip', role: 'tooltip' }, t.dataset.tip);
            root().append(tipEl);
            const r = t.getBoundingClientRect(), b = tipEl.getBoundingClientRect();
            tipEl.style.left = Math.max(4, Math.min(r.left + r.width / 2 - b.width / 2, innerWidth - b.width - 4)) + 'px';
            tipEl.style.top = (r.bottom + 6 + b.height > innerHeight ? r.top - b.height - 6 : r.bottom + 6) + 'px';
        }, 550);
    });
    document.addEventListener('pointerdown', hideTip, true);

    WD.ui = Object.assign(WD.ui || {}, {
        toast, busy, modal, menu, closeMenu,
        confirm: confirmDlg, alert: alertDlg, prompt: promptDlg,
        menuOpen: () => !!openMenuEl,
    });
})();
