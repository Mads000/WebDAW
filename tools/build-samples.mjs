// Baut die eingebetteten Samples (js/audio/samples/*.js). Aufruf: node tools/build-samples.mjs
// Quellen und Lizenzen: docs/SAMPLES.md. Die Dateien liegen als Skripte vor, damit sie auch per Doppelklick (file://) laden.
import { launch } from '../tests/lib/cdp.mjs';
import { writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'js', 'audio', 'samples');
const b64 = async url => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status + ' ' + url);
    return Buffer.from(await res.arrayBuffer()).toString('base64');
};
const { page, close } = await launch({});
await page.goto('about:blank');
await page.eval(readFileSync(join(root, 'js/vendor/lame.min.js'), 'utf8') + ';window.lamejs=lamejs;0');
await page.eval(`
window.dec = async s => { const u = Uint8Array.from(atob(s), c => c.charCodeAt(0)); return new OfflineAudioContext(2, 1, 48000).decodeAudioData(u.buffer); };
// Anfang des Anschlags, damit Encoder-Vorlauf und Stille nicht verzögern
window.onset = b => { const d = b.getChannelData(0); let p = 0; for (const v of d) p = Math.max(p, Math.abs(v)); for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > p * .03) return Math.max(0, i / b.sampleRate - .001); return 0; };
window.onsetOf = async s => onset(await dec(s));
window.enc = async (parts, secs, kbps) => {
    const bufs = []; for (const [s, g] of parts) bufs.push([await dec(s), g]);
    const sr = 48000, n = Math.min(Math.ceil(secs * sr), Math.max(...bufs.map(b => b[0].length)));
    const L = new Float32Array(n), R = new Float32Array(n);
    for (const [b, g] of bufs) { const st = Math.floor(onset(b) * sr); const a = b.getChannelData(0), c = b.getChannelData(b.numberOfChannels - 1);
        for (let i = 0; i + st < b.length && i < n; i++) { L[i] += a[i + st] * g; R[i] += c[i + st] * g; } }
    const fade = Math.floor(n * .3); for (let i = 0; i < fade; i++) { const f = 1 - i / fade; L[n - fade + i] *= f; R[n - fade + i] *= f; }
    let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    const norm = .95 / peak, toI = x => { const o = new Int16Array(n); for (let i = 0; i < n; i++) o[i] = x[i] * norm * 32767; return o; };
    const I = toI(L), J = toI(R), e = new lamejs.Mp3Encoder(2, sr, kbps), out = [];
    for (let i = 0; i < n; i += 1152) { const m = e.encodeBuffer(I.subarray(i, i + 1152), J.subarray(i, i + 1152)); if (m.length) out.push(m); }
    const m = e.flush(); if (m.length) out.push(m);
    const all = new Uint8Array(out.reduce((s, x) => s + x.length, 0)); let o = 0; for (const x of out) { all.set(x, o); o += x.length; }
    let bin = ''; for (let i = 0; i < all.length; i += 8192) bin += String.fromCharCode(...all.subarray(i, i + 8192));
    const s = btoa(bin); return [s, await onsetOf(s)];
};0`);
const write = (name, zones) => {
    const js = `// Erzeugt von tools/build-samples.mjs. Quellen und Lizenzen: docs/SAMPLES.md\nWD.sampleData = WD.sampleData || {};\nWD.sampleData[${JSON.stringify(name)}] = ${JSON.stringify(zones)};\n`;
    writeFileSync(join(outDir, name + '.js'), js);
    console.log(name, Object.keys(zones).length, 'Zonen', (js.length / 1048576).toFixed(2), 'MB');
};

// Flügel: Salamander Grand Piano, alle sechs Halbtöne
const PIANO = { A0: 21, C1: 24, Fs1: 30, C2: 36, Fs2: 42, C3: 48, Fs3: 54, C4: 60, Fs4: 66, C5: 72, Fs5: 78, C6: 84, Fs6: 90, C7: 96, C8: 108 };
const piano = {};
for (const [nm, midi] of Object.entries(PIANO)) {
    const s = await b64(`https://tonejs.github.io/audio/salamander/${nm}.mp3`);
    piano[midi] = [[s, await page.eval(`onsetOf(${JSON.stringify(s)})`)]];
}
write('piano', piano);

// E-Bass: FluidR3 GM (Finger)
const src = await (await fetch('https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/gh-pages/FluidR3_GM/electric_bass_finger-mp3.js')).text();
const BASS = { E1: 28, A1: 33, D2: 38, G2: 43, C3: 48, F3: 53, Bb3: 58 };
const bass = {};
for (const [nm, midi] of Object.entries(BASS)) {
    const key = `"${nm}": "data:audio/mp3;base64,`, at = src.indexOf(key);
    if (at < 0) throw new Error('Bass fehlt: ' + nm);
    const data = src.slice(at + key.length, src.indexOf('"', at + key.length));
    bass[midi] = [[data, await page.eval(`onsetOf(${JSON.stringify(data)})`)]];
}
write('bass', bass);

// Drums: Virtuosity Drums (CC0). Nahmikrofon plus Overheads, zwei Varianten gegen den Maschinengewehr-Effekt
const base = 'https://raw.githubusercontent.com/sfzinstruments/virtuosity_drums/master/';
const tree = (await (await fetch('https://api.github.com/repos/sfzinstruments/virtuosity_drums/git/trees/master?recursive=1')).json()).tree.map(x => x.path);
const pick = (prefix, art, take) => {
    const re = new RegExp(String.raw`/${prefix}_${art}_vl(\d+)(?:_rr(\d+))?\.flac$`);
    const hits = tree.map(p => [p, p.match(re)]).filter(x => x[1]);
    const vls = [...new Set(hits.map(x => +x[1][1]))].sort((a, b) => a - b);
    const hasRr = hits.some(x => x[1][2]);
    const vl = vls[Math.round((vls.length - 1) * .75) - (hasRr ? 0 : take)];
    const f = hits.find(x => +x[1][1] === vl && (!hasRr || +x[1][2] === take + 1));
    if (!f) throw new Error('nicht gefunden: ' + prefix + art);
    return f[0];
};
const part = async (mic, art, take, g, folder) => [await b64(base + encodeURI(pick(mic, art, take))), g];
const DRUMS = [
    [0, 'kick', 'kick_snon', .55, 2, [['kickmic', 1], ['oh', .4]]],
    [1, 'snare', 'snare_center', .6, 2, [['snaremic', 1], ['oh', .5]]],
    [2, 'hh', 'hh_closed', .3, 2, [['oh', 1]]],
    [3, 'hh', 'hh_open', 1.1, 1, [['oh', 1]]],
    [5, 'htom', 'htom_center', .9, 1, [['mid', 1]]],
    [6, 'crash', 'crash_crash', 2.8, 1, [['oh', 1]]],
];
const drums = {};
for (const [lane, , art, secs, takes, mics] of DRUMS) {
    drums[lane] = [];
    for (let k = 0; k < takes; k++) {
        const parts = []; for (const [mic, g] of mics) parts.push(await part(mic, art, k, g));
        drums[lane].push(await page.eval(`enc(${JSON.stringify(parts)}, ${secs}, 160)`));
    }
}
const tamb = await b64(base + 'Samples/perc/close/tambourine/Tamb1_Shake_rr1_Close.wav');
drums[7] = [await page.eval(`enc(${JSON.stringify([[tamb, 1]])}, .5, 128)`)];
write('drums', drums);
await close();
