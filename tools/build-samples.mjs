// Baut die Sample-Sets (js/audio/samples/*.js). Aufruf: node tools/build-samples.mjs [set …], ohne Angabe alle.
// Quellen und Lizenzen: docs/SAMPLES.md. Die Dateien liegen als Skripte vor, damit sie auch per Doppelklick (file://) laden.
import { launch } from '../tests/lib/cdp.mjs';
import { writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'js', 'audio', 'samples');
const only = process.argv.slice(2);
const b64 = async url => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status + ' ' + url);
    return Buffer.from(await res.arrayBuffer()).toString('base64');
};
const treeOf = async (repo, ref) => {
    const res = await fetch(`https://api.github.com/repos/${repo}/git/trees/${ref}?recursive=1`);
    if (!res.ok) throw new Error(res.status + ' ' + repo);
    return (await res.json()).tree.filter(x => x.type === 'blob').map(x => x.path);
};
const rawUrl = (repo, ref, path) => `https://raw.githubusercontent.com/${repo}/${ref}/${path.split('/').map(encodeURIComponent).join('/')}`;

const { page, close } = await launch({});
await page.goto('about:blank');
await page.eval(readFileSync(join(root, 'js/vendor/lame.min.js'), 'utf8') + ';window.lamejs=lamejs;0');
await page.eval(`
window.dec = async s => { const u = Uint8Array.from(atob(s), c => c.charCodeAt(0)); return new OfflineAudioContext(2, 1, 48000).decodeAudioData(u.buffer); };
// Anfang des Anschlags, damit Encoder-Vorlauf und Stille nicht verzögern
window.onset = b => { const d = b.getChannelData(0); let p = 0; for (const v of d) p = Math.max(p, Math.abs(v)); for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > p * .03) return Math.max(0, i / b.sampleRate - .001); return 0; };
window.onsetOf = async s => onset(await dec(s));
// loop: Sekunden ab Anschlag {a, b, xf}; der Bereich wird überblendet, damit gehaltene Töne endlos klingen
window.enc = async (parts, secs, kbps, loop) => {
    const bufs = []; for (const [s, g] of parts) bufs.push([await dec(s), g]);
    const sr = 48000, n = Math.min(Math.ceil(secs * sr), Math.max(...bufs.map(b => b[0].length)));
    const L = new Float32Array(n), R = new Float32Array(n);
    for (const [b, g] of bufs) { const st = Math.floor(onset(b) * sr); const a = b.getChannelData(0), c = b.getChannelData(b.numberOfChannels - 1);
        for (let i = 0; i + st < b.length && i < n; i++) { L[i] += a[i + st] * g; R[i] += c[i + st] * g; } }
    let A = 0, B = 0;
    if (loop) {
        B = Math.min(n - 2400, Math.floor(loop.b * sr)); const X = Math.floor(loop.xf * sr); A = Math.max(X + 1, Math.floor(loop.a * sr));
        if (B <= A + X) throw new Error('Sample zu kurz für Loop');
        for (const d of [L, R]) { const src = d.slice(A - X, A); for (let i = 0; i < X; i++) { const f = i / X; d[B - X + i] = d[B - X + i] * Math.sqrt(1 - f) + src[i] * Math.sqrt(f); } }
    } else { const fade = Math.floor(n * .3); for (let i = 0; i < fade; i++) { const f = 1 - i / fade; L[n - fade + i] *= f; R[n - fade + i] *= f; } }
    let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    const norm = .95 / peak, toI = x => { const o = new Int16Array(n); for (let i = 0; i < n; i++) o[i] = x[i] * norm * 32767; return o; };
    const I = toI(L), J = toI(R), e = new lamejs.Mp3Encoder(2, sr, kbps), out = [];
    for (let i = 0; i < n; i += 1152) { const m = e.encodeBuffer(I.subarray(i, i + 1152), J.subarray(i, i + 1152)); if (m.length) out.push(m); }
    const m = e.flush(); if (m.length) out.push(m);
    const all = new Uint8Array(out.reduce((s, x) => s + x.length, 0)); let o = 0; for (const x of out) { all.set(x, o); o += x.length; }
    let bin = ''; for (let i = 0; i < all.length; i += 8192) bin += String.fromCharCode(...all.subarray(i, i + 8192));
    const s = btoa(bin), st = await onsetOf(s);
    return loop ? [s, st, loop.layer || 0, st + A / sr, st + B / sr] : [s, st, loop === 0 ? 0 : 0];
};0`);
const write = (name, zones) => {
    const js = `// Erzeugt von tools/build-samples.mjs. Quellen und Lizenzen: docs/SAMPLES.md\nWD.sampleData = WD.sampleData || {};\nWD.sampleData[${JSON.stringify(name)}] = ${JSON.stringify(zones)};\n`;
    writeFileSync(join(outDir, name + '.js'), js);
    console.log(name, Object.keys(zones).length, 'Zonen', (js.length / 1048576).toFixed(2), 'MB');
};
const enc = (parts, secs, kbps, loop) => page.eval(`enc(${JSON.stringify(parts)}, ${secs}, ${kbps}${loop ? ', ' + JSON.stringify(loop) : ''})`);
const withLayer = (z, layer) => { z[2] = layer; return z; };

