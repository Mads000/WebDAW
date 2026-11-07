// Maus-Bedienung der Spuren-Fläche: Auswahl, Rahmen, Verschieben (auch auf andere Spuren), Kopieren mit Alt, Trimmen.
// Alle Ereignisse laufen über einen einzigen delegierten Listener.
'use strict';
(() => {
    const { $, bus, uid } = WD;
    const M = WD.model, V = WD.timeline, Ops = WD.regionOps;
    const rows = $('trackRows'), marquee = $('marquee');

    function capture(e, onMove, onUp) {
        const move = ev => onMove(ev);
        const up = ev => {
            removeEventListener('pointermove', move);
            removeEventListener('pointerup', up);
            removeEventListener('pointercancel', up);
            onUp(ev);
        };
        addEventListener('pointermove', move);
        addEventListener('pointerup', up);
        addEventListener('pointercancel', up);
    }

    function trackIndexAt(clientY) {
        const list = [...rows.querySelectorAll('.trow')];
        for (let i = 0; i < list.length; i++) {
            const r = list[i].getBoundingClientRect();
            if (clientY < r.bottom) return i;
        }
        return list.length - 1;
    }

    function selectTrack(id) {
        if (WD.view.selTrackId === id) return;
        WD.view.selTrackId = id;
        bus.emit('track:selected');
    }

    function startMove(e, tr, r) {
        const tx = WD.history.begin('Region verschieben');
        const sel = M.selRegions();
        const startClient = e.clientX, startRow = trackIndexAt(e.clientY);
        const orig = sel.map(s => ({
            region: s.region, track: s.track, start: s.region.startBar,
            idx: WD.project.tracks.indexOf(s.track),
        }));
        const minStart = Math.min(...orig.map(o => o.start));
        let moved = false, copied = false;

        capture(e, ev => {
            const dxPx = ev.clientX - startClient;
            const rowDelta = trackIndexAt(ev.clientY) - startRow;
            if (!moved && Math.abs(dxPx) < 4 && rowDelta === 0) return;
            if (!moved) {
                moved = true;
                if (ev.altKey) {
                    // Alt beim Start: Kopien bleiben stehen, das Original wandert mit
                    copied = true;
                    orig.forEach(o => { o.track.regions.push(Object.assign(JSON.parse(JSON.stringify(o.region)), { id: uid() })); });
                }
            }
            let target = r.startBar;
            target = V.snap(orig.find(o => o.region === r).start + dxPx / WD.view.ppb, ev);
            let delta = target - orig.find(o => o.region === r).start;
            delta = Math.max(delta, -minStart);
            orig.forEach(o => { o.region.startBar = o.start + delta; });

            // Vertikal: nur wenn alle Zielspuren denselben Typ haben
            const tracks = WD.project.tracks;
            const ok = orig.every(o => {
                const t = tracks[o.idx + rowDelta];
                return t && t.type === o.track.type;
            });
            if (ok) {
                orig.forEach(o => {
                    const dest = tracks[o.idx + rowDelta];
                    const cur = tracks.find(t => t.regions.includes(o.region));
                    if (cur !== dest) {
                        cur.regions = cur.regions.filter(x => x !== o.region);
                        dest.regions.push(o.region);
                    }
                });
            }
            bus.emit('regions');
        }, () => {
            tx.end();
            if (moved) {
                const anyAudio = orig.some(o => o.region.bufId);
                if (anyAudio) bus.emit('audio:edited');
                bus.emit('regions');
                if (copied) bus.emit('selection');
            }
        });
    }

    function startResizeRight(e, tr, r) {
        const tx = WD.history.begin('Region-Länge');
        const sx = e.clientX, orig = r.lengthBars;
        if (!r.bufId && !r.loopLen) r.loopLen = r.lengthBars;
        // Ungeloopte Audio-Regionen enden mit der Aufnahme; geloopte dürfen beliebig weiterlaufen
        const maxLen = () => {
            const buf = WD.audioStore.get(r.bufId);
            if (!buf || r.loopLen) return Infinity;
            return Math.max(0.02, (buf.duration - (r.offset || 0)) / (r.rate || 1) / M.secPerBar());
        };
        capture(e, ev => {
            const end = V.snap(r.startBar + orig + (ev.clientX - sx) / WD.view.ppb, ev);
            r.lengthBars = Math.min(maxLen(), Math.max(V.gridStep() / 2, end - r.startBar));
            bus.emit('regions');
        }, () => { tx.end(); if (r.bufId) bus.emit('audio:edited'); bus.emit('editor:refresh'); });
    }

    // Loop-Griff: Ziehen wiederholt den Inhalt der Region bis zur neuen Länge
    function startLoopDrag(e, tr, r) {
        const tx = WD.history.begin('Region loopen');
        const sx = e.clientX, orig = r.lengthBars;
        const setLoop = !r.loopLen;
        if (setLoop) r.loopLen = r.lengthBars;
        capture(e, ev => {
            const end = V.snap(r.startBar + orig + (ev.clientX - sx) / WD.view.ppb, ev);
            r.lengthBars = Math.max(Math.min(r.loopLen, V.gridStep() / 2), end - r.startBar);
            bus.emit('regions');
        }, () => {
            // Nicht über den Inhalt hinaus gezogen: kein Loop
            if (setLoop && r.lengthBars <= r.loopLen + 1e-6) r.loopLen = 0;
            tx.end();
            if (r.bufId) bus.emit('audio:edited');
            bus.emit('regions'); bus.emit('editor:refresh');
        });
    }

    function startResizeLeft(e, tr, r) {
        const tx = WD.history.begin('Region trimmen');
        const sx = e.clientX, s0 = r.startBar, l0 = r.lengthBars, off0 = r.offset || 0, loop0 = r.loopLen || 0;
        const rate = r.rate || 1;
        capture(e, ev => {
            let start = V.snap(s0 + (ev.clientX - sx) / WD.view.ppb, ev);
            let d = start - s0;
            d = Math.min(d, l0 - V.gridStep() / 2);
            if (loop0) d = Math.min(d, loop0 - V.gridStep() / 2);
            if (off0 + d * M.secPerBar() * rate < 0) d = -off0 / (M.secPerBar() * rate);
            r.startBar = s0 + d; r.lengthBars = l0 - d;
            if (loop0) r.loopLen = loop0 - d; // der Inhalt wird vorne gekürzt, also auch jeder Durchgang
            r.offset = off0 + d * M.secPerBar() * rate;
            bus.emit('regions');
        }, () => { tx.end(); bus.emit('audio:edited'); bus.emit('editor:refresh'); });
    }

    function startMarquee(e) {
        const x0 = e.clientX, y0 = e.clientY;
        const additive = e.shiftKey;
        const base = new Set(additive ? WD.view.selRegionIds : []);
        let active = false;
        capture(e, ev => {
            if (!active && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
            active = true;
            const l = Math.min(x0, ev.clientX), t = Math.min(y0, ev.clientY);
            const w = Math.abs(ev.clientX - x0), h = Math.abs(ev.clientY - y0);
            Object.assign(marquee.style, { display: 'block', left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px' });
            const ids = new Set(base);
            rows.querySelectorAll('.region').forEach(n => {
                const b = n.getBoundingClientRect();
                if (b.right > l && b.left < l + w && b.bottom > t && b.top < t + h) ids.add(n.dataset.id);
            });
            WD.view.selRegionIds = ids;
            bus.emit('selection');
        }, () => {
            marquee.style.display = 'none';
            if (!active && !additive) Ops.clearSelection();
        });
    }

    rows.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        if (e.target.closest('.thead') || e.target.classList.contains('autoCv')) return;
        const laneEl = e.target.closest('.tlane');
        if (!laneEl) return;
        e.preventDefault();
        if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
        WD.view.focus = 'timeline';
        const regionEl = e.target.closest('.region');
        const tr = M.track(laneEl.dataset.id);
        selectTrack(tr.id);
        if (!regionEl) { startMarquee(e); return; }

        const { region: r, track } = M.findRegion(regionEl.dataset.id);
        const sel = WD.view.selRegionIds;
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
            if (sel.has(r.id)) sel.delete(r.id); else sel.add(r.id);
            bus.emit('selection');
            if (!sel.has(r.id)) return;
        } else if (!sel.has(r.id)) {
            Ops.selectOnly([r.id]);
        }
        if (e.target.classList.contains('rloop')) startLoopDrag(e, track, r);
        else if (e.target.classList.contains('rsz')) startResizeRight(e, track, r);
        else if (e.target.classList.contains('rszL')) startResizeLeft(e, track, r);
        else startMove(e, track, r);
    });

    rows.addEventListener('dblclick', e => {
        if (e.target.closest('.thead') || e.target.classList.contains('autoCv')) return;
        const laneEl = e.target.closest('.tlane');
        if (!laneEl) return;
        const regionEl = e.target.closest('.region');
        if (regionEl) { WD.editor.open(regionEl.dataset.id); return; }
        const tr = M.track(laneEl.dataset.id);
        if (tr.type === 'audio') return;
        const rect = laneEl.getBoundingClientRect();
        const barL = M.barLen();
        const bar = Math.floor((e.clientX - rect.left) / WD.view.ppb / barL) * barL;
        const r = M.normalizeRegion({ startBar: bar, lengthBars: barL, loopLen: 0, notes: [], name: tr.type === 'drum' ? 'Beat' : 'Noten' });
        WD.history.run('Region anlegen', () => tr.regions.push(r));
        Ops.selectOnly([r.id]);
        bus.emit('regions');
        WD.editor.open(r.id);
    });

    rows.addEventListener('contextmenu', e => {
        if (e.target.closest('.thead')) return;
        const laneEl = e.target.closest('.tlane');
        if (!laneEl) return;
        e.preventDefault();
        const regionEl = e.target.closest('.region');
        if (!regionEl) {
            const tr = M.track(laneEl.dataset.id);
            selectTrack(tr.id);
            WD.ui.menu(e.clientX, e.clientY, [
                { label: 'Einfügen am Playhead', shortcut: 'Strg+V', action: Ops.paste },
                { label: 'Alle Regionen auswählen', shortcut: 'Strg+A', action: Ops.selectAll },
            ]);
            return;
        }
        const f = M.findRegion(regionEl.dataset.id);
        if (!WD.view.selRegionIds.has(f.region.id)) Ops.selectOnly([f.region.id]);
        selectTrack(f.track.id);
        Ops.contextMenu(e.clientX, e.clientY, f.track, f.region);
    });

    WD.regionInput = { selectTrack };
})();
