// Eingebaute Loops: Noten-Pattern, wie Regionen frei bearbeitbar.
'use strict';
WD.LOOPS = (() => {
    const dn = [];
    for (let b = 0; b < 4; b++) {
        dn.push({ t: b, n: 0, d: .05 }, { t: b + .5, n: 0, d: .05 }, { t: b + .25, n: 1, d: .05 }, { t: b + .75, n: 1, d: .05 });
        for (let s = 0; s < 1; s += .125) dn.push({ t: b + s, n: 2, d: .03 });
    }
    const ht = [];
    for (let b = 0; b < 4; b++) {
        ht.push({ t: b, n: 0, d: .05 }, { t: b + .625, n: 0, d: .05 }, { t: b + .5, n: 1, d: .05 });
        for (let s = 0; s < 1; s += .25) ht.push({ t: b + s, n: 3, d: .03 });
    }
    const CH = [[52, 55, 59, 62, 66], [43, 55, 59, 62, 67], [50, 57, 62, 66], [45, 55, 60, 64, 67]];
    const strum = [];
    CH.forEach((ch, b) => [0, .25, .5, .625, .75].forEach(st =>
        ch.forEach((n, i) => strum.push({ t: b + st + i * .006, n: n, d: .2 }))));
    const arp = [];
    CH.forEach((ch, b) => {
        for (let s = 0; s < 8; s++) arp.push({ t: b + s / 8, n: ch[s % ch.length], d: .12 });
    });
    const bass = [], bass8 = [];
    [40, 43, 38, 45].forEach((rt, b) => {
        for (let s = 0; s < 1; s += .25) bass.push({ t: b + s, n: rt - 12, d: .2 });
        for (let s = 0; s < 1; s += .125) bass8.push({ t: b + s, n: rt - 12, d: .1 });
    });
    const anthem = [];
    for (let b = 0; b < 4; b++) {
        anthem.push({ t: b, n: 0, d: .05 }, { t: b + .5, n: 0, d: .05 }, { t: b + .875, n: 0, d: .05, v: .6 });
        anthem.push({ t: b + .25, n: 1, d: .05 }, { t: b + .75, n: 1, d: .05 });
        for (let s = 0; s < 1; s += .125) anthem.push({ t: b + s, n: 2, d: .03, v: s % .25 === 0 ? .6 : .35 });
        for (let s = 0; s < 1; s += .125) anthem.push({ t: b + s, n: 7, d: .03, v: s % .25 === 0 ? .85 : .45 });
    }
    anthem.push({ t: 0, n: 6, d: .1 });
    anthem.push({ t: 3.75, n: 5, d: .05 }, { t: 3.875, n: 1, d: .05, v: .7 });

    const bedroomBeat = [], indieBeat = [], stadiumBeat = [], hyperBeat = [];
    for (let b = 0; b < 2; b++) {
        bedroomBeat.push({ t: b, n: 0, d: .05 }, { t: b + .375, n: 0, d: .05, v: .7 }, { t: b + .25, n: 4, d: .05, v: .85 }, { t: b + .75, n: 4, d: .05 });
        for (let s = 0; s < 1; s += .125) bedroomBeat.push({ t: b + s, n: 2, d: .03, v: s % .25 === 0 ? .55 : .3 });
        indieBeat.push({ t: b, n: 0, d: .05 }, { t: b + .5, n: 0, d: .05, v: .8 }, { t: b + .25, n: 1, d: .05 }, { t: b + .75, n: 1, d: .05 });
        [.125, .375, .625, .875].forEach(s => indieBeat.push({ t: b + s, n: 3, d: .03, v: .5 }));
        stadiumBeat.push({ t: b, n: 0, d: .05 }, { t: b + .375, n: 0, d: .05, v: .8 }, { t: b + .5, n: 0, d: .05 }, { t: b + .25, n: 1, d: .05 }, { t: b + .75, n: 1, d: .05 });
        for (let s = 0; s < 1; s += .125) stadiumBeat.push({ t: b + s, n: 7, d: .03, v: s % .25 === 0 ? .8 : .4 });
        for (let s = 0; s < 1; s += .125) stadiumBeat.push({ t: b + s, n: 3, d: .03, v: .45 });
        for (let s = 0; s < 1; s += .25) hyperBeat.push({ t: b + s, n: 0, d: .05 });
        hyperBeat.push({ t: b + .25, n: 4, d: .05 }, { t: b + .75, n: 4, d: .05 });
        for (let s = 0; s < 1; s += .0625) hyperBeat.push({ t: b + s, n: 2, d: .02, v: s % .125 === 0 ? .6 : .32 });
    }
    hyperBeat.push({ t: 1.875, n: 1, d: .03 }, { t: 1.9375, n: 1, d: .03, v: .7 });

    const ukeChords = [[67, 60, 64, 69], [67, 62, 67, 71], [69, 60, 64, 69], [69, 60, 65, 69]];
    const ukeStrum = [];
    ukeChords.forEach((ch, b) => [[0, 1], [.25, .65], [.375, .6], [.625, .65], [.75, .85]].forEach(([s, v]) =>
        ch.forEach((n, i) => ukeStrum.push({ t: b + s + i * .005, n: n - 12, d: .12, v }))));
    const pickChords = [[45, 57, 60, 64], [41, 57, 60, 65], [48, 55, 60, 64], [43, 55, 59, 62]];
    const picking = [];
    pickChords.forEach((ch, b) => [0, 2, 1, 3, 2, 1, 3, 2].forEach((idx, s) =>
        picking.push({ t: b + s / 8, n: ch[idx], d: .22, v: s === 0 ? .9 : .6 })));
    const powerLine = [];
    [38, 34, 41, 36].forEach((rt, b) => [0, .25, .375, .5, .75].forEach((s, i) =>
        powerLine.push({ t: b + s, n: rt + 12, d: i === 3 ? .24 : .11, v: i === 0 ? 1 : .75 })));
    return [
        { name: 'Anthem Beat (Crash+Tamb)', type: 'drum', len: 4, notes: anthem },
        { name: 'Brit Rock Beat', type: 'drum', len: 4, notes: dn },
        { name: 'Half-Time Beat', type: 'drum', len: 4, notes: ht },
        {
            name: 'Tambourine 1/8', type: 'drum', len: 1,
            notes: Array.from({ length: 8 }, (_, i) => ({ t: i / 8, n: 7, d: .03, v: i % 2 ? .5 : .9 }))
        },
        {
            name: 'Tambourine Offbeat', type: 'drum', len: 1,
            notes: [{ t: .25, n: 7, d: .03 }, { t: .75, n: 7, d: .03 }]
        },
        {
            name: 'Shaker 1/16', type: 'drum', len: 1,
            notes: Array.from({ length: 16 }, (_, i) => ({ t: i / 16, n: 2, d: .02, v: i % 4 === 0 ? .8 : .35 }))
        },
        { name: 'Strumming Em-G-D-A', type: 'inst', len: 4, notes: strum },
        { name: 'Arpeggio Em-G-D-A', type: 'inst', len: 4, notes: arp },
        { name: 'Rock Bass', type: 'inst', len: 4, notes: bass },
        { name: 'Driving Bass 1/8', type: 'inst', len: 4, notes: bass8 },
        // Indie, Bedroom-Pop, Elektronik (allgemeine Muster)
        { name: 'Bedroom Beat', type: 'drum', len: 2, notes: bedroomBeat },
        { name: 'Indie Offbeat Hats', type: 'drum', len: 2, notes: indieBeat },
        { name: 'Stadion-Refrain', type: 'drum', len: 2, notes: stadiumBeat },
        { name: 'Hyperpop Rush', type: 'drum', len: 2, notes: hyperBeat },
        { name: 'Ukulele-Schlag C-G-Am-F', type: 'inst', len: 4, notes: ukeStrum },
        { name: 'Fingerpicking Am-F-C-G', type: 'inst', len: 4, notes: picking },
        { name: 'Power Chords Dm-Bb-F-C', type: 'inst', len: 4, notes: powerLine },
    ];
})();