const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const midiOf = s => { const m = /^([A-G](?:#|b)?)(-?\d)$/.exec(s); return 12 * (+m[2] + 1) + NOTE[m[1]]; };
const NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const flatName = m => NAMES_FLAT[m % 12] + (Math.floor(m / 12) - 1);

// FluidR3 GM (MIDI.js): ein Instrument, alle "step" Halbtöne
async function fluid(file, from, to, step) {
    const src = await (await fetch(`https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/gh-pages/FluidR3_GM/${file}-mp3.js`)).text();
    const zones = {};
    for (let m = from; m <= to; m += step) {
        const key = `"${flatName(m)}": "data:audio/mp3;base64,`, at = src.indexOf(key);
        if (at < 0) throw new Error(file + ' fehlt: ' + flatName(m));
        const data = src.slice(at + key.length, src.indexOf('"', at + key.length));
        zones[m] = [[data, await page.eval(`onsetOf(${JSON.stringify(data)})`)]];
    }
    return zones;
}

const VSCO = 'sgossner/VSCO-2-CE';
const SWIRLY = 'sfzinstruments/karoryfer.swirly-drums';
const VIRT = 'sfzinstruments/virtuosity_drums';
// VSCO zählt die Oktaven eins niedriger als MIDI üblich (Geigen beginnen bei „G2“); per Tonhöhenmessung geprüft
const VSCO_OCT = 12;
const vscoTree = () => treeOf(VSCO, 'master');

const BUILD = {
    // Flügel: Salamander, alle drei Halbtöne, zwei Anschlagstufen
    async piano() {
        const repo = 'sfzinstruments/SalamanderGrandPiano', zones = {};
        const names = ['C', 'D#', 'F#', 'A'];
        for (let oct = 0; oct <= 8; oct++) for (const nm of names) {
            const midi = midiOf(nm + oct);
            if (midi < 21 || midi > 108) continue;
            const secs = midi < 60 ? 5 : midi < 84 ? 3.5 : 2.2;
            zones[midi] = [];
            for (const [layer, v] of [[0, 5], [1, 12]]) {
                const s = await b64(rawUrl(repo, 'master', `Samples/${nm}${oct}v${v}.flac`));
                zones[midi].push(withLayer(await enc([[s, 1]], secs, 96), layer));
            }
        }
        write('piano', zones);
    },
    async bass() { write('bass', await fluid('electric_bass_finger', 28, 58, 5)); },
    async epiano() { write('epiano', await fluid('electric_piano_1', 36, 96, 4)); },
    async celesta() { write('celesta', await fluid('celesta', 60, 108, 4)); },
    async musicbox() { write('musicbox', await fluid('music_box', 60, 108, 4)); },

    // Streicher-Ensemble: Celli, Bratschen und Geigen (VSCO 2 CE), gehaltene Töne geloopt
    async strings() {
        const tree = await vscoTree(), found = {};
        const scan = (dir, re, from, to) => tree.filter(p => p.startsWith(dir)).forEach(p => {
            const m = re.exec(p); if (!m) return;
            const midi = midiOf(m[1]) + VSCO_OCT; if (midi >= from && midi < to) found[midi] = p;
        });
        scan('Strings/Cello Section/susvib/', /susvib_([A-G]#?\d)_v3_1\.wav$/, 36, 55);
        scan('Strings/Viola Section/susvib/', /susvib_([A-G]#?\d)_v2_1\.wav$/, 55, 67);
        scan('Strings/Violin Section/susVib/', /susVib_([A-G]#?\d)_v2\.wav$/, 67, 100);
        const zones = {};
        let last = -99;
        for (const midi of Object.keys(found).map(Number).sort((a, b) => a - b)) {
            if (midi - last < 4) continue;
            last = midi;
            const s = await b64(rawUrl(VSCO, 'master', found[midi]));
            zones[midi] = [await enc([[s, 1]], 4, 112, { a: 1.6, b: 3.4, xf: .4 })];
        }
        write('strings', zones);
    },
    // Pizzicato: zwei Anschlagstufen, Round-Robin
    async pizz() {
        const tree = await vscoTree(), zones = {}, re = /VlnEns_Pizz_([A-G]#?\d)_v([12])_rr([12])\.wav$/, notes = {};
        tree.filter(p => p.startsWith('Strings/Violin Section/Pizz/')).forEach(p => { const m = re.exec(p); if (m) { const k = midiOf(m[1]) + VSCO_OCT; (notes[k] = notes[k] || []).push([p, +m[2] - 1]); } });
        let last = -99;
        for (const midi of Object.keys(notes).map(Number).sort((a, b) => a - b)) {
            if (midi - last < 4) continue;
            last = midi;
            zones[midi] = [];
            for (const [p, layer] of notes[midi]) zones[midi].push(withLayer(await enc([[await b64(rawUrl(VSCO, 'master', p)), 1]], 1.2, 96), layer));
        }
        write('pizz', zones);
    },
    async glock() {
        const zones = {};
        for (const nm of ['G4', 'C5', 'G5', 'C6', 'G6', 'C7']) zones[midiOf(nm) + 12] = [await enc([[await b64(rawUrl(VSCO, 'master', `Percussion/Glock/glock_medium_${nm}.wav`)), 1]], 2.8, 112)];
        write('glock', zones);
    },

    // Akustik-Kit: Virtuosity Drums, Nahmikrofon plus Overheads, zwei Anschlagstufen
    async drums() {
        const tree = await treeOf(VIRT, 'master');
        const pick = (prefix, art, take, frac) => {
            const re = new RegExp(String.raw`/${prefix}_${art}_vl(\d+)(?:_rr(\d+))?\.flac$`);
            const hits = tree.map(p => [p, p.match(re)]).filter(x => x[1]);
            const vls = [...new Set(hits.map(x => +x[1][1]))].sort((a, b) => a - b);
            const hasRr = hits.some(x => x[1][2]);
            const vl = vls[Math.max(0, Math.round((vls.length - 1) * frac) - (hasRr ? 0 : take))];
            const f = hits.find(x => +x[1][1] === vl && (!hasRr || +x[1][2] === take + 1));
            if (!f) throw new Error('nicht gefunden: ' + prefix + art);
            return f[0];
        };
        const DRUMS = [
            [0, 'kick_snon', .55, 2, [['kickmic', 1], ['oh', .4]]],
            [1, 'snare_center', .6, 3, [['snaremic', 1], ['oh', .5]]],
            [2, 'hh_closed', .3, 3, [['oh', 1]]],
            [3, 'hh_open', 1.1, 1, [['oh', 1]]],
            [5, 'htom_center', .9, 1, [['mid', 1]]],
            [6, 'crash_crash', 2.8, 1, [['oh', 1]]],
        ];
        const zones = {};
        for (const [lane, art, secs, takes, mics] of DRUMS) {
            zones[lane] = [];
            for (const [layer, frac] of [[0, .35], [1, .8]]) for (let k = 0; k < takes; k++) {
                const parts = []; for (const [mic, g] of mics) parts.push([await b64(rawUrl(VIRT, 'master', pick(mic, art, k, frac))), g]);
                zones[lane].push(withLayer(await enc(parts, secs, 160), layer));
            }
        }
        zones[7] = [await enc([[await b64(rawUrl(VIRT, 'master', 'Samples/perc/close/tambourine/Tamb1_Shake_rr1_Close.wav')), 1]], .5, 128)];
        write('drums', zones);
    },

    // Trockenes Pop-Kit: Swirly Drums, nur der trockene Ordner, zwei Anschlagstufen, drei Varianten
    async drumspop() {
        const tree = await treeOf(SWIRLY, 'main');
        const dry = (dir, file, vl, rr) => {
            const hit = tree.find(p => p.startsWith(`Samples/${dir}/`) && new RegExp(`${file}_vl${vl}_rr${rr}(_front|_top)?\\.wav$`).test(p));
            if (!hit) throw new Error(`fehlt: ${dir} ${file} vl${vl} rr${rr}`);
            return hit;
        };
        const maxVl = (dir, file) => Math.max(...tree.filter(p => p.startsWith(`Samples/${dir}/`) && p.includes(file + '_vl')).map(p => +/_vl(\d+)/.exec(p)[1]));
        const KIT = [[0, 'cajon_kick', 'cajon_kick', .5], [1, 'snare_main', null, .45], [2, 'hat_closed', 'hh_closed', .25], [3, 'hat_open', null, 1], [5, 'tom_mlow', null, .8], [6, 'crash', 'crash', 2.6]];
        const nameIn = dir => /([^/]+)_vl\d+_rr\d+/.exec(tree.find(p => p.startsWith(`Samples/${dir}/`) && /_vl\d+_rr\d+/.test(p)))[1];
        const zones = {};
        for (const [lane, dir, known, secs] of KIT) {
            const file = known || nameIn(dir), top = maxVl(dir, file);
            zones[lane] = [];
            for (const [layer, frac] of [[0, .45], [1, .9]]) for (let rr = 1; rr <= 3; rr++) {
                const vl = Math.max(1, Math.round(top * frac));
                zones[lane].push(withLayer(await enc([[await b64(rawUrl(SWIRLY, 'main', dry(dir, file, vl, rr))), 1]], secs, 160), layer));
            }
        }
        write('drumspop', zones);
    },
};

for (const name of only.length ? only : Object.keys(BUILD)) { console.log('baue', name); await BUILD[name](); }
await close();
