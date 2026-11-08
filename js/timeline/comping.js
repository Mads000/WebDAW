// Takes aufklappen und zusammenschneiden. Unter der Region liegt je Take eine Zeile; Ziehen über eine Zeile
// übernimmt diesen Bereich aus dem Take, ein Klick den ganzen Take.
'use strict';
(() => {
    const { el, bus } = WD;
    const M = WD.model;
    const ROW = 34, MAX_CV = 4096;

    function isOpen(r) { return WD.view.takesOpen.has(r.id) && r.takes && r.takes.length > 1; }
    const extraHeight = t => t.regions.reduce((h, r) => (isOpen(r) ? Math.max(h, r.takes.length * ROW + 2) : h), 0);

    function segments(r) {
        if (r.comp && r.comp.length) return r.comp;
        const w = M.takeWindow(r);
        return [{ t0: w.t0, t1: w.t1, take: r.takeIdx || 0 }];
    }

    function changed() { bus.emit('regions'); bus.emit('audio:edited'); bus.emit('editor:refresh'); }

    // Ganzen Take wählen; der gezeigte Ausschnitt bleibt musikalisch an derselben Stelle
    function applyTake(r, i) {
        const tk = r.takes[i];
        const w = M.takeWindow(r);
        const off = w.t0 - M.takeStart(tk);
        if (off >= -1e-6) {
            r.takeIdx = i; r.bufId = tk.bufId; r.offset = Math.max(0, off); r.comp = null;
        } else {
            // Dieser Take beginnt erst nach dem Regionsanfang: vorne bleibt Stille statt zu verrutschen
            r.comp = [{ t0: w.t0, t1: w.t1, take: i }];
        }
    }

    function applyRange(r, take, a, b) {
        const w = M.takeWindow(r);
        // Bis auf wenige Millisekunden an den Rand gezogen heißt: bis zum Rand
        a = a - w.t0 < 0.02 ? w.t0 : a; b = w.t1 - b < 0.02 ? w.t1 : b;
        if (b <= a + 1e-3) return;
        const out = [];
        segments(r).forEach(s => {
            if (s.t1 <= a || s.t0 >= b) { out.push(Object.assign({}, s)); return; }
            if (s.t0 < a) out.push({ t0: s.t0, t1: a, take: s.take });
            if (s.t1 > b) out.push({ t0: b, t1: s.t1, take: s.take });
        });
        out.push({ t0: a, t1: b, take });
        out.sort((x, y) => x.t0 - y.t0);
        const merged = [];
        out.forEach(s => {
            const last = merged[merged.length - 1];
            if (last && last.take === s.take && Math.abs(last.t1 - s.t0) < 1e-6) last.t1 = s.t1;
            else merged.push(s);
        });
        if (merged.length === 1) { r.comp = null; applyTake(r, merged[0].take); }
        else r.comp = merged;
    }

    const C = WD.comping = {
        ROW, isOpen, extraHeight, segments,
        toggle(id) {
            const v = WD.view.takesOpen;
            if (v.has(id)) v.delete(id); else v.add(id);
            bus.emit('tracks');
        },
        selectTake(r, i) {
            WD.history.run('Take wählen', () => applyTake(r, i));
            changed();
        },
        selectRange(r, take, a, b) {
            WD.history.run('Comping', () => applyRange(r, take, a, b));
            changed();
        },
    };

    function drawTake(cv, r, idx, w, h, color) {
        const dpr = Math.min(devicePixelRatio || 1, 2), bw = Math.min(MAX_CV, Math.ceil(w * dpr));
        cv.width = bw; cv.height = Math.ceil(h * dpr);
        const g = cv.getContext('2d');
        g.setTransform(bw / w, 0, 0, dpr, 0, 0);
        const win = M.takeWindow(r), span = win.t1 - win.t0;
        const segs = segments(r).filter(s => s.take === idx);
        const tk = r.takes[idx], buf = WD.audioStore.get(tk.bufId), peaks = WD.audioStore.peaks(tk.bufId);
        const xOf = t => (t - win.t0) / span * w;
        g.fillStyle = color; g.globalAlpha = .85;
        segs.forEach(s => g.fillRect(xOf(s.t0), 0, xOf(s.t1) - xOf(s.t0), h));
        g.globalAlpha = 1;
        if (!peaks) return;
        const start = M.takeStart(tk), bin = WD.audioStore.BIN, sr = buf.sampleRate, total = peaks.length / 2;
        const mid = h / 2, amp = h / 2 - 2;
        for (let x = 0; x < w; x++) {
            const t = win.t0 + x / w * span;
            const i0 = Math.floor((t - start) * sr / bin), i1 = Math.max(i0 + 1, Math.ceil((t + span / w - start) * sr / bin));
            if (i0 < 0 || i0 >= total) continue;
            let mn = 1, mx = -1;
            for (let i = i0; i < i1 && i < total; i++) {
                if (peaks[i * 2] < mn) mn = peaks[i * 2];
                if (peaks[i * 2 + 1] > mx) mx = peaks[i * 2 + 1];
            }
            g.fillStyle = segs.some(s => t >= s.t0 && t < s.t1) ? 'rgba(255,255,255,.92)' : 'rgba(150,155,165,.65)';
            g.fillRect(x, mid - mx * amp, 1, Math.max(1, (mx - mn) * amp));
        }
    }

    // Wird von lanes.js je Region aufgerufen; legt das Feld an, aktualisiert oder entfernt es
    C.sync = (c, tr, r, lane) => {
        if (!isOpen(r)) {
            if (c.panel) { c.panel.remove(); c.panel = null; c.panelKey = ''; }
            return;
        }
        const ppb = WD.view.ppb, bars = M.isLooped(r) ? r.loopLen : r.lengthBars;
        const w = Math.max(40, bars * ppb - 1);
        if (!c.panel) {
            c.panel = el('div', { class: 'takes-panel', dataset: { id: r.id } });
            c.panelKey = '';
        }
        if (c.panel.parentElement !== lane) lane.append(c.panel);
        c.panel.style.left = r.startBar * ppb + 'px';
        c.panel.style.top = WD.view.rowH + 'px';
        c.panel.style.width = w + 'px';
        const key = [w, tr.color, WD.project.bpm, r.offset, r.rate, r.takeIdx, JSON.stringify(r.comp || 0)].join('|');
        if (key === c.panelKey) return;
        c.panelKey = key;
        c.panel.textContent = '';
        const active = !(r.comp && r.comp.length) ? (r.takeIdx || 0) : -1;
        r.takes.forEach((_, i) => {
            const cv = el('canvas');
            c.panel.append(el('div', { class: 'take-row' + (i === active ? ' on' : ''), dataset: { take: i } },
                cv, el('span', { class: 'take-name' }, `Take ${i + 1}`)));
            cv.style.width = w + 'px';
            drawTake(cv, r, i, w, ROW - 2, tr.color);
        });
    };

    // Ziehen über eine Take-Zeile
    const rows = WD.$('trackRows');
    rows.addEventListener('pointerdown', e => {
        const row = e.target.closest && e.target.closest('.take-row');
        if (!row || e.button !== 0) return;
        e.preventDefault();
        const panel = row.parentElement;
        const f = M.findRegion(panel.dataset.id);
        if (!f) return;
        const r = f.region, take = +row.dataset.take;
        const rect = panel.getBoundingClientRect();
        const win = M.takeWindow(r), secPerPx = M.secPerBar() * (r.rate || 1) / WD.view.ppb;
        const toX = (ev, snap) => {
            let bar = r.startBar + (ev.clientX - rect.left) / WD.view.ppb;
            if (snap) bar = WD.timeline.snap(bar, ev);
            return Math.max(0, Math.min(rect.width, (bar - r.startBar) * WD.view.ppb));
        };
        const x0 = toX(e, true), px0 = e.clientX;
        const mark = el('div', { class: 'take-sel' });
        row.append(mark);
        let dragged = false, x1 = x0;
        const show = () => { mark.style.left = Math.min(x0, x1) + 'px'; mark.style.width = Math.abs(x1 - x0) + 'px'; };
        const move = ev => {
            if (!dragged && Math.abs(ev.clientX - px0) < 4) return;
            dragged = true;
            x1 = toX(ev, true);
            show();
        };
        const up = () => {
            removeEventListener('pointermove', move);
            removeEventListener('pointerup', up);
            removeEventListener('pointercancel', up);
            mark.remove();
            if (!dragged) { C.selectTake(r, take); return; }
            if (Math.abs(x1 - x0) < 1) return;
            C.selectRange(r, take, win.t0 + Math.min(x0, x1) * secPerPx, win.t0 + Math.max(x0, x1) * secPerPx);
        };
        addEventListener('pointermove', move);
        addEventListener('pointerup', up);
        addEventListener('pointercancel', up);
    });
})();
