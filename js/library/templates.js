// Song-Vorlagen: Gitarren und Ukulele sind aufnahmebereite Audio-Spuren für echte Instrumente.
// Synth-Parts laufen nur als "Guide" zur Orientierung mit und lassen sich stumm schalten oder löschen.
// Akkordfolgen und Pattern sind allgemeine Standardmuster, keine Übernahmen bestimmter Songs.
'use strict';
(() => {
    const { el } = WD;
    const M = WD.model;
    const NOTE = { C: 48, 'C#': 49, Db: 49, D: 50, Eb: 51, E: 52, F: 53, 'F#': 54, G: 55, Ab: 56, A: 57, Bb: 58, B: 59 };

    function chordNotes(name) {
        const minor = name.endsWith('m');
        const root = NOTE[minor ? name.slice(0, -1) : name];
        return { root, tones: [root, root + 7, root + 12, root + (minor ? 15 : 16), root + 19] };
    }
    function strum(prog, pattern, oct = 0, spread = .005) {
        const out = [];
        prog.forEach((c, b) => pattern.forEach(([s, v, d]) => chordNotes(c).tones.forEach((n, i) =>
            out.push({ t: b + s + i * spread, n: n + oct, d: d || .2, v }))));
        return out;
    }
    function bassLine(prog, pattern) {
        const out = [];
        prog.forEach((c, b) => pattern.forEach(([s, v, d, iv]) => out.push({ t: b + s, n: chordNotes(c).root - 12 + (iv || 0), d: d || .2, v })));
        return out;
    }
    function drums(bars, { hat = .125, hatVel = .45, tamb = false, kickExtra = [] } = {}) {
        const o = [];
        for (let b = 0; b < bars; b++) {
            o.push({ t: b, n: 0, d: .05 }, { t: b + .5, n: 0, d: .05, v: .85 });
            kickExtra.forEach(k => o.push({ t: b + k, n: 0, d: .05, v: .7 }));
            o.push({ t: b + .25, n: 1, d: .05 }, { t: b + .75, n: 1, d: .05 });
            for (let s = 0; s < 1; s += hat) o.push({ t: b + s, n: 2, d: .03, v: hatVel });
            if (tamb) for (let s = 0; s < 1; s += .125) o.push({ t: b + s, n: 7, d: .03, v: s % .25 === 0 ? .8 : .4 });
        }
        return o;
    }
    const region = (startBar, lengthBars, notes, name, loopLen) => ({ startBar, lengthBars, notes, name, loopLen: loopLen || 0 });
    const form = list => {
        let pos = 0;
        return list.map(([name, bars]) => { const m = { name, startBar: pos, lengthBars: bars }; pos += bars; return m; });
    };
    const patched = (track, name) => { WD.patches.apply(track, name); return track; };
    // Audio-Spur für ein echtes Instrument mit passendem Klang
    const real = (add, name, patch, pan = 0) => {
        const t = patched(add('audio', name, {}), patch);
        t.pan = pan;
        return t;
    };

    const STRUM = [[0, 1], [.25, .7], [.375, .6], [.625, .65], [.75, .8]];

    const T = {
        'Schnelle Idee': {
            desc: 'Sofort aufnehmen: Gitarre und Gesang, Klick an. Für den Moment, in dem die Idee da ist.',
            bpm: 90, key: ['C', 'major'],
            build(add, p) {
                p.metronome = true;
                const g = add('audio', 'Gitarre', {}); patched(g, 'Akustikgitarre'); g.arm = true;
                patched(add('audio', 'Gesang', {}), 'Lead-Vocal');
                return g;
            },
        },
        'Bedroom-Pop': {
            desc: 'Echte Ukulele (doppelt), Beat, Bass und mehrstimmiger Gesang. Einfache Akkorde als Guide, leicht Lo-Fi.',
            bpm: 92, key: ['C', 'major'],
            build(add, p) {
                const prog = ['C', 'G', 'Am', 'F'];
                p.markers = form([['Intro', 4], ['Verse', 8], ['Chorus', 8], ['Verse', 8], ['Chorus', 8], ['Outro', 4]]);
                const u = real(add, 'Ukulele', 'Ukulele', -.1);
                u.arm = true;
                real(add, 'Ukulele Dopplung', 'Ukulele', .35);
                const guide = add('inst', 'Guide (Akkorde)', { inst: 'Ukulele', vol: .45, fxRev: .1 });
                guide.regions.push(region(0, 40, strum(prog, STRUM, -12), 'Guide', 4));
                const dr = add('drum', 'Beat', { kit: 'Bedroom' }); patched(dr, 'Lo-Fi Beat');
                dr.regions.push(region(4, 36, drums(4, { hat: .125 }), 'Beat', 4));
                const b = add('inst', 'Bass', { inst: 'Sub Bass', vol: .7 });
                b.regions.push(region(4, 36, bassLine(prog, [[0, 1, .4], [.5, .8, .3]]), 'Bass', 4));
                const k = add('inst', 'Lo-Fi Keys', { inst: 'Lo-Fi Keys', vol: .5, pan: .25, fxRev: .25 });
                k.regions.push(region(12, 8, strum(prog, [[0, .7, .9]], 0, .002), 'Keys', 4));
                patched(add('audio', 'Lead-Vocal', {}), 'Bedroom-Vocal');
                const h = add('audio', 'Harmonie', { pan: -.3 }); patched(h, 'Harmonie-Vocal');
                const h2 = add('audio', 'Harmonie 2', { pan: .3 }); patched(h2, 'Harmonie-Vocal');
                return u;
            },
        },
        'Indie-Rock organisch': {
            desc: 'Spuren für Akustik- und E-Gitarren zum Einspielen, Live-Drums, ruhige Strophen, die sich zum Refrain steigern.',
            bpm: 118, key: ['G', 'major'],
            build(add, p) {
                const vs = ['G', 'Em', 'C', 'D'], ch = ['C', 'G', 'D', 'Em'];
                p.markers = form([['Intro', 4], ['Verse', 8], ['Pre-Chorus', 4], ['Chorus', 8], ['Verse', 8], ['Pre-Chorus', 4], ['Chorus', 8], ['Bridge', 8], ['Chorus', 8], ['Outro', 4]]);
                const a = real(add, 'Akustikgitarre', 'Akustikgitarre', -.25);
                a.arm = true;
                real(add, 'E-Gitarre Clean', 'Indie Clean', .4);
                real(add, 'E-Gitarre Crunch L', 'Crunch', -.6);
                real(add, 'E-Gitarre Crunch R', 'Crunch', .6);
                const guide = add('inst', 'Guide (Akkorde)', { inst: 'Steel Acoustic', vol: .45 });
                guide.regions.push(region(0, 12, strum(vs, STRUM), 'Guide Strophe', 4));
                guide.regions.push(region(12, 12, strum(ch, [[0, .9], [.5, .7]]), 'Guide Refrain', 4));
                const dr = add('drum', 'Live-Drums', { kit: 'Live Room' }); patched(dr, 'Live-Drums');
                dr.regions.push(region(4, 8, drums(4, { hat: .25, hatVel: .35 }), 'Sparsam', 4));
                dr.regions.push(region(12, 12, drums(4, { hat: .125 }), 'Voll', 4));
                const b = add('inst', 'Bass', { inst: 'Picked Bass', vol: .75 }); patched(b, 'Bass DI');
                b.regions.push(region(4, 20, bassLine(ch, [[0, 1, .24], [.25, .75, .2], [.5, .9, .24], [.75, .7, .2, 7]]), 'Bass', 4));
                patched(add('audio', 'Gesang', {}), 'Lead-Vocal');
                return a;
            },
        },
        'Gitarrenrock-Hymne': {
            desc: 'Spuren für zwei Rhythmusgitarren links und rechts, Akustik, Lead, dazu Tamburin und großer Refrain. Master auf 90s.',
            bpm: 86, key: ['E', 'minor'],
            build(add, p) {
                const vs = ['Em', 'G', 'D', 'A'], ch = ['C', 'G', 'Em', 'D'];
                p.master.mode = '90s';
                p.markers = form([['Intro', 4], ['Verse', 8], ['Pre-Chorus', 4], ['Chorus', 8], ['Verse', 8], ['Pre-Chorus', 4], ['Chorus', 8], ['Solo', 8], ['Chorus', 8], ['Outro', 4]]);
                const a = real(add, 'Akustikgitarre', 'Akustikgitarre', -.15);
                a.arm = true;
                const l = real(add, 'Rhythmus L', 'Gitarrenwand', -.8); l.dbl = false;
                const r = real(add, 'Rhythmus R', 'Gitarrenwand', .8); r.dbl = false;
                real(add, 'Lead-Gitarre', 'Lead-Gitarre', 0);
                const guide = add('inst', 'Guide (Akkorde)', { inst: '12-String Guitar', vol: .45 });
                guide.regions.push(region(0, 16, strum(vs, STRUM), 'Guide Strophe', 4));
                guide.regions.push(region(16, 8, strum(ch, STRUM), 'Guide Refrain', 4));
                const dr = add('drum', 'Live-Drums', { kit: 'Britpop Anthem' }); patched(dr, 'Live-Drums');
                dr.regions.push(region(4, 12, drums(4, { hat: .125 }), 'Beat', 4));
                const tb = add('drum', 'Tamburin', { kit: 'Brit Pop', vol: .45, fxRev: .15 });
                tb.regions.push(region(16, 8, Array.from({ length: 8 }, (_, i) => ({ t: i / 8, n: 7, d: .03, v: i % 2 ? .45 : .85 })), 'Tamburin', 1));
                dr.regions.push(region(16, 8, drums(4, { hat: .125, kickExtra: [.375] }), 'Refrain', 4));
                const b = add('inst', 'Bass', { inst: 'Picked Bass', vol: .75 }); patched(b, 'Bass DI');
                b.regions.push(region(4, 12, bassLine(vs, [[0, 1, .12], [.125, .7, .1], [.25, .85, .12], [.375, .7, .1], [.5, 1, .12], [.625, .7, .1], [.75, .85, .12], [.875, .7, .1, 7]]), 'Bass Strophe', 4));
                b.regions.push(region(16, 8, bassLine(ch, [[0, 1, .24], [.25, .85, .24], [.5, 1, .24], [.75, .85, .2, 7]]), 'Bass Refrain', 4));
                patched(add('audio', 'Gesang', {}), 'Lead-Vocal');
                patched(add('audio', 'Gesang Dopplung', { pan: .2 }), 'Doppel-Vocal');
                return a;
            },
        },
        'Alt-Pop elektronisch': {
            desc: 'Echte Gitarre trifft Sub-Bass, harte Beats und einen breiten Synth-Refrain. Für Stilbrüche zwischen den Abschnitten.',
            bpm: 140, key: ['A', 'minor'],
            build(add, p) {
                const prog = ['Am', 'F', 'C', 'G'];
                p.markers = form([['Intro', 4], ['Verse', 8], ['Chorus', 8], ['Bridge', 4], ['Chorus', 8], ['Outro', 4]]);
                const g = real(add, 'Gitarre', 'Akustikgitarre', -.2);
                g.arm = true;
                const guide = add('inst', 'Guide (Picking)', { inst: 'Nylon Guitar', vol: .45 });
                guide.regions.push(region(0, 12, WD.LOOPS.find(x => x.name.startsWith('Fingerpicking')).notes, 'Guide', 4));
                const dr = add('drum', 'Beat', { kit: 'Hyperpop' }); patched(dr, 'Hyperpop Drums');
                dr.regions.push(region(12, 8, WD.LOOPS.find(x => x.name === 'Hyperpop Rush').notes, 'Rush', 2));
                const s = add('inst', '808', { inst: '808 Sub', vol: .7 });
                s.regions.push(region(4, 16, bassLine(prog, [[0, 1, .45], [.625, .8, .3]]), '808', 4));
                const sy = add('inst', 'Synth', { inst: 'Hyper Saw', vol: .45, fxRev: .2, fxDly: .12 });
                sy.regions.push(region(12, 8, strum(prog, [[0, .9, .22], [.25, .8, .1], [.375, .8, .22], [.625, .8, .1], [.75, .8, .2]], 12, 0), 'Refrain', 4));
                patched(add('audio', 'Gesang', {}), 'Hyper-Vocal');
                return g;
            },
        },
    };

    // Reine Songform für das aktuelle Projekt (Abschnitte der ersten Version)
    function applySongForm() {
        WD.history.run('Song-Form', () => {
            const barL = M.barLen();
            WD.project.markers = form([['Intro', 2], ['Verse 1', 4], ['Pre-Chorus', 2], ['Chorus', 4], ['Verse 2', 4], ['Chorus', 4], ['Bridge/Solo', 4], ['Doppel-Chorus', 6], ['Outro', 2]])
                .map(m => ({ name: m.name, startBar: m.startBar * barL, lengthBars: m.lengthBars * barL }));
        });
        WD.sections.render();
        WD.bus.emit('markers');
    }

    async function create(name) {
        const t = T[name];
        if (!t || !await WD.storage.confirmLeave()) return;
        const project = WD.newProject(name);
        project.bpm = t.bpm;
        [project.keyRoot, project.keyMode] = t.key;
        WD.storage.activate(project);
        const add = (type, nm, extra) => M.addTrack(type, nm, Object.assign({ customName: true }, extra), { select: false });
        const first = t.build(add, project);
        project.tracks.forEach(tr => { tr.regions = tr.regions.map(M.normalizeRegion); });
        WD.view.selTrackId = first ? first.id : null;
        if (WD.engine.ready) WD.engine.setMasterMode(project.master.mode);
        WD.history.clear();
        WD.bus.emit('project', { soft: false });
        WD.timeline.zoomToFit();
        WD.input.refresh();
        WD.bus.emit('dirty');
    }

    WD.templates = {
        names: () => Object.keys(T),
        create, applySongForm,
        showDialog() {
            WD.ui.modal((box, close) => {
                box.append(el('h2', {}, 'Neues Projekt aus Vorlage'),
                    el('p', {}, 'Vorlagen bringen Spuren, Klänge, Abschnitte und einfache Start-Parts mit. Alles lässt sich ersetzen oder überspielen.'));
                const list = el('div', { class: 'list-table' });
                Object.entries(T).forEach(([name, t]) => list.append(el('div', {
                    class: 'list-row', onclick: () => { close(); create(name); }, style: { cursor: 'default', alignItems: 'flex-start' },
                },
                    el('div', { style: { flex: 1, minWidth: 0 } },
                        el('div', { class: 'name' }, name),
                        el('div', { class: 'meta', style: { whiteSpace: 'normal', lineHeight: 1.4 } }, t.desc)),
                    el('div', { class: 'meta' }, t.bpm + ' BPM'))));
                box.append(list, el('div', { class: 'modal-btns' }, el('button', { onclick: close }, 'Abbrechen')));
            }, { wide: true, onEscape: () => { } });
        },
    };
})();
