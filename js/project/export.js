// Export: Mix und Stems als WAV.
'use strict';
(() => {
    const safeName = s => (s || 'Projekt').replace(/[^\wäöüÄÖÜß\- ]+/g, '').trim().replace(/\s+/g, '_') || 'Projekt';

    function download(blob, name) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    }

    // PCM-WAV; 16 Bit mit TPDF-Dither, damit leise Ausklänge nicht körnig werden
    function bufToWav(buf, bits = 16) {
        const nCh = buf.numberOfChannels, len = buf.length, sr = buf.sampleRate;
        const bytesPer = bits / 8;
        const dataLen = len * nCh * bytesPer;
        const ab = new ArrayBuffer(44 + dataLen), dv = new DataView(ab);
        const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
        ws(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); ws(8, 'WAVE'); ws(12, 'fmt ');
        dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, nCh, true);
        dv.setUint32(24, sr, true); dv.setUint32(28, sr * nCh * bytesPer, true);
        dv.setUint16(32, nCh * bytesPer, true); dv.setUint16(34, bits, true);
        ws(36, 'data'); dv.setUint32(40, dataLen, true);
        const chs = [];
        for (let c = 0; c < nCh; c++) chs.push(buf.getChannelData(c));
        let o = 44;
        for (let i = 0; i < len; i++) {
            for (let c = 0; c < nCh; c++) {
                const v = chs[c][i];
                if (bits === 24) {
                    const s = Math.round(Math.max(-1, Math.min(1, v)) * 8388607);
                    dv.setUint8(o, s & 255); dv.setUint8(o + 1, (s >> 8) & 255); dv.setUint8(o + 2, (s >> 16) & 255);
                    o += 3;
                } else {
                    const dither = (Math.random() - Math.random()) / 32768;
                    const s = Math.max(-1, Math.min(1, v + dither));
                    dv.setInt16(o, s < 0 ? s * 32768 : s * 32767, true);
                    o += 2;
                }
            }
        }
        return new Blob([ab], { type: 'audio/wav' });
    }

    let busyFlag = false;
    const X = WD.exporter = {
        safeName, download, bufToWav,
        get busy() { return busyFlag; },

        // Rendert den gesamten Mix mit Mute/Solo wie gehört
        async bounce(bits = 16) {
            if (busyFlag) return null;
            const p = WD.project;
            const list = p.tracks.filter(t => WD.engine.isAudible(t) && t.regions.length);
            if (!list.length) { WD.ui.alert('Nichts zu exportieren', 'Es gibt keine hörbaren Spuren mit Inhalt.'); return null; }
            WD.transport.halt();
            busyFlag = true;
            const stop = WD.ui.busy('Mix wird berechnet …');
            const t0 = performance.now();
            try {
                const buf = await WD.render.render(list, { useMaster: true });
                const name = safeName(p.name) + '.wav';
                download(bufToWav(buf, bits), name);
                WD.ui.toast(`Exportiert: ${name} (${(performance.now() - t0) / 1000 < 10 ? ((performance.now() - t0) / 1000).toFixed(1) : Math.round((performance.now() - t0) / 1000)} s Rechenzeit)`, { type: 'ok' });
                return buf;
            } catch (err) {
                console.error(err);
                WD.ui.alert('Export fehlgeschlagen', err.message);
                return null;
            } finally { busyFlag = false; stop(); }
        },
        async stems(bits = 24) {
            if (busyFlag) return;
            const p = WD.project;
            const list = p.tracks.filter(t => t.regions.length);
            if (!list.length) { WD.ui.alert('Nichts zu exportieren', 'Keine Spur enthält Regionen.'); return; }
            WD.transport.halt();
            busyFlag = true;
            const stop = WD.ui.busy(`Stems: 0 von ${list.length} …`);
            try {
                for (let i = 0; i < list.length; i++) {
                    const buf = await WD.render.render([list[i]], { useMaster: false });
                    download(bufToWav(buf, bits), `${i + 1}_${safeName(list[i].name)}.wav`);
                    await new Promise(res => setTimeout(res, 400));
                }
                WD.ui.toast(`${list.length} Stems exportiert.`, { type: 'ok' });
            } catch (err) {
                console.error(err);
                WD.ui.alert('Stem-Export fehlgeschlagen', err.message);
            } finally { busyFlag = false; stop(); }
        },
        dialog() {
            WD.ui.modal((box, close) => {
                const bits = WD.el('select', {}, new Option('16 Bit (CD, Streaming)', 16), new Option('24 Bit (Weiterbearbeitung)', 24));
                box.append(
                    WD.el('h2', {}, 'Als WAV exportieren'),
                    WD.el('p', {}, `„${WD.project.name}“ · Master: ${{ clean: 'Neutral', warm: 'Warm', '90s': '90s' }[WD.project.master.mode]}. Der Limiter hält den Pegel unter -1 dB.`),
                    WD.el('div', { class: 'form-row' }, WD.el('label', {}, 'Format'), bits),
                    WD.el('div', { class: 'modal-btns' },
                        WD.el('button', { onclick: close }, 'Abbrechen'),
                        WD.el('button', { onclick: () => { close(); X.stems(+bits.value); } }, 'Stems einzeln'),
                        WD.el('button', { class: 'primary', onclick: () => { close(); X.bounce(+bits.value); } }, 'Mix exportieren')));
            }, { onEscape: () => { } });
        },
    };
})();
