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
        ppb: 120, rowH: 72, snap: true, grid: 'auto', bottom: null, bottomH: 320, editorH: 470,
        libraryOpen: true, editRegionId: null, takesOpen: new Set(),
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
                fxRevSize: 0.5, fxDlyDiv: '1/8.',
                auto: [], autos: {}, autoParam: 'vol', showAuto: false, regions: [],
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
                if (t.type === 'audio') t.regions.forEach(r => { r.lengthBars *= f; if (r.loopLen) r.loopLen *= f; });
            });
            p.bpm = v;
            bus.emit('tempo');
            bus.emit('tracks');
            return v;
        },

        // Loop: loopLen ist die Länge des Inhalts, lengthBars die Länge samt Wiederholungen
        isLooped: r => !!r.loopLen && r.loopLen < r.lengthBars - 1e-6,
        // Eine geloopte Audio-Region als Folge einzelner Durchgänge; jeder spielt wie eine eigene Region.
        // Fade-In gilt nur am Anfang, Fade-Out nur am Ende.
        loopPieces(r) {
            if (!M.isLooped(r)) return [r];
            const L = r.loopLen, end = r.startBar + r.lengthBars, out = [];
            for (let k = 0; r.startBar + k * L < end - 1e-6; k++) {
                const s = r.startBar + k * L, len = Math.min(L, end - s);
                out.push(Object.assign({}, r, {
                    startBar: s, lengthBars: len, loopLen: 0, loopIdx: k,
                    fadeIn: k ? 0 : r.fadeIn, fadeOut: s + len >= end - 1e-6 ? r.fadeOut : 0,
                }));
            }
            return out;
        },
        // Alles, was tatsächlich erklingt: Loop-Durchgänge, innerhalb davon die Abschnitte eines Comps
        audioPieces: r => M.loopPieces(r).flatMap(M.compPieces),

        // Takes und Comping. Alle Takes einer Region liegen auf einer gemeinsamen Zeitachse in Sekunden:
        // startSec sagt, wo der Puffer eines Takes auf dieser Achse beginnt. So bleibt ein Comp auch nach Trimmen,
        // Teilen und Tempowechseln an der richtigen Stelle.
        takeStart: tk => (tk && tk.startSec) || 0,
        takeWindow(r) {
            const active = r.takes ? r.takes[r.takeIdx || 0] : null;
            const t0 = (r.offset || 0) + M.takeStart(active);
            const bars = M.isLooped(r) ? r.loopLen : r.lengthBars;
            return { t0, t1: t0 + bars * M.secPerBar() * (r.rate || 1) };
        },
        compPieces(r) {
            if (!r.comp || !r.comp.length || !r.takes) return [r];
            const XF = 0.008; // Überblendung an den Schnittstellen gegen Knackser
            const spb = M.secPerBar(), rate = r.rate || 1, lenSec = r.lengthBars * spb;
            const t0 = (r.offset || 0) + M.takeStart(r.takes[r.takeIdx || 0]);
            const spans = r.comp.slice().sort((a, b) => a.t0 - b.t0).map(s => ({
                a: Math.max(0, (s.t0 - t0) / rate), b: Math.min(lenSec, (s.t1 - t0) / rate), tk: r.takes[s.take],
            })).filter(s => s.tk && s.b > s.a + 1e-4);
            const out = [];
            spans.forEach((s, i) => {
                const joinL = i > 0 && Math.abs(spans[i - 1].b - s.a) < 1e-4;
                const joinR = i < spans.length - 1 && Math.abs(spans[i + 1].a - s.b) < 1e-4;
                let a = joinL ? s.a - XF / 2 : s.a;
                const b = joinR ? s.b + XF / 2 : s.b;
                let off = t0 + a * rate - M.takeStart(s.tk);
                if (off < 0) { a -= off / rate; off = 0; } // Dieser Take beginnt erst später
                if (b <= a + 1e-4) return;
                out.push(Object.assign({}, r, {
                    startBar: r.startBar + a / spb, lengthBars: (b - a) / spb, bufId: s.tk.bufId, offset: off, loopLen: 0, comp: null,
                    fadeIn: joinL ? XF : (s.a < 1e-6 ? r.fadeIn : 0),
                    fadeOut: joinR ? XF : (lenSec - s.b < 1e-6 ? r.fadeOut : 0),
                }));
            });
            return out;
        },

        // Automation: Lautstärke liegt in t.auto, alles andere in t.autos[param]. Werte immer 0…1.
        AUTO: {
            vol: { label: 'Lautstärke', short: 'Lautst.', def: () => 1 },
            pan: { label: 'Panorama', short: 'Pan', def: t => ((t.pan || 0) + 1) / 2 },
            rev: { label: 'Hall', short: 'Hall', def: t => t.fxRev || 0 },
            lp: { label: 'Filter (Tiefpass)', short: 'Filter', def: t => 1 - ((t.fx && t.fx.lp) || 0) },
        },
        autoList: (t, key = 'vol') => (key === 'vol' ? t.auto : (t.autos && t.autos[key])) || [],

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
