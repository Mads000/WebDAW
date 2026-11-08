// Klangerzeuger: rein synthetisch, ohne Samples. ctx wird pro Aufruf auf den Kontext des Ziels gesetzt,
// dadurch funktioniert derselbe Code live und im Offline-Rendering.
'use strict';
(() => {
let ctx = null, noiseCache = null, driveCache = null;
const freq = m => 440 * Math.pow(2, (m - 69) / 12);
function noiseBuffer() {
    if (!noiseCache || noiseCache.sampleRate !== ctx.sampleRate) {
        noiseCache = new AudioBuffer({ length: ctx.sampleRate, sampleRate: ctx.sampleRate, numberOfChannels: 1 });
        const d = noiseCache.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseCache;
}
function driveCurve() {
    if (!driveCache) {
        driveCache = new Float32Array(1025);
        for (let i = 0; i < 1025; i++) driveCache[i] = Math.tanh((i / 512 - 1) * 4);
    }
    return driveCache;
}

/* Gitarren (Karplus-Strong) */
// Karplus-Strong mit Puffer-Cache. Die Puffer sind unabhängig vom Kontext wiederverwendbar;
// die Feinstimmung übernimmt playbackRate, damit auch hohe Töne und feine Verstimmungen exakt stimmen.
const ksCache = new Map(), KS_VARIANTS = 3, KS_CACHE_MAX = 160;
let ksRound = 0;
function ksBuffer(midiInt, damp, sr) {
    const variant = ksRound++ % KS_VARIANTS;
    const key = midiInt + '|' + damp + '|' + sr + '|' + variant;
    let e = ksCache.get(key);
    if (e) { ksCache.delete(key); ksCache.set(key, e); return e; }
    const N = Math.max(4, Math.round(sr / freq(midiInt)));
    const len = Math.round(sr * 2.6);
    const buf = new AudioBuffer({ length: len, sampleRate: sr, numberOfChannels: 1 });
    const d = buf.getChannelData(0);
    for (let i = 0; i < N; i++) d[i] = Math.random() * 2 - 1;
    for (let i = N; i < len; i++) d[i] = (d[i - N] + d[i - N + 1]) * damp;
    e = { buf, baseFreq: sr / (N - 0.5) };
    ksCache.set(key, e);
    if (ksCache.size > KS_CACHE_MAX) ksCache.delete(ksCache.keys().next().value);
    return e;
}
function ks(midi, t, dur, dest, opt) {
    const sr = ctx.sampleRate, base = Math.round(midi), damp = opt.damp || .4985;
    const e = ksBuffer(base, damp, sr);
    const s = ctx.createBufferSource(); s.buffer = e.buf;
    s.playbackRate.value = freq(midi) / e.baseFreq;
    const g = ctx.createGain();
    const stopT = t + Math.min(2.5, dur + 1.2);
    g.gain.setValueAtTime(opt.vol, t);
    g.gain.setValueAtTime(opt.vol, stopT - .02);
    g.gain.linearRampToValueAtTime(0, stopT);
    if (opt.drive) {
        const pre = ctx.createGain(); pre.gain.value = 5;
        const ws = ctx.createWaveShaper(); ws.curve = driveCurve(); ws.oversample = '2x';
        const fl = ctx.createBiquadFilter(); fl.frequency.value = 3200;
        s.connect(pre); pre.connect(ws); ws.connect(fl); fl.connect(g);
    } else s.connect(g);
    g.connect(dest); s.start(t); s.stop(stopT + .01);
}
function gtClean(m, t, d, x) { ks(m, t, d, x, { vol: .75 }); }
function gtDrive(m, t, d, x) { ks(m, t, d, x, { vol: .45, drive: true }); }
function gt12(m, t, d, x) { ks(m, t, d, x, { vol: .5 }); ks(m + 12, t + .008, d, x, { vol: .3, damp: .497 }); }

function simpleOsc(m, t, dur, dest, type, cut, vol, atk, rel, det) {
    const o = ctx.createOscillator(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq(m); if (det) o.detune.value = det;
    fl.type = 'lowpass'; fl.frequency.value = cut;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + atk);
    g.gain.setValueAtTime(vol, t + Math.max(atk, dur));
    g.gain.exponentialRampToValueAtTime(.001, t + Math.max(atk, dur) + rel);
    o.connect(fl); fl.connect(g); g.connect(dest);
    o.start(t); o.stop(t + Math.max(atk, dur) + rel + .05);
}
function piano(m, t, d, x) {
    [[1, .5, 1.6], [2, .22, 1.1], [3, .08, .7], [4, .04, .5]].forEach(([h, v, dec]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = freq(m) * h;
        g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.001, t + dec);
        o.connect(g); g.connect(x); o.start(t); o.stop(t + dec + .05);
    });
}
function ePiano(m, t, d, x) {
    [[1, .5], [2, .18], [3, .05]].forEach(([h, v]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = freq(m) * h;
        g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.001, t + 1.3);
        o.connect(g); g.connect(x); o.start(t); o.stop(t + 1.4);
    });
}
function organ(m, t, d, x) {
    [[0, .3], [12, .2], [19, .1], [24, .07]].forEach(([iv, v]) =>
        simpleOsc(m + iv, t, d, x, 'sine', 8000, v, .02, .08));
}
function strings(m, t, d, x) {
    [-7, 7].forEach(c => simpleOsc(m, t, Math.max(.25, d), x, 'sawtooth', 1700, .16, .25, .5, c));
}
function pad(m, t, d, x) {
    [-5, 5].forEach(c => simpleOsc(m, t, Math.max(.5, d), x, 'triangle', 2200, .2, .5, 1.2, c));
}
function flute(m, t, d, x) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    const v = ctx.createOscillator(), vg = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq(m);
    v.frequency.value = 5; vg.gain.value = 4;
    v.connect(vg); vg.connect(o.frequency);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(.35, t + .08);
    g.gain.setValueAtTime(.35, t + Math.max(.1, d));
    g.gain.exponentialRampToValueAtTime(.001, t + Math.max(.1, d) + .2);
    o.connect(g); g.connect(x);
    o.start(t); v.start(t); o.stop(t + d + .3); v.stop(t + d + .3);
}
function mallet(m, t, d, x, ratio, dec, v2) {
    [[1, .5, dec], [ratio, v2, dec * .4]].forEach(p => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = freq(m) * p[0];
        g.gain.setValueAtTime(p[1], t);
        g.gain.exponentialRampToValueAtTime(.001, t + p[2]);
        o.connect(g); g.connect(x); o.start(t); o.stop(t + p[2] + .05);
    });
}
function vibra(m, t, d, x) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    const tr = ctx.createOscillator(), tg = ctx.createGain();
    o.frequency.value = freq(m); tr.frequency.value = 4; tg.gain.value = .12;
    tr.connect(tg); tg.connect(g.gain);
    g.gain.setValueAtTime(.4, t); g.gain.exponentialRampToValueAtTime(.001, t + 2);
    o.connect(g); g.connect(x);
    o.start(t); tr.start(t); o.stop(t + 2.1); tr.stop(t + 2.1);
}
function brass(m, t, d, x) {
    [-8, 8].forEach(c => simpleOsc(m, t, Math.max(.2, d), x, 'sawtooth', 2600, .18, .07, .25, c));
}
function cello(m, t, d, x) {
    [-5, 5].forEach(c => simpleOsc(m, t, Math.max(.3, d), x, 'sawtooth', 900, .2, .15, .4, c));
}
function mellotron(m, t, d, x) {
    [-9, 0, 9].forEach((det, i) => {
        const o = ctx.createOscillator(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
        o.type = 'sawtooth'; o.frequency.value = freq(m); o.detune.value = det;
        fl.type = 'lowpass'; fl.frequency.value = 1100; fl.Q.value = .5;
        const v = ctx.createOscillator(), vg = ctx.createGain();
        v.frequency.value = 5.5 + i * .3; vg.gain.value = 2.5;
        v.connect(vg); vg.connect(o.frequency);
        const vol = .14;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(vol, t + .18);
        g.gain.setValueAtTime(vol, t + Math.max(.2, d));
        g.gain.exponentialRampToValueAtTime(.001, t + Math.max(.2, d) + .45);
        o.connect(fl); fl.connect(g); g.connect(x);
        o.start(t); v.start(t);
        o.stop(t + d + .6); v.stop(t + d + .6);
    });
    noiseHit(t + .02, .03, 'bandpass', 3000, Math.max(.3, d), x);
}
function choir(m, t, d, x) {
    [-6, 6].forEach(c => {
        const o = ctx.createOscillator(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
        o.type = 'triangle'; o.frequency.value = freq(m); o.detune.value = c;
        fl.type = 'bandpass'; fl.frequency.value = 700; fl.Q.value = .8;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(.4, t + .3);
        g.gain.setValueAtTime(.4, t + Math.max(.3, d));
        g.gain.exponentialRampToValueAtTime(.001, t + Math.max(.3, d) + .8);
        o.connect(fl); fl.connect(g); g.connect(x);
        o.start(t); o.stop(t + d + 1);
    });
}
function honky(m, t, d, x) {
    [-6, 7].forEach(det => {
        [[1, .3, 1.5], [2, .14, 1], [3, .05, .6]].forEach(([h, v, dec]) => {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.frequency.value = freq(m) * h; o.detune.value = det;
            g.gain.setValueAtTime(v, t);
            g.gain.exponentialRampToValueAtTime(.001, t + dec);
            o.connect(g); g.connect(x); o.start(t); o.stop(t + dec + .05);
        });
    });
}
function hammond(m, t, d, x) {
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 6.8; lg.gain.value = 9;
    lfo.connect(lg); lfo.start(t); lfo.stop(t + d + .5);
    const trem = ctx.createGain(); trem.gain.value = 1;
    const tl = ctx.createOscillator(), tg = ctx.createGain();
    tl.frequency.value = 6.8; tg.gain.value = .25;
    tl.connect(tg); tg.connect(trem.gain); tl.start(t); tl.stop(t + d + .5);
    trem.connect(x);
    [[0, .28], [12, .2], [19, .12], [24, .08], [28, .05]].forEach(([iv, v]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = freq(m + iv);
        lg.connect(o.detune);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(v, t + .03);
        g.gain.setValueAtTime(v, t + Math.max(.05, d));
        g.gain.exponentialRampToValueAtTime(.001, t + Math.max(.05, d) + .12);
        o.connect(g); g.connect(trem);
        o.start(t); o.stop(t + d + .3);
    });
}
function wurli(m, t, d, x) {
    const trem = ctx.createGain(); trem.gain.value = 1;
    const tl = ctx.createOscillator(), tg = ctx.createGain();
    tl.frequency.value = 5.5; tg.gain.value = .3;
    tl.connect(tg); tg.connect(trem.gain); tl.start(t); tl.stop(t + 1.6);
    trem.connect(x);
    [[1, .45, 1.4], [3, .12, .5], [5, .05, .25]].forEach(([h, v, dec]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = freq(m) * h;
        g.gain.setValueAtTime(v, t);
        g.gain.exponentialRampToValueAtTime(.001, t + dec);
        o.connect(g); g.connect(trem); o.start(t); o.stop(t + dec + .05);
    });
}
function harmonium(m, t, d, x) {
    [-4, 4, 0].forEach((det, i) => {
        const o = ctx.createOscillator(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
        o.type = i === 2 ? 'square' : 'sawtooth';
        o.frequency.value = freq(m); o.detune.value = det;
        fl.type = 'lowpass'; fl.frequency.value = 850; fl.Q.value = .4;
        const vol = i === 2 ? .07 : .13;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(vol, t + .35);
        g.gain.setValueAtTime(vol, t + Math.max(.4, d));
        g.gain.linearRampToValueAtTime(0, t + Math.max(.4, d) + .4);
        o.connect(fl); fl.connect(g); g.connect(x);
        o.start(t); o.stop(t + d + .9);
    });
    noiseHit(t, .02, 'lowpass', 500, Math.max(.4, d), x);
}

/* ---- Britpop-Sounds ---- */
function wallGt(m, t, d, x) {
    ks(m - .06, t, d, x, { vol: .28, drive: true });
    ks(m + .07, t + .012, d, x, { vol: .28, drive: true, damp: .498 });
    ks(m + 12, t + .02, d, x, { vol: .14, drive: true, damp: .497 });
}
function britLead(m, t, d, x) {
    ks(m, t, d, x, { vol: .42, drive: true });
    ks(m + .09, t + .018, d, x, { vol: .26, drive: true, damp: .4982 });
}
function tremGt(m, t, d, x) {
    const g = ctx.createGain(); g.gain.value = .7;
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 5.2; lg.gain.value = .4;
    lfo.connect(lg); lg.connect(g.gain);
    lfo.start(t); lfo.stop(t + 2.5);
    g.connect(x);
    ks(m, t, d, g, { vol: .85 });
}
function tinW(m, t, d, x) {
    flute(m + 12, t, d, x);
    noiseHit(t, .025, 'highpass', 4000, .06, x);
}


/* ---- Indie, Akustik, Elektronik: Skizzen- und Guide-Sounds ---- */
function ukulele(m, t, d, x) {           // kurzer Sustain, helle Nylonsaite
    ks(m + 12, t, Math.min(d, .5), x, { vol: .7, damp: .4955 });
    noiseHit(t, .05, 'highpass', 3500, .012, x);
}
function steelAcoustic(m, t, d, x) {     // Stahlsaite: Anschlag plus Oktav-Obertöne
    ks(m, t, d, x, { vol: .6, damp: .4982 });
    ks(m + 12, t + .002, d, x, { vol: .14, damp: .496 });
    noiseHit(t, .06, 'bandpass', 2600, .018, x);
}
function jangle(m, t, d, x) {            // helle, leicht verstimmte Clean-Gitarre
    ks(m - .05, t, d, x, { vol: .4, damp: .4975 });
    ks(m + .05, t + .006, d, x, { vol: .34, damp: .4968 });
    ks(m + 12, t + .009, d, x, { vol: .1, damp: .495 });
}
function powerChord(m, t, d, x) {        // Grundton, Quinte, Oktave aus einer Note
    ks(m, t, d, x, { vol: .3, drive: true });
    ks(m + 7, t + .004, d, x, { vol: .24, drive: true });
    ks(m + 12, t + .008, d, x, { vol: .16, drive: true });
}
function supersaw(m, t, d, x) {          // breite, helle Fläche
    [-14, -6, 0, 6, 14].forEach(c => simpleOsc(m, t, d, x, 'sawtooth', 7000, .09, .004, .12, c));
}
function bell(m, t, d, x) {              // glasige Glocke
    [[1, .34, 1.1], [2.76, .12, .5], [5.4, .05, .22]].forEach(([h, v, dec]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = freq(m) * h;
        g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.001, t + dec);
        o.connect(g); g.connect(x); o.start(t); o.stop(t + dec + .05);
    });
}
function lofiKeys(m, t, d, x) {          // gedämpftes, leicht leierndes E-Piano
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500; lp.connect(x);
    [[1, .42, 1.1], [2, .1, .6]].forEach(([h, v, dec]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = freq(m) * h;
        const w = ctx.createOscillator(), wg = ctx.createGain();
        w.frequency.value = .9; wg.gain.value = 7;
        w.connect(wg); wg.connect(o.detune);
        g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.001, t + dec);
        o.connect(g); g.connect(lp); o.start(t); w.start(t); o.stop(t + dec + .05); w.stop(t + dec + .05);
    });
}
function sub808(m, t, d, x) {            // lang ausklingender Sub mit Pitch-Fall
    const o = ctx.createOscillator(), g = ctx.createGain();
    const f = freq(m);
    o.frequency.setValueAtTime(f * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(f, t + .05);
    const end = t + Math.max(.25, d) + .3;
    g.gain.setValueAtTime(.8, t); g.gain.setValueAtTime(.8, t + Math.max(.2, d)); g.gain.exponentialRampToValueAtTime(.001, end);
    o.connect(g); g.connect(x); o.start(t); o.stop(end + .02);
}

// Gesampelte Instrumente: fehlen die Daten, spielt der Synth-Klang weiter. Anschlagstärke kommt als fünfter Wert.
const sampled = (set, fallback, opts = {}) => ({
    set,
    play(m, t, d, x, vel) {
        if (!WD.samples.has(set)) return fallback(m, t, d, x);
        WD.samples.playPitched(set, m, t, d, x, Object.assign({ vel }, opts, opts.bright ? { brightness: vel === undefined ? .8 : vel } : {}));
    },
});
const glockFallback = (m, t, d, x) => mallet(m + 12, t, d, x, 3.7, 1.5, .15);

const INSTR = {
    'Sampled Grand': { cat: 'Echte Samples', family: 'keys', iconName: 'keys', ...sampled('piano', piano, { release: .35, gain: .55, bright: true }) },
    'Sampled EP': { cat: 'Echte Samples', family: 'keys', iconName: 'keys', ...sampled('epiano', ePiano, { release: .25, gain: .55, bright: true }) },
    'Sampled Bass': { cat: 'Echte Samples', family: 'bass', iconName: 'bass', ...sampled('bass', (m, t, d, x) => simpleOsc(m, t, d, x, 'sawtooth', 650, .5, .01, .12), { release: .1, gain: .6, maxLen: 8 }) },
    'Sampled Strings': { cat: 'Echte Samples', family: 'keys', iconName: 'keys', ...sampled('strings', strings, { release: .45, gain: .5 }) },
    'Sampled Pizz': { cat: 'Echte Samples', family: 'keys', iconName: 'keys', ...sampled('pizz', strings, { release: .12, gain: .6, maxLen: 3 }) },
    'Sampled Glock': { cat: 'Echte Samples', family: 'keys', iconName: 'mallet', ...sampled('glock', glockFallback, { release: .5, gain: .5, maxLen: 5 }) },
    'Sampled Celesta': { cat: 'Echte Samples', family: 'keys', iconName: 'mallet', ...sampled('celesta', glockFallback, { release: .4, gain: .55, maxLen: 5 }) },
    'Sampled Music Box': { cat: 'Echte Samples', family: 'keys', iconName: 'mallet', ...sampled('musicbox', glockFallback, { release: .5, gain: .55, maxLen: 5 }) },
    'Clean Guitar': { cat: 'Gitarren', play: gtClean },
    'Overdrive Guitar': { cat: 'Gitarren', play: gtDrive },
    '12-String Guitar': { cat: 'Gitarren', play: gt12 },
    'Muted Guitar': { cat: 'Gitarren', play: (m, t, d, x) => ks(m, t, d, x, { vol: .8, damp: .488 }) },
    'Nylon Guitar': { cat: 'Gitarren', play: (m, t, d, x) => ks(m, t, d, x, { vol: .7, damp: .4978 }) },
    'Bass': { cat: 'Bass', play: (m, t, d, x) => simpleOsc(m, t, d, x, 'sawtooth', 650, .5, .01, .12) },
    'Picked Bass': { cat: 'Bass', play: (m, t, d, x) => ks(m, t, d, x, { vol: .8, damp: .499 }) },
    'Sub Bass': { cat: 'Bass', play: (m, t, d, x) => simpleOsc(m, t, d, x, 'sine', 300, .7, .01, .15) },
    'Fuzz Bass': { cat: 'Bass', play: (m, t, d, x) => ks(m, t, d, x, { vol: .5, drive: true, damp: .498 }) },
    'Grand Piano': { cat: 'Keys', play: piano },
    'E-Piano': { cat: 'Keys', play: ePiano },
    'Organ': { cat: 'Keys', play: organ },
    'Upright Piano': { cat: 'Keys', play: honky },
    'Hammond Organ': { cat: 'Keys', play: hammond },
    'Wurlitzer': { cat: 'Keys', play: wurli },
    'Harmonium': { cat: 'Keys', play: harmonium },
    'Rock Organ': { cat: 'Keys', play: (m, t, d, x) => { organ(m, t, d, x); organ(m + 12, t, d, x); } },
    'Harpsichord': { cat: 'Keys', play: (m, t, d, x) => { ks(m, t, d, x, { vol: .5, damp: .4982 }); ks(m + 12, t, d, x, { vol: .25, damp: .4982 }); } },
    'Marimba': { cat: 'Mallets', play: (m, t, d, x) => mallet(m, t, d, x, 4, .45, .2) },
    'Vibraphone': { cat: 'Mallets', play: vibra },
    'Music Box': { cat: 'Mallets', play: (m, t, d, x) => mallet(m + 12, t, d, x, 3.7, 1.5, .15) },
    'Synth Lead': { cat: 'Synth', play: (m, t, d, x) => simpleOsc(m, t, d, x, 'square', 2400, .3, .01, .2) },
    'Synth Pad': { cat: 'Synth', play: pad },
    'Synth Brass': { cat: 'Synth', play: (m, t, d, x) => { [-10, 10].forEach(c => simpleOsc(m, t, d, x, 'sawtooth', 3000, .2, .05, .2, c)); } },
    'Synth Pluck': { cat: 'Synth', play: (m, t, d, x) => ks(m, t, d, x, { vol: .6, damp: .492 }) },
    'Mellotron': { cat: 'Orchestral', play: mellotron },
    'Strings': { cat: 'Orchestral', play: strings },
    'Cello': { cat: 'Orchestral', play: cello },
    'Brass': { cat: 'Orchestral', play: brass },
    'Flute': { cat: 'Orchestral', play: flute },
    'Choir': { cat: 'Orchestral', play: choir },
    'Vocal Oohs': { cat: 'Orchestral', play: choir },
    'Wall of Guitars': { cat: 'Britpop', play: wallGt },
    'Britpop Lead': { cat: 'Britpop', play: britLead },
    'Tremolo Guitar': { cat: 'Britpop', play: tremGt },
    'Tin Whistle': { cat: 'Britpop', play: tinW },
    'Soul Brass': { cat: 'Britpop', play: (m, t, d, x) => { brass(m, t, d, x); brass(m + 12, t, d, x); } },
    'Gospel Choir': { cat: 'Britpop', play: (m, t, d, x) => { choir(m, t, d, x); choir(m - 12, t, d, x); } },
    'Ukulele': { cat: 'Akustisch', iconName: 'uke', play: ukulele },
    'Steel Acoustic': { cat: 'Akustisch', iconName: 'guitar', play: steelAcoustic },
    'Indie Jangle': { cat: 'Akustisch', iconName: 'guitar', play: jangle },
    'Power Chords': { cat: 'Britpop', iconName: 'guitar', play: powerChord },
    'Hyper Saw': { cat: 'Elektronisch', iconName: 'synth', play: supersaw },
    'Glass Bell': { cat: 'Elektronisch', iconName: 'mallet', play: bell },
    'Lo-Fi Keys': { cat: 'Elektronisch', iconName: 'keys', play: lofiKeys },
    '808 Sub': { cat: 'Elektronisch', iconName: 'bass', play: sub808 },
};

// Interne Namen bleiben (sie stehen in gespeicherten Projekten), angezeigt wird einheitlich Deutsch
const LABELS = {
    'Sampled Grand': 'Flügel (Sample)', 'Sampled Bass': 'E-Bass (Sample)', 'Sampled Kit': 'Akustik-Kit (Sample)',
    'Own Sampler': 'Eigener Sampler', 'Sampled EP': 'E-Piano (Sample)', 'Sampled Strings': 'Streicher (Sample)', 'Sampled Pizz': 'Pizzicato (Sample)', 'Sampled Glock': 'Glockenspiel (Sample)',
    'Sampled Celesta': 'Celesta (Sample)', 'Sampled Music Box': 'Spieluhr (Sample)', 'Sampled Pop Kit': 'Trockenes Pop-Kit (Sample)',
    'Clean Guitar': 'Clean-Gitarre', 'Overdrive Guitar': 'Overdrive-Gitarre', '12-String Guitar': '12-saitige Gitarre',
    'Muted Guitar': 'Abgedämpfte Gitarre', 'Nylon Guitar': 'Nylongitarre', 'Bass': 'Synth-Bass', 'Picked Bass': 'Plektrum-Bass',
    'Sub Bass': 'Sub-Bass', 'Fuzz Bass': 'Fuzz-Bass', 'Grand Piano': 'Flügel (Synth)', 'Organ': 'Orgel', 'Upright Piano': 'Klavier',
    'Hammond Organ': 'Hammond-Orgel', 'Rock Organ': 'Rock-Orgel', 'Harpsichord': 'Cembalo', 'Vibraphone': 'Vibraphon', 'Music Box': 'Spieluhr',
    'Synth Lead': 'Synth-Lead', 'Synth Pad': 'Synth-Fläche', 'Synth Brass': 'Synth-Bläser', 'Synth Pluck': 'Synth-Pluck',
    'Strings': 'Streicher', 'Brass': 'Bläser', 'Flute': 'Querflöte', 'Choir': 'Chor', 'Vocal Oohs': 'Chor (Oohs)',
    'Wall of Guitars': 'Gitarrenwand', 'Britpop Lead': 'Britpop-Lead', 'Tremolo Guitar': 'Tremolo-Gitarre', 'Tin Whistle': 'Tin Whistle',
    'Soul Brass': 'Soul-Bläser', 'Gospel Choir': 'Gospelchor', 'Steel Acoustic': 'Westerngitarre', 'Indie Jangle': 'Indie-Jangle',
    'Power Chords': 'Powerchords', 'Hyper Saw': 'Hyper-Saw', 'Glass Bell': 'Glasglocke', 'Lo-Fi Keys': 'Lo-Fi-Keys', '808 Sub': '808-Sub',
    'Rock Kit': 'Rock-Kit', 'Brit Pop': 'Britpop-Kit', 'Britpop Anthem': 'Britpop-Hymne', '808': '808-Kit', 'LoFi': 'Lo-Fi-Kit',
    'Live Room': 'Live-Raum', 'Bedroom': 'Bedroom-Kit', 'Hyperpop': 'Hyperpop-Kit',
};
const FAMILY = { Gitarren: 'guitar', Britpop: 'guitar', Akustisch: 'guitar', Bass: 'bass' };

const KITS = {
    'Sampled Kit': { sampled: 'drums', kick: [150, 45, .45], snF: 1800, snD: .2, snT: 180, htF: 8000, htD: .05, ohD: .3, clF: 1400 },
    'Sampled Pop Kit': { sampled: 'drumspop', kick: [150, 45, .45], snF: 1800, snD: .2, snT: 180, htF: 8000, htD: .05, ohD: .3, clF: 1400 },
    'Rock Kit': { kick: [150, 45, .45], snF: 1800, snD: .2, snT: 180, htF: 8000, htD: .05, ohD: .3, clF: 1400 },
    'Brit Pop': { kick: [135, 40, .5], snF: 1500, snD: .22, snT: 165, htF: 7000, htD: .06, ohD: .35, clF: 1200 },
    'Britpop Anthem': { kick: [145, 42, .55], snF: 1550, snD: .3, snT: 170, htF: 7200, htD: .07, ohD: .4, clF: 1250, room: .35, crD: 2.4 },
    '808': { kick: [120, 32, .7], snF: 1200, snD: .25, snT: 140, htF: 9000, htD: .04, ohD: .45, clF: 1000 },
    'LoFi': { kick: [100, 40, .4], snF: 900, snD: .22, snT: 150, htF: 5000, htD: .06, ohD: .25, clF: 800 },
    'Live Room': { kick: [125, 48, .38], snF: 1700, snD: .24, snT: 190, htF: 7600, htD: .06, ohD: .42, clF: 1300, room: .28, crD: 2 },
    'Bedroom': { kick: [90, 42, .3], snF: 1100, snD: .13, snT: 210, htF: 6200, htD: .035, ohD: .16, clF: 1100 },
    'Hyperpop': { kick: [180, 38, .6], snF: 2600, snD: .12, snT: 240, htF: 10500, htD: .028, ohD: .2, clF: 2000 },
};
function noiseHit(t, v, type, f, dur, dest) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuffer();
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(dest); s.start(t); s.stop(t + dur + .05);
}
function playDrum(lane, kitName, t, dest, chokeGroup, vel) {
    const k = KITS[kitName] || KITS['Rock Kit'];
    if (k.sampled && WD.samples.has(k.sampled, lane)) { WD.samples.playDrum(k.sampled, lane, t, dest, chokeGroup, .9, vel); return; }
    if (lane === 0) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(k.kick[0], t);
        o.frequency.exponentialRampToValueAtTime(k.kick[1], t + .12);
        g.gain.setValueAtTime(.9, t); g.gain.exponentialRampToValueAtTime(.001, t + k.kick[2]);
        o.connect(g); g.connect(dest); o.start(t); o.stop(t + k.kick[2] + .05);
        if (k.room) noiseHit(t, .12, 'highpass', 2500, .025, dest);
    } else if (lane === 1) {
        noiseHit(t, .8, 'bandpass', k.snF, k.snD, dest);
        if (k.room) noiseHit(t + .015, k.room, 'bandpass', 1100, .5, dest);
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = k.snT;
        g.gain.setValueAtTime(.4, t); g.gain.exponentialRampToValueAtTime(.001, t + .1);
        o.connect(g); g.connect(dest); o.start(t); o.stop(t + .12);
    } else if (lane === 2) noiseHit(t, .4, 'highpass', k.htF, k.htD, dest);
    else if (lane === 3) noiseHit(t, .35, 'highpass', k.htF - 800, k.ohD, dest);
    else if (lane === 4) {
        [0, .012, .024].forEach(o => noiseHit(t + o, .5, 'bandpass', k.clF, .1, dest));
        noiseHit(t + .03, .35, 'bandpass', k.clF, .22, dest);
    } else if (lane === 5) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(220, t);
        o.frequency.exponentialRampToValueAtTime(110, t + .2);
        g.gain.setValueAtTime(.7, t); g.gain.exponentialRampToValueAtTime(.001, t + .35);
        o.connect(g); g.connect(dest); o.start(t); o.stop(t + .4);
    } else if (lane === 6) noiseHit(t, .5, 'highpass', 6000, k.crD || 1.2, dest); else {
        noiseHit(t, .3, 'bandpass', 9000, .08, dest);
        noiseHit(t + .05, .2, 'bandpass', 9000, .12, dest);
    }
}

