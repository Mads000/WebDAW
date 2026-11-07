// Projektmodell: reine, JSON-fähige Daten. Audio-Knoten leben getrennt in der Engine, Audiodaten im Audio-Store.
// Zeiteinheit: 1 "Bar" in den Feldern startBar/lengthBars/t/d = 1 ganze Note (4 Viertel), unabhängig von der Taktart.
'use strict';
(() => {
    const { uid, bus, clamp } = WD;

    const TRACK_COLORS = {
        drum: '#d9a93a', inst: '#57b26a', audio: '#4f8fe0',
    };
    const PALETTE = ['#4f8fe0', '#57b26a', '#d9a93a', '#e0705a', '#b06fd8', '#3fb5b0', '#d96c9c', '#8d97a5'];

    const defaultFx = () => ({
        gate: 0, drive: 0, driveType: 'overdrive', chorus: 0, crush: 0,
        hp: 0, lp: 0, limit: 0,
    });

    function newProject(name) {
        return {
            version: 2, id: uid(), name: name || 'Neues Projekt',
            bpm: 85, timeSig: [4, 4], keyRoot: 'C', keyMode: 'major', keySnap: false,
            tracks: [], markers: [],
            cycle: { on: false, a: 0, b: 4 }, punch: false,
            metronome: false, countIn: false,
            master: { vol: 0.8, mode: 'clean' },
        };
    }

    WD.project = newProject();
    WD.TRACK_COLORS = TRACK_COLORS;
    WD.PALETTE = PALETTE;
    WD.newProject = newProject;

    // Nicht rückgängig zu machender Bedien-Zustand
    WD.view = {
        selTrackId: null, selRegionIds: new Set(),
        ppb: 120, rowH: 72, snap: true, grid: 'auto', bottom: null, bottomH: 320,
        libraryOpen: true, editRegionId: null,
    };

    const M = WD.model = {
        barLen: () => WD.project.timeSig[0] / WD.project.timeSig[1],
        beatLen: () => 1 / WD.project.timeSig[1],
        secPerBar: () => 240 / WD.project.bpm,

        track: id => WD.project.tracks.find(t => t.id === id) || null,
        selTrack: () => M.track(WD.view.selTrackId),

        findRegion(id) {
            for (const t of WD.project.tracks) {
                const r = t.regions.find(x => x.id === id);
                if (r) return { track: t, region: r };
            }
            return null;
        },
        selRegions() {
            const out = [];
            WD.project.tracks.forEach(t => t.regions.forEach(r => {
                if (WD.view.selRegionIds.has(r.id)) out.push({ track: t, region: r });
            }));
            return out;
        },

        normalizeTrack(t) {
            const base = {
                id: uid(), type: 'inst', name: 'Spur', color: null, vol: 0.8, pan: 0, mute: false, solo: false,
                arm: false, monitor: false, inputCh: 'mono1',
                eqL: 0, eqM: 0, eqH: 0, fxRev: 0, fxDly: 0, fxCmp: 0, dbl: false,
                auto: [], showAuto: false, regions: [],
            };
            const out = Object.assign(base, t);
            out.fx = Object.assign(defaultFx(), t.fx || {});
            if (!out.color) out.color = TRACK_COLORS[out.type] || PALETTE[0];
            return out;
        },
        normalizeRegion(r) {
            const out = Object.assign({
                id: uid(), startBar: 0, lengthBars: 1, loopLen: 0, name: 'Region', notes: [],
                offset: 0, rate: 1, gain: 1, fadeIn: 0, fadeOut: 0,
            }, r);
            if (!out.id) out.id = uid();
            return out;
        },

        addTrack(type, name, extra, { select = true, index } = {}) {
            const t = M.normalizeTrack(Object.assign({ type, name }, extra));
            t.regions = t.regions.map(M.normalizeRegion);
            if (index === undefined) WD.project.tracks.push(t); else WD.project.tracks.splice(index, 0, t);
            if (select) WD.view.selTrackId = t.id;
            bus.emit('tracks');
            return t;
        },
        removeTrack(id) {
            const p = WD.project;
            const t = M.track(id);
            if (!t) return;
            t.regions.forEach(r => WD.view.selRegionIds.delete(r.id));
            p.tracks = p.tracks.filter(x => x.id !== id);
            if (WD.view.selTrackId === id) {
                WD.view.selTrackId = p.tracks.length ? p.tracks[p.tracks.length - 1].id : null;
            }
            bus.emit('tracks');
        },
        duplicateTrack(id, { withRegions = true, name } = {}) {
            const t = M.track(id);
            if (!t) return null;
            const copy = JSON.parse(JSON.stringify(t));
            copy.id = uid();
            copy.name = name || (t.name + ' Kopie');
            copy.arm = false; copy.monitor = false;
            copy.regions = withRegions ? copy.regions.map(r => Object.assign(r, { id: uid() })) : [];
            const idx = WD.project.tracks.indexOf(t);
            WD.project.tracks.splice(idx + 1, 0, copy);
            WD.view.selTrackId = copy.id;
            bus.emit('tracks');
            return copy;
        },
        moveTrack(id, newIndex) {
            const arr = WD.project.tracks;
            const from = arr.findIndex(t => t.id === id);
            if (from < 0) return;
            const [t] = arr.splice(from, 1);
            arr.splice(clamp(newIndex, 0, arr.length), 0, t);
            bus.emit('tracks');
        },

        // Tempo: Audio behält seine echte Dauer, deshalb wächst/schrumpft seine Länge in Takten.
        setBpm(bpm) {
            const p = WD.project;
            const v = clamp(Math.round(+bpm) || p.bpm, 30, 300);
            if (v === p.bpm) return v;
            const f = v / p.bpm;
            bus.emit('tempo:before');
            p.tracks.forEach(t => {
                if (t.type === 'audio') t.regions.forEach(r => { r.lengthBars *= f; });
            });
            p.bpm = v;
            bus.emit('tempo');
            bus.emit('tracks');
            return v;
        },

        // Ende des letzten Inhalts in Bar-Einheiten
        contentEnd() {
            let end = 0;
            const p = WD.project;
            p.tracks.forEach(t => t.regions.forEach(r => { end = Math.max(end, r.startBar + r.lengthBars); }));
            p.markers.forEach(m => { end = Math.max(end, m.startBar + m.lengthBars); });
            return end;
        },
        // Länge der Zeitleiste: immer etwas Platz hinter dem Inhalt
        timelineBars: () => Math.max(64, Math.ceil(M.contentEnd()) + 32),
    };
})();
