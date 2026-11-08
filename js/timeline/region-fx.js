// Kreative Werkzeuge für Audio-Regionen: als spielbaren Sampler verwenden, rückwärts, Tonhöhe, Tempo.
// Alle Bearbeitungen erzeugen einen neuen Puffer oder ändern nur die Region; das Original bleibt erhalten, Rückgängig funktioniert.
'use strict';
(() => {
    const { bus } = WD;
    const M = WD.model;

    // Ausschnitt der Quelle, den die Region spielt (eine Loop-Runde)
    function sourceWindow(r) {
        const buf = WD.audioStore.get(r.bufId);
        if (!buf) return null;
        const sr = buf.sampleRate, spb = M.secPerBar(), rate = r.rate || 1;
        const start = Math.max(0, Math.floor((r.offset || 0) * sr));
        const bars = r.loopLen || r.lengthBars;
        const frames = Math.min(buf.length - start, Math.ceil(bars * spb * rate * sr));
        return { buf, start, frames, sr };
    }
    const canEdit = r => !!r.bufId && !(r.comp && r.comp.length);

    function newBuffer(w, frames, fill) {
        const out = new AudioBuffer({ length: Math.max(1, frames), numberOfChannels: w.buf.numberOfChannels, sampleRate: w.sr });
        for (let c = 0; c < out.numberOfChannels; c++) fill(w.buf.getChannelData(c), out.getChannelData(c));
        return out;
    }

    function replaceWith(r, label, make) {
        const w = sourceWindow(r);
        if (!w || !w.frames) { WD.ui.toast('Für diese Region sind keine Audiodaten geladen.', { type: 'error' }); return; }
        const id = WD.audioStore.put(make(w));
        WD.history.run(label, () => { r.bufId = id; r.offset = 0; r.takes = null; r.comp = null; r.takeIdx = 0; });
        bus.emit('regions'); bus.emit('audio:edited'); bus.emit('editor:refresh');
    }

    const reverse = r => replaceWith(r, 'Rückwärts', w => newBuffer(w, w.frames, (src, dst) => {
        for (let i = 0; i < w.frames; i++) dst[i] = src[w.start + w.frames - 1 - i];
    }));

    // Tonhöhe ändern, Länge behalten: Hann-Körner überlappend neu ansetzen
    function pitchShifted(w, semis) {
        const ratio = Math.pow(2, semis / 12), G = Math.floor(w.sr * .05), hop = G >> 1;
        return newBuffer(w, w.frames, (src, dst) => {
            const norm = new Float32Array(w.frames);
            for (let o = 0; o < w.frames; o += hop) {
                for (let i = 0; i < G && o + i < w.frames; i++) {
                    const p = w.start + o + (i - G / 2) * ratio + G / 2;
                    const a = Math.floor(p);
                    if (a < w.start || a + 1 >= w.start + w.frames) continue;
                    const f = p - a, win = Math.sin(Math.PI * i / G) ** 2;
                    dst[o + i] += (src[a] * (1 - f) + src[a + 1] * f) * win;
                    norm[o + i] += win;
                }
            }
            for (let i = 0; i < w.frames; i++) if (norm[i] > .01) dst[i] /= norm[i];
        });
    }
    const shift = (r, semis) => replaceWith(r, semis > 0 ? 'Oktave höher' : 'Oktave tiefer', w => pitchShifted(w, semis));

    // Wie ein Tonband: Tempo und Tonhöhe ändern sich gemeinsam
    function tape(r, factor) {
        WD.history.run(factor < 1 ? 'Halbes Tempo' : 'Doppeltes Tempo', () => {
            r.rate = (r.rate || 1) * factor;
            r.lengthBars /= factor;
            if (r.loopLen) r.loopLen /= factor;
        });
        bus.emit('regions'); bus.emit('audio:edited'); bus.emit('editor:refresh');
    }

    function menuItems(region) {
        if (!canEdit(region)) return [];
        return [
            { sep: 1 },
            { label: 'Rückwärts abspielen', action: () => reverse(region) },
            { label: 'Eine Oktave höher (+12)', action: () => shift(region, 12) },
            { label: 'Eine Oktave tiefer (−12)', action: () => shift(region, -12) },
            { label: 'Halbes Tempo (wie Tonband)', action: () => tape(region, .5) },
            { label: 'Doppeltes Tempo (wie Tonband)', action: () => tape(region, 2) },
            { sep: 1 },
            { label: 'Auf der Tastatur spielen (Sampler)', icon: 'keys', action: () => WD.sampler.fromRegion(region) },
        ];
    }

    // Grundton schätzen; ohne klaren Ton gilt C4
    function detectRoot(w) {
        const d = w.buf.getChannelData(0), N = Math.min(8192, w.frames);
        let best = w.start, peak = 0;
        for (let i = w.start; i + N < w.start + w.frames; i += 2048) {
            let e = 0;
            for (let j = 0; j < N; j += 16) e += d[i + j] * d[i + j];
            if (e > peak) { peak = e; best = i; }
        }
        const lo = Math.floor(w.sr / 1200), hi = Math.floor(w.sr / 70), n = N - hi;
        if (n < 512) return 60;
        let lag = 0, top = 0, e0 = 0;
        for (let j = 0; j < n; j++) e0 += d[best + j] * d[best + j];
        for (let l = lo; l <= hi; l++) {
            let s = 0;
            for (let j = 0; j < n; j += 2) s += d[best + j] * d[best + j + l];
            if (s > top) { top = s; lag = l; }
        }
        if (!lag || top * 2 < e0 * .55) return 60;
        return Math.max(24, Math.min(96, Math.round(69 + 12 * Math.log2(w.sr / lag / 440))));
    }

    WD.sampler = {
        NAME: 'Own Sampler',
        fromRegion(region) {
            const w = sourceWindow(region);
            if (!w) { WD.ui.toast('Für diese Region sind keine Audiodaten geladen.', { type: 'error' }); return null; }
            const root = detectRoot(w);
            const t = WD.history.run('Sampler anlegen', () => M.addTrack('inst', 'Sampler: ' + (region.name || 'Aufnahme'), {
                inst: WD.sampler.NAME, customName: true,
                sampler: { bufId: region.bufId, start: w.start / w.sr, end: (w.start + w.frames) / w.sr, root },
            }));
            WD.view.selTrackId = t.id;
            bus.emit('tracks'); bus.emit('track:selected');
            WD.ui.toast('Sampler angelegt: Spiele ihn mit der Tastatur oder im Editor. Ohne Transponierung klingt die Note ' + root + '.', { type: 'ok', ms: 6000 });
            return t;
        },
        // Spielt die Note, sonst false (Puffer fehlt oder Spur hat einen anderen Klang gewählt)
        play(track, n, t, dur, dest) {
            const s = track.sampler;
            const buf = s && track.inst === WD.sampler.NAME && WD.audioStore.get(s.bufId);
            if (!buf) return false;
            let z = zones.get(buf);
            if (!z || z.start !== s.start) {
                let p = 0;
                const d = buf.getChannelData(0), a = Math.floor(s.start * buf.sampleRate), b = Math.floor(s.end * buf.sampleRate);
                for (let i = a; i < b; i++) if (Math.abs(d[i]) > p) p = Math.abs(d[i]);
                z = { buf, start: s.start, norm: p > 0 ? .8 / p : 1 };
                zones.set(buf, z);
            }
            const rate = Math.pow(2, (n - s.root) / 12);
            const len = (s.end - s.start) / rate;
            WD.samples.playZone(z, rate, t, Math.min(dur, Math.max(.02, len - .02)), dest, { release: Math.min(.06, len / 4), maxLen: len });
            return true;
        },
    };
    const zones = new WeakMap();

    WD.regionFx = { reverse, shift, tape, menuItems, canEdit };
})();
