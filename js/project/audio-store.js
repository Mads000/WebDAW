// Audiodaten getrennt vom Projekt: id → AudioBuffer, plus Pegel-Vorschau (Peaks) für schnelles Zeichnen.
'use strict';
(() => {
    const buffers = new Map(), peaks = new Map();
    const BIN = 256;

    function computePeaks(buf) {
        const bins = Math.ceil(buf.length / BIN);
        const out = new Float32Array(bins * 2);
        const chans = [];
        for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
        for (let b = 0; b < bins; b++) {
            let mn = 1, mx = -1;
            const end = Math.min(buf.length, (b + 1) * BIN);
            for (const d of chans) {
                for (let i = b * BIN; i < end; i++) {
                    const v = d[i];
                    if (v < mn) mn = v;
                    if (v > mx) mx = v;
                }
            }
            out[b * 2] = mn; out[b * 2 + 1] = mx;
        }
        return out;
    }

    WD.audioStore = {
        BIN,
        get: id => buffers.get(id) || null,
        has: id => buffers.has(id),
        ids: () => [...buffers.keys()],
        peaks(id) {
            if (!buffers.has(id)) return null;
            if (!peaks.has(id)) peaks.set(id, computePeaks(buffers.get(id)));
            return peaks.get(id);
        },
        // Legt einen Puffer an und meldet ihn zur dauerhaften Speicherung an
        put(buffer, id) {
            const key = id || 'b' + WD.uid();
            buffers.set(key, buffer);
            WD.bus.emit('audio:added', key);
            return key;
        },
        // Lädt einen bereits gespeicherten Puffer in den Speicher
        adopt(id, buffer) { buffers.set(id, buffer); },
        clearMemory(keep) {
            const k = new Set(keep || []);
            [...buffers.keys()].forEach(id => { if (!k.has(id)) { buffers.delete(id); peaks.delete(id); } });
        },
        // Summe des belegten Arbeitsspeichers in Byte
        memoryBytes() {
            let n = 0;
            buffers.forEach(b => { n += b.length * b.numberOfChannels * 4; });
            return n;
        },
    };
})();
