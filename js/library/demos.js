// Demo-Songs: eigene Arrangements. Sie öffnen als neues Projekt, das aktuelle wird vorher abgefragt.
'use strict';
(() => {
const DEMOS = {};
const uidRegion = r => WD.model.normalizeRegion(r);
let state = null;
// Regionen werden per regions.push ergänzt und in load() normalisiert
const addTrack = (type, name, extra) => WD.model.addTrack(type, name, extra, { select: false });
const demo = (name, bpm, build, { autoplay = true } = {}) => { DEMOS[name] = { bpm, build, autoplay }; };

demo('Britpop-Demo', 85, () => {
    state.markers.push({ name: 'Intro', startBar: 0, lengthBars: 4 });
    state.markers.push({ name: 'Verse', startBar: 4, lengthBars: 8 });
    state.markers.push({ name: 'Chorus', startBar: 12, lengthBars: 4 });
    const CH = [[52, 55, 59, 62, 66], [43, 55, 59, 62, 67], [50, 57, 62, 66], [45, 55, 60, 64, 67]];
    const ROOTS = [40, 43, 38, 45];
    const dr = addTrack('drum', 'Brit Pop', { kit: 'Brit Pop' });
    const dn = [];
    for (let b = 0; b < 4; b++) {
        dn.push({ t: b, n: 0, d: .05 }); dn.push({ t: b + .5, n: 0, d: .05 });
        dn.push({ t: b + .25, n: 1, d: .05 }); dn.push({ t: b + .75, n: 1, d: .05 });
        for (let s = 0; s < 1; s += .125) dn.push({ t: b + s, n: 2, d: .03 });
        dn.push({ t: b + .5, n: 7, d: .03 });
    }
    dn.push({ t: 3.875, n: 5, d: .05 }); dn.push({ t: 0, n: 6, d: .1 });
    dr.regions.push({ startBar: 4, lengthBars: 12, loopLen: 4, notes: dn, name: 'Beat' });
    const g12 = addTrack('inst', '12-String Guitar', { inst: '12-String Guitar', pan: -.3 });
    const gn = [];
    CH.forEach((ch, b) => [0, .25, .5, .625, .75].forEach(st =>
        ch.forEach((n, i) => gn.push({ t: b + st + i * .006, n: n, d: .2 }))));
    g12.regions.push({ startBar: 0, lengthBars: 16, loopLen: 4, notes: gn, name: 'Akustik' });
    const od = addTrack('inst', 'Overdrive Guitar', { inst: 'Overdrive Guitar', pan: .3, vol: .55 });
    const on = [];
    CH.forEach((ch, b) => { on.push({ t: b, n: ch[0], d: .9 }); on.push({ t: b, n: ch[0] + 7, d: .9 }); });
    od.regions.push({ startBar: 12, lengthBars: 4, loopLen: 4, notes: on, name: 'Power' });
    const bs = addTrack('inst', 'Picked Bass', { inst: 'Picked Bass' });
    const bn = [];
    ROOTS.forEach((rt, b) => { for (let s = 0; s < 1; s += .25) bn.push({ t: b + s, n: rt - 12, d: .2 }); });
    bs.regions.push({ startBar: 4, lengthBars: 12, loopLen: 4, notes: bn, name: 'Bass' });
    const st = addTrack('inst', 'Strings', { inst: 'Strings', vol: .6 });
    const sn = [];
    CH.forEach((ch, b) => ch.slice(0, 3).forEach(n => sn.push({ t: b, n: n + 12, d: .95 })));
    st.regions.push({ startBar: 8, lengthBars: 8, loopLen: 4, notes: sn, name: 'Strings' });
    addTrack('audio', 'Vocals');
    return g12;
});

/* ---- Demo: Ballade ---- */
demo('Ballade', 72, () => {
    state.markers.push(
        { name: 'Intro', startBar: 0, lengthBars: 4 },
        { name: 'Verse', startBar: 4, lengthBars: 8 },
        { name: 'Chorus', startBar: 12, lengthBars: 8 },
        { name: 'Outro', startBar: 20, lengthBars: 4 });
    /* Akkorde: E – B – C#m – A */
    const CH = [[40, 47, 52, 56, 59, 64], [47, 54, 59, 63, 66],
    [49, 56, 61, 64, 68], [45, 52, 57, 61, 64]];
    const ROOTS = [40, 47, 49, 45];

    /* Nylon-Arpeggio (läuft fast durchgehend) */
    const ny = addTrack('inst', 'Nylon Guitar', { inst: 'Nylon Guitar', pan: -.25, fxRev: .3 });
    const an = [];
    CH.forEach((ch, b) => {
        const seq = [0, 2, 4, 5, 4, 2, 4, 1];
        for (let s = 0; s < 8; s++)
            an.push({ t: b + s / 8, n: ch[Math.min(seq[s], ch.length - 1)], d: .22, v: s % 2 ? .6 : .85 });
    });
    ny.regions.push({ startBar: 0, lengthBars: 24, loopLen: 4, notes: an, name: 'Arpeggio' });

    /* 12-String-Strumming ab Verse */
    const g12 = addTrack('inst', '12-String Guitar', { inst: '12-String Guitar', pan: .3, vol: .65, fxRev: .2 });
    const gn = [];
    CH.forEach((ch, b) => [0, .375, .5, .75].forEach((st, si) =>
        ch.forEach((n, i) => gn.push({ t: b + st + i * .008, n: n, d: .25, v: si === 0 ? .9 : .6 }))));
    g12.regions.push({ startBar: 4, lengthBars: 16, loopLen: 4, notes: gn, name: 'Strumming' });

    /* Bass: halbe Noten */
    const bs = addTrack('inst', 'Picked Bass', { inst: 'Picked Bass', vol: .75 });
    const bn = [];
    ROOTS.forEach((rt, b) => {
        bn.push({ t: b, n: rt - 12, d: .45 });
        bn.push({ t: b + .5, n: rt - 12, d: .45, v: .7 });
    });
    bs.regions.push({ startBar: 4, lengthBars: 16, loopLen: 4, notes: bn, name: 'Bass' });

    /* Half-Time-Drums ab zweiter Verse-Hälfte */
    const dr = addTrack('drum', 'Brit Pop', { kit: 'Brit Pop', vol: .7 });
    const dn = [];
    for (let b = 0; b < 4; b++) {
        dn.push({ t: b, n: 0, d: .05 }, { t: b + .5, n: 1, d: .05 });
        for (let s = 0; s < 1; s += .25) dn.push({ t: b + s, n: 2, d: .03, v: .5 });
    }
    dr.regions.push({ startBar: 8, lengthBars: 12, loopLen: 4, notes: dn, name: 'Half-Time' });

    /* Tambourine ab Chorus – der Oasis-Trick */
    const tb = addTrack('drum', 'Tambourine', { kit: 'Brit Pop', vol: .5, fxRev: .25 });
    const tn = Array.from({ length: 8 }, (_, i) => ({ t: i / 8, n: 7, d: .03, v: i % 2 ? .5 : .9 }));
    tb.regions.push({ startBar: 12, lengthBars: 8, loopLen: 1, notes: tn, name: 'Tambourine' });

    /* Mellotron-Streicher mit Schwell-Automation */
    const ml = addTrack('inst', 'Mellotron', { inst: 'Mellotron', vol: .8, fxRev: .45 });
    const mn = [];
    CH.forEach((ch, b) => [2, 3, 5].forEach(i =>
        mn.push({ t: b, n: ch[Math.min(i, ch.length - 1)] + 12, d: .97 })));
    ml.regions.push({ startBar: 8, lengthBars: 16, loopLen: 4, notes: mn, name: 'Mellotron' });
    ml.auto = [
        { bar: 8, val: 0 }, { bar: 12, val: .4 }, { bar: 13, val: 1 },
        { bar: 20, val: 1 }, { bar: 24, val: 0 }
    ];

    /* Melodie-Spur (Chorus-Hook) */
    const ld = addTrack('inst', 'Flute', { inst: 'Flute', vol: .55, fxRev: .4, fxDly: .2 });
    const melo = [
        { t: 0, n: 71, d: .5 }, { t: .5, n: 68, d: .25 }, { t: .75, n: 66, d: .25 },
        { t: 1, n: 66, d: .75 }, { t: 1.75, n: 68, d: .25 },
        { t: 2, n: 64, d: .5 }, { t: 2.5, n: 66, d: .5 },
        { t: 3, n: 64, d: 1 }
    ];
    ld.regions.push({ startBar: 12, lengthBars: 8, loopLen: 4, notes: melo, name: 'Hook' });

    addTrack('audio', 'Vocals');
    return ny;
});

/* ---- Demo: Moll-Ballade (Mid-90s-Stil) ---- */
demo('Moll-Ballade', 82, () => {
    state.markers.push(
        { name: 'Intro', startBar: 0, lengthBars: 4 },
        { name: 'Verse', startBar: 4, lengthBars: 8 },
        { name: 'Chorus', startBar: 12, lengthBars: 8 },
        { name: 'Outro', startBar: 20, lengthBars: 4 });

    /* Eigene Akkordfolge: Bm – G – D – A  (melancholisches Moll) */
    const CH = [[47, 50, 54, 59, 62], [43, 50, 55, 59, 62],
    [50, 54, 57, 62, 66], [45, 52, 57, 61, 64]];
    const ROOTS = [47, 43, 50, 45];

    /* 12-String: getragenes Strumming, durchgehend */
    const g12 = addTrack('inst', '12-String Guitar', { inst: '12-String Guitar', pan: -.3, fxRev: .25 });
    const gn = [];
    CH.forEach((ch, b) => [0, .25, .5, .625, .75, .875].forEach((st, si) =>
        ch.forEach((n, i) => gn.push({ t: b + st + i * .007, n: n, d: .22, v: si === 0 ? .9 : si === 2 ? .75 : .55 }))));
    g12.regions.push({ startBar: 0, lengthBars: 24, loopLen: 4, notes: gn, name: 'Strumming' });

    /* Zweite Akustik rechts (Clean, nur Akzente auf 1 und 3) */
    const g2 = addTrack('inst', 'Clean Guitar', { inst: 'Clean Guitar', pan: .35, vol: .6, fxRev: .2 });
    const g2n = [];
    CH.forEach((ch, b) => [0, .5].forEach(st =>
        ch.forEach((n, i) => g2n.push({ t: b + st + i * .009, n: n, d: .4, v: .7 }))));
    g2.regions.push({ startBar: 4, lengthBars: 16, loopLen: 4, notes: g2n, name: 'Akzente' });

    /* Bass: Grundton + Oktavwechsel */
    const bs = addTrack('inst', 'Picked Bass', { inst: 'Picked Bass', vol: .75 });
    const bn = [];
    ROOTS.forEach((rt, b) => {
        bn.push({ t: b, n: rt - 12, d: .45 }, { t: b + .5, n: rt - 12, d: .25, v: .7 },
            { t: b + .75, n: rt - 12, d: .2, v: .6 });
    });
    bs.regions.push({ startBar: 4, lengthBars: 16, loopLen: 4, notes: bn, name: 'Bass' });

    /* Drums: schleppender Beat mit Betonung auf Snare 2+4 */
    const dr = addTrack('drum', 'Brit Pop', { kit: 'Brit Pop', vol: .75 });
    const dn = [];
    for (let b = 0; b < 4; b++) {
        dn.push({ t: b, n: 0, d: .05 }, { t: b + .625, n: 0, d: .05, v: .7 },
            { t: b + .25, n: 1, d: .05 }, { t: b + .75, n: 1, d: .05 });
        for (let s = 0; s < 1; s += .25) dn.push({ t: b + s, n: 2, d: .03, v: .45 });
    }
    dr.regions.push({ startBar: 8, lengthBars: 12, loopLen: 4, notes: dn, name: 'Beat' });

    /* Tambourine ab Chorus */
    const tb = addTrack('drum', 'Tambourine', { kit: 'Brit Pop', vol: .45, fxRev: .3 });
    const tn = Array.from({ length: 8 }, (_, i) => ({ t: i / 8, n: 7, d: .03, v: i % 2 ? .5 : .85 }));
    tb.regions.push({ startBar: 12, lengthBars: 8, loopLen: 1, notes: tn, name: 'Tambourine' });

    /* Streicher: große Fläche, schwillt zum Chorus an */
    const st = addTrack('inst', 'Strings', { inst: 'Strings', vol: .85, fxRev: .5 });
    const sn = [];
    CH.forEach((ch, b) => [1, 2, 4].forEach(i =>
        sn.push({ t: b, n: ch[Math.min(i, ch.length - 1)] + 12, d: .98 })));
    st.regions.push({ startBar: 8, lengthBars: 16, loopLen: 4, notes: sn, name: 'Streicher' });
    st.auto = [
        { bar: 8, val: .25 }, { bar: 11.5, val: .5 }, { bar: 12, val: 1 },
        { bar: 20, val: .8 }, { bar: 24, val: 0 }
    ];

    /* Cello: tiefe Gegenstimme im Chorus (eigene Linie) */
    const cl = addTrack('inst', 'Cello', { inst: 'Cello', vol: .6, fxRev: .4 });
    const cn = [
        { t: 0, n: 47, d: .95 }, { t: 1, n: 43, d: .5 }, { t: 1.5, n: 45, d: .5 },
        { t: 2, n: 50, d: .95 }, { t: 3, n: 45, d: .95 }
    ];
    cl.regions.push({ startBar: 12, lengthBars: 8, loopLen: 4, notes: cn, name: 'Cello' });

    /* Vocal Oohs als Fläche im Chorus */
    const vx = addTrack('inst', 'Vocal Oohs', { inst: 'Vocal Oohs', vol: .5, fxRev: .5 });
    const vn = [];
    CH.forEach((ch, b) => vn.push({ t: b, n: ch[2] + 12, d: .95 }, { t: b, n: ch[3] + 12, d: .95 }));
    vx.regions.push({ startBar: 12, lengthBars: 8, loopLen: 4, notes: vn, name: 'Oohs' });

    addTrack('audio', 'Vocals');
    return g12;
});
/* ---- Demo: Akustik-Session (Lagerfeuer-Stil) ---- */
demo('Akustik-Session', 88, () => {
    state.markers.push(
        { name: 'Intro', startBar: 0, lengthBars: 2 },
        { name: 'Verse', startBar: 2, lengthBars: 8 },
        { name: 'Refrain', startBar: 10, lengthBars: 6 },
        { name: 'Outro', startBar: 16, lengthBars: 4 });

    /* Eigene Akkordfolge: C – Am – F – G (warm, folkig) */
    const CH = [[48, 52, 55, 60, 64], [45, 52, 57, 60, 64],
    [41, 48, 53, 57, 60], [43, 50, 55, 59, 62]];
    const ROOTS = [48, 45, 41, 43];

    /* Nylon: entspanntes Fingerpicking */
    const ny = addTrack('inst', 'Nylon Guitar', { inst: 'Nylon Guitar', pan: -.2, fxRev: .22 });
    const an = [];
    CH.forEach((ch, b) => {
        const seq = [0, 2, 3, 2, 4, 2, 3, 2];
        for (let s = 0; s < 8; s++)
            an.push({ t: b + s / 8, n: ch[Math.min(seq[s], ch.length - 1)], d: .2, v: s === 0 ? .9 : .6 });
    });
    ny.regions.push({ startBar: 0, lengthBars: 20, loopLen: 4, notes: an, name: 'Picking' });

    /* Harmonium: der Teppich – DAS Stilmittel */
    const hm = addTrack('inst', 'Harmonium', { inst: 'Harmonium', vol: .7, fxRev: .3 });
    const hn = [];
    CH.forEach((ch, b) => [1, 2, 3].forEach(i => hn.push({ t: b, n: ch[i], d: .98 })));
    hm.regions.push({ startBar: 2, lengthBars: 18, loopLen: 4, notes: hn, name: 'Harmonium' });
    hm.auto = [{ bar: 2, val: .4 }, { bar: 10, val: 1 }, { bar: 16, val: .6 }, { bar: 20, val: 0 }];

    /* Bass: tapsig-freundlich, Grundton + Quinte */
    const bs = addTrack('inst', 'Picked Bass', { inst: 'Picked Bass', vol: .7 });
    const bn = [];
    ROOTS.forEach((rt, b) => {
        bn.push({ t: b, n: rt - 12, d: .4 }, { t: b + .5, n: rt - 5, d: .4, v: .7 });
    });
    bs.regions.push({ startBar: 2, lengthBars: 18, loopLen: 4, notes: bn, name: 'Bass' });

    /* Drums: nur sanfte HiHat + Kick, sehr zurückhaltend */
    const dr = addTrack('drum', 'LoFi', { kit: 'LoFi', vol: .55 });
    const dn = [];
    for (let b = 0; b < 2; b++) {
        dn.push({ t: b, n: 0, d: .05, v: .7 }, { t: b + .5, n: 1, d: .05, v: .5 });
        for (let s = .125; s < 1; s += .25) dn.push({ t: b + s, n: 2, d: .03, v: .4 });
    }
    dr.regions.push({ startBar: 6, lengthBars: 14, loopLen: 2, notes: dn, name: 'Soft Beat' });

    /* Shaker ab Refrain */
    const sh = addTrack('drum', 'Shaker', { kit: 'Brit Pop', vol: .4 });
    const shn = Array.from({ length: 16 }, (_, i) => ({ t: i / 16, n: 2, d: .02, v: i % 4 === 0 ? .8 : .35 }));
    sh.regions.push({ startBar: 10, lengthBars: 6, loopLen: 1, notes: shn, name: 'Shaker' });

    /* Wurlitzer: kleine Antwort-Licks im Refrain (weglassen, falls nicht eingebaut) */
    const wl = addTrack('inst', 'Wurlitzer', { inst: 'Wurlitzer', vol: .5, pan: .3, fxRev: .3 });
    const wn = [
        { t: .5, n: 72, d: .25 }, { t: .75, n: 71, d: .25 },
        { t: 1.5, n: 69, d: .5, v: .8 },
        { t: 2.5, n: 65, d: .25 }, { t: 2.75, n: 67, d: .25 },
        { t: 3.5, n: 67, d: .4, v: .8 }
    ];
    wl.regions.push({ startBar: 10, lengthBars: 6, loopLen: 4, notes: wn, name: 'Licks' });

    addTrack('audio', 'Vocals');
    return ny;
});

/* ---- Rockin' Demo (Original, Britpop-Balladen-Vibe) ---- */
demo("Rockin' Demo", 80, () => {
    WD.project.keyRoot = 'D'; WD.project.keyMode = 'major';

    /* Akkorde: [Grundton, Intervalle] */
    const MAJ = [0, 7, 12, 16], MIN = [0, 7, 12, 15];
    const D = [50, MAJ], Bm = [47, MIN], G = [43, MAJ], A = [45, MAJ];
    const vs = [D, Bm, G, A, D, Bm, G, A]; /* Verse, 8 Takte */
    const ch = [G, A, D, Bm, G, A, D, D]; /* Chorus, 8 Takte */
    const cn = c => c[1].map(iv => c[0] + iv);

    /* Lagerfeuer-Strumming D-DU-U */
    const strum = prog => {
        const o = [];
        prog.forEach((c, b) =>
            [[0, .3, 1], [.375, .15, .7], [.5, .25, .85], [.75, .2, .7]].forEach(([t, d, v]) =>
                cn(c).forEach((n, i) => o.push({ t: b + t + i * .006, n: n + 12, d, v }))));
        return o;
    };
    /* Bass: Viertel auf dem Grundton */
    const bass = prog => {
        const o = [];
        prog.forEach((c, b) => { for (let s = 0; s < 1; s += .25) o.push({ t: b + s, n: c[0] - 12, d: .2, v: s === 0 ? 1 : .7 }); });
        return o;
    };
    /* Flächen: ganztaktige Akkorde */
    const pad = (prog, oct) => {
        const o = [];
        prog.forEach((c, b) => cn(c).forEach(n => o.push({ t: b, n: n + (oct || 0), d: .98, v: .6 })));
        return o;
    };
    /* Drums: ruhiger Beat, optional Tambourin + Crash auf die 1 */
    const drums = (bars, tamb, crash) => {
        const o = [];
        for (let b = 0; b < bars; b++) {
            o.push({ t: b, n: 0, d: .05 }, { t: b + .5, n: 0, d: .05 });
            o.push({ t: b + .25, n: 1, d: .05 }, { t: b + .75, n: 1, d: .05 });
            for (let s = 0; s < 1; s += .125) o.push({ t: b + s, n: 2, d: .03, v: s % .25 === 0 ? .55 : .3 });
            if (tamb) for (let s = 0; s < 1; s += .125) o.push({ t: b + s, n: 7, d: .03, v: s % .25 === 0 ? .8 : .45 });
        }
        if (crash) o.push({ t: 0, n: 6, d: .1 });
        o.push({ t: bars - .25, n: 5, d: .05, v: .6 }, { t: bars - .125, n: 1, d: .05, v: .65 });
        return o;
    };
    /* Eigene Lead-Hook für den Chorus (8 Takte) */
    const hook = [
        { t: 0, n: 71, d: .5 }, { t: .5, n: 74, d: .25 }, { t: .75, n: 76, d: .25 },
        { t: 1, n: 78, d: .75 }, { t: 1.75, n: 76, d: .25 },
        { t: 2, n: 74, d: .5 }, { t: 2.5, n: 69, d: .5 },
        { t: 3, n: 71, d: 1 },
        { t: 4, n: 71, d: .5 }, { t: 4.5, n: 74, d: .25 }, { t: 4.75, n: 76, d: .25 },
        { t: 5, n: 78, d: .5 }, { t: 5.5, n: 81, d: .5 },
        { t: 6, n: 78, d: .5 }, { t: 6.5, n: 76, d: .25 }, { t: 6.75, n: 74, d: .25 },
        { t: 7, n: 74, d: 1 }
    ].map(x => ({ ...x, v: .9 }));

    const reg = (tr, startBar, len, notes, name) =>
        tr.regions.push({ startBar, lengthBars: len, loopLen: 0, notes, name });

    /* Struktur: Intro 0–4 | Verse 4–12 | Chorus 12–20 | Verse 20–28 | Chorus 28–36 | Outro 36–40 */
    const trem = addTrack('inst', 'Tremolo Gt', { inst: 'Tremolo Guitar' });
    reg(trem, 0, 4, pad([D, Bm, G, A], 12), 'Intro');
    reg(trem, 36, 4, pad([G, A, D, D], 12), 'Outro');

    const g12 = addTrack('inst', '12-String', { inst: '12-String Guitar' });
    reg(g12, 4, 8, strum(vs), 'Verse 1');
    reg(g12, 12, 8, strum(ch), 'Chorus 1');
    reg(g12, 20, 8, strum(vs), 'Verse 2');
    reg(g12, 28, 8, strum(ch), 'Chorus 2');
    reg(g12, 36, 4, strum([G, A, D, D]), 'Outro');

    const lead = addTrack('inst', 'Lead Gt', { inst: 'Britpop Lead' });
    reg(lead, 12, 8, hook, 'Hook');
    reg(lead, 28, 8, hook, 'Hook');

    const bs = addTrack('inst', 'Bass', { inst: 'Picked Bass' });
    reg(bs, 4, 32, bass([].concat(vs, ch, vs, ch)), 'Bass');
    reg(bs, 36, 4, bass([G, A, D, D]), 'Outro');

    const mel = addTrack('inst', 'Mellotron', { inst: 'Mellotron' });
    reg(mel, 28, 8, pad(ch, 0), 'Fläche');
    reg(mel, 36, 4, pad([G, A, D, D], 0), 'Outro');

    const dr = addTrack('drum', 'Drums – Brit Pop', { kit: 'Brit Pop' });
    reg(dr, 4, 8, drums(8, false, false), 'Verse 1');
    reg(dr, 12, 8, drums(8, true, true), 'Chorus 1');
    reg(dr, 20, 8, drums(8, false, false), 'Verse 2');
    reg(dr, 28, 8, drums(8, true, true), 'Chorus 2');

    state.markers.push(
        { name: 'Intro', startBar: 0, lengthBars: 4 },
        { name: 'Verse 1', startBar: 4, lengthBars: 8 },
        { name: 'Chorus', startBar: 12, lengthBars: 8 },
        { name: 'Verse 2', startBar: 20, lengthBars: 8 },
        { name: 'Chorus', startBar: 28, lengthBars: 8 },
        { name: 'Outro', startBar: 36, lengthBars: 4 });

    return null;
}, { autoplay: false });

WD.demos = {
    names: () => Object.keys(DEMOS),
    async load(name) {
        const d = DEMOS[name];
        if (!d) return;
        if (!await WD.storage.confirmLeave()) return;
        const project = WD.newProject(name);
        project.bpm = d.bpm;
        WD.storage.activate(project);
        state = { markers: project.markers };
        const first = d.build();
        project.tracks.forEach(t => { t.regions = t.regions.map(uidRegion); });
        WD.view.selTrackId = (first && first.id) || (project.tracks[0] && project.tracks[0].id) || null;
        WD.bus.emit('project', { soft: false });
        WD.storage.refreshTitle();
        if (d.autoplay) WD.transport.play();
    },
};
})();
