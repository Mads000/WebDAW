// Klang-Presets (Patches): feste Einstellungen des Kanalzugs. Sie wirken auf das echte Signal und bleiben frei änderbar.
'use strict';
(() => {
    const { bus } = WD;
    const M = WD.model;
    const fx = o => Object.assign({ gate: 0, drive: 0, driveType: 'overdrive', chorus: 0, crush: 0, hp: 0, lp: 0, limit: 0 }, o);

    const PATCHES = {
        'Gitarre & Ukulele': {
            'Akustikgitarre': { eqL: -2, eqM: -1, eqH: 2, fxCmp: .25, fxRev: .14, fx: fx({ hp: .3 }) },
            'Ukulele': { eqL: -3, eqM: 1, eqH: 2, fxCmp: .3, fxRev: .1, fx: fx({ hp: .4 }) },
            'Indie Clean': { eqL: -1, eqM: 0, eqH: 3, fxCmp: .2, fxRev: .16, fxDly: .1, fx: fx({ chorus: .35, hp: .25 }) },
            'Crunch': { eqL: -1, eqM: 2, eqH: 1, fxCmp: .15, fxRev: .08, fx: fx({ drive: .45, hp: .3 }) },
            'Gitarrenwand': { eqL: -2, eqM: 3, eqH: 2, fxCmp: .35, fxRev: .12, dbl: true, fx: fx({ drive: .7, hp: .35 }) },
            'Lead-Gitarre': { eqL: -3, eqM: 4, eqH: 1, fxCmp: .3, fxRev: .22, fxDly: .22, fx: fx({ drive: .6, hp: .35 }) },
            'Fuzz': { eqL: 0, eqM: -2, eqH: 2, fxCmp: .1, fx: fx({ drive: .75, driveType: 'distortion', hp: .25 }) },
        },
        'Gesang': {
            'Lead-Vocal': { eqL: -2, eqM: 1, eqH: 3, fxCmp: .45, fxRev: .16, fxDly: .08, fx: fx({ gate: .25, hp: .45 }) },
            'Doppel-Vocal': { eqL: -2, eqM: 0, eqH: 3, fxCmp: .45, fxRev: .14, dbl: true, fx: fx({ gate: .25, hp: .45 }) },
            'Harmonie-Vocal': { eqL: -4, eqM: -1, eqH: 2, fxCmp: .55, fxRev: .3, fx: fx({ gate: .25, hp: .55 }) },
            'Bedroom-Vocal': { eqL: -3, eqM: 2, eqH: -2, fxCmp: .5, fxRev: .08, fx: fx({ gate: .2, hp: .45, lp: .3 }) },
            'Hyper-Vocal': { eqL: -4, eqM: 2, eqH: 4, fxCmp: .6, fxRev: .1, fxDly: .16, fx: fx({ gate: .25, hp: .55, drive: .25, crush: .22 }) },
        },
        'Bass': {
            'Bass DI': { eqL: 2, eqM: 1, eqH: -2, fxCmp: .5, fx: fx({ gate: .1 }) },
            'Bass Moog-artig': { eqL: 3, eqM: -1, eqH: -3, fxCmp: .45, fx: fx({ drive: .3, lp: .45 }) },
        },
        'Drums': {
            'Live-Drums': { eqL: 1, eqM: -1, eqH: 2, fxCmp: .35, fxRev: .14 , fx: fx({}) },
            'Lo-Fi Beat': { eqL: 1, eqM: 1, eqH: -3, fxCmp: .5, fx: fx({ crush: .28, lp: .4, drive: .15 }) },
            'Hyperpop Drums': { eqL: 3, eqM: 0, eqH: 3, fxCmp: .65, fx: fx({ drive: .5, driveType: 'distortion', limit: .25 }) },
        },
    };

    function find(name) {
        for (const g of Object.values(PATCHES)) if (g[name]) return g[name];
        return null;
    }

    const LABELS = {
        'Indie Clean': 'Indie-Clean', 'Lead-Vocal': 'Lead-Gesang', 'Doppel-Vocal': 'Doppel-Gesang', 'Harmonie-Vocal': 'Harmonie-Gesang',
        'Bedroom-Vocal': 'Bedroom-Gesang', 'Hyper-Vocal': 'Hyper-Gesang', 'Bass DI': 'Bass direkt', 'Lo-Fi Beat': 'Lo-Fi-Beat', 'Hyperpop Drums': 'Hyperpop-Drums',
    };
    // Welche Preset-Gruppen zu einer Spur passen
    function groupsFor(t) {
        if (t.type === 'drum') return ['Drums'];
        if (t.type === 'audio') return ['Gitarre & Ukulele', 'Gesang', 'Bass'];
        const fam = WD.instruments.family(t.inst);
        return fam === 'guitar' ? ['Gitarre & Ukulele'] : fam === 'bass' ? ['Bass'] : [];
    }

    const P = WD.patches = {
        PATCHES, groupsFor,
        label: name => LABELS[name] || name,
        apply(track, name) {
            const def = find(name);
            if (!def) return;
            WD.history.run('Patch: ' + name, () => {
                Object.assign(track, { eqL: 0, eqM: 0, eqH: 0, fxCmp: 0, fxRev: 0, fxDly: 0, fxRevSize: .5, fxDlyDiv: '1/8.', dbl: false }, JSON.parse(JSON.stringify(def)));
                track.patch = name;
            });
            bus.emit('mix'); bus.emit('patch');
        },
        // Mehrspurige Gitarren und Gesang: neue, leere Spur mit gleichem Klang und gespiegeltem Panorama
        doubleTrack(t, { name, panSpread = .7, gainDb = 0 } = {}) {
            WD.history.run('Spur doppeln', () => {
                const pan = t.pan || 0;
                if (Math.abs(pan) < .05 && panSpread) t.pan = -panSpread;
                const copy = M.duplicateTrack(t.id, { withRegions: false, name: name || (t.name + ' Dopplung') });
                copy.pan = -(t.pan || 0);
                copy.vol = t.vol * WD.dbToGain(gainDb);
                copy.arm = t.type === 'audio' || t.type === 'inst';
                t.arm = false;
                return copy;
            });
            bus.emit('tracks'); bus.emit('mix');
            WD.input.refresh();
            WD.ui.toast('Neue Spur ist aufnahmebereit: Spiele denselben Part noch einmal ein.', { type: 'ok' });
        },
        harmonyTrack(t) { P.doubleTrack(t, { name: t.name + ' Harmonie', panSpread: .3, gainDb: -5 }); },
    };
})();
