// Misst den tatsächlichen Versatz Ausgang → Eingang: Klicks abspielen, im Eingang wiederfinden.
// Dafür muss das Mikrofon die Lautsprecher hören oder Ausgang und Eingang des Interfaces sind per Kabel verbunden.
'use strict';
(() => {
    const CLICKS = 6, SPACING = 0.5;

    // Sucht je Klick den ersten deutlichen Anstieg im Fenster danach. Reine Funktion, damit sie testbar ist.
    // Rückgabe: Latenz in Sekunden oder null, wenn die Klicks nicht zuverlässig erkannt wurden.
    function analyze(samples, sr, clickSamples, spacingSamples) {
        const lat = [];
        const noiseWin = Math.floor(sr * 0.02);
        for (const start of clickSamples) {
            const end = Math.min(samples.length, start + spacingSamples);
            let peak = 0;
            for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(samples[i]));
            let floor = 0;
            for (let i = Math.max(0, start - noiseWin); i < start; i++) floor = Math.max(floor, Math.abs(samples[i]));
            if (peak < 0.005 || peak < floor * 4) continue;
            for (let i = start; i < end; i++) {
                if (Math.abs(samples[i]) >= peak * 0.5) { lat.push((i - start) / sr); break; }
            }
        }
        if (lat.length < Math.ceil(clickSamples.length * 2 / 3)) return null;
        lat.sort((a, b) => a - b);
        const median = lat[Math.floor(lat.length / 2)];
        // Streuung über 3 ms: eher Raumgeräusche oder Echos als ein verlässlicher Wert
        const close = lat.filter(v => Math.abs(v - median) <= 0.003);
        if (close.length < Math.ceil(lat.length * 2 / 3)) return null;
        return close.reduce((a, b) => a + b, 0) / close.length;
    }

    async function run() {
        await WD.engine.ensure();
        const wasOpen = WD.input.active;
        await WD.input.open();
        const ctx = WD.engine.ctx;
        const node = new AudioWorkletNode(ctx, 'wd-recorder', { numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1] });
        const silent = ctx.createGain(); silent.gain.value = 0;
        WD.input.node.connect(node); node.connect(silent); silent.connect(ctx.destination);
        const chunks = [];
        node.port.onmessage = e => { if (!e.data.done) chunks.push(e.data); };

        const t0 = ctx.currentTime + 0.3;
        const clickTimes = [];
        for (let i = 0; i < CLICKS; i++) {
            const t = t0 + i * SPACING;
            clickTimes.push(t);
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.frequency.value = 2000;
            g.gain.setValueAtTime(0.8, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
            o.connect(g); g.connect(WD.engine.nodes.monitor);
            o.start(t); o.stop(t + 0.02);
        }
        await new Promise(res => setTimeout(res, (CLICKS * SPACING + 0.5) * 1000));
        node.port.postMessage('stop');
        await new Promise(res => setTimeout(res, 100));
        try { WD.input.node.disconnect(node); } catch { /* */ }
        node.disconnect(); silent.disconnect();
        if (!wasOpen && !WD.input.needed()) WD.input.close();
        if (!chunks.length) return null;

        const sr = ctx.sampleRate, first = chunks[0].frame;
        const last = chunks[chunks.length - 1];
        const all = new Float32Array(last.frame + last.channels[0].length - first);
        chunks.forEach(c => all.set(c.channels[0], c.frame - first));
        return analyze(all, sr, clickTimes.map(t => Math.round(t * sr) - first), Math.floor(SPACING * sr));
    }

    WD.latencyTest = {
        analyze, run,
        // Übernimmt die Messung so, dass der gesamte Ausgleich dem gemessenen Wert entspricht
        apply(measuredSec) {
            const s = WD.input.settings;
            const auto = WD.input.roundTripSec() - s.latencyOffsetMs / 1000;
            s.latencyOffsetMs = Math.round((measuredSec - auto) * 1000);
            WD.input.saveSettings();
        },
    };
})();
