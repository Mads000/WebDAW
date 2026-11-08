// Gesampelte Klänge (Flügel, E-Bass, Drumkit). Die Daten liegen als Skripte in js/audio/samples/ und werden
// beim Start der Engine einmal dekodiert. Fehlt ein Set, spielen die Instrumente ihren Synth-Klang weiter.
'use strict';
(() => {
    const sets = {}; // name → {key: [{buf, start}, …]}
    const round = {};
    const openHats = new WeakMap();
    let loading = null;

    const toBytes = s => {
        const bin = atob(s), u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        return u.buffer;
    };

    // Gleicht die Zonen untereinander an, damit das Instrument über die Tastatur gleich laut bleibt
    function normOf(buf) {
        let p = 0;
        for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) if (d[i] > p) p = d[i]; else if (-d[i] > p) p = -d[i]; }
        return p > 0 ? 1 / p : 1;
    }

    async function decodeAll(ctx) {
        const data = WD.sampleData || {};
        await Promise.all(Object.keys(data).map(async name => {
            const out = {};
            await Promise.all(Object.entries(data[name]).map(async ([key, list]) => {
                out[key] = await Promise.all(list.map(async ([b64, start]) => { const buf = await ctx.decodeAudioData(toBytes(b64)); return { buf, start, norm: normOf(buf) }; }));
            }));
            sets[name] = out;
            delete data[name]; // Die Base64-Texte werden nicht mehr gebraucht
        }));
    }

    function nearest(set, m) {
        let best = null, dist = Infinity;
        for (const k of Object.keys(set)) {
            const d = Math.abs(k - m);
            if (d < dist) { dist = d; best = +k; }
        }
        return best;
    }

    function pick(set, key) {
        const list = set[key];
        const id = set === sets.drums ? 'd' + key : key;
        round[id] = ((round[id] || 0) + 1) % list.length;
        return list[round[id]];
    }

    WD.samples = {
        load(ctx) {
            if (!loading) loading = decodeAll(ctx).catch(err => { console.warn('Samples nicht geladen:', err); });
            return loading;
        },
        has: (name, key) => !!sets[name] && (key === undefined || !!sets[name][key]),
        count: name => (sets[name] ? Object.keys(sets[name]).length : 0),

        // Gestimmte Note: nächstliegende Zone, per playbackRate transponiert. brightness 0…1 öffnet den Klang mit der Anschlagstärke.
        playPitched(name, m, t, dur, dest, { release = .3, gain = 1, brightness, maxLen = 12 } = {}) {
            const ctx = dest.context, set = sets[name];
            const root = nearest(set, Math.round(m));
            const z = set[root][0];
            const s = ctx.createBufferSource();
            s.buffer = z.buf;
            s.playbackRate.value = Math.pow(2, (m - root) / 12);
            const g = ctx.createGain();
            const hold = Math.min(maxLen, Math.max(.02, dur));
            const level = gain * z.norm;
            g.gain.setValueAtTime(level, t);
            g.gain.setValueAtTime(level, t + hold);
            g.gain.linearRampToValueAtTime(0, t + hold + release);
            let last = g;
            if (brightness !== undefined) {
                const f = ctx.createBiquadFilter();
                f.type = 'lowpass'; f.frequency.value = 900 + brightness * brightness * 17000; f.Q.value = .3;
                s.connect(f); f.connect(g);
            } else s.connect(g);
            last.connect(dest);
            s.start(t, z.start);
            s.stop(t + hold + release + .02);
        },

        // Drum-Schlag; die geschlossene Hi-Hat würgt eine klingende offene ab
        playDrum(lane, t, out, chokeGroup, level = 1) {
            const ctx = out.context, z = pick(sets.drums, lane);
            const s = ctx.createBufferSource();
            s.buffer = z.buf;
            const g = ctx.createGain();
            g.gain.value = level;
            s.connect(g); g.connect(out);
            s.start(t, z.start);
            if (lane === 3) openHats.set(chokeGroup, g);
            if (lane === 2) {
                const open = openHats.get(chokeGroup);
                if (open) { open.gain.setTargetAtTime(0, t, .012); openHats.delete(chokeGroup); }
            }
        },
    };
})();
