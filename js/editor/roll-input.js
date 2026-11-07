// Maus und Tastatur im MIDI-Editor.
// Leere Stelle ziehen: neue Note aufziehen. Note ziehen: verschieben. Rechte Kante: Länge. Umschalt+Ziehen: Rahmenauswahl.
'use strict';
(() => {
    const { clamp } = WD;
    let clipboard = null;

    function preview(R, n, dur) { WD.instruments.preview(R.track, n, dur || .3); }

    function attach(R) {
        const cv = R.canvas, r = R.region;
        const local = e => {
            const b = cv.getBoundingClientRect();
            return { x: e.clientX - b.left, y: e.clientY - b.top };
        };
        const hit = (x, y) => {
            const t = R.tOf(x), row = R.rowAt(y);
            if (row < 0 || row >= R.rowCount) return null;
            const n = R.noteOf(row);
            return r.notes.find(nt => nt.n === n && t >= nt.t - (R.drum ? 1 / 128 : 0) && t < nt.t + Math.max(nt.d, R.drum ? 1 / 32 : 0)) || null;
        };
        const quant = t => Math.floor(t / R.gridOf()) * R.gridOf();
        const round = (t, e) => e.ctrlKey || e.metaKey ? t : Math.round(t / R.gridOf()) * R.gridOf();

        cv.addEventListener('contextmenu', e => {
            e.preventDefault();
            const { x, y } = local(e);
            if (x < R.KEYW || y < R.RULER || y >= R.laneBottom()) return;
            const nt = hit(x, y);
            if (!nt) return;
            if (R.drum) {
                WD.history.run('Velocity', () => {
                    const v = nt.v === undefined ? 1 : nt.v;
                    nt.v = v >= .9 ? .6 : v >= .5 ? .3 : 1;
                });
            } else {
                WD.history.run('Note löschen', () => {
                    if (R.selected.has(nt) && R.selected.size > 1) {
                        const s = R.selected;
                        r.notes = r.notes.filter(q => !s.has(q));
                        s.clear();
                    } else {
                        r.notes = r.notes.filter(q => q !== nt);
                        R.selected.delete(nt);
                    }
                });
            }
            R.changed();
        });

        cv.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            e.preventDefault();
            R.scroll.focus({ preventScroll: true });
            WD.view.focus = 'editor';
            cv.setPointerCapture(e.pointerId);
            const { x, y } = local(e);

            // Lineal: Position setzen
            if (y < R.RULER) {
                if (x >= R.KEYW) WD.transport.seek(r.startBar + clamp(R.tOf(x), 0, r.lengthBars));
                return;
            }
            // Velocity-Spur
            if (y >= R.laneBottom()) {
                if (x >= R.KEYW) velocityDrag(e);
                return;
            }
            // Tasten: vorhören
            if (x < R.KEYW) {
                const row = R.rowAt(y);
                if (row >= 0 && row < R.rowCount) preview(R, R.noteOf(row), .5);
                return;
            }

            const row = R.rowAt(y);
            if (row < 0 || row >= R.rowCount) return;
            let nt = hit(x, y);

            if (!nt && e.shiftKey) { marquee(e, x, y); return; }

            const tx = WD.history.begin('Note bearbeiten');
            let mode, created = false;
            const L = R.L();
            if (nt) {
                const right = R.xOf(nt.t + nt.d);
                mode = !R.drum && x > right - 7 ? 'resize' : 'move';
                if (e.shiftKey) { if (R.selected.has(nt)) R.selected.delete(nt); else R.selected.add(nt); }
                else if (!R.selected.has(nt)) { R.selected.clear(); R.selected.add(nt); }
            } else {
                const t = clamp(quant(R.tOf(x)), 0, L - R.gridOf());
                nt = { t, n: R.noteOf(row), d: R.drum ? 1 / 16 : R.noteLen() };
                r.notes.push(nt);
                R.selected.clear(); R.selected.add(nt);
                mode = R.drum ? 'none' : 'resize';
                created = true;
                preview(R, nt.n);
            }
            if (R.velSlider && nt) R.velSlider.value = Math.round((nt.v === undefined ? 1 : nt.v) * 100);

            const group = [...R.selected].map(n => ({ n, t: n.t, p: n.n, d: n.d }));
            const anchor = group.find(g => g.n === nt);
            const minT = Math.min(...group.map(g => g.t));
            let lastPitch = nt.n, dragged = false;
            R.changed();

            const move = ev => {
                const q = local(ev);
                const dt = (q.x - x) / R.prefs.pxPerBar;
                const dRow = Math.round((q.y - y) / R.rowH);
                if (Math.abs(q.x - x) > 3 || dRow) dragged = true;
                if (mode === 'move') {
                    const d = round(anchor.t + dt, ev) - anchor.t;
                    const dd = Math.max(d, -minT);
                    group.forEach(g => {
                        g.n.t = clamp(g.t + dd, 0, L - 1 / 128);
                        const newRow = R.rowOf(g.p) + dRow;
                        g.n.n = R.noteOf(newRow);
                    });
                    if (nt.n !== lastPitch) { lastPitch = nt.n; preview(R, nt.n, .2); }
                } else if (mode === 'resize') {
                    const end = round(anchor.t + anchor.d + dt, ev);
                    group.forEach(g => { g.n.d = clamp(end - anchor.t + (g.d - anchor.d), 1 / 64, L - g.n.t); });
                }
                R.redraw();
            };
            const up = () => {
                cv.removeEventListener('pointermove', move);
                cv.removeEventListener('pointerup', up);
                // Drums: Klick auf eine vorhandene Note entfernt sie (Step-Sequencer-Verhalten)
                if (R.drum && !dragged && !created && !e.shiftKey) {
                    r.notes = r.notes.filter(q => q !== nt);
                    R.selected.delete(nt);
                }
                tx.end();
                R.changed();
            };
            cv.addEventListener('pointermove', move);
            cv.addEventListener('pointerup', up);
        });

        function velocityDrag(e) {
            const tx = WD.history.begin('Velocity');
            const bottom = R.laneBottom(), H = R.VEL - 8;
            const apply = ev => {
                const q = local(ev);
                const v = clamp((bottom + R.VEL - 3 - q.y) / H, .05, 1);
                const t = R.tOf(q.x);
                const near = r.notes.filter(n => Math.abs(n.t - t) * R.prefs.pxPerBar < 5);
                const useSel = near.some(n => R.selected.has(n));
                (useSel ? [...R.selected] : near).forEach(n => { n.v = v; });
                R.changed();
            };
            apply(e);
            const up = () => {
                cv.removeEventListener('pointermove', apply);
                cv.removeEventListener('pointerup', up);
                tx.end();
            };
            cv.addEventListener('pointermove', apply);
            cv.addEventListener('pointerup', up);
        }

        function marquee(e, x0, y0) {
            const base = new Set(R.selected);
            const move = ev => {
                const q = local(ev);
                const x = Math.min(x0, q.x), y = Math.min(y0, q.y), w = Math.abs(q.x - x0), h = Math.abs(q.y - y0);
                R.marquee = { x, y, w, h };
                R.selected = new Set(base);
                r.notes.forEach(n => {
                    const nx = R.xOf(n.t), ny = R.yOfRow(R.rowOf(n.n));
                    const nw = n.d * R.prefs.pxPerBar;
                    if (nx + nw > x && nx < x + w && ny + R.rowH > y && ny < y + h) R.selected.add(n);
                });
                R.redraw();
            };
            const up = () => {
                cv.removeEventListener('pointermove', move);
                cv.removeEventListener('pointerup', up);
                R.marquee = null;
                R.redraw();
            };
            cv.addEventListener('pointermove', move);
            cv.addEventListener('pointerup', up);
        }

        // Tastaturbefehle, wenn der Editor den Fokus hat. true = verarbeitet.
        R.onKey = e => {
            const ctrl = e.ctrlKey || e.metaKey;
            const key = e.key.toLowerCase();
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (!R.selected.size) return false;
                WD.history.run('Noten löschen', () => {
                    const s = R.selected;
                    r.notes = r.notes.filter(n => !s.has(n));
                    R.selected = new Set();
                });
                R.changed();
                return true;
            }
            if (ctrl && key === 'a') { R.selected = new Set(r.notes); R.redraw(); return true; }
            if (ctrl && (key === 'c' || key === 'x')) {
                if (!R.selected.size) return false;
                const list = [...R.selected], first = Math.min(...list.map(n => n.t));
                clipboard = list.map(n => Object.assign({}, n, { t: n.t - first }));
                if (key === 'x') {
                    WD.history.run('Noten ausschneiden', () => { r.notes = r.notes.filter(n => !R.selected.has(n)); R.selected = new Set(); });
                    R.changed();
                }
                return true;
            }
            if (ctrl && key === 'v') {
                if (!clipboard) return false;
                const L = R.L();
                let at = R.selected.size
                    ? Math.max(...[...R.selected].map(n => n.t + n.d))
                    : clamp(WD.transport.current() - r.startBar, 0, L - 1 / 16);
                at = Math.round(at / R.gridOf()) * R.gridOf();
                const added = clipboard.map(n => Object.assign({}, n, { t: at + n.t })).filter(n => n.t < L);
                WD.history.run('Noten einfügen', () => r.notes.push(...added));
                R.selected = new Set(added);
                R.changed();
                return true;
            }
            if (!ctrl && key === 'q') { R.quantize(); return true; }
            if (!R.selected.size) return false;
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                const d = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1);
                WD.history.run('Transponieren', () => R.selected.forEach(n => {
                    n.n = R.drum ? clamp(n.n - Math.sign(d), 0, 7) : clamp(n.n + d, 21, 108);
                }));
                R.changed();
                if (!R.drum) preview(R, [...R.selected][0].n, .2);
                return true;
            }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                const d = (e.key === 'ArrowLeft' ? -1 : 1) * R.gridOf();
                WD.history.run('Noten verschieben', () => R.selected.forEach(n => { n.t = clamp(n.t + d, 0, R.L() - 1 / 128); }));
                R.changed();
                return true;
            }
            return false;
        };
    }

    WD.rollInput = { attach };
})();