const DRUMLANES = ['Kick', 'Snare', 'Hi-Hat', 'Open-Hat', 'Clap', 'Tom', 'Crash', 'Tamburin'];

WD.instruments = {
    INSTR, KITS, DRUMLANES,
    setOfInst: name => (INSTR[name] && INSTR[name].set) || null,
    setOfKit: name => (KITS[name] && KITS[name].sampled) || null,
    label: name => LABELS[name] || name,
    // guitar, bass oder keys: bestimmt die passenden Regler und Klang-Presets
    family(name) { const d = INSTR[name]; return (d && (d.family || FAMILY[d.cat])) || 'keys'; },
    // Spielt eine Note der Spur in das angegebene Ziel
    play(track, n, t, durSec, vel, dest) {
        ctx = dest.context;
        let out = dest;
        if (vel !== undefined && vel < 1) {
            out = ctx.createGain(); out.gain.value = Math.max(.05, vel);
            out.connect(dest);
        }
        if (track.type === 'drum') playDrum(n, track.kit, t, out, dest, vel);
        else if (!(track.sampler && WD.sampler.play(track, n, t, durSec, out))) (INSTR[track.inst] || INSTR['Synth Lead']).play(n, t, durSec, out, vel);
    },
    // Live gehaltene Note (MIDI-Keyboard): klingt bis zum Aufruf der Rückgabefunktion
    hold(track, n, vel) {
        const strip = WD.engine.strip(track), c = WD.engine.ctx;
        const g = c.createGain();
        g.connect(strip.input);
        WD.instruments.play(track, n, c.currentTime, track.type === 'drum' ? .4 : 10, vel, g);
        return () => {
            if (track.type === 'drum') return;
            g.gain.setTargetAtTime(0, c.currentTime, .05);
            setTimeout(() => g.disconnect(), 400);
        };
    },
    // Live-Vorhören einer Note über den Kanalzug der Spur
    preview(track, n, durSec, vel) {
        return WD.engine.ensure().then(() => {
            const strip = WD.engine.strip(track);
            WD.instruments.play(track, n, WD.engine.ctx.currentTime, durSec || .4, vel, strip.input);
        });
    },
    cacheSize: () => ksCache.size,
};
})();
