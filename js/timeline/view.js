// Zeitleisten-Geometrie: Zoom, Raster, Lineal, Playhead und die gemeinsame Animationsschleife.
// Lineal und Raster zeichnen nur den sichtbaren Ausschnitt.
'use strict';
(() => {
    const { $, bus, clamp, gainToDb } = WD;
    const M = WD.model;
    const T = () => WD.transport;

    const arrange = $('arrange'), rulerEl = $('ruler'), rulerCv = $('rulerCv'), gridCv = $('gridCv');
    const laneArea = $('laneArea'), arrLane = $('arrLane'), playhead = $('playhead');

    const headW = () => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--head-w'), 10) || 252;
    const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

    function gridStep() {
        const v = WD.view;
        if (v.grid !== 'auto') return +v.grid;
        for (const g of [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1]) if (g * v.ppb >= 12) return g;
        return M.barLen();
    }

    const V = WD.timeline = {
        headW, gridStep,
        dragPos: null, // Während der Wiedergabe gezogene Position; der Sprung folgt erst beim Loslassen
        barX: bar => bar * WD.view.ppb,
        // Holt eine Position in den sichtbaren Bereich
        reveal(bar) {
            const px = bar * WD.view.ppb, sl = arrange.scrollLeft, visW = arrange.clientWidth - headW();
            if (px < sl || px > sl + visW - 24) arrange.scrollLeft = Math.max(0, px - visW / 3);
        },
        // Bildschirm-X → Position
        clientToBar(clientX) {
            const r = rulerEl.getBoundingClientRect();
            return (clientX - r.left) / WD.view.ppb;
        },
        snap(bar, ev) {
            if (!WD.view.snap || (ev && (ev.ctrlKey || ev.metaKey))) return Math.max(0, bar);
            const g = gridStep();
            return Math.max(0, Math.round(bar / g) * g);
        },
        laneWidth: () => M.timelineBars() * WD.view.ppb,

        layout() {
            const w = V.laneWidth();
            rulerEl.style.width = w + 'px';
            arrLane.style.width = w + 'px';
            document.querySelectorAll('.tlane').forEach(l => { l.style.width = w + 'px'; });
            V.requestDraw();
        },

        setZoom(ppb, anchorClientX) {
            const old = WD.view.ppb;
            const next = clamp(Math.round(ppb), 16, 640);
            if (next === old) return;
            const hw = headW();
            const rect = arrange.getBoundingClientRect();
            const anchorX = anchorClientX !== undefined ? anchorClientX - rect.left - hw : (arrange.clientWidth - hw) / 2;
            const bar = (arrange.scrollLeft + anchorX) / old;
            WD.view.ppb = next;
            V.layout();
            bus.emit('zoom');
            arrange.scrollLeft = Math.max(0, bar * next - anchorX);
        },
        zoomBy(f, x) { V.setZoom(WD.view.ppb * f, x); },
        zoomToFit() {
            const end = Math.max(M.contentEnd(), M.barLen() * 8);
            V.setZoom((arrange.clientWidth - headW() - 30) / end);
            arrange.scrollLeft = 0;
        },
        setRowHeight(h) { WD.view.rowH = clamp(h, 48, 140); bus.emit('tracks'); },

        requestDraw() {
            if (V._drawPending) return;
            V._drawPending = true;
            requestAnimationFrame(() => { V._drawPending = false; drawRuler(); drawGrid(); });
        },
        drawNow() { drawRuler(); drawGrid(); },
    };

    function sizeCanvas(cv, w, h) {
        const dpr = devicePixelRatio || 1;
        const bw = Math.max(1, Math.round(w * dpr)), bh = Math.max(1, Math.round(h * dpr));
        if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
        cv.style.width = w + 'px'; cv.style.height = h + 'px';
        const g = cv.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        return g;
    }

    function barStride(barPx) {
        for (const s of [1, 2, 4, 8, 16, 32, 64]) if (s * barPx >= 34) return s;
        return 128;
    }

    function drawRuler() {
        const hw = headW();
        const visW = Math.max(1, arrange.clientWidth - hw);
        const h = rulerEl.clientHeight || 28;
        const sl = arrange.scrollLeft;
        const g = sizeCanvas(rulerCv, visW, h);
        rulerCv.style.transform = `translateX(${sl}px)`;
        g.clearRect(0, 0, visW, h);
        const ppb = WD.view.ppb, barL = M.barLen(), beat = M.beatLen();
        const barPx = barL * ppb, beatPx = beat * ppb;
        const c = WD.project.cycle;

        // Cycle-Bereich
        const cx0 = c.a * ppb - sl, cx1 = c.b * ppb - sl;
        const cycleCol = cssVar('--cycle');
        g.globalAlpha = c.on ? 1 : 0.32;
        g.fillStyle = cycleCol;
        g.beginPath(); g.roundRect(cx0, 1, Math.max(3, cx1 - cx0), 8, 3); g.fill();
        g.globalAlpha = 1;

        const stride = barStride(barPx);
        const first = Math.max(0, Math.floor(sl / barPx));
        const last = Math.ceil((sl + visW) / barPx);
        const tickCol = cssVar('--grid-bar'), txtCol = cssVar('--ruler-text');
        g.font = '10.5px ' + cssVar('--font');
        g.textBaseline = 'alphabetic';
        for (let i = first; i <= last; i++) {
            const x = Math.round(i * barPx - sl) + 0.5;
            if (i % stride === 0) {
                g.strokeStyle = txtCol; g.globalAlpha = .55;
                g.beginPath(); g.moveTo(x, h - 12); g.lineTo(x, h); g.stroke();
                g.globalAlpha = 1;
                g.fillStyle = txtCol;
                g.fillText(String(i + 1), x + 4, h - 4);
            } else if (barPx >= 8) {
                g.strokeStyle = tickCol;
                g.beginPath(); g.moveTo(x, h - 5); g.lineTo(x, h); g.stroke();
            }
            if (beatPx >= 14) {
                g.strokeStyle = tickCol;
                const beats = Math.round(barL / beat);
                for (let b = 1; b < beats; b++) {
                    const bx = Math.round((i * barL + b * beat) * ppb - sl) + 0.5;
                    g.beginPath(); g.moveTo(bx, h - 4); g.lineTo(bx, h); g.stroke();
                }
            }
        }
    }

    function drawGrid() {
        const hw = headW();
        const visW = Math.max(1, arrange.clientWidth - hw);
        const h = Math.max(laneArea.clientHeight, 1);
        const sl = arrange.scrollLeft;
        const g = sizeCanvas(gridCv, visW, h);
        gridCv.style.transform = `translateX(${sl}px)`;
        g.clearRect(0, 0, visW, h);
        const ppb = WD.view.ppb, barL = M.barLen(), beat = M.beatLen();
        const barPx = barL * ppb, beatPx = beat * ppb;
        const line = (x, col) => {
            const px = Math.round(x - sl) + 0.5;
            g.strokeStyle = col; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, h); g.stroke();
        };
        // Songabschnitte dezent hinterlegen
        WD.project.markers.forEach((m, i) => {
            if (i % 2) return;
            const x0 = m.startBar * ppb - sl, w = m.lengthBars * ppb;
            if (x0 + w < 0 || x0 > visW) return;
            g.fillStyle = cssVar('--grid-sub');
            g.fillRect(x0, 0, w, h);
        });
        const barCol = cssVar('--grid-bar'), beatCol = cssVar('--grid-beat'), subCol = cssVar('--grid-sub');
        const stride = barPx < 12 ? barStride(barPx) : 1;
        const first = Math.floor(sl / barPx), last = Math.ceil((sl + visW) / barPx);
        const sub = gridStep();
        for (let i = first; i <= last; i++) {
            if (i % stride === 0) line(i * barPx, barCol);
            if (beatPx >= 14) {
                const nb = Math.round(barL / beat);
                for (let b = 1; b < nb; b++) line((i * barL + b * beat) * ppb, beatCol);
                if (sub < beat && sub * ppb >= 10) {
                    const count = Math.round(barL / sub);
                    for (let s = 1; s < count; s++) {
                        const pos = s * sub;
                        if (Math.abs(pos / beat - Math.round(pos / beat)) > 1e-6) line((i * barL + pos) * ppb, subCol);
                    }
                }
            }
        }
    }

    arrange.addEventListener('scroll', V.requestDraw, { passive: true });
    arrange.addEventListener('wheel', e => {
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); V.zoomBy(e.deltaY < 0 ? 1.15 : 0.87, e.clientX); }
        else if (e.altKey) { e.preventDefault(); V.setRowHeight(WD.view.rowH + (e.deltaY < 0 ? 6 : -6)); }
    }, { passive: false });
    new ResizeObserver(V.requestDraw).observe(arrange);
    new ResizeObserver(V.requestDraw).observe(laneArea);

    // Beim Ziehen des Playheads an den Fensterrand läuft die Ansicht mit
    function edgeScroll(clientX) {
        const r = arrange.getBoundingClientRect();
        if (clientX > r.right - 24) arrange.scrollLeft += 16;
        else if (clientX < r.left + headW() + 24) arrange.scrollLeft -= 16;
    }
    const nearPlayhead = xIn => Math.abs(xIn - T().audible() * WD.view.ppb) < 7;

    rulerEl.addEventListener('pointermove', e => {
        if (e.buttons) return;
        rulerEl.style.cursor = nearPlayhead(e.clientX - rulerEl.getBoundingClientRect().left) ? 'ew-resize' : '';
    });

    // Lineal: Klick setzt die Position, Ziehen am Playhead verschiebt ihn, Ziehen daneben legt den Cycle-Bereich an,
    // der Balken selbst ist verschieb- und ziehbar.
    rulerEl.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        rulerEl.setPointerCapture(e.pointerId);
        const tx = WD.history.begin('Cycle-Bereich');
        const rect = rulerEl.getBoundingClientRect();
        const c = WD.project.cycle, ppb = WD.view.ppb;
        const xIn = e.clientX - rect.left, yIn = e.clientY - rect.top;
        const inBar = yIn < 11 && xIn >= c.a * ppb - 4 && xIn <= c.b * ppb + 4;
        let mode = 'new';
        if (inBar) {
            if (Math.abs(xIn - c.a * ppb) < 7) mode = 'left';
            else if (Math.abs(xIn - c.b * ppb) < 7) mode = 'right';
            else mode = 'move';
        }
        const barMove = mode === 'move';
        // Liegt eine Cycle-Kante auf dem Playhead, greift oben die Kante und im unteren Teil des Lineals der Playhead
        if (nearPlayhead(xIn) && mode !== 'left' && mode !== 'right') mode = 'playhead';
        const toBar = ev => (ev.clientX - rect.left) / WD.view.ppb;
        const b0 = V.snap(toBar(e), e), a0 = c.a, bEnd0 = c.b;
        let dragged = false;
        const onMove = ev => {
            if (mode === 'playhead') {
                if (!dragged && Math.abs(ev.clientX - e.clientX) < 2) return;
                dragged = true;
                edgeScroll(ev.clientX);
                const b = V.snap(V.clientToBar(ev.clientX), ev);
                // Bei laufender Wiedergabe würde jeder Zwischenschritt den Klang neu starten
                if (T().playing) { V.dragPos = b; kick(); } else T().seek(b);
                return;
            }
            const b1 = V.snap(toBar(ev), ev);
            if (!dragged && Math.abs(ev.clientX - e.clientX) < 4) return;
            dragged = true;
            if (mode === 'new') { c.on = true; T().setCycle(Math.min(b0, b1), Math.max(b0, b1)); }
            else if (mode === 'left') T().setCycle(Math.min(b1, bEnd0 - gridStep()), bEnd0);
            else if (mode === 'right') T().setCycle(a0, Math.max(b1, a0 + gridStep()));
            else { const d = Math.max(-a0, b1 - b0); T().setCycle(a0 + d, bEnd0 + d); }
        };
        const onUp = ev => {
            rulerEl.removeEventListener('pointermove', onMove);
            rulerEl.removeEventListener('pointerup', onUp);
            rulerEl.removeEventListener('pointercancel', onUp);
            if (V.dragPos !== null) { const b = V.dragPos; V.dragPos = null; T().seek(b); }
            if (!dragged) {
                if (inBar && barMove) T().toggleCycle();
                else T().seek(V.snap(toBar(ev), ev));
            }
            tx.end();
        };
        rulerEl.addEventListener('pointermove', onMove);
        rulerEl.addEventListener('pointerup', onUp);
        rulerEl.addEventListener('pointercancel', onUp);
    });

    // ----- Pegelmessung und gemeinsame Bild-Schleife: läuft nur, wenn etwas zu aktualisieren ist -----
    const peakBuf = new Float32Array(2048);
    function analyserPeak(a) {
        const n = Math.min(a.fftSize, peakBuf.length);
        const b = n === peakBuf.length ? peakBuf : peakBuf.subarray(0, n);
        a.getFloatTimeDomainData(b);
        let p = 0;
        for (let i = 0; i < n; i++) { const v = Math.abs(b[i]); if (v > p) p = v; }
        return p;
    }
    const meterState = new Map();
    const scaleDb = p => clamp((gainToDb(p) + 60) / 60, 0, 1);
    function smooth(id, peak) {
        const prev = meterState.get(id) || 0;
        const next = peak > prev ? peak : prev * 0.88;
        meterState.set(id, next < 0.0005 ? 0 : next);
        return next;
    }

    WD.meters = {
        scaleDb,
        setH: (node, level) => { node.style.clipPath = `inset(0 ${(1 - scaleDb(level)) * 100}% 0 0)`; },
        setV: (node, level) => { node.style.clipPath = `inset(${(1 - scaleDb(level)) * 100}% 0 0 0)`; },
        level: id => meterState.get(id) || 0,
        peak: analyserPeak,
    };

    const frameFns = new Set();
    let running = false, holdFrames = 0;
    let lastText = '', lastX = -1, lcdMode = 'bars';

    function renderPlayhead() {
        const dragging = V.dragPos !== null;
        const pos = dragging ? V.dragPos : T().audible();
        const x = headW() + pos * WD.view.ppb;
        if (Math.abs(x - lastX) > 0.2) {
            playhead.style.transform = `translateX(${x}px)`;
            lastX = x;
        }
        const bb = T().barBeat(pos);
        // Im Stillstand zeigt die Anzeige auch feine Positionen abseits des Rasters
        const still = !T().playing;
        const fine = still && bb.tick ? '.' + String(bb.tick).padStart(2, '0') : '';
        const text = lcdMode === 'bars' ? `${bb.bar}.${bb.beat}.${bb.sub}${fine}` : T().timeStr(pos, still ? 2 : 1);
        if (text !== lastText) { $('pos').textContent = text; lastText = text; }
        if (T().playing && !dragging) {
            const sl = arrange.scrollLeft, visW = arrange.clientWidth - headW();
            const px = pos * WD.view.ppb;
            if (!V.userScrolling && (px > sl + visW - 24 || px < sl)) arrange.scrollLeft = Math.max(0, px - 40);
        }
    }

    function updateMeters() {
        if (WD.engine.ready) {
            const n = WD.engine.nodes;
            frameFns.forEach(fn => fn());
            smooth('L', analyserPeak(n.anaL)); smooth('R', analyserPeak(n.anaR));
            WD.project.tracks.forEach(t => {
                const s = WD.engine.strip(t);
                if (s && s.meter) smooth(t.id, analyserPeak(s.meter));
            });
        }
    }

    function loop() {
        renderPlayhead();
        updateMeters();
        bus.emit('frame');
        const active = T().playing || (WD.input && WD.input.active);
        if (active) holdFrames = 60;
        else holdFrames--;
        if (holdFrames > 0) requestAnimationFrame(loop);
        else { running = false; bus.emit('frame:idle'); }
    }
    function kick() {
        holdFrames = Math.max(holdFrames, 45);
        if (!running) { running = true; requestAnimationFrame(loop); }
    }
    WD.frame = { kick, add: fn => frameFns.add(fn), remove: fn => frameFns.delete(fn), isRunning: () => running };
    bus.on('transport', kick);
    bus.on('input:changed', kick);
    bus.on('mix', kick);
    bus.on('zoom', () => { lastX = -1; kick(); });
    bus.on('tempo', kick);
    bus.on('cycle', V.requestDraw);
    bus.on('markers', V.requestDraw);
    bus.on('project', () => { V.layout(); lastX = -1; kick(); });
    bus.on('regions', V.layout);
    bus.on('tracks', V.layout);
    bus.on('timesig', () => { V.requestDraw(); kick(); });

    // "3", "3.2", "3.2.1", "3.2.1.50" oder "1:23.45". Ohne Doppelpunkt zählt in der Zeitanzeige die Zahl als Sekunden.
    function parsePosition(raw, mode) {
        const s = raw.trim().replace(/\s+/g, '');
        if (!s) return null;
        const t = /^(\d+):(\d+(?:[.,]\d*)?)$/.exec(s);
        if (t) return (+t[1] * 60 + parseFloat(t[2].replace(',', '.'))) / M.secPerBar();
        if (mode === 'time') {
            if (!/^\d+(?:[.,]\d*)?$/.test(s)) return null;
            return parseFloat(s.replace(',', '.')) / M.secPerBar();
        }
        const parts = s.replace(/,/g, '.').split('.');
        if (parts.length > 4 || parts.some(p => !/^\d+$/.test(p))) return null;
        const [bar, bt = 1, sub = 1, tick = 0] = parts.map(Number);
        const beat = M.beatLen(), beats = Math.round(M.barLen() / beat);
        if (bar < 1 || bt < 1 || bt > beats || sub < 1 || sub > 4 || tick > 99) return null;
        return (bar - 1) * M.barLen() + (bt - 1) * beat + (sub - 1 + tick / 100) * beat / 4;
    }
    V.parsePosition = parsePosition;

    function editPosition() {
        const lcd = $('lcdPos'), show = $('pos');
        if (lcd.querySelector('input')) return;
        const input = WD.el('input', { type: 'text', class: 'lcd-pos-edit', 'aria-label': 'Position eingeben', spellcheck: 'false', value: show.textContent });
        input.value = show.textContent;
        show.hidden = true;
        lcd.prepend(input);
        input.focus(); input.select();
        let done = false;
        const finish = () => { if (done) return; done = true; input.remove(); show.hidden = false; lastText = ''; kick(); };
        input.addEventListener('keydown', ev => {
            ev.stopPropagation();
            if (ev.key === 'Escape') finish();
            else if (ev.key === 'Enter') {
                const b = parsePosition(input.value, lcdMode);
                if (b === null) { input.classList.add('bad'); return; }
                finish();
                T().seek(b);
                V.reveal(b);
            } else input.classList.remove('bad');
        });
        input.addEventListener('blur', finish);
    }

    // Einfacher Klick wartet kurz, damit ein Doppelklick die Anzeige nicht erst umschaltet
    let lcdClick = 0;
    $('lcdPos').addEventListener('click', e => {
        if (e.target.tagName === 'INPUT') return;
        clearTimeout(lcdClick);
        if (e.detail > 1) return;
        lcdClick = setTimeout(() => {
            lcdMode = lcdMode === 'bars' ? 'time' : 'bars';
            $('posLabel').textContent = lcdMode === 'bars' ? 'TAKT · SCHLAG' : 'MIN : SEK';
            lastText = ''; kick();
        }, 260);
    });
    $('lcdPos').addEventListener('dblclick', e => {
        if (e.target.tagName === 'INPUT') return;
        clearTimeout(lcdClick);
        editPosition();
    });
})();
