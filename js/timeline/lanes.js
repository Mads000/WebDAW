// Darstellung der Regionen. Elemente werden wiederverwendet; ein Canvas wird nur neu gezeichnet, wenn sich sein Inhalt ändert.
'use strict';
(() => {
    const { el, bus } = WD;
    const MAX_CV = 4096;
    const cache = new Map(); // Region-ID → {node, canvas, key}

    function notesHash(r) {
        let h = r.notes.length;
        for (const n of r.notes) h = (h * 31 + n.t * 1000 + n.n * 7 + n.d * 500 + (n.v === undefined ? 1 : n.v) * 13) | 0;
        return h;
    }
    const contentKey = (tr, r) => [
        WD.view.ppb, WD.view.rowH, r.lengthBars.toFixed(4), r.loopLen, (r.offset || 0).toFixed(4), r.rate, r.gain, r.bufId,
        r.fadeIn, r.fadeOut, WD.project.bpm, r.bufId ? 0 : notesHash(r),
    ].join('|');

    function drawWave(cv, tr, r, w, h) {
        const g = cv.getContext('2d');
        g.clearRect(0, 0, w, h);
        const peaks = WD.audioStore.peaks(r.bufId), buf = WD.audioStore.get(r.bufId);
        if (!peaks) {
            g.fillStyle = 'rgba(255,255,255,.75)'; g.font = '10px sans-serif';
            g.fillText('Audio fehlt', 6, Math.min(h - 3, 14));
            return;
        }
        const bin = WD.audioStore.BIN, sr = buf.sampleRate, rate = r.rate || 1;
        const spb = WD.model.secPerBar();
        const lenSec = r.lengthBars * spb;
        const looped = WD.model.isLooped(r), segSec = looped ? r.loopLen * spb : lenSec;
        const vol = r.gain === undefined ? 1 : r.gain;
        const mid = h / 2, amp = h / 2 - 1;
        const total = peaks.length / 2;
        for (let x = 0; x < w; x++) {
            // Bei Loops beginnt jeder Durchgang wieder am Anfang des Inhalts
            const p0 = (x / w) * lenSec, k = Math.floor(p0 / segSec + 1e-9);
            const q0 = p0 - k * segSec, q1 = Math.min(segSec, ((x + 1) / w) * lenSec - k * segSec);
            g.fillStyle = k ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.82)';
            const t0 = (r.offset || 0) + q0 * rate, t1 = (r.offset || 0) + q1 * rate;
            let i0 = Math.floor(t0 * sr / bin), i1 = Math.max(i0 + 1, Math.ceil(t1 * sr / bin));
            if (i0 >= total) continue;
            i1 = Math.min(i1, total);
            let mn = 1, mx = -1;
            for (let i = i0; i < i1; i++) {
                if (peaks[i * 2] < mn) mn = peaks[i * 2];
                if (peaks[i * 2 + 1] > mx) mx = peaks[i * 2 + 1];
            }
            const y0 = mid - Math.min(1, mx * vol) * amp, y1 = mid - Math.max(-1, mn * vol) * amp;
            g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
        }
        // Fades sichtbar machen
        const fade = (x0, x1, a0, a1) => {
            g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath();
            g.moveTo(x0, 0); g.lineTo(x1, 0); g.lineTo(x1, h * a1); g.lineTo(x0, h * a0); g.closePath(); g.fill();
        };
        if (r.fadeIn > 0) fade(0, r.fadeIn / lenSec * w, 1, 0);
        if (r.fadeOut > 0) fade(w - r.fadeOut / lenSec * w, w, 0, 1);
        if (looped) {
            g.fillStyle = 'rgba(0,0,0,.5)';
            for (let k = 1; k * segSec < lenSec - 1e-6; k++) g.fillRect(Math.round(k * segSec / lenSec * w), 0, 1, h);
        }
    }

    function drawNotes(cv, tr, r, w, h) {
        const g = cv.getContext('2d');
        g.clearRect(0, 0, w, h);
        if (!r.notes.length) return;
        const L = r.loopLen || r.lengthBars, sx = w / r.lengthBars;
        let lo = Infinity, hi = -Infinity;
        for (const n of r.notes) { if (n.n < lo) lo = n.n; if (n.n > hi) hi = n.n; }
        if (tr.type === 'drum') { lo = 0; hi = 7; }
        const span = Math.max(hi - lo, 8);
        const noteH = Math.max(1.5, Math.min(4, (h - 4) / (span + 1)));
        g.fillStyle = 'rgba(255,255,255,.88)';
        const reps = Math.ceil(r.lengthBars / L);
        for (let k = 0; k < reps; k++) {
            g.globalAlpha = k === 0 ? 1 : 0.62;
            for (const n of r.notes) {
                const abs = k * L + n.t;
                if (abs >= r.lengthBars) continue;
                const x = abs * sx, nw = Math.max(1.5, n.d * sx - .5);
                const y = h - 2 - noteH - (n.n - lo) / span * (h - 4 - noteH);
                g.fillRect(x, y, nw, noteH);
            }
        }
        g.globalAlpha = 0.55;
        g.fillStyle = 'rgba(0,0,0,.5)';
        for (let k = 1; k < reps; k++) g.fillRect(k * L * sx, 0, 1, h);
        g.globalAlpha = 1;
    }

    function labelOf(r) {
        if (!WD.model.isLooped(r)) return r.name || 'Region';
        const n = r.lengthBars / r.loopLen;
        return (r.name || 'Region') + ' ↻ ' + (Math.abs(n - Math.round(n)) < 0.01 ? Math.round(n) : n.toFixed(1)) + '×';
    }

    function syncRegion(tr, r, lane) {
        const ppb = WD.view.ppb;
        let c = cache.get(r.id);
        if (!c) {
            const canvas = el('canvas');
            const head = el('div', { class: 'rhead' });
            const node = el('div', { class: 'region', dataset: { id: r.id } }, canvas, head, el('div', { class: 'rsz' }),
                el('div', { class: 'rloop', 'data-tip': 'Ziehen: Region wiederholen (Loop). Taste L: bis Songende' }));
            c = { node, canvas, head, key: '' };
            cache.set(r.id, c);
        }
        const { node } = c;
        if (node.parentElement !== lane) lane.append(node);
        node.style.left = r.startBar * ppb + 'px';
        const cssW = Math.max(10, r.lengthBars * ppb - 1);
        node.style.width = cssW + 'px';
        node.style.setProperty('--rc', tr.color);
        node.classList.toggle('sel', WD.view.selRegionIds.has(r.id));
        node.classList.toggle('dim', !WD.engine.isAudible(tr));

        // Griff links nur für Audio: Zuschneiden des Anfangs
        const hasL = !!r.bufId;
        const left = node.querySelector('.rszL');
        if (hasL && !left) node.append(el('div', { class: 'rszL' }));
        if (!hasL && left) left.remove();

        c.head.textContent = '';
        c.head.append(labelOf(r));
        if (r.takes && r.takes.length > 1) {
            c.head.append(el('span', { class: 'rtake', 'data-tip': 'Take wechseln: im Editor' }, `Take ${(r.takeIdx || 0) + 1}/${r.takes.length}`));
        }

        const key = contentKey(tr, r);
        if (c.key !== key) {
            c.key = key;
            const h = Math.max(8, WD.view.rowH - 5 - 15);
            const w = Math.min(MAX_CV, Math.ceil(cssW));
            const dpr = Math.min(devicePixelRatio || 1, 2);
            const bw = Math.min(MAX_CV, Math.ceil(w * dpr));
            c.canvas.width = bw; c.canvas.height = Math.ceil(h * dpr);
            const g = c.canvas.getContext('2d');
            g.setTransform(bw / w, 0, 0, dpr, 0, 0);
            if (r.bufId) drawWave(c.canvas, tr, r, w, h); else drawNotes(c.canvas, tr, r, w, h);
        }
    }

    function syncLane(tr, lane) {
        const keep = new Set(tr.regions.map(r => r.id));
        lane.querySelectorAll(':scope > .region').forEach(n => { if (!keep.has(n.dataset.id)) n.remove(); });
        tr.regions.forEach(r => syncRegion(tr, r, lane));
    }

    function renderAll() {
        const seen = new Set();
        WD.project.tracks.forEach(tr => {
            const lane = document.querySelector(`.tlane[data-id="${tr.id}"]`);
            if (!lane) return;
            syncLane(tr, lane);
            tr.regions.forEach(r => seen.add(r.id));
        });
        cache.forEach((c, id) => { if (!seen.has(id)) { c.node.remove(); cache.delete(id); } });
    }
    function refreshSelection() {
        cache.forEach((c, id) => c.node.classList.toggle('sel', WD.view.selRegionIds.has(id)));
    }

    WD.lanes = { renderAll, refreshSelection, nodeOf: id => (cache.get(id) || {}).node };
    bus.on('regions', renderAll);
    bus.on('selection', refreshSelection);
    bus.on('zoom', renderAll);
})();
