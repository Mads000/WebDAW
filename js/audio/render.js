// Offline-Rendering (Bounce und Stems) mit denselben Kanalzügen wie die Live-Wiedergabe.
'use strict';
(() => {
    const M = WD.model;

    function exportEnd(p) {
        let end = 0;
        p.tracks.forEach(t => t.regions.forEach(r => { end = Math.max(end, r.startBar + r.lengthBars); }));
        return end || 1;
    }

    // Rendert die übergebenen Spuren zu einem AudioBuffer. useMaster=false liefert neutrale Stems.
    async function render(tracks, { useMaster = true, tail = 2.5 } = {}) {
        await WD.engine.ensure();
        const p = WD.project, spb = M.secPerBar();
        const sr = WD.engine.ctx.sampleRate;
        const total = exportEnd(p) * spb + tail;
        const oc = new OfflineAudioContext(2, Math.ceil(total * sr), sr);
        await WD.worklets.load(oc);

        const masterCfg = useMaster ? p.master : { vol: 1, mode: 'clean' };
        const master = WD.engine.buildMaster(oc, masterCfg, oc.destination);
        master.delay.delayTime.value = WD.engine.delaySeconds(p.bpm);
        if (!useMaster) { // Stems: ohne Limiter, sonst würden sie anders als im Mix klingen
            master.input.disconnect(); master.limiter.disconnect();
            master.input.connect(oc.destination);
        }

        // Ereignisse sammeln und erst kurz vor ihrer Zeit anlegen: Knoten, die noch warten, kosten sonst in jedem Rechenschritt.
        const events = [];
        for (const tr of tracks) {
            if (!tr.regions.length) continue;
            const strip = WD.channel.createStrip(oc, tr, { output: master.input, reverb: master.reverb, delay: master.delay });
            strip.setMuted(false, true);
            if (tr.auto && tr.auto.length) {
                const s = tr.auto.slice().sort((a, b) => a.bar - b.bar);
                strip.fader.gain.setValueAtTime(tr.vol * s[0].val, 0);
                s.forEach(pt => strip.fader.gain.linearRampToValueAtTime(tr.vol * pt.val, Math.max(0, pt.bar * spb)));
            } else strip.fader.gain.value = tr.vol;

            tr.regions.forEach(r => {
                if (tr.type === 'audio') {
                    WD.model.audioPieces(r).forEach(pc => {
                        const t = pc.startBar * spb;
                        events.push({ t, fn: () => WD.channel.startRegionSource(oc, strip.input, pc, t, 0, pc.lengthBars * spb) });
                    });
                    return;
                }
                const L = r.loopLen || r.lengthBars;
                r.notes.forEach(nt => {
                    for (let k = 0; ; k++) {
                        const abs = r.startBar + k * L + nt.t;
                        if (abs >= r.startBar + r.lengthBars) break;
                        const t = abs * spb;
                        events.push({ t, fn: () => WD.instruments.play(tr, nt.n, t, nt.d * spb, nt.v, strip.input) });
                    }
                });
            });
        }
        events.sort((a, b) => a.t - b.t);
        let next = 0;
        const planUntil = end => { while (next < events.length && events[next].t < end) events[next++].fn(); };
        const WINDOW = 2;
        if (typeof oc.suspend === 'function') {
            planUntil(WINDOW);
            for (let k = 1; k * WINDOW < total - 0.1; k++) {
                const at = k * WINDOW;
                oc.suspend(at - 0.02).then(() => { planUntil(at + WINDOW); oc.resume(); });
            }
        } else planUntil(Infinity);
        return oc.startRendering();
    }

    WD.render = { render, exportEnd };
})();
