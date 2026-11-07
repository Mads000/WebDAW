// MIDI-Editor für Instrumente und Drums. Ein mitlaufender Canvas zeichnet nur den sichtbaren Ausschnitt,
// deshalb bleibt er auch bei langen Regionen und starkem Zoom schnell. Zeilen: Tonhöhen oder Drum-Instrumente.
'use strict';
(() => {
    const { el, bus, clamp } = WD;
    const M = WD.model;
    const KEYW = 58, RULER = 20, VEL = 62;
    const LO = 21, HI = 108;
    const BLACK = new Set([1, 3, 6, 8, 10]);
    const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'H'];
    const prefs = { pxPerBar: 300, rowH: 16, grid: 1 / 16 };
    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

    WD.roll = {
        mount(host, tr, r) {
            const drum = tr.type === 'drum';
            const lanes = WD.instruments.DRUMLANES;
            const R = {
                KEYW, RULER, VEL, prefs, drum, track: tr, region: r,
                rowH: drum ? 26 : prefs.rowH,
                rowCount: drum ? lanes.length : HI - LO + 1,
                selected: new Set(),
                marquee: null,
                rowOf: n => drum ? n : HI - n,
                noteOf: row => drum ? clamp(row, 0, lanes.length - 1) : HI - clamp(row, 0, HI - LO),
                L: () => r.loopLen || r.lengthBars,
                gridOf: () => prefs.grid,
                noteLen: () => r.noteLen || prefs.grid,
            };

            const cv = el('canvas', { class: 'roll-canvas' });
            const spacer = el('div', { class: 'roll-spacer' });
            const scroll = el('div', { class: 'roll-scroll', tabIndex: 0 }, spacer, cv);
            R.scroll = scroll; R.canvas = cv;

            R.widthBars = () => Math.max(R.L(), r.lengthBars) + M.barLen();
            R.layout = () => {
                spacer.style.width = KEYW + R.widthBars() * prefs.pxPerBar + 'px';
                spacer.style.height = RULER + R.rowCount * R.rowH + VEL + 'px';
                const w = scroll.clientWidth, h = scroll.clientHeight;
                const dpr = devicePixelRatio || 1;
                cv.width = Math.max(1, w * dpr); cv.height = Math.max(1, h * dpr);
                cv.style.width = w + 'px'; cv.style.height = h + 'px';
                R.redraw();
            };
            R.xOf = t => KEYW + t * prefs.pxPerBar - scroll.scrollLeft;
            R.tOf = x => (x - KEYW + scroll.scrollLeft) / prefs.pxPerBar;
            R.yOfRow = row => RULER + row * R.rowH - scroll.scrollTop;
            R.rowAt = y => Math.floor((y - RULER + scroll.scrollTop) / R.rowH);
            R.laneBottom = () => scroll.clientHeight - VEL;

            let pending = false;
            R.redraw = () => {
                if (pending) return;
                pending = true;
                requestAnimationFrame(() => { pending = false; if (cv.isConnected) draw(); });
            };

            function draw() {
                const w = scroll.clientWidth, h = scroll.clientHeight;
                const dpr = devicePixelRatio || 1;
                const g = cv.getContext('2d');
                g.setTransform(dpr, 0, 0, dpr, 0, 0);
                const laneH = h - VEL;
                const ppb = prefs.pxPerBar, L = R.L();
                const bg = css('--bg-lane'), surf = css('--surface'), surf2 = css('--surface-2');
                g.fillStyle = bg; g.fillRect(0, 0, w, h);

                // Zeilen
                g.save();
                g.beginPath(); g.rect(KEYW, RULER, w - KEYW, laneH - RULER); g.clip();
                const firstRow = Math.max(0, R.rowAt(RULER)), lastRow = Math.min(R.rowCount - 1, R.rowAt(laneH));
                const scale = keyScaleSet();
                for (let row = firstRow; row <= lastRow; row++) {
                    const y = R.yOfRow(row);
                    if (drum) {
                        if (row % 2) { g.fillStyle = css('--grid-sub'); g.fillRect(KEYW, y, w, R.rowH); }
                    } else {
                        const pc = R.noteOf(row) % 12;
                        if (!scale.has(pc)) { g.fillStyle = css('--roll-shade'); g.fillRect(KEYW, y, w, R.rowH); }
                        if (pc === 0) { g.fillStyle = css('--grid-bar'); g.fillRect(KEYW, y + R.rowH - 1, w, 1); }
                    }
                }
                // Bereich außerhalb des Patterns abdunkeln
                const endX = R.xOf(L);
                if (endX < w) { g.fillStyle = css('--roll-outside'); g.fillRect(Math.max(KEYW, endX), RULER, w, laneH); }

                // Rasterlinien
                const grid = prefs.grid, barL = M.barLen(), beat = M.beatLen();
                const start = Math.max(0, Math.floor(R.tOf(KEYW) / grid)), end = Math.ceil(R.tOf(w) / grid);
                for (let i = start; i <= end; i++) {
                    const t = i * grid, x = Math.round(R.xOf(t)) + .5;
                    const isBar = Math.abs(t / barL - Math.round(t / barL)) < 1e-6;
                    const isBeat = Math.abs(t / beat - Math.round(t / beat)) < 1e-6;
                    if (!isBar && !isBeat && grid * ppb < 5) continue;
                    g.strokeStyle = isBar ? css('--grid-bar') : isBeat ? css('--grid-beat') : css('--grid-sub');
                    g.beginPath(); g.moveTo(x, RULER); g.lineTo(x, laneH); g.stroke();
                }

                // Noten inkl. Loop-Geister
                const reps = Math.max(1, Math.ceil(r.lengthBars / L));
                const col = tr.color;
                for (let k = 1; k < reps; k++) {
                    g.globalAlpha = .22; g.fillStyle = col;
                    r.notes.forEach(n => {
                        const abs = k * L + n.t;
                        if (abs >= r.lengthBars) return;
                        g.fillRect(R.xOf(abs), R.yOfRow(R.rowOf(n.n)) + 1, Math.max(3, n.d * ppb - 1), R.rowH - 2);
                    });
                }
                g.globalAlpha = 1;
                r.notes.forEach(n => {
                    const x = R.xOf(n.t), y = R.yOfRow(R.rowOf(n.n)) + 1;
                    const nw = Math.max(drum ? 6 : 4, n.d * ppb - 1), nh = R.rowH - 2;
                    if (x > w || x + nw < KEYW) return;
                    const vel = n.v === undefined ? 1 : n.v;
                    g.globalAlpha = .4 + .6 * vel;
                    g.fillStyle = col;
                    g.beginPath(); g.roundRect(x, y, nw, nh, 2.5); g.fill();
                    g.globalAlpha = 1;
                    const sel = R.selected.has(n);
                    g.strokeStyle = sel ? '#fff' : 'rgba(0,0,0,.45)';
                    g.lineWidth = sel ? 1.6 : 1;
                    g.beginPath(); g.roundRect(x + .5, y + .5, nw - 1, nh - 1, 2.5); g.stroke();
                    g.lineWidth = 1;
                });
                // Rahmenauswahl
                if (R.marquee) {
                    const q = R.marquee;
                    g.fillStyle = css('--sel'); g.strokeStyle = css('--accent');
                    g.fillRect(q.x, q.y, q.w, q.h); g.strokeRect(q.x + .5, q.y + .5, q.w, q.h);
                }
                g.restore();

                // Velocity-Spur
                g.fillStyle = surf; g.fillRect(KEYW, laneH, w, VEL);
                g.fillStyle = css('--border-soft'); g.fillRect(0, laneH, w, 1);
                g.save(); g.beginPath(); g.rect(KEYW, laneH, w - KEYW, VEL); g.clip();
                r.notes.forEach(n => {
                    const x = R.xOf(n.t);
                    if (x > w || x < KEYW - 8) return;
                    const vel = n.v === undefined ? 1 : n.v, bh = vel * (VEL - 8);
                    g.fillStyle = R.selected.has(n) ? '#fff' : col;
                    g.fillRect(x, laneH + VEL - 3 - bh, 3, bh);
                    g.beginPath(); g.arc(x + 1.5, laneH + VEL - 3 - bh, 2.5, 0, 7); g.fill();
                });
                g.restore();
                g.fillStyle = surf2; g.fillRect(0, laneH, KEYW, VEL);
                g.fillStyle = css('--text-3'); g.font = '10px ' + css('--font'); g.fillText('Velocity', 7, laneH + 16);

                // Lineal
                g.fillStyle = surf; g.fillRect(KEYW, 0, w, RULER);
                g.fillStyle = css('--border-soft'); g.fillRect(0, RULER - 1, w, 1);
                g.font = '10px ' + css('--font'); g.fillStyle = css('--ruler-text');
                const barPx = barL * ppb;
                const stride = barPx < 40 ? Math.ceil(40 / barPx) : 1;
                const b0 = Math.floor(R.tOf(KEYW) / barL), b1 = Math.ceil(R.tOf(w) / barL);
                for (let b = Math.max(0, b0); b <= b1; b++) {
                    if (b % stride) continue;
                    const x = R.xOf(b * barL);
                    if (x >= KEYW - 1) {
                        g.fillRect(Math.round(x), RULER - 7, 1, 7);
                        g.fillText(String(Math.floor((r.startBar + b * barL) / barL) + 1), x + 3, 13);
                    }
                }

                // Tasten bzw. Drum-Namen
                g.save(); g.beginPath(); g.rect(0, RULER, KEYW, laneH - RULER); g.clip();
                for (let row = firstRow; row <= lastRow; row++) {
                    const y = R.yOfRow(row), n = R.noteOf(row);
                    if (drum) {
                        g.fillStyle = surf2; g.fillRect(0, y, KEYW, R.rowH);
                        g.fillStyle = css('--text-2'); g.font = '11px ' + css('--font');
                        g.fillText(lanes[row], 6, y + R.rowH / 2 + 4);
                        g.fillStyle = css('--border-soft'); g.fillRect(0, y + R.rowH - 1, KEYW, 1);
                    } else {
                        const black = BLACK.has(n % 12);
                        g.fillStyle = black ? '#2b2c30' : '#e9e9ea';
                        g.fillRect(0, y, KEYW, R.rowH);
                        g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(0, y + R.rowH - 1, KEYW, 1);
                        if (n % 12 === 0 || R.rowH >= 18) {
                            g.fillStyle = black ? '#c9cad0' : '#44464c'; g.font = (n % 12 === 0 ? 'bold ' : '') + '9.5px ' + css('--font');
                            g.fillText(NAMES[n % 12] + (Math.floor(n / 12) - 1), 5, y + R.rowH - 4);
                        }
                    }
                }
                g.restore();
                g.fillStyle = surf; g.fillRect(0, 0, KEYW, RULER);
                g.fillStyle = css('--border-soft'); g.fillRect(KEYW - 1, 0, 1, h);

                // Playhead
                const T = WD.transport;
                const pos = T.audible();
                if (pos >= r.startBar && pos < r.startBar + r.lengthBars) {
                    const local = (pos - r.startBar) % L;
                    const x = R.xOf(local);
                    if (x >= KEYW) {
                        g.fillStyle = css('--playhead');
                        g.fillRect(Math.round(x), 0, 1, h);
                    }
                }
            }

            function keyScaleSet() {
                const p = WD.project;
                const root = NAMES.indexOf(p.keyRoot === 'B' ? 'H' : p.keyRoot);
                const sc = p.keyMode === 'minor' ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
                return new Set(sc.map(s => (s + root) % 12));
            }

            R.changed = () => { bus.emit('regions'); R.redraw(); };

            // --- Werkzeugleiste ---
            R.buildToolbar = head => {
                const opt = (sel, list, cur) => list.forEach(([label, v]) => sel.add(new Option(label, v, false, Math.abs(+v - cur) < 1e-6)));
                // Pattern-Länge: auch ungewöhnliche Längen werden korrekt angezeigt
                const barL = M.barLen();
                const lenSel = el('select', { 'aria-label': 'Pattern-Länge' });
                const cur = R.L();
                const opts = [1, 2, 4, 8, 16].map(n => [`${n} ${n === 1 ? 'Takt' : 'Takte'}`, n * barL]);
                if (!opts.some(o => Math.abs(o[1] - cur) < 1e-6)) opts.push([`${+(cur / barL).toFixed(2)} Takte`, cur]);
                opts.sort((a, b) => a[1] - b[1]);
                opt(lenSel, opts, cur);
                lenSel.onchange = () => {
                    WD.history.run('Pattern-Länge', () => {
                        const v = +lenSel.value;
                        r.loopLen = v;
                        if (r.lengthBars < v) r.lengthBars = v;
                    });
                    bus.emit('regions'); bus.emit('editor:refresh');
                };

                const gridSel = el('select', { 'aria-label': 'Raster' });
                opt(gridSel, [['1/4', 1 / 4], ['1/8', 1 / 8], ['1/16', 1 / 16], ['1/32', 1 / 32], ['1/8 T', 1 / 12], ['1/16 T', 1 / 24]], prefs.grid);
                gridSel.onchange = () => { prefs.grid = +gridSel.value; R.redraw(); gridSel.blur(); };

                const lenPick = el('select', { 'aria-label': 'Notenlänge' });
                opt(lenPick, [['1/32', 1 / 32], ['1/16', 1 / 16], ['1/8', 1 / 8], ['1/4', 1 / 4], ['1/2', 1 / 2], ['1 Takt', 1]], r.noteLen || 1 / 16);
                lenPick.onchange = () => { r.noteLen = +lenPick.value; lenPick.blur(); };

                const vel = el('input', { type: 'range', class: 'slider', min: 5, max: 100, value: 100, 'aria-label': 'Velocity', 'data-tip': 'Velocity der ausgewählten Noten' });
                let velTx = null;
                vel.onpointerdown = () => { velTx = WD.history.begin('Velocity'); };
                vel.oninput = () => { R.selected.forEach(n => { n.v = vel.value / 100; }); R.changed(); };
                vel.onpointerup = () => { if (velTx) velTx.end(); velTx = null; vel.blur(); };
                R.velSlider = vel;

                const btn = (label, tip, fn) => el('button', { 'data-tip': tip, onclick: fn }, label);
                const targets = () => R.selected.size ? [...R.selected] : r.notes;

                head.append(
                    el('label', { class: 'pane-field' }, 'Pattern', lenSel),
                    el('label', { class: 'pane-field' }, 'Raster', gridSel),
                    el('label', { class: 'pane-field' }, 'Notenlänge', lenPick),
                    el('span', { class: 'pane-sep' }),
                    btn('Quantisieren', 'Auswahl (oder alle Noten) auf das Raster ziehen (Q)', () => R.quantize()),
                    btn('Humanize', 'Leichte Timing- und Velocity-Abweichungen', () => {
                        WD.history.run('Humanize', () => targets().forEach(n => {
                            n.t = Math.max(0, n.t + (Math.random() - .5) / 48);
                            n.v = .7 + Math.random() * .3;
                        }));
                        R.changed();
                    }),
                    el('label', { class: 'pane-field' }, 'Velocity', vel),
                );
                if (!drum) {
                    head.append(
                        el('span', { class: 'pane-sep' }),
                        btn('−12', 'Oktave tiefer', () => R.transpose(-12)),
                        btn('−1', 'Halbton tiefer', () => R.transpose(-1)),
                        btn('+1', 'Halbton höher', () => R.transpose(1)),
                        btn('+12', 'Oktave höher', () => R.transpose(12)),
                        btn('Streichersatz', 'Melodie in der Projekt-Tonart um Terz und Unteroktave ergänzen', () => R.harmonize()),
                    );
                }
                head.append(
                    el('span', { class: 'spacer' }),
                    el('button', { class: 'tool', 'aria-label': 'Verkleinern', 'data-tip': 'Horizontal verkleinern', onclick: () => R.zoom(.8) }, WD.icons.icon('zoomOut')),
                    el('button', { class: 'tool', 'aria-label': 'Vergrößern', 'data-tip': 'Horizontal vergrößern (Strg+Mausrad)', onclick: () => R.zoom(1.25) }, WD.icons.icon('zoomIn')),
                );
            };

            R.zoom = f => { prefs.pxPerBar = clamp(prefs.pxPerBar * f, 60, 3000); R.layout(); };
            R.quantize = () => {
                const g = prefs.grid;
                const list = R.selected.size ? [...R.selected] : r.notes;
                WD.history.run('Quantisieren', () => list.forEach(n => {
                    n.t = Math.min(R.L() - g, Math.max(0, Math.round(n.t / g) * g));
                }));
                R.changed();
            };
            R.transpose = d => {
                const list = R.selected.size ? [...R.selected] : r.notes;
                WD.history.run('Transponieren', () => list.forEach(n => { n.n = clamp(n.n + d, LO, HI); }));
                R.changed();
            };
            R.harmonize = () => {
                if (!r.notes.length) { WD.ui.toast('Erst eine Melodie einspielen oder zeichnen.'); return; }
                const p = WD.project;
                const root = NAMES.indexOf(p.keyRoot === 'B' ? 'H' : p.keyRoot);
                const scale = p.keyMode === 'minor' ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
                const list = R.selected.size ? [...R.selected] : r.notes.slice();
                WD.history.run('Streichersatz', () => {
                    list.forEach(nt => {
                        const vel = nt.v === undefined ? 1 : nt.v;
                        const deg = scale.indexOf(((nt.n - root) % 12 + 12) % 12);
                        if (deg >= 0) {
                            let third = scale[(deg + 2) % 7] - scale[deg];
                            if (third < 0) third += 12;
                            r.notes.push({ t: nt.t, n: nt.n + third, d: nt.d, v: vel * .7 });
                        }
                        r.notes.push({ t: nt.t, n: nt.n - 12, d: nt.d, v: vel * .6 });
                    });
                });
                R.changed();
            };

            scroll.addEventListener('scroll', R.redraw, { passive: true });
            scroll.addEventListener('wheel', e => {
                if (e.ctrlKey || e.metaKey) { e.preventDefault(); R.zoom(e.deltaY < 0 ? 1.15 : .87); }
                else if (e.altKey && !drum) {
                    e.preventDefault();
                    prefs.rowH = clamp(prefs.rowH + (e.deltaY < 0 ? 2 : -2), 9, 30);
                    R.rowH = prefs.rowH; R.layout();
                }
            }, { passive: false });

            WD.rollInput.attach(R);

            host.append(scroll);
            const ro = new ResizeObserver(() => R.layout());
            ro.observe(scroll);
            R.dispose = () => ro.disconnect();

            // Sofort zu den vorhandenen Noten scrollen
            R.layout();
            if (!drum) {
                const ns = r.notes.map(n => n.n);
                const mid = ns.length ? (Math.max(...ns) + Math.min(...ns)) / 2 : 66;
                scroll.scrollTop = Math.max(0, R.rowOf(Math.round(mid)) * R.rowH - (scroll.clientHeight - VEL) / 2 + RULER);
            }
            return R;
        },
    };
})();
