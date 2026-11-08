// Offline-Rendering (Bounce und Stems) mit denselben Kanalzügen wie die Live-Wiedergabe.
'use strict';
(() => {
    const M = WD.model;

    function exportEnd(p) {
        let end = 0;
        p.tracks.forEach(t => t.regions.forEach(r => { end = Math.max(end, r.startBar + r.lengthBars); }));
        return end || 1;
    }

    // Kopie der Spur ohne alle Effekte; Lautstärke und Panorama bleiben
    function dryCopy(tr) {
        const c = JSON.parse(JSON.stringify(tr));
        Object.assign(c, { eqL: 0, eqM: 0, eqH: 0, fxRev: 0, fxDly: 0, fxCmp: 0, dbl: false, fxPump: 0, fxTune: 0 });
        c.fx = { gate: 0, drive: 0, driveType: 'overdrive', chorus: 0, crush: 0, hp: 0, lp: 0, limit: 0 };
        c.autos = c.autos && c.autos.pan ? { pan: c.autos.pan } : {};
        return c;
    }

    // Automation als dichte Stützstellen, damit auch nichtlineare Parameter (Filter) dem Verlauf folgen
    function scheduleAuto(strip, tr, key, a, b, spb, base) {
        const pts = M.autoList(tr, key);
        if (!pts.length) return false;
        const ap = strip.autoParam(key);
        if (!ap) return false;
        const at = bar => base * ap.map(WD.transport.autoValAt(tr, bar, key));
        ap.param.setValueAtTime(at(a), 0);
        const step = 1 / 32;
        for (let bar = a + step; bar <= b + 1e-6; bar += step) ap.param.linearRampToValueAtTime(at(bar), (bar - a) * spb);
        return true;
    }

    // Rendert die übergebenen Spuren zu einem AudioBuffer.
    // useMaster=false: neutral, ohne Master-Klang und Limiter. dry: ohne Effekte. range: {a, b} in Bar-Einheiten.
    async function render(tracks, { useMaster = true, tail = 2.5, dry = false, range = null } = {}) {
        await WD.engine.ensure();
        await WD.samples.ensureProject();
        const p = WD.project, spb = M.secPerBar();
        const sr = WD.engine.ctx.sampleRate;
        const a = range ? range.a : 0, b = range ? range.b : exportEnd(p);
        const total = (b - a) * spb + tail;
        const oc = new OfflineAudioContext(2, Math.ceil(total * sr), sr);
        await WD.worklets.load(oc);

        const masterCfg = useMaster ? p.master : { vol: 1, mode: 'clean' };
        const master = WD.engine.buildMaster(oc, masterCfg, oc.destination, p.bpm);
        if (!useMaster) { // Stems: ohne Limiter, sonst würden sie anders als im Mix klingen
            master.input.disconnect(); master.limiter.disconnect();
            master.input.connect(oc.destination);
        }

        // Ereignisse sammeln und erst kurz vor ihrer Zeit anlegen: Knoten, die noch warten, kosten sonst in jedem Rechenschritt.
        const events = [];
        for (const source of tracks) {
            if (!source.regions.length) continue;
            const tr = dry ? dryCopy(source) : source;
            const strip = WD.channel.createStrip(oc, tr, { output: master.input, reverb: master.reverb, delay: master.delay });
            strip.setMuted(false, true);
            if (!scheduleAuto(strip, tr, 'vol', a, b, spb, tr.vol)) strip.fader.gain.value = tr.vol;
            ['pan', 'rev', 'lp'].forEach(key => scheduleAuto(strip, tr, key, a, b, spb, 1));
            if ((tr.fxPump || 0) > 0 && tr.type !== 'drum') {
                const dur = M.pumpDur();
                M.kicks(a, b).forEach(bar => { const t = (bar - a) * spb; events.push({ t, fn: () => strip.pumpAt(t, tr.fxPump, dur) }); });
            }

            tr.regions.forEach(r => {
                if (tr.type === 'audio') {
                    M.audioPieces(r).forEach(pc => {
                        const end = pc.startBar + pc.lengthBars;
                        if (end <= a + 1e-6 || pc.startBar >= b - 1e-6) return;
                        const skip = Math.max(0, a - pc.startBar) * spb;
                        const t = Math.max(0, pc.startBar - a) * spb;
                        events.push({ t, fn: () => WD.channel.startRegionSource(oc, strip.input, pc, t, skip, pc.lengthBars * spb - skip) });
                    });
                    return;
                }
                const L = r.loopLen || r.lengthBars;
                r.notes.forEach(nt => {
                    for (let k = 0; ; k++) {
                        const abs = r.startBar + k * L + nt.t;
                        if (abs >= r.startBar + r.lengthBars) break;
                        if (abs < a - 1e-6 || abs >= b - 1e-6) continue;
                        const t = (abs - a) * spb;
                        events.push({ t, fn: () => WD.instruments.play(tr, nt.n, t, nt.d * spb, nt.v, strip.input) });
                    }
                });
            });
        }
        events.sort((x, y) => x.t - y.t);
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
