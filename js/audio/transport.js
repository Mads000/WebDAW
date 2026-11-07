// Transport und Scheduler. Das Zeitraster ist die AudioContext-Uhr; ein Worker liefert den Takt,
// damit Hintergrund-Tabs nicht gedrosselt werden. Cycle-Sprünge werden sampelgenau im Voraus geplant.
'use strict';
(() => {
    const { bus } = WD;
    const M = WD.model;
    const LOOKAHEAD = 0.2;

    let playing = false;
    let startPos = 0;     // wo die Wiedergabe zuletzt begann (Stop per Leertaste kehrt dorthin zurück)
    let position = 0;     // Position im Stillstand
    let anchors = [];     // [{t: Kontextzeit, bar: Position}] – mehrere bei Cycle-Sprüngen
    let schedBar = 0;
    let audioSources = []; // {src, trackId}
    let timer = null;

    // Takt-Quelle
    let worker = null;
    function startClock() {
        if (!worker) {
            try {
                const code = 'let h;onmessage=e=>{clearInterval(h);if(e.data)h=setInterval(()=>postMessage(0),25)}';
                worker = new Worker(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
                worker.onmessage = () => tick();
            } catch { worker = false; }
        }
        if (worker) worker.postMessage(1); else timer = setInterval(tick, 25);
    }
    function stopClock() { if (worker) worker.postMessage(0); clearInterval(timer); }

    const seg = () => anchors[anchors.length - 1];
    function posAt(time) {
        for (let i = anchors.length - 1; i >= 0; i--) {
            if (time >= anchors[i].t) return anchors[i].bar + (time - anchors[i].t) / M.secPerBar();
        }
        return anchors[0].bar;
    }
    const timeOf = bar => { const s = seg(); return s.t + (bar - s.bar) * M.secPerBar(); };

    function autoValAt(tr, bar) {
        const pts = tr.auto;
        if (!pts || !pts.length) return 1;
        const s = pts.slice().sort((a, b) => a.bar - b.bar);
        if (bar <= s[0].bar) return s[0].val;
        for (let i = 0; i < s.length - 1; i++) {
            if (bar <= s[i + 1].bar) {
                const f = (bar - s[i].bar) / Math.max(1e-4, s[i + 1].bar - s[i].bar);
                return s[i].val + f * (s[i + 1].val - s[i].val);
            }
        }
        return s[s.length - 1].val;
    }

    function click(time, accent) {
        const ctx = WD.engine.ctx;
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = accent ? 1400 : 950;
        g.gain.setValueAtTime(accent ? 0.28 : 0.2, time);
        g.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
        o.connect(g); g.connect(WD.engine.nodes.monitor);
        o.start(time); o.stop(time + 0.05);
    }

    function voiceOf(strip) {
        if (!strip.voice) {
            strip.voice = WD.engine.ctx.createGain();
            strip.voice.connect(strip.input);
        }
        return strip.voice;
    }

    // Plant alle Ereignisse im Fenster [a, b) des aktuellen Segments
    function scheduleWindow(a, b) {
        const p = WD.project;
        if (p.metronome) {
            const beat = M.beatLen(), barL = M.barLen();
            for (let k = Math.ceil(a / beat - 1e-9); k * beat < b; k++) {
                const pos = k * beat;
                click(timeOf(pos), Math.abs(pos / barL - Math.round(pos / barL)) < 1e-6);
            }
        }
        const spb = M.secPerBar();
        p.tracks.forEach(tr => {
            const strip = WD.engine.strip(tr);
            tr.regions.forEach(r => {
                const end = r.startBar + r.lengthBars;
                if (end <= a || r.startBar >= b) return;
                if (tr.type === 'audio') {
                    if (r.startBar >= a && r.startBar < b) startRegion(tr, r, timeOf(r.startBar), 0, b);
                    return;
                }
                const L = r.loopLen || r.lengthBars;
                r.notes.forEach(nt => {
                    let k = Math.max(0, Math.floor((a - r.startBar - nt.t) / L));
                    for (; ; k++) {
                        const abs = r.startBar + k * L + nt.t;
                        if (abs >= end || abs >= b) break;
                        if (abs >= a) WD.instruments.play(tr, nt.n, timeOf(abs), nt.d * spb, nt.v, voiceOf(strip));
                    }
                });
            });
        });
    }

    function startRegion(tr, r, when, skipSec, curBar) {
        const strip = WD.engine.strip(tr);
        const cyc = WD.project.cycle, spb = M.secPerBar();
        let dur = r.lengthBars * spb - skipSec;
        if (cyc.on && curBar < cyc.b + 1) {
            const regionPosEnd = r.startBar + skipSec / spb + dur / spb;
            if (regionPosEnd > cyc.b && r.startBar + skipSec / spb < cyc.b) dur -= (regionPosEnd - cyc.b) * spb;
        }
        const src = WD.channel.startRegionSource(WD.engine.ctx, voiceOf(strip), r, when, skipSec, dur);
        if (src) {
            audioSources.push({ src, trackId: tr.id });
            src.onended = () => { audioSources = audioSources.filter(x => x.src !== src); };
        }
    }

    // Startet Audio-Regionen, die bei pos bereits laufen
    function startRunningAudio(pos, when) {
        const spb = M.secPerBar();
        WD.project.tracks.forEach(tr => {
            if (tr.type !== 'audio') return;
            tr.regions.forEach(r => {
                if (r.startBar < pos && r.startBar + r.lengthBars > pos) {
                    startRegion(tr, r, when, (pos - r.startBar) * spb, pos);
                }
            });
        });
    }

    function tick() {
        if (!playing) return;
        const ctx = WD.engine.ctx, now = ctx.currentTime;
        const horizonT = now + LOOKAHEAD;
        const cyc = WD.project.cycle, spb = M.secPerBar();
        const loopOk = cyc.on && !T.noLoop && cyc.b - cyc.a > 0.01;

        for (let guard = 0; guard < 64; guard++) {
            const s = seg();
            const hBar = s.bar + (horizonT - s.t) / spb;
            const end = loopOk && schedBar < cyc.b ? cyc.b : Infinity;
            const lim = Math.min(hBar, end);
            if (lim > schedBar) { scheduleWindow(schedBar, lim); schedBar = lim; }
            if (lim < end) break;
            const t = s.t + (end - s.bar) * spb;
            anchors.push({ t, bar: cyc.a });
            schedBar = cyc.a;
            startRunningAudio(cyc.a, t);
            bus.emit('cycle:wrap', t);
        }
        while (anchors.length > 1 && anchors[1].t < now - 1) anchors.shift();

        // Automation: weich nachgeführt, deshalb ohne Stufen
        const bar = posAt(now);
        WD.project.tracks.forEach(tr => {
            if (!tr.auto || !tr.auto.length) return;
            const st = WD.engine.strip(tr);
            st.fader.gain.setTargetAtTime(tr.vol * autoValAt(tr, bar), now, 0.015);
        });
    }

    function stopSounds() {
        audioSources.forEach(({ src }) => { try { src.stop(); } catch { /* lief nicht mehr */ } });
        audioSources = [];
        const ctx = WD.engine.ctx;
        if (!ctx) return;
        WD.project.tracks.forEach(tr => {
            const s = WD.engine.strip(tr);
            if (!s || !s.voice) return;
            const v = s.voice;
            s.voice = null;
            // Bereits geplante Noten verstummen mit kurzem Fade und hängen danach nirgends mehr
            v.gain.setTargetAtTime(0, ctx.currentTime, 0.012);
            setTimeout(() => { try { v.disconnect(); } catch { /* */ } }, 120);
        });
    }

    const T = WD.transport = {
        get playing() { return playing; },
        get startPos() { return startPos; },
        // Interne Position (für Aufnahme und Bearbeitung)
        current() {
            if (!playing) return position;
            return posAt(WD.engine.ctx.currentTime);
        },
        // Position, die gerade aus den Lautsprechern kommt (für Playhead und Anzeige)
        audible() {
            if (!playing) return position;
            const ctx = WD.engine.ctx;
            return Math.max(anchors[0].bar, posAt(ctx.currentTime - WD.engine.outputLatency()));
        },
        noLoop: false,
        startTime: () => anchors.length ? anchors[0].t : 0,
        posAt,
        timeOf,
        autoValAt,

        async play() {
            await WD.engine.ensure();
            if (playing) return;
            const ctx = WD.engine.ctx;
            playing = true;
            startPos = position;
            const t0 = ctx.currentTime + 0.08;
            anchors = [{ t: t0, bar: position }];
            schedBar = position;
            startRunningAudio(position, t0);
            startClock();
            tick();
            bus.emit('transport');
        },
        // Anhalten an der aktuellen Stelle
        pause() {
            if (!playing) return;
            position = Math.max(0, T.audible());
            T.halt();
        },
        // Anhalten ohne Positions-Festlegung
        halt() {
            if (!playing) return;
            playing = false;
            stopClock();
            stopSounds();
            bus.emit('transport:halted');
            bus.emit('transport');
        },
        // Leertaste: zurück zum Startpunkt der Wiedergabe
        stopToStart() { if (!playing) return; T.halt(); position = startPos; bus.emit('transport'); },
        // Stop-Knopf: zurück auf den Songanfang
        stop() { T.halt(); position = 0; bus.emit('transport'); },
        toggle() { if (playing) T.stopToStart(); else T.play(); },
        seek(bar) {
            const b = Math.max(0, bar);
            if (playing) {
                const ctx = WD.engine.ctx;
                stopSounds();
                const t0 = ctx.currentTime + 0.05;
                anchors = [{ t: t0, bar: b }];
                schedBar = b;
                startRunningAudio(b, t0);
                startPos = b;
            } else { position = b; startPos = b; }
            bus.emit('transport');
        },
        // Nach Bearbeitungen und Tempowechseln während der Wiedergabe: Audio neu ausrichten, ohne Sprung.
        resync() {
            if (!playing) return;
            const ctx = WD.engine.ctx;
            const b = posAt(ctx.currentTime);
            audioSources.forEach(({ src }) => { try { src.stop(); } catch { /* */ } });
            audioSources = [];
            const t0 = ctx.currentTime + 0.03;
            anchors = [{ t: t0, bar: b + 0.03 / M.secPerBar() }];
            schedBar = Math.max(schedBar, anchors[0].bar);
            startRunningAudio(anchors[0].bar, t0);
        },
        rewind() { T.seek(0); },
        setCycle(a, b) {
            const c = WD.project.cycle;
            c.a = Math.max(0, Math.min(a, b));
            c.b = Math.max(c.a + M.beatLen() / 4, Math.max(a, b));
            bus.emit('cycle');
        },
        toggleCycle(on) {
            const c = WD.project.cycle;
            c.on = on === undefined ? !c.on : !!on;
            bus.emit('cycle');
            bus.emit('dirty');
        },
        barBeat(bar) {
            const barL = M.barLen(), beat = M.beatLen();
            const b = Math.max(0, bar);
            const barIdx = Math.floor(b / barL + 1e-9);
            const rest = b - barIdx * barL;
            const beatIdx = Math.floor(rest / beat + 1e-9);
            const tick16 = Math.floor((rest - beatIdx * beat) / beat * 4 + 1e-9);
            return { bar: barIdx + 1, beat: beatIdx + 1, sub: tick16 + 1 };
        },
        timeStr(bar) {
            const sec = Math.max(0, bar) * M.secPerBar();
            const m = Math.floor(sec / 60), s = sec - m * 60;
            return String(m).padStart(2, '0') + ':' + s.toFixed(1).padStart(4, '0');
        },
    };

    let resyncTimer;
    const scheduleResync = () => { clearTimeout(resyncTimer); resyncTimer = setTimeout(T.resync, 60); };
    // Vor einem Tempowechsel die Position festhalten, sonst würde sie auf das neue Tempo umgerechnet und springen
    bus.on('tempo:before', () => {
        if (!playing) return;
        const now = WD.engine.ctx.currentTime;
        anchors = [{ t: now, bar: posAt(now) }];
    });
    bus.on('tempo', scheduleResync);
    bus.on('audio:edited', scheduleResync);
    bus.on('cycle', scheduleResync);
    bus.on('project', o => { if (o && o.soft) scheduleResync(); });
})();
