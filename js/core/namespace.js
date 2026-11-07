// Gemeinsamer Namensraum aller Module (klassische Skripte, damit die DAW auch per Doppelklick läuft).
'use strict';
window.WD = (() => {
    const listeners = new Map();
    const bus = {
        on(evt, fn) {
            if (!listeners.has(evt)) listeners.set(evt, new Set());
            listeners.get(evt).add(fn);
            return () => listeners.get(evt).delete(fn);
        },
        emit(evt, ...args) {
            const set = listeners.get(evt);
            if (set) set.forEach(fn => fn(...args));
        },
    };

    // DOM-Helfer: Texte werden immer als Textknoten eingefügt, nie als HTML.
    function el(tag, attrs, ...kids) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (v === undefined || v === null || v === false) continue;
            if (k === 'class') node.className = v;
            else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
            else if (k === 'dataset') Object.assign(node.dataset, v);
            else if (k.startsWith('on') && typeof v === 'function') node[k] = v;
            else if (k in node && k !== 'list') node[k] = v;
            else node.setAttribute(k, v);
        }
        for (const kid of kids.flat()) {
            if (kid === null || kid === undefined || kid === false) continue;
            node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
        }
        return node;
    }

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const $ = id => document.getElementById(id);
    const dbToGain = db => Math.pow(10, db / 20);
    const gainToDb = g => 20 * Math.log10(Math.max(g, 1e-6));
    const debounce = (fn, ms) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; };

    return { bus, el, clamp, uid, $, dbToGain, gainToDb, debounce };
})();
