// Einstimmige Tonhöhenerkennung (Autokorrelation) → MIDI-Noten.
'use strict';
(() => {
/* ---- Pitch-Erkennung → MIDI ---- */
function pitchToMidi(tr, r) {
    const buf = WD.audioStore.get(r.bufId);
    if (!buf) return;
    const sr = buf.sampleRate, d = buf.getChannelData(0);
    const rate = r.rate || 1, spb = WD.model.secPerBar();
    const start = Math.floor((r.offset || 0) * sr);
    const end = Math.min(d.length, start + Math.floor(r.lengthBars * spb * rate * sr));
    const win = 1024, hop = 1024;
    const lagMin = Math.floor(sr / 600), lagMax = Math.floor(sr / 70);
    const steps = [];
    for (let i = start; i + win + lagMax < end; i += hop) {
        let rms = 0;
        for (let j = 0; j < win; j++) rms += d[i + j] * d[i + j];
        rms = Math.sqrt(rms / win);
        if (rms < .015) { steps.push(-1); continue; }
        let best = -1, bestV = 0, e0 = 0;
        for (let j = 0; j < win; j++) e0 += d[i + j] * d[i + j];
        for (let lag = lagMin; lag <= lagMax; lag++) {
            let s = 0;
            for (let j = 0; j < win; j++) s += d[i + j] * d[i + j + lag];
            if (s > bestV) { bestV = s; best = lag; }
        }
        if (best < 0 || bestV < e0 * .3) { steps.push(-1); continue; }
        steps.push(Math.round(69 + 12 * Math.log2((sr / best) / 440)));
    }
    /* Glätten: Einzel-Ausreißer entfernen */
    for (let i = 1; i < steps.length - 1; i++)
        if (steps[i] !== steps[i - 1] && steps[i] !== steps[i + 1] && steps[i - 1] === steps[i + 1])
            steps[i] = steps[i - 1];
    /* Gruppieren in Noten (min. 2 Fenster ≈ 45 ms) */
    const stepBars = (hop / sr) / rate / spb;
    const notes = [];
    let cur = -1, cnt = 0, at = 0;
    const flush = () => {
        if (cur > 20 && cur < 100 && cnt >= 2)
            notes.push({ t: Math.round(at * 32) / 32, n: cur, d: Math.max(1 / 16, Math.round(cnt * stepBars * 32) / 32) });
    };
    steps.forEach((s, i) => {
        if (s === cur) { cnt++; return; }
        flush(); cur = s; cnt = 1; at = i * stepBars;
    });
    flush();
    if (!notes.length) { WD.ui.alert('Keine Melodie erkannt', 'Tipp: einstimmig, sauber und nah am Mikrofon spielen.'); return; }
    WD.history.run('Noten erkennen', () => {
    const nt = WD.model.addTrack('inst', 'Erkannt: ' + (r.name || 'Take'), { inst: 'Clean Guitar' });
    nt.regions.push(WD.model.normalizeRegion({
        startBar: r.startBar, lengthBars: Math.max(1, Math.ceil(r.lengthBars)),
        loopLen: 0, notes, name: 'Pitch→MIDI',
    }));
});
WD.bus.emit('tracks');
WD.ui.toast(notes.length + ' Noten erkannt und auf einer neuen Spur abgelegt. Im Editor nachbessern.', { type: 'ok', ms: 5000 });
}

WD.pitchDetect = { toMidi: pitchToMidi };
})();
