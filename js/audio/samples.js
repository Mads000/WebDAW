// Gesampelte Klänge. Jedes Instrument liegt als eigenes Skript in js/audio/samples/ und wird erst geladen,
// wenn eine Spur es benutzt; so bleibt der Start schnell. Skripte statt fetch, damit es auch per Doppelklick (file://) geht.
// Solange ein Set fehlt, spielen die Instrumente ihren Synth-Klang.
'use strict';
(() => {
    const sets = {}; // name → {key: [{buf, start, layer, loopA, loopB, norm}, …]}
    const round = {};
    const openHats = new WeakMap();
    const pending = new Map();
    let ctxRef = null;

    const toBytes = s => {
        const bin = atob(s), u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        return u.buffer;
    };

    // Gleicht die Zonen untereinander an; die Dynamik kommt aus der Lautstärke der Note
    function normOf(buf) {
        let p = 0;
        for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) if (d[i] > p) p = d[i]; else if (-d[i] > p) p = -d[i]; }
        return p > 0 ? 1 / p : 1;
    }

    function injectScript(name) {
        return new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = `js/audio/samples/${name}.js`;
            s.onload = () => { s.remove(); res(); };
            s.onerror = () => { s.remove(); rej(new Error('Klang „' + name + '“ nicht erreichbar')); };
            document.head.append(s);
        });
    }

    async function loadSet(name) {
        if (!(WD.sampleData && WD.sampleData[name])) await injectScript(name);
        const data = WD.sampleData[name], out = {};
        await Promise.all(Object.entries(data).map(async ([key, list]) => {
            out[key] = await Promise.all(list.map(async ([b64, start, layer = 0, loopA, loopB]) => {
                const buf = await ctxRef.decodeAudioData(toBytes(b64));
                return { buf, start, layer, loopA, loopB, norm: normOf(buf) };
            }));
        }));
        sets[name] = out;
        delete WD.sampleData[name]; // Die Base64-Texte werden nicht mehr gebraucht
        WD.bus.emit('samples:loaded', name);
    }

    function nearest(set, m) {
        let best = null, dist = Infinity;
        for (const k of Object.keys(set)) {
            const d = Math.abs(k - m);
            if (d < dist) { dist = d; best = +k; }
        }
        return best;
    }

    // Anschlagstufe nach Stärke wählen, innerhalb der Stufe reihum gegen den Maschinengewehr-Effekt
    function pick(id, list, vel) {
        const layers = list.reduce((n, z) => Math.max(n, z.layer + 1), 1);
        const layer = Math.min(layers - 1, Math.floor((vel === undefined ? .8 : vel) * layers));
        const cand = list.filter(z => z.layer === layer);
        const use = cand.length ? cand : list;
        const rid = id + '/' + layer;
        round[rid] = ((round[rid] || 0) + 1) % use.length;
        return use[round[rid]];
    }

    // Welche Sets die Spuren eines Projekts brauchen
    function needed(project) {
        const out = new Set();
        project.tracks.forEach(t => {
            const s = t.type === 'drum' ? WD.instruments.setOfKit(t.kit) : t.type === 'inst' ? WD.instruments.setOfInst(t.inst) : null;
            if (s) out.add(s);
        });
        return out;
    }

    const S = WD.samples = {
        // Beim Start der Engine: nur das laden, was das offene Projekt braucht
        load(ctx) { ctxRef = ctx; return S.ensureProject(); },
        has: (name, key) => !!sets[name] && (key === undefined || !!sets[name][key]),
        count: name => (sets[name] ? Object.keys(sets[name]).length : 0),
        keys: name => (sets[name] ? Object.keys(sets[name]).map(Number).sort((a, b) => a - b) : []),
        busy: () => pending.size > 0,

        // Lädt ein Set einmalig; Fehler (etwa offline, nie zuvor geladen) lassen den Synth-Klang weiterspielen
        ensure(name) {
            if (sets[name]) return Promise.resolve(true);
            if (!ctxRef) return WD.engine.ensure().then(() => S.ensure(name));
            if (pending.has(name)) return pending.get(name);
            const p = loadSet(name).then(() => true).catch(err => {
                console.warn(err);
                WD.ui.toast('Ein gesampelter Klang ist gerade nicht erreichbar, es spielt der Ersatzklang. Online lädt er beim nächsten Versuch.', { ms: 6000 });
                return false;
            }).finally(() => pending.delete(name));
            pending.set(name, p);
            return p;
        },
        ensureProject: () => Promise.all([...needed(WD.project)].map(S.ensure)),

        // Gestimmte Note: nächstliegende Zone, per playbackRate transponiert. brightness 0…1 öffnet den Klang mit der Anschlagstärke.
        playPitched(name, m, t, dur, dest, { release = .3, gain = 1, brightness, maxLen = 12, vel } = {}) {
            const set = sets[name];
            const root = nearest(set, Math.round(m));
            S.playZone(pick(name + root, set[root], vel), Math.pow(2, (m - root) / 12), t, dur, dest, { release, gain, brightness, maxLen });
        },

        playZone(z, rate, t, dur, dest, { release = .3, gain = 1, brightness, maxLen = 12 } = {}) {
            const ctx = dest.context;
            const s = ctx.createBufferSource();
            s.buffer = z.buf;
            s.playbackRate.value = rate;
            if (z.loopB) { s.loop = true; s.loopStart = z.loopA; s.loopEnd = z.loopB; }
            const g = ctx.createGain();
            const hold = Math.min(z.loopB ? 60 : maxLen, Math.max(.02, dur));
            const level = gain * z.norm;
            g.gain.setValueAtTime(level, t);
            g.gain.setValueAtTime(level, t + hold);
            g.gain.linearRampToValueAtTime(0, t + hold + release);
            if (brightness !== undefined) {
                const f = ctx.createBiquadFilter();
                f.type = 'lowpass'; f.frequency.value = 900 + brightness * brightness * 17000; f.Q.value = .3;
                s.connect(f); f.connect(g);
            } else s.connect(g);
            g.connect(dest);
            s.start(t, z.start || 0);
            s.stop(t + hold + release + .02);
        },

        // Drum-Schlag; die geschlossene Hi-Hat würgt eine klingende offene ab
        playDrum(setName, lane, t, out, chokeGroup, level = 1, vel) {
            const ctx = out.context, z = pick(setName + 'd' + lane, sets[setName][lane], vel);
            const s = ctx.createBufferSource();
            s.buffer = z.buf;
            const g = ctx.createGain();
            g.gain.value = level * z.norm * .75;
            s.connect(g); g.connect(out);
            s.start(t, z.start);
            if (lane === 3) openHats.set(chokeGroup, g);
            if (lane === 2) {
                const open = openHats.get(chokeGroup);
                if (open) { open.gain.setTargetAtTime(0, t, .012); openHats.delete(chokeGroup); }
            }
        },
    };

    // Sobald eine Spur einen gesampelten Klang bekommt, im Hintergrund nachladen
    const refresh = () => { if (ctxRef) S.ensureProject(); };
    WD.bus.on('tracks', refresh);
    WD.bus.on('project', refresh);
})();
