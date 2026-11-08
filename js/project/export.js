// Export: Mix, einzelne Spur und Stems als WAV oder MP3; mehrere Dateien als eine ZIP-Datei.
'use strict';
(() => {
    const { el } = WD;
    const M = WD.model;
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

    // MP3 mit lamejs. Läuft in Abschnitten, damit die Oberfläche nicht einfriert.
    async function bufToMp3(buf, kbps = 192) {
        let src = buf;
        if (![32000, 44100, 48000].includes(src.sampleRate)) {
            const oc = new OfflineAudioContext(2, Math.ceil(buf.duration * 48000), 48000);
            const s = oc.createBufferSource(); s.buffer = buf; s.connect(oc.destination); s.start();
            src = await oc.startRendering();
        }
        const toI16 = d => {
            const o = new Int16Array(d.length);
            for (let i = 0; i < d.length; i++) { const v = Math.max(-1, Math.min(1, d[i])); o[i] = v < 0 ? v * 32768 : v * 32767; }
            return o;
        };
        const L = toI16(src.getChannelData(0)), R = toI16(src.getChannelData(src.numberOfChannels > 1 ? 1 : 0));
        const enc = new lamejs.Mp3Encoder(2, src.sampleRate, kbps), parts = [], BLOCK = 1152;
        for (let i = 0; i < L.length; i += BLOCK) {
            const m = enc.encodeBuffer(L.subarray(i, i + BLOCK), R.subarray(i, i + BLOCK));
            if (m.length) parts.push(new Uint8Array(m));
            if (i % (BLOCK * 400) === 0) await new Promise(res => setTimeout(res));
        }
        const end = enc.flush();
        if (end.length) parts.push(new Uint8Array(end));
        return new Blob(parts, { type: 'audio/mpeg' });
    }

    // Format-Wert aus den Dialogen: "wav16", "wav24", "mp3192", "mp3320"
    const encode = (buf, format) => (format.startsWith('mp3') ? bufToMp3(buf, +format.slice(3)) : Promise.resolve(bufToWav(buf, +format.slice(3))));
    const extOf = format => (format.startsWith('mp3') ? '.mp3' : '.wav');

    // ZIP ohne Kompression: WAV und MP3 werden dadurch ohnehin kaum kleiner
    const crcTable = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
        return t;
    })();
    const crc32 = u8 => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
    async function makeZip(files) {
        const enc = new TextEncoder(), parts = [], central = [];
        let offset = 0;
        for (const f of files) {
            const data = new Uint8Array(await f.blob.arrayBuffer()), name = enc.encode(f.name), crc = crc32(data);
            const head = new DataView(new ArrayBuffer(30));
            head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true);
            head.setUint32(14, crc, true); head.setUint32(18, data.length, true); head.setUint32(22, data.length, true); head.setUint16(26, name.length, true);
            parts.push(head.buffer, name, data);
            const dir = new DataView(new ArrayBuffer(46));
            dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, 20, true); dir.setUint16(6, 20, true); dir.setUint16(8, 0x0800, true);
            dir.setUint32(16, crc, true); dir.setUint32(20, data.length, true); dir.setUint32(24, data.length, true); dir.setUint16(28, name.length, true); dir.setUint32(42, offset, true);
            central.push(dir.buffer, name);
            offset += 30 + name.length + data.length;
            if (offset > 0xFFFFFFF0) throw new Error('Die ZIP-Datei würde größer als 4 GB. Exportiere weniger Spuren auf einmal.');
        }
        const dirSize = central.reduce((s, x) => s + x.byteLength, 0);
        const tail = new DataView(new ArrayBuffer(22));
        tail.setUint32(0, 0x06054b50, true); tail.setUint16(8, files.length, true); tail.setUint16(10, files.length, true);
        tail.setUint32(12, dirSize, true); tail.setUint32(16, offset, true);
        return new Blob([...parts, ...central, tail.buffer], { type: 'application/zip' });
    }

    function rangeOf(useCycle) {
        if (!useCycle) return { range: null, suffix: '' };
        const c = WD.project.cycle;
        return { range: { a: c.a, b: c.b }, tail: 0, suffix: '_Cycle' };
    }

    let busyFlag = false;
    async function guarded(what, fn) {
        if (busyFlag) return null;
        WD.transport.halt();
        busyFlag = true;
        const stop = WD.ui.busy(what);
        try { return await fn(stop); }
        catch (err) { console.error(err); WD.ui.alert('Export fehlgeschlagen', err.message); return null; }
        finally { busyFlag = false; stop(); }
    }

    const X = WD.exporter = {
        safeName, download, bufToWav, bufToMp3, makeZip,
        get busy() { return busyFlag; },

        // Rendert den gesamten Mix mit Mute/Solo wie gehört. format: Zahl (Bit, alte Aufrufe) oder "wav16" usw.
        async bounce(format = 'wav16') {
            if (typeof format === 'number') format = 'wav' + format;
            const p = WD.project;
            const list = p.tracks.filter(t => WD.engine.isAudible(t) && t.regions.length);
            if (!list.length) { WD.ui.alert('Nichts zu exportieren', 'Es gibt keine hörbaren Spuren mit Inhalt.'); return null; }
            return guarded('Mix wird berechnet …', async () => {
                const t0 = performance.now();
                const buf = await WD.render.render(list, { useMaster: true });
                const name = safeName(p.name) + extOf(format);
                download(await encode(buf, format), name);
                const sec = (performance.now() - t0) / 1000;
                WD.ui.toast(`Exportiert: ${name} (${sec < 10 ? sec.toFixed(1) : Math.round(sec)} s Rechenzeit)`, { type: 'ok' });
                return buf;
            });
        },

        // Eine Spur. opts: {format, dry, master, cycle}
        async track(t, opts) {
            if (!t.regions.length) { WD.ui.alert('Nichts zu exportieren', `Die Spur „${t.name}“ enthält keine Regionen.`); return null; }
            return guarded(`„${t.name}“ wird berechnet …`, async () => {
                const { range, tail, suffix } = rangeOf(opts.cycle);
                const buf = await WD.render.render([t], { useMaster: !!opts.master, dry: !!opts.dry, range, tail: tail === undefined ? 2.5 : tail });
                const name = `${safeName(WD.project.name)}_${safeName(t.name)}${suffix}${extOf(opts.format)}`;
                download(await encode(buf, opts.format), name);
                WD.ui.toast('Exportiert: ' + name, { type: 'ok' });
                return buf;
            });
        },

        // Mehrere Spuren als eine ZIP-Datei. tracks: Liste der Spuren
        async stems(tracks, opts = {}) {
            const list = (Array.isArray(tracks) ? tracks : WD.project.tracks).filter(t => t.regions.length);
            const o = Object.assign({ format: typeof tracks === 'number' ? 'wav' + tracks : 'wav24', dry: false, master: false, cycle: false }, opts);
            if (!list.length) { WD.ui.alert('Nichts zu exportieren', 'Keine der gewählten Spuren enthält Regionen.'); return null; }
            return guarded(`Stems werden berechnet (${list.length}) …`, async () => {
                const { range, tail, suffix } = rangeOf(o.cycle);
                const files = [], used = new Set();
                for (let i = 0; i < list.length; i++) {
                    const buf = await WD.render.render([list[i]], { useMaster: !!o.master, dry: !!o.dry, range, tail: tail === undefined ? 2.5 : tail });
                    let name = `${String(i + 1).padStart(2, '0')}_${safeName(list[i].name)}${extOf(o.format)}`;
                    while (used.has(name)) name = '_' + name;
                    used.add(name);
                    files.push({ name, blob: await encode(buf, o.format) });
                }
                const zipName = `${safeName(WD.project.name)}_Stems${suffix}.zip`;
                download(await makeZip(files), zipName);
                WD.ui.toast(`${list.length} Stems exportiert: ${zipName}`, { type: 'ok' });
                return files;
            });
        },

        dialog() {
            WD.ui.modal((box, close) => {
                const fmt = formatSelect('wav16');
                box.append(
                    el('h2', {}, 'Mix exportieren'),
                    el('p', {}, `„${WD.project.name}“ · Master: ${{ clean: 'Neutral', warm: 'Warm', '90s': '90s' }[WD.project.master.mode]}. Der Limiter hält den Pegel unter -1 dB.`),
                    el('div', { class: 'form-row' }, el('label', {}, 'Format'), fmt),
                    el('div', { class: 'modal-btns' },
                        el('button', { class: 'left', onclick: () => { close(); X.stemsDialog(); } }, 'Stems …'),
                        el('button', { onclick: close }, 'Abbrechen'),
                        el('button', { class: 'primary', onclick: () => { close(); X.bounce(fmt.value); } }, 'Mix exportieren')));
            }, { onEscape: () => { } });
        },

        trackDialog(t) {
            WD.ui.modal((box, close) => {
                const o = optionFields('wav24');
                box.append(el('h2', {}, `Spur „${t.name}“ exportieren`), ...o.nodes,
                    el('div', { class: 'modal-btns' },
                        el('button', { onclick: close }, 'Abbrechen'),
                        el('button', { class: 'primary', onclick: () => { close(); X.track(t, o.read()); } }, 'Exportieren')));
            }, { onEscape: () => { } });
        },

        stemsDialog() {
            const candidates = WD.project.tracks.filter(t => t.regions.length);
            if (!candidates.length) { WD.ui.alert('Nichts zu exportieren', 'Keine Spur enthält Regionen.'); return; }
            WD.ui.modal((box, close) => {
                const o = optionFields('wav24');
                const checks = candidates.map(t => ({ t, input: el('input', { type: 'checkbox', checked: true, 'aria-label': t.name }) }));
                const list = el('div', { class: 'list-table check-list' },
                    checks.map(({ t, input }) => el('label', { class: 'list-row' }, input, el('span', { class: 'name' }, t.name))));
                const all = on => checks.forEach(c => { c.input.checked = on; });
                box.append(el('h2', {}, 'Stems exportieren'),
                    el('p', {}, 'Jede gewählte Spur wird einzeln berechnet; alles kommt als eine ZIP-Datei.'),
                    list,
                    el('div', { class: 'form-row' }, el('button', { onclick: () => all(true) }, 'Alle'), el('button', { onclick: () => all(false) }, 'Keine')),
                    ...o.nodes,
                    el('div', { class: 'modal-btns' },
                        el('button', { onclick: close }, 'Abbrechen'),
                        el('button', {
                            class: 'primary', onclick: () => {
                                const sel = checks.filter(c => c.input.checked).map(c => c.t);
                                if (!sel.length) { WD.ui.toast('Wähle mindestens eine Spur aus.'); return; }
                                close(); X.stems(sel, o.read());
                            },
                        }, 'ZIP exportieren')));
            }, { wide: true, onEscape: () => { } });
        },
    };

    function formatSelect(value) {
        const s = el('select', { 'aria-label': 'Format' },
            new Option('WAV 16 Bit (CD, Streaming)', 'wav16'), new Option('WAV 24 Bit (Weiterbearbeitung)', 'wav24'),
            new Option('MP3 192 kbps', 'mp3192'), new Option('MP3 320 kbps', 'mp3320'));
        s.value = value;
        return s;
    }

    // Gemeinsame Einstellungen von Spur- und Stem-Export
    function optionFields(format) {
        const fmt = formatSelect(format);
        const fx = el('select', { 'aria-label': 'Effekte' }, new Option('Mit allen Spur-Effekten', 'wet'), new Option('Trocken (ohne Effekte)', 'dry'));
        const master = el('input', { type: 'checkbox', 'aria-label': 'Master-Klang und Limiter' });
        const area = el('select', { 'aria-label': 'Bereich' }, new Option('Ganzer Song', 'song'), new Option(cycleLabel(), 'cycle'));
        return {
            nodes: [
                el('div', { class: 'form-row' }, el('label', {}, 'Format'), fmt),
                el('div', { class: 'form-row' }, el('label', {}, 'Effekte'), fx),
                el('div', { class: 'form-row' }, el('label', {}, 'Bereich'), area),
                el('label', { class: 'form-row' }, el('span', { style: { flex: '0 0 150px', color: 'var(--text-2)' } }, 'Master-Klang und Limiter'), master),
            ],
            read: () => ({ format: fmt.value, dry: fx.value === 'dry', master: master.checked, cycle: area.value === 'cycle' }),
        };
    }
    function cycleLabel() {
        const c = WD.project.cycle, bar = v => M.barLen() ? Math.round(v / M.barLen() * 100) / 100 + 1 : 1;
        return `Nur Cycle-Bereich (Takt ${bar(c.a)} bis ${bar(c.b)})`;
    }
})();
