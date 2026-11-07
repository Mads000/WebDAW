// Aufnahme. Audio: unkomprimiert per AudioWorklet, mehrere Spuren gleichzeitig, Takes im Cycle, Punch,
// Latenzausgleich und laufende Sicherung in die Datenbank. MIDI: Noten von der Computertastatur.
'use strict';
(() => {
    const { bus, uid, el } = WD;
    const M = WD.model;
    const T = WD.transport;

    let session = null;   // laufende Audio-Aufnahme
    let midi = null;      // laufende MIDI-Aufnahme
    let countTimer = null, countSounds = [];

    const state = () => session || midi || countTimer ? (countTimer ? 'count' : 'rec') : 'idle';

    function targets() {
        let list = WD.project.tracks.filter(t => t.arm);
        if (!list.length) {
            const s = M.selTrack();
            if (s) list = [s];
        }
        return list;
    }

    function cancelCount() {
        if (countTimer) { clearTimeout(countTimer); countTimer = null; }
        countSounds.forEach(n => { try { n.stop(); } catch { /* */ } });
        countSounds = [];
    }

    function countIn(fn) {
        const p = WD.project;
        if (!p.countIn) { fn(); return; }
        const ctx = WD.engine.ctx;
        const beat = M.beatLen() * M.secPerBar(), n = p.timeSig[0];
        const t0 = ctx.currentTime + 0.05;
        for (let i = 0; i < n; i++) {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.frequency.value = i === 0 ? 1400 : 950;
            g.gain.setValueAtTime(0.3, t0 + i * beat);
            g.gain.exponentialRampToValueAtTime(0.001, t0 + i * beat + 0.05);
            o.connect(g); g.connect(WD.engine.nodes.monitor);
            o.start(t0 + i * beat); o.stop(t0 + i * beat + 0.06);
            countSounds.push(o);
        }
        countTimer = setTimeout(() => { countTimer = null; countSounds = []; fn(); }, (n * beat + 0.05) * 1000);
        bus.emit('rec:state');
    }

    // ----- Audio -----
    async function startCapture(audioTracks) {
        await WD.input.open();
        const ctx = WD.engine.ctx;
        const nCh = Math.max(1, WD.input.channelCount || 1);
        const node = new AudioWorkletNode(ctx, 'wd-recorder', {
            numberOfOutputs: 1, channelCount: nCh, channelCountMode: 'explicit', outputChannelCount: [1],
        });
        const silent = ctx.createGain(); silent.gain.value = 0;
        WD.input.node.connect(node); node.connect(silent); silent.connect(ctx.destination);
        const s = {
            id: uid(), node, silent, tracks: audioTracks, chunks: [], sr: ctx.sampleRate, passes: [],
            startT: null, startBar: 0, punch: null, comp: 0, finished: null, lastPersist: 0, persistIdx: 0,
            ghosts: new Map(), compSamples: [],
        };
        node.port.onmessage = e => {
            if (e.data.done) { if (s.finished) s.finished(); return; }
            s.chunks.push(e.data);
            WD.storage.recChunk(s, e.data);
        };
        return s;
    }

    // Holt [t0, t1) aus den aufgezeichneten Blöcken. Rückgabe: Array pro Kanal.
    function extract(s, t0, t1) {
        const f0 = Math.round(t0 * s.sr), f1 = Math.round(t1 * s.sr), len = f1 - f0;
        if (len <= 0 || !s.chunks.length) return null;
        const nCh = s.chunks[0].channels.length;
        const out = Array.from({ length: nCh }, () => new Float32Array(len));
        s.chunks.forEach(c => {
            const n = c.channels[0].length;
            const from = Math.max(f0, c.frame), to = Math.min(f1, c.frame + n);
            if (to <= from) return;
            for (let k = 0; k < nCh; k++) {
                const src = c.channels[k] || c.channels[0];
                out[k].set(src.subarray(from - c.frame, to - c.frame), from - f0);
            }
        });
        return out;
    }

    function makeBuffer(channels, track, sr) {
        let chans;
        if (track.inputCh === 'stereo' && channels.length > 1) chans = channels.slice(0, 2);
        else if (track.inputCh === 'mono2' && channels.length > 1) chans = [channels[1]];
        else chans = [channels[0]];
        const buf = new AudioBuffer({ length: chans[0].length, numberOfChannels: chans.length, sampleRate: sr });
        chans.forEach((c, i) => buf.copyToChannel(c, i));
        return buf;
    }

    // Vorhandene Audio-Regionen im aufgenommenen Bereich werden nicht zerstörend zurechtgeschnitten
    function clearRange(tr, a, b, keep) {
        [...tr.regions].forEach(r => {
            if (r === keep || r.startBar >= b - 1e-6 || r.startBar + r.lengthBars <= a + 1e-6) return;
            if (r.startBar < a - 1e-6) WD.regionOps.splitAt(tr, r, a);
        });
        [...tr.regions].forEach(r => {
            if (r === keep || r.startBar >= b - 1e-6 || r.startBar + r.lengthBars <= a + 1e-6) return;
            if (r.startBar + r.lengthBars > b + 1e-6) WD.regionOps.splitAt(tr, r, b);
        });
        tr.regions = tr.regions.filter(r => r === keep || r.startBar >= b - 1e-6 || r.startBar + r.lengthBars <= a + 1e-6);
    }

    async function finishCapture(s) {
        const ctx = WD.engine.ctx;
        const stopT = ctx.currentTime;
        s.stopT = stopT;
        // Der Browser meldet die Ausgangslatenz nicht konstant: Median über die ganze Aufnahme statt eines Einzelwerts
        if (s.compSamples.length) {
            const sorted = s.compSamples.slice().sort((a, b) => a - b);
            s.comp = sorted[Math.floor(sorted.length / 2)];
        }
        R.lastTake = { startT: s.startT, startBar: s.startBar, comp: s.comp };
        session = null;
        bus.emit('rec:state');
        // Bis zum Eintreffen der letzten Samples warten (Latenzausgleich)
        await new Promise(res => setTimeout(res, Math.max(40, s.comp * 1000 + 40)));
        const done = new Promise(res => { s.finished = res; });
        s.node.port.postMessage('stop');
        await Promise.race([done, new Promise(res => setTimeout(res, 800))]);
        try { WD.input.node && WD.input.node.disconnect(s.node); } catch { /* bereits getrennt */ }
        s.node.disconnect(); s.silent.disconnect();
        removeGhosts(s);

        const spb = M.secPerBar();
        // Durchgänge bilden: ohne Cycle genau einer, mit Cycle je Runde ein Take
        const edges = [s.startT, ...s.passes.map(p => p.t).filter(t => t < stopT), stopT];
        const bars = [s.startBar, ...s.passes.map(p => p.bar)];
        const clips = [];
        for (let i = 0; i < edges.length - 1; i++) {
            let t0 = edges[i], t1 = edges[i + 1], bar = bars[i];
            if (s.punch) {
                const pa = s.punch.a, pb = s.punch.b;
                const barEnd = bar + (t1 - t0) / spb;
                const from = Math.max(bar, pa), to = Math.min(barEnd, pb);
                if (to <= from) continue;
                t0 += (from - bar) * spb; t1 -= (barEnd - to) * spb; bar = from;
            }
            if (t1 - t0 < 0.03) continue;
            clips.push({ t0: t0 + s.comp, t1: t1 + s.comp, bar });
        }
        if (!clips.length) {
            WD.ui.toast(s.punch ? 'Der Punch-Bereich wurde nicht erreicht, es entstand keine Aufnahme.' : 'Die Aufnahme war zu kurz.');
            WD.storage.recDone(s);
            WD.input.refresh();
            return;
        }

        WD.history.run('Aufnahme', () => s.tracks.forEach(tr => {
            const live = M.track(tr.id);
            if (!live) return;
            const buffers = clips.map(c => {
                const ch = extract(s, c.t0, c.t1);
                return { buf: makeBuffer(ch, live, s.sr), bar: c.bar, dur: c.t1 - c.t0 };
            });
            const main = buffers[buffers.length - 1];
            const allTakes = buffers.map(b => ({ bufId: WD.audioStore.put(b.buf), offset: 0 }));
            const takeNo = live.regions.length + 1;
            // Letzte vollständige Runde gewinnt; kürzerer letzter Rest wird nicht bevorzugt
            let idx = allTakes.length - 1;
            if (buffers.length > 1 && main.dur < buffers[0].dur * 0.5) idx = allTakes.length - 2;
            const chosen = buffers[idx];
            const r = M.normalizeRegion({
                startBar: chosen.bar, lengthBars: chosen.dur / spb, bufId: allTakes[idx].bufId,
                offset: 0, name: 'Take ' + takeNo, notes: [],
            });
            if (allTakes.length > 1) { r.takes = allTakes; r.takeIdx = idx; }
            clearRange(live, r.startBar, r.startBar + r.lengthBars, null);
            live.regions.push(r);
            WD.view.selRegionIds = new Set([r.id]);
        }));
        bus.emit('regions'); bus.emit('selection'); bus.emit('audio:edited');
        WD.storage.recDone(s);
        WD.input.refresh();
    }

    // Wachsende Vorschau während der Aufnahme
    function updateGhosts() {
        if (!session || session.startT === null) return;
        if (session.compSamples.length < 3000) session.compSamples.push(WD.input.roundTripSec());
        const spb = M.secPerBar();
        const now = WD.engine.ctx.currentTime;
        const lastEdge = session.passes.length ? session.passes[session.passes.length - 1] : { t: session.startT, bar: session.startBar };
        const barNow = lastEdge.bar + Math.max(0, now - lastEdge.t) / spb;
        session.tracks.forEach(tr => {
            const lane = document.querySelector(`.tlane[data-id="${tr.id}"]`);
            if (!lane) return;
            let g = session.ghosts.get(tr.id);
            if (!g || !g.isConnected) {
                g = el('div', { class: 'region rec' }, el('div', { class: 'rhead' }, 'Aufnahme'));
                lane.append(g);
                session.ghosts.set(tr.id, g);
            }
            g.style.left = lastEdge.bar * WD.view.ppb + 'px';
            g.style.width = Math.max(2, (barNow - lastEdge.bar) * WD.view.ppb) + 'px';
        });
    }
    function removeGhosts(s) { s.ghosts.forEach(g => g.remove()); s.ghosts.clear(); }

    // ----- MIDI -----
    function beginMidi(tracks) {
        const bar = T.current();
        const c = WD.project.cycle;
        const tx = WD.history.begin('MIDI-Aufnahme');
        const items = tracks.map(tr => {
            const startBar = c.on ? Math.min(c.a, bar) : Math.floor(bar / M.barLen()) * M.barLen();
            const reg = M.normalizeRegion({ startBar, lengthBars: M.barLen(), loopLen: 0, notes: [], name: 'Aufnahme' });
            tr.regions.push(reg);
            return { tr, reg };
        });
        midi = { items, tx, held: new Map() };
        bus.emit('regions');
    }
    function endMidi() {
        const m = midi;
        midi = null;
        m.held.clear();
        const bar = T.current();
        m.items.forEach(({ tr, reg }) => {
            if (!reg.notes.length) {
                tr.regions = tr.regions.filter(r => r !== reg);
                WD.ui.toast('Es wurden keine Noten gespielt, die leere Region wurde verworfen.');
                return;
            }
            const end = Math.max(bar - reg.startBar, ...reg.notes.map(n => n.t + n.d));
            reg.lengthBars = Math.max(M.barLen(), Math.ceil(end / M.barLen() - 1e-6) * M.barLen());
        });
        m.tx.end();
        bus.emit('regions');
    }

    const R = WD.recorder = {
        state,
        lastTake: null,
        isRecording: () => !!(session || midi),
        isCapturing: () => !!session,
        activeMidiTrack: id => !!midi && midi.items.some(i => i.tr.id === id),

        async toggle() {
            if (state() !== 'idle') { R.stop(); return; }
            await R.start();
        },

        async start() {
            await WD.engine.ensure();
            const list = targets();
            if (!list.length) {
                WD.ui.alert('Keine Spur ausgewählt', 'Wähle zuerst eine Spur aus oder lege eine neue Audio-Spur an.');
                return;
            }
            const audio = list.filter(t => t.type === 'audio');
            const midiTracks = list.filter(t => t.type !== 'audio');
            let s = null;
            if (audio.length) {
                try { s = await startCapture(audio); }
                catch (err) { WD.ui.alert('Kein Audio-Eingang', WD.input.explain(err)); return; }
                session = s;
                WD.input.refresh();
                if (WD.project.punch) {
                    const c = WD.project.cycle;
                    if (c.b > c.a) { s.punch = { a: c.a, b: c.b }; T.noLoop = true; }
                }
            }
            const go = async () => {
                await T.play();
                const now = WD.engine.ctx.currentTime;
                if (s) {
                    // Der Takt läuft bereits, Aufnahme beginnt genau jetzt an dieser Stelle
                    s.startT = Math.max(now, T.startTime());
                    s.startBar = T.posAt(s.startT);
                    s.comp = WD.input.roundTripSec();
                    WD.storage.recBegin(s);
                }
                if (midiTracks.length) beginMidi(midiTracks);
                bus.emit('rec:state');
            };
            countIn(go);
            bus.emit('rec:state');
        },

        // Beendet die Aufnahme, der Transport läuft weiter, außer er wurde von außen gestoppt
        stop() {
            cancelCount();
            if (session) { const s = session; T.noLoop = false; if (s.startT === null) { abortCapture(s); } else finishCapture(s); }
            if (midi) endMidi();
            bus.emit('rec:state');
        },

        // ----- Tastatur → MIDI -----
        noteOn(track, n, key) {
            if (!R.activeMidiTrack(track.id) || !T.playing) return;
            const it = midi.items.find(i => i.tr.id === track.id);
            const reg = it.reg;
            let t = T.current() - reg.startBar;
            if (t < -1 / 16) return;
            t = Math.max(0, Math.round(t * 16) / 16);
            const note = { t, n, d: 1 / 8, v: 0.9 };
            reg.notes.push(note);
            const barL = M.barLen();
            reg.lengthBars = Math.max(reg.lengthBars, Math.ceil((t + .01) / barL) * barL);
            if (key) midi.held.set(key, { note, reg, start: T.current() });
            bus.emit('regions');
        },
        noteOff(key) {
            if (!midi) return;
            const h = midi.held.get(key);
            if (!h) return;
            midi.held.delete(key);
            const len = T.current() - h.start;
            if (len > 0) h.note.d = Math.max(1 / 16, Math.round(len * 16) / 16);
            bus.emit('regions');
        },
    };

    function abortCapture(s) {
        session = null;
        try { WD.input.node && WD.input.node.disconnect(s.node); } catch { /* */ }
        s.node.port.postMessage('stop');
        s.node.disconnect(); s.silent.disconnect();
        WD.input.refresh();
    }

    bus.on('cycle:wrap', t => {
        if (session && session.startT !== null && !session.punch) session.passes.push({ t, bar: WD.project.cycle.a });
    });
    bus.on('transport:halted', () => { if (R.isRecording() || countTimer) R.stop(); });
    bus.on('frame', updateGhosts);
    addEventListener('beforeunload', e => {
        if (R.isRecording()) { e.preventDefault(); e.returnValue = ''; }
    });
})();
