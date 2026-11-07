// Wiederverwendbare Regler. Jede Geste ergibt genau einen Undo-Schritt.
'use strict';
(() => {
    const { el, clamp, bus } = WD;
    const NS = 'http://www.w3.org/2000/svg';
    const svgEl = (tag, attrs) => {
        const n = document.createElementNS(NS, tag);
        Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
        return n;
    };
    const A0 = -135, A1 = 135;
    const polar = (cx, cy, r, deg) => {
        const a = (deg - 90) * Math.PI / 180;
        return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    };
    function arc(cx, cy, r, a, b) {
        if (Math.abs(b - a) < 0.5) return '';
        const [x0, y0] = polar(cx, cy, r, Math.min(a, b)), [x1, y1] = polar(cx, cy, r, Math.max(a, b));
        return `M${x0} ${y0}A${r} ${r} 0 ${Math.abs(b - a) > 180 ? 1 : 0} 1 ${x1} ${y1}`;
    }

    // opts: label, min, max, def, get(), set(v), fmt(v), size ('sm'|'md'|''), historyLabel, tip
    function knob(opts) {
        const { min = 0, max = 1, def = min, get, set, fmt, size = '', label, tip, historyLabel } = opts;
        const svg = svgEl('svg', { viewBox: '0 0 44 44' });
        const track = svgEl('path', { class: 'k-track', d: arc(22, 22, 19, A0, A1) });
        const val = svgEl('path', { class: 'k-val' });
        const body = svgEl('circle', { class: 'k-body', cx: 22, cy: 22, r: 14 });
        const ptr = svgEl('line', { class: 'k-ptr' });
        svg.append(track, val, body, ptr);
        const valueEl = size === 'sm' ? null : el('div', { class: 'k-value' });
        const root = el('div', {
            class: 'knob' + (size ? ' ' + size : ''), tabIndex: 0, role: 'slider',
            'aria-label': label || historyLabel || '', 'data-tip': tip || (size === 'sm' && label) || null,
        }, svg, label && size !== 'sm' ? el('div', { class: 'k-label' }, label) : null, valueEl);

        function redraw() {
            const v = get();
            const f = (clamp(v, min, max) - min) / (max - min);
            const deg = A0 + f * (A1 - A0);
            const zero = min < 0 && max > 0 ? A0 + (0 - min) / (max - min) * (A1 - A0) : A0;
            val.setAttribute('d', arc(22, 22, 19, zero, deg));
            const [x0, y0] = polar(22, 22, 6, deg), [x1, y1] = polar(22, 22, 12.5, deg);
            ptr.setAttribute('x1', x0); ptr.setAttribute('y1', y0); ptr.setAttribute('x2', x1); ptr.setAttribute('y2', y1);
            const text = fmt ? fmt(v) : Math.round(f * 100) + ' %';
            if (valueEl) valueEl.textContent = text;
            root.setAttribute('aria-valuetext', text);
        }
        function commit(v) { set(clamp(v, min, max)); redraw(); bus.emit('mix'); }
        const once = (fn) => WD.history.run(historyLabel || label || 'Regler', fn);

        svg.addEventListener('pointerdown', e => {
            e.preventDefault(); root.focus({ preventScroll: true });
            svg.setPointerCapture(e.pointerId);
            const tx = WD.history.begin(historyLabel || label || 'Regler');
            const y0 = e.clientY, x0 = e.clientX, start = get();
            const onMove = ev => {
                const delta = (y0 - ev.clientY + (ev.clientX - x0)) / (ev.shiftKey ? 600 : 150);
                commit(start + delta * (max - min));
            };
            const onUp = () => {
                svg.removeEventListener('pointermove', onMove);
                svg.removeEventListener('pointerup', onUp);
                svg.removeEventListener('pointercancel', onUp);
                tx.end();
            };
            svg.addEventListener('pointermove', onMove);
            svg.addEventListener('pointerup', onUp);
            svg.addEventListener('pointercancel', onUp);
        });
        svg.addEventListener('dblclick', () => once(() => commit(def)));
        root.addEventListener('wheel', e => {
            e.preventDefault();
            once(() => commit(get() - Math.sign(e.deltaY) * (max - min) * (e.shiftKey ? .005 : .02)));
        }, { passive: false });
        root.addEventListener('keydown', e => {
            const step = (max - min) * (e.shiftKey ? .01 : .05);
            if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); once(() => commit(get() + step)); }
            else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); once(() => commit(get() - step)); }
        });
        root.refresh = redraw;
        redraw();
        return root;
    }

    // Native Schieberegler mit Undo-Geste. Gibt danach den Fokus frei, damit die Tastatur aktiv bleibt.
    function slider(opts) {
        const { min = 0, max = 100, get, set, label, cls = 'slider', step } = opts;
        const inp = el('input', { type: 'range', class: cls, min, max, step: step || 1, 'aria-label': label });
        inp.value = get();
        let tx = null;
        inp.addEventListener('pointerdown', e => { e.stopPropagation(); tx = WD.history.begin(label || 'Regler'); });
        inp.addEventListener('input', () => { set(+inp.value); bus.emit('mix'); });
        const finish = () => { if (tx) { tx.end(); tx = null; } inp.blur(); };
        inp.addEventListener('pointerup', finish);
        inp.addEventListener('pointercancel', finish);
        inp.addEventListener('change', () => { if (!tx) bus.emit('dirty'); });
        inp.onclick = e => e.stopPropagation();
        inp.ondblclick = e => { e.stopPropagation(); if (opts.def !== undefined) WD.history.run(label || 'Regler', () => { inp.value = opts.def; set(opts.def); bus.emit('mix'); }); };
        inp.refresh = () => { inp.value = get(); };
        return inp;
    }

    WD.controls = { knob, slider };
})();
