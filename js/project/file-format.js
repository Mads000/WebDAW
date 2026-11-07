// Projektdatei (.webdaw): kurzer Kopf, JSON, danach die Audiodaten als rohe Float32-Blöcke (verlustfrei, Stereo).
// Alte .json-Projekte der ersten Version werden weiter gelesen. Beim Lesen wird erst vollständig geprüft;
// das offene Projekt bleibt unberührt, falls die Datei fehlerhaft ist.
'use strict';
(() => {
    const MAGIC = 'WEBDAW2\n';
    const M = WD.model;

    class ProjectFileError extends Error { }

    function collectBufferIds(project) {
        const ids = new Set();
        project.tracks.forEach(t => t.regions.forEach(r => {
            if (r.bufId) ids.add(r.bufId);
            (r.takes || []).forEach(k => ids.add(k.bufId));
        }));
        return ids;
    }

    function write(project) {
        const ids = [...collectBufferIds(project)].filter(id => WD.audioStore.has(id));
        const parts = [], table = [];
        ids.forEach(id => {
            const b = WD.audioStore.get(id);
            table.push({ id, sr: b.sampleRate, channels: b.numberOfChannels, length: b.length });
            for (let c = 0; c < b.numberOfChannels; c++) parts.push(b.getChannelData(c));
        });
        const json = new TextEncoder().encode(JSON.stringify({ project, buffers: table }));
        const len = new DataView(new ArrayBuffer(4));
        len.setUint32(0, json.length, true);
        return new Blob([MAGIC, len.buffer, json, ...parts], { type: 'application/octet-stream' });
    }

    const finite = (v, fb) => (typeof v === 'number' && isFinite(v) ? v : fb);

    // Prüft und bereinigt fremde Projektdaten. Wirft bei unbrauchbaren Dateien.
    function sanitize(p, { legacy = false } = {}) {
        if (!p || typeof p !== 'object') throw new ProjectFileError('Die Datei enthält kein Projekt.');
        if (!Array.isArray(p.tracks)) throw new ProjectFileError('In der Datei fehlt die Spurliste; sie ist vermutlich beschädigt oder kein WebDAW-Projekt.');
        const base = WD.newProject(typeof p.name === 'string' ? p.name : 'Importiertes Projekt');
        const out = Object.assign(base, {
            id: typeof p.id === 'string' ? p.id : base.id,
            bpm: WD.clamp(finite(p.bpm, 85), 30, 300),
            timeSig: Array.isArray(p.timeSig) && p.timeSig.length === 2 && p.timeSig.every(n => n > 0) ? p.timeSig : [4, 4],
            keyRoot: typeof p.keyRoot === 'string' ? p.keyRoot : 'C',
            keyMode: p.keyMode === 'minor' ? 'minor' : 'major',
            keySnap: !!p.keySnap, punch: !!p.punch, metronome: !!p.metronome, countIn: !!p.countIn,
            cycle: p.cycle && typeof p.cycle === 'object' ? { on: !!p.cycle.on, a: finite(p.cycle.a, 0), b: finite(p.cycle.b, 4) } : base.cycle,
            // Alte Projekte klangen immer mit dem warmen Master; so klingen sie gleich wie früher
            master: p.master && typeof p.master === 'object'
                ? { vol: WD.clamp(finite(p.master.vol, .8), 0, 1), mode: ['clean', 'warm', '90s'].includes(p.master.mode) ? p.master.mode : 'clean' }
                : { vol: .8, mode: legacy ? 'warm' : 'clean' },
            markers: (Array.isArray(p.markers) ? p.markers : []).filter(m => m && typeof m === 'object').map(m => ({
                name: String(m.name ?? 'Abschnitt'), startBar: Math.max(0, finite(m.startBar, 0)),
                lengthBars: Math.max(.01, finite(m.lengthBars, 4)), color: typeof m.color === 'string' ? m.color : undefined,
            })),
        });
        out.tracks = p.tracks.map((t, i) => {
            if (!t || !['drum', 'inst', 'audio'].includes(t.type)) throw new ProjectFileError(`Spur ${i + 1} hat einen unbekannten Typ.`);
            const clean = M.normalizeTrack(Object.assign({}, t, { name: String(t.name ?? 'Spur') }));
            clean.vol = WD.clamp(finite(clean.vol, .8), 0, 1);
            clean.pan = WD.clamp(finite(clean.pan, 0), -1, 1);
            clean.arm = false; clean.monitor = false;
            clean.auto = (Array.isArray(t.auto) ? t.auto : []).filter(a => a && isFinite(a.bar) && isFinite(a.val));
            clean.regions = (Array.isArray(t.regions) ? t.regions : []).map(r => {
                const nr = M.normalizeRegion(Object.assign({}, r, { name: String(r.name ?? 'Region') }));
                nr.startBar = Math.max(0, finite(nr.startBar, 0));
                nr.lengthBars = Math.max(.001, finite(nr.lengthBars, 1));
                nr.notes = (Array.isArray(r.notes) ? r.notes : []).filter(n => n && isFinite(n.t) && isFinite(n.n) && isFinite(n.d));
                delete nr.audio; delete nr.buffer;
                return nr;
            });
            return clean;
        });
        return out;
    }

    // Altformat: Base64-Mono-Audio direkt in der Region
    function fromLegacy(raw) {
        const buffers = new Map();
        const p = JSON.parse(JSON.stringify(raw));
        if (!Array.isArray(p.tracks)) throw new ProjectFileError('In der Datei fehlt die Spurliste; sie ist vermutlich beschädigt oder kein WebDAW-Projekt.');
        p.tracks.forEach(t => (t.regions || []).forEach(r => {
            if (!r.audio || !r.audio.b64) return;
            const bin = atob(r.audio.b64), u8 = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
            const pcm = new Int16Array(u8.buffer);
            const buf = new AudioBuffer({ length: Math.max(1, pcm.length), numberOfChannels: 1, sampleRate: r.audio.sr });
            const d = buf.getChannelData(0);
            for (let i = 0; i < pcm.length; i++) d[i] = pcm[i] / 32767;
            const id = 'b' + WD.uid();
            buffers.set(id, buf);
            r.bufId = id;
        }));
        const project = sanitize(p, { legacy: true });
        project.id = WD.uid();
        return { project, buffers };
    }

    async function read(file) {
        const head = new TextDecoder().decode(await file.slice(0, MAGIC.length).arrayBuffer());
        if (head === MAGIC) {
            const lenBytes = await file.slice(MAGIC.length, MAGIC.length + 4).arrayBuffer();
            const jsonLen = new DataView(lenBytes).getUint32(0, true);
            let off = MAGIC.length + 4;
            let meta;
            try { meta = JSON.parse(new TextDecoder().decode(await file.slice(off, off + jsonLen).arrayBuffer())); }
            catch { throw new ProjectFileError('Die Projektdatei ist beschädigt (Kopfbereich nicht lesbar).'); }
            off += jsonLen;
            const project = sanitize(meta.project);
            const buffers = new Map();
            for (const b of meta.buffers || []) {
                const bytes = b.length * b.channels * 4;
                if (off + bytes > file.size) throw new ProjectFileError('Die Projektdatei ist unvollständig: Audiodaten fehlen.');
                const data = await file.slice(off, off + bytes).arrayBuffer();
                off += bytes;
                const buf = new AudioBuffer({ length: b.length, numberOfChannels: b.channels, sampleRate: b.sr });
                for (let c = 0; c < b.channels; c++) buf.copyToChannel(new Float32Array(data, c * b.length * 4, b.length), c);
                buffers.set(b.id, buf);
            }
            return { project, buffers };
        }
        let raw;
        try { raw = JSON.parse(await file.text()); }
        catch { throw new ProjectFileError('Diese Datei ist kein WebDAW-Projekt.'); }
        if (raw && raw.version >= 2) return { project: sanitize(raw), buffers: new Map() };
        return fromLegacy(raw);
    }

    WD.fileFormat = { write, read, sanitize, fromLegacy, collectBufferIds, ProjectFileError };
})();
