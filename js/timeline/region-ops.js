// Bearbeitungsbefehle für Regionen: Teilen, Duplizieren, Löschen, Kopieren, Einfügen, Quantisieren.
'use strict';
(() => {
    const { bus, uid } = WD;
    const M = WD.model;
    let clipboard = null;

    const clone = r => JSON.parse(JSON.stringify(r));

    // Teilt eine Region an einer Position, Rückgabe ist der rechte Teil. Geloopte MIDI-Regionen werden dabei ausgeschrieben.
    function splitAt(tr, r, bar) {
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
            WD.history.run('Einfügen', () => clipboard.forEach(c => {
                let tr = singleTrack && sel && sel.type === c.type ? sel : M.track(c.trackId);
                if (!tr || tr.type !== c.type) tr = WD.project.tracks.find(x => x.type === c.type);
                if (!tr) return;
                const r = Object.assign(clone(c.region), { id: uid(), startBar: at + c.rel });
                tr.regions.push(r);
                newIds.push(r.id);
            }));
            if (!newIds.length) { WD.ui.toast('Keine passende Spur zum Einfügen vorhanden.'); return; }
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

        // Schreibt eine geloopte Region aus, sodass jede Wiederholung einzeln bearbeitbar ist
        unloop(tr, r) {
            if (r.bufId || !(r.loopLen && r.loopLen < r.lengthBars)) return;
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
                { sep: 1 },
                { label: 'Teilen am Playhead', icon: 'scissors', shortcut: 'Strg+T', action: Ops.splitAtPlayhead },
                { label: n > 1 ? `${n} Regionen duplizieren` : 'Duplizieren', icon: 'copy', shortcut: 'Strg+D', action: Ops.duplicate },
                { label: 'Kopieren', shortcut: 'Strg+C', action: Ops.copy },
                { label: 'Ausschneiden', shortcut: 'Strg+X', action: Ops.cut },
                { label: 'Einfügen am Playhead', shortcut: 'Strg+V', disabled: !clipboard, action: Ops.paste },
                !region.bufId && { label: 'Loop auflösen', icon: 'loop', disabled: !(region.loopLen && region.loopLen < region.lengthBars), action: () => Ops.unloop(track, region) },
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
