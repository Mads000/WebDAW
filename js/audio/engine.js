// Audio-Engine: AudioContext, Master-Kette, Effekt-Busse und die Kanalzüge aller Spuren.
'use strict';
(() => {
    const { bus } = WD;
    let ctx = null, readyPromise = null, nodes = null;
    const strips = new Map(); // Spur-ID → Kanalzug

    // Reproduzierbare Rausch-Impulsantwort: Live und Bounce haben denselben Hall.
    function buildImpulse(c) {
        const len = Math.floor(c.sampleRate * 2.2), ir = c.createBuffer(2, len, c.sampleRate);
        let seed = 12345;
        const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
        for (let ch = 0; ch < 2; ch++) {
            const d = ir.getChannelData(ch);
            for (let i = 0; i < len; i++) d[i] = rnd() * Math.pow(1 - i / len, 2.8);
        }
        return ir;
    }

    const MODE = {
        clean: null,
        warm: { drive: 1.6, thr: -10, knee: 4, ratio: 12, atk: 0.003, rel: 0.25 },   // Klang der Original-DAW
        '90s': { drive: 3.2, thr: -24, knee: 1, ratio: 20, atk: 0.001, rel: 0.12 },  // Brickwall-Master
    };
    function satCurve(drive) {
        const sc = new Float32Array(2049);
        for (let i = 0; i < 2049; i++) { const x = i / 1024 - 1; sc[i] = Math.tanh(x * drive) / Math.tanh(drive); }
        return sc;
    }

    // Master-Kette: Lautstärke → (Warm/90s-Färbung) → Limiter → Ausgang. Auch vom Offline-Rendering genutzt.
    function buildMaster(c, master, destination) {
        const input = c.createGain();
        input.gain.value = master.vol;
        const reverb = c.createConvolver(); reverb.buffer = buildImpulse(c);
        const delay = c.createDelay(2);
        const fb = c.createGain(); fb.gain.value = 0.35;
        delay.connect(fb); fb.connect(delay);
        reverb.connect(input); delay.connect(input);

        const sat = c.createWaveShaper(); sat.oversample = '4x';
        const comp = c.createDynamicsCompressor();
        const limiter = new AudioWorkletNode(c, 'wd-limiter', { outputChannelCount: [2] });
        limiter.parameters.get('ceiling').value = -1;
        limiter.connect(destination);

        let current = null;
        function setMode(modeName) {
            if (modeName === current) return;
            current = modeName;
            const m = MODE[modeName];
            input.disconnect();
            try { sat.disconnect(); comp.disconnect(); } catch { /* war nicht verbunden */ }
            if (!m) { input.connect(limiter); return; }
            sat.curve = satCurve(m.drive);
            comp.threshold.value = m.thr; comp.knee.value = m.knee; comp.ratio.value = m.ratio;
            comp.attack.value = m.atk; comp.release.value = m.rel;
            input.connect(sat); sat.connect(comp); comp.connect(limiter);
        }
        setMode(master.mode || 'clean');
        return { input, reverb, delay, limiter, setMode };
    }

    function delaySeconds(bpm) { return Math.min(1.9, 60 / bpm * 0.75); } // punktierte Achtel

    async function init() {
        ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
        await WD.worklets.load(ctx);
        const output = ctx.createGain();
        const split = ctx.createChannelSplitter(2);
        const anaL = ctx.createAnalyser(), anaR = ctx.createAnalyser(), spec = ctx.createAnalyser();
        anaL.fftSize = anaR.fftSize = 2048; spec.fftSize = 512;
        output.connect(split); split.connect(anaL, 0); split.connect(anaR, 1);
        output.connect(spec); output.connect(ctx.destination);
        const master = buildMaster(ctx, WD.project.master, output);
        const monitor = ctx.createGain(); monitor.gain.value = 0.9; monitor.connect(ctx.destination);
        nodes = { master, monitor, anaL, anaR, spec };
        master.delay.delayTime.value = delaySeconds(WD.project.bpm);
        WD.engine.sync();
        return ctx;
    }

    const anySolo = () => WD.project.tracks.some(t => t.solo);
    const isAudible = t => anySolo() ? !!t.solo : !t.mute;

    WD.engine = {
        // Darf ohne await aufgerufen werden; muss einmal aus einer Benutzer-Geste heraus laufen.
        ensure() {
            if (!readyPromise) readyPromise = init();
            if (ctx && ctx.state === 'suspended') ctx.resume();
            return readyPromise;
        },
        get ctx() { return ctx; },
        get nodes() { return nodes; },
        get ready() { return !!nodes; },
        isAudible,
        buildMaster, delaySeconds,

        strip(track) {
            if (!nodes) return null;
            let s = strips.get(track.id);
            if (!s) {
                s = WD.channel.createStrip(ctx, track, {
                    output: nodes.master.input, reverb: nodes.master.reverb, delay: nodes.master.delay,
                });
                s.meter = ctx.createAnalyser(); s.meter.fftSize = 512;
                s.pan.connect(s.meter);
                s.fader.gain.value = track.vol;
                s.setMuted(!isAudible(track), true);
                strips.set(track.id, s);
            }
            return s;
        },

        // Gleicht die Kanalzüge mit dem Projekt ab. Entfernte Spuren werden wirklich abgebaut (kein Knoten-Leck).
        sync() {
            if (!nodes) return;
            const p = WD.project;
            const ids = new Set(p.tracks.map(t => t.id));
            strips.forEach((s, id) => {
                if (!ids.has(id)) { s.destroy(); if (s.meter) s.meter.disconnect(); strips.delete(id); }
            });
            p.tracks.forEach(t => {
                const s = WD.engine.strip(t);
                s.update(t);
                s.setMuted(!isAudible(t));
                if (!t.auto || !t.auto.length) s.fader.gain.setTargetAtTime(t.vol, ctx.currentTime, 0.01);
            });
            nodes.master.setMode(p.master.mode);
            nodes.master.input.gain.setTargetAtTime(p.master.vol, ctx.currentTime, 0.01);
            nodes.master.delay.delayTime.setTargetAtTime(delaySeconds(p.bpm), ctx.currentTime, 0.02);
        },
        setMasterMode(mode) {
            WD.project.master.mode = mode;
            if (nodes) nodes.master.setMode(mode);
        },
        stripCount: () => strips.size,
        // Gesamtlatenz vom Planen bis zum Lautsprecher
        outputLatency() {
            if (!ctx) return 0;
            return (ctx.outputLatency || 0) + (ctx.baseLatency || 0) + WD.worklets.LOOKAHEAD_SEC;
        },
    };

    bus.on('tracks', () => WD.engine.sync());
    bus.on('project', () => WD.engine.sync());
    bus.on('tempo', () => WD.engine.sync());
    bus.on('mix', () => WD.engine.sync());
})();
