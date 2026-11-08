// Bearbeitungsbefehle für Regionen: Teilen, Duplizieren, Löschen, Kopieren, Einfügen, Quantisieren.
'use strict';
(() => {
    const { bus, uid } = WD;
    const M = WD.model;
    let clipboard = null;

    const clone = r => JSON.parse(JSON.stringify(r));

    // Teilt eine Region an einer Position, Rückgabe ist der rechte Teil. Geloopte MIDI-Regionen werden dabei ausgeschrieben.
    // Eine geloopte Audio-Region in einzelne Regionen je Durchgang zerlegen; r wird zum ersten Durchgang
    function expandAudioLoop(tr, r) {
        const pieces = M.loopPieces(r);
        if (pieces.length < 2) return [r];
        const out = [r];
        pieces.slice(1).forEach(pc => {
            const c = Object.assign(clone(pc), { id: uid() });
            delete c.loopIdx;
            tr.regions.push(c); out.push(c);
        });
        Object.assign(r, { lengthBars: pieces[0].lengthBars, loopLen: 0, fadeOut: 0 });
        return out;
    }

    function splitAt(tr, r, bar) {
        if (r.bufId && M.isLooped(r)) {
            const parts = expandAudioLoop(tr, r);
            r = parts.find(p => bar > p.startBar + 1e-6 && bar < p.startBar + p.lengthBars - 1e-6);
            if (!r) return parts.find(p => Math.abs(p.startBar - bar) < 1e-6) || null;
        }
        const cut = bar - r.startBar;
        if (cut <= 1e-6 || cut >= r.lengthBars - 1e-6) return null;
        let r2;
        if (r.bufId) {
            r2 = Object.assign(clone(r), {
                id: uid(), startBar: bar, lengthBars: r.lengthBars - cut,
                offset: (r.offset || 0) + cut * M.secPerBar() * (r.rate || 1), fadeIn: 0,
            });
            r.lengthBars = cut;
            r.fadeOut = 0;
        } else {
            const L = r.loopLen || r.lengthBars, n1 = [], n2 = [];
            r.notes.forEach(nt => {
                for (let k = 0; ; k++) {
                    const abs = k * L + nt.t;
                    if (abs >= r.lengthBars) break;
                    const copy = Object.assign({}, nt, { t: abs });
                    if (abs < cut) { n1.push(copy); }
                    else { copy.t = abs - cut; n2.push(copy); }
                }
            });
            r2 = Object.assign(clone(r), { id: uid(), startBar: bar, lengthBars: r.lengthBars - cut, loopLen: 0, notes: n2 });
            r.notes = n1; r.lengthBars = cut; r.loopLen = 0;
        }
        tr.regions.push(r2);
        return r2;
    }

    function notify(hasAudio) {
        bus.emit('regions');
        bus.emit('selection');
        if (hasAudio) bus.emit('audio:edited');
    }

    const Ops = WD.regionOps = {
        splitAt,

        selectOnly(ids) {
            WD.view.selRegionIds = new Set(ids);
            bus.emit('selection');
        },
        selectAll() { Ops.selectOnly(WD.project.tracks.flatMap(t => t.regions.map(r => r.id))); },
        clearSelection() { if (WD.view.selRegionIds.size) Ops.selectOnly([]); },

        // Teilt die Auswahl am Playhead; ohne Auswahl alle Regionen der aktiven Spur unter dem Playhead
        splitAtPlayhead() {
            const bar = WD.transport.current();
            let targets = M.selRegions();
            if (!targets.length) {
                const t = M.selTrack();
                if (t) targets = t.regions.filter(r => bar > r.startBar && bar < r.startBar + r.lengthBars).map(region => ({ track: t, region }));
            }
            targets = targets.filter(({ region: r }) => bar > r.startBar + 1e-6 && bar < r.startBar + r.lengthBars - 1e-6);
            if (!targets.length) {
                WD.ui.toast('Der Playhead muss innerhalb einer Region stehen.');
                return;
            }
            WD.history.run('Teilen', () => targets.forEach(({ track, region }) => {
                const r2 = splitAt(track, region, bar);
                if (r2) WD.view.selRegionIds.add(r2.id);
            }));
            notify(targets.some(x => x.region.bufId));
        },

        duplicate() {
            const sel = M.selRegions();
            if (!sel.length) { WD.ui.toast('Keine Region ausgewählt.'); return; }
            const first = Math.min(...sel.map(s => s.region.startBar));
            const last = Math.max(...sel.map(s => s.region.startBar + s.region.lengthBars));
            const span = last - first;
            const newIds = [];
            WD.history.run('Duplizieren', () => sel.forEach(({ track, region }) => {
                const c = Object.assign(clone(region), { id: uid(), startBar: region.startBar + span });
                track.regions.push(c);
                newIds.push(c.id);
            }));
            WD.view.selRegionIds = new Set(newIds);
            notify(sel.some(x => x.region.bufId));
        },

        remove() {
            const sel = M.selRegions();
            if (!sel.length) return false;
            WD.history.run('Löschen', () => sel.forEach(({ track, region }) => {
                track.regions = track.regions.filter(x => x !== region);
            }));
            if (sel.some(s => s.region.id === WD.view.editRegionId)) WD.view.editRegionId = null;
            WD.view.selRegionIds = new Set();
            notify(sel.some(x => x.region.bufId));
            bus.emit('editor:refresh');
            return true;
        },

        copy() {
            const sel = M.selRegions();
            if (!sel.length) return false;
            const first = Math.min(...sel.map(s => s.region.startBar));
            clipboard = sel.map(({ track, region }) => ({
                trackId: track.id, type: track.type, rel: region.startBar - first, region: clone(region),
            }));
            return true;
        },
        cut() { if (Ops.copy()) Ops.remove(); },
        paste() {
            if (!clipboard || !clipboard.length) return;
            const at = WD.transport.current();
            const sel = M.selTrack();
            const newIds = [];
            const singleTrack = new Set(clipboard.map(c => c.trackId)).size === 1;
            const placed = clipboard.map(c => {
                let tr = singleTrack && sel && sel.type === c.type ? sel : M.track(c.trackId);
                if (!tr || tr.type !== c.type) tr = WD.project.tracks.find(x => x.type === c.type);
                return { c, tr };
            }).filter(x => x.tr);
            if (!placed.length) { WD.ui.toast('Keine passende Spur zum Einfügen vorhanden.'); return; }
            // Liegt am Ziel schon etwas, rückt die ganze Einfügung dahinter; es liegt nie etwas unsichtbar übereinander
            let pos = at;
            for (let guard = 0; guard < 2000; guard++) {
                let next = null;
                placed.forEach(({ c, tr }) => {
                    const a = pos + c.rel, b = a + c.region.lengthBars;
                    tr.regions.forEach(x => {
                        const end = x.startBar + x.lengthBars;
                        if (x.startBar < b - 1e-6 && end > a + 1e-6) next = Math.max(next === null ? -Infinity : next, end - c.rel);
                    });
                });
                if (next === null) break;
                pos = next;
            }
            WD.history.run('Einfügen', () => placed.forEach(({ c, tr }) => {
                const r = Object.assign(clone(c.region), { id: uid(), startBar: pos + c.rel });
                tr.regions.push(r);
                newIds.push(r.id);
            }));
            if (pos > at + 1e-6) WD.ui.toast('Am Playhead lag schon eine Region, deshalb direkt dahinter eingefügt.');
            WD.view.selRegionIds = new Set(newIds);
            notify(true);
        },

        rename(region) {
            return WD.ui.prompt('Region umbenennen', region.name).then(nn => {
                if (!nn) return;
                WD.history.run('Umbenennen', () => { region.name = nn; });
                bus.emit('regions');
            });
        },

        // Loopt die Regionen bis zur nächsten Region auf derselben Spur oder bis zum Songende
        loopToEnd(targets = M.selRegions()) {
            if (!targets.length) { WD.ui.toast('Keine Region ausgewählt.'); return; }
            const songEnd = M.contentEnd();
            WD.history.run('Loopen', () => targets.forEach(({ track, region: r }) => {
                const L = r.loopLen && r.loopLen < r.lengthBars ? r.loopLen : r.lengthBars;
                const myEnd = r.startBar + r.lengthBars;
                const next = track.regions.filter(x => x !== r && x.startBar >= myEnd - 1e-6).map(x => x.startBar);
                let end = next.length ? Math.min(...next) : songEnd;
                if (end <= myEnd + 1e-6) end = r.startBar + 4 * L; // schon am Ende: vier Durchgänge
                if (end <= myEnd + 1e-6) return;
                r.loopLen = L;
                r.lengthBars = end - r.startBar;
            }));
            notify(targets.some(x => x.region.bufId));
            bus.emit('editor:refresh');
        },
        // Nimmt die Wiederholungen weg; übrig bleibt ein Durchgang
        removeLoop(targets = M.selRegions()) {
            const looped = targets.filter(x => M.isLooped(x.region));
            if (!looped.length) return;
            WD.history.run('Loop entfernen', () => looped.forEach(({ region: r }) => {
                r.lengthBars = r.loopLen; r.loopLen = 0;
            }));
            notify(looped.some(x => x.region.bufId));
            bus.emit('editor:refresh');
        },
        // Taste L: ausgewählte Regionen loopen, oder den Loop entfernen, wenn alle schon geloopt sind
        toggleLoop() {
            const sel = M.selRegions();
            if (!sel.length) { WD.ui.toast('Erst eine Region auswählen, dann L drücken.'); return; }
            if (sel.every(x => M.isLooped(x.region))) Ops.removeLoop(sel); else Ops.loopToEnd(sel.filter(x => !M.isLooped(x.region)));
        },

        // Schreibt eine geloopte Region aus, sodass jede Wiederholung einzeln bearbeitbar ist
        unloop(tr, r) {
            if (!M.isLooped(r)) return;
            if (r.bufId) {
                let parts = [];
                WD.history.run('Loop auflösen', () => { parts = expandAudioLoop(tr, r); });
                WD.view.selRegionIds = new Set(parts.map(p => p.id));
                notify(true);
                return;
            }
            WD.history.run('Loop auflösen', () => {
                const L = r.loopLen, out = [];
                r.notes.forEach(nt => {
                    for (let k = 0; ; k++) {
                        const abs = k * L + nt.t;
                        if (abs >= r.lengthBars) break;
                        out.push(Object.assign({}, nt, { t: abs }));
                    }
                });
                r.notes = out; r.loopLen = 0;
            });
            bus.emit('regions');
            bus.emit('editor:refresh');
        },

        contextMenu(x, y, track, region) {
            const n = M.selRegions().length;
            WD.ui.menu(x, y, [
                { label: 'Öffnen im Editor', icon: 'roll', action: () => WD.editor.open(region.id) },
                { label: 'Umbenennen …', action: () => Ops.rename(region) },
                region.takes && region.takes.length > 1 && { label: WD.view.takesOpen.has(region.id) ? 'Takes einklappen' : 'Takes aufklappen (Comping)', action: () => WD.comping.toggle(region.id) },
                { sep: 1 },
                { label: 'Teilen am Playhead', icon: 'scissors', shortcut: 'Strg+T', action: Ops.splitAtPlayhead },
                { label: n > 1 ? `${n} Regionen duplizieren` : 'Duplizieren', icon: 'copy', shortcut: 'Strg+D', action: Ops.duplicate },
                { label: 'Kopieren', shortcut: 'Strg+C', action: Ops.copy },
                { label: 'Ausschneiden', shortcut: 'Strg+X', action: Ops.cut },
                { label: 'Einfügen am Playhead', shortcut: 'Strg+V', disabled: !clipboard, action: Ops.paste },
                { sep: 1 },
                { label: n > 1 ? `${n} Regionen loopen bis Songende` : 'Loopen bis Songende', icon: 'loop', shortcut: 'L', action: () => Ops.loopToEnd() },
                { label: 'Loop entfernen', disabled: !M.selRegions().some(x => M.isLooped(x.region)), action: () => Ops.removeLoop() },
                { label: 'Loop auflösen (einzeln bearbeitbar)', disabled: !M.isLooped(region), action: () => Ops.unloop(track, region) },
                ...(track.type === 'audio' ? WD.regionFx.menuItems(region) : []),
                { sep: 1 },
                {
                    label: 'Cycle auf diese Region', icon: 'cycle', action: () => {
                        WD.history.run('Cycle-Bereich', () => {
                            WD.project.cycle.on = true;
                            WD.transport.setCycle(region.startBar, region.startBar + region.lengthBars);
                        });
                    },
                },
                { sep: 1 },
                { label: n > 1 ? `${n} Regionen löschen` : 'Löschen', icon: 'trash', shortcut: 'Entf', danger: true, action: Ops.remove },
            ]);
        },
    };
})();
