// Audio-Eingang: Gerätewahl, Pegel, Monitoring. Das Mikrofon ist nur geöffnet, solange eine Spur es braucht.
'use strict';
(() => {
    const { bus, $ } = WD;
    const KEY = 'webdaw_audio_settings';
    const settings = Object.assign({ deviceId: '', trimDb: 0, latencyOffsetMs: 0 }, (() => {
        try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
    })());
    const saveSettings = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* nur Komfort */ } };

    let stream = null, source = null, trim = null, analyser = null, splitter = null;
    let opening = null;
    const monitorTaps = new Map();

    function explain(err) {
        if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
            return 'Der Browser hat den Zugriff auf das Mikrofon verweigert. Erlaube ihn über das Symbol in der Adressleiste und versuche es erneut.';
        }
        if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
            return 'Das gewählte Eingangsgerät wurde nicht gefunden. Prüfe das Kabel oder wähle unter „Audio-Eingang“ ein anderes Gerät.';
        }
        if (err.name === 'NotReadableError') {
            return 'Das Eingangsgerät wird gerade von einem anderen Programm belegt.';
        }
        return 'Der Audio-Eingang konnte nicht geöffnet werden: ' + err.message;
    }

    async function open() {
        if (stream) return;
        if (opening) return opening;
        opening = (async () => {
            await WD.engine.ensure();
            if (navigator.audioSession) navigator.audioSession.type = 'play-and-record';
            const ctx = WD.engine.ctx;
            const audio = {
                echoCancellation: false, noiseSuppression: false, autoGainControl: false,
                channelCount: { ideal: 2 }, latency: { ideal: 0 },
            };
            if (settings.deviceId) audio.deviceId = { exact: settings.deviceId };
            let s;
            try {
                s = await navigator.mediaDevices.getUserMedia({ audio });
            } catch (err) {
                if (settings.deviceId && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
                    delete audio.deviceId;
                    s = await navigator.mediaDevices.getUserMedia({ audio });
                    WD.ui.toast('Das gewählte Gerät fehlt; es wird das Standardgerät verwendet.');
                } else throw err;
            }
            stream = s;
            source = ctx.createMediaStreamSource(stream);
            trim = ctx.createGain();
            trim.gain.value = WD.dbToGain(settings.trimDb);
            trim.channelCountMode = 'max';
            source.connect(trim);
            analyser = ctx.createAnalyser();
            analyser.fftSize = 2048;
            trim.connect(analyser);
            splitter = ctx.createChannelSplitter(2);
            trim.connect(splitter);
            stream.getTracks().forEach(t => { t.onended = () => { WD.ui.toast('Das Eingangsgerät wurde getrennt.', { type: 'error' }); close(); bus.emit('tracks'); }; });
            bus.emit('input:changed');
        })();
        try { await opening; } finally { opening = null; }
    }

    function close() {
        monitorTaps.forEach(n => { try { n.disconnect(); } catch { /* */ } });
        monitorTaps.clear();
        if (stream) stream.getTracks().forEach(t => { t.onended = null; t.stop(); });
        [source, trim, analyser, splitter].forEach(n => { if (n) { try { n.disconnect(); } catch { /* */ } } });
        stream = source = trim = analyser = splitter = null;
        if (navigator.audioSession) navigator.audioSession.type = WD.phone && WD.phone.active ? 'playback' : 'auto';
        const fill = $('inMeter').firstElementChild;
        if (fill) WD.meters.setH(fill, 0);
        bus.emit('input:changed');
    }

    // Quelle für eine Spur je nach gewähltem Kanal: mono1, mono2 oder stereo
    function tapFor(track) {
        const ctx = WD.engine.ctx;
        if (track.inputCh === 'stereo') return { node: trim };
        const g = ctx.createGain();
        splitter.connect(g, track.inputCh === 'mono2' ? 1 : 0);
        return { node: g, owned: g };
    }

    function wireMonitors() {
        monitorTaps.forEach(n => { try { n.disconnect(); } catch { /* */ } });
        monitorTaps.clear();
        if (!stream) return;
        WD.project.tracks.forEach(t => {
            if (t.type !== 'audio' || !t.monitor) return;
            const strip = WD.engine.strip(t);
            const g = WD.engine.ctx.createGain();
            tapFor(t).node.connect(g);
            g.connect(strip.input);
            monitorTaps.set(t.id, g);
        });
    }

    const I = WD.input = {
        settings, saveSettings,
        get active() { return !!stream; },
        get node() { return trim; },
        get channelCount() { return source ? source.channelCount : 0; },
        get label() { return stream ? stream.getAudioTracks()[0].label : ''; },
        needed() {
            return WD.project.tracks.some(t => t.type === 'audio' && (t.arm || t.monitor)) || (WD.recorder && WD.recorder.isCapturing());
        },
        open,
        close,
        explain,
        async refresh() {
            try {
                if (I.needed()) await open(); else if (stream) close();
                wireMonitors();
            } catch (err) {
                WD.project.tracks.forEach(t => { if (t.type === 'audio') { t.arm = false; t.monitor = false; } });
                bus.emit('tracks');
                WD.ui.alert('Kein Audio-Eingang', explain(err));
            }
            bus.emit('input:changed');
        },
        async toggleMonitor(t) {
            t.monitor = !t.monitor;
            if (t.monitor) {
                WD.ui.toast('Monitoring an. Nutze Kopfhörer, sonst kann es zu Rückkopplungen kommen.', { ms: 5000 });
            }
            bus.emit('tracks');
            bus.emit('dirty');
            await I.refresh();
        },
        async devices() {
            if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
            return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
        },
        async setDevice(id) {
            settings.deviceId = id; saveSettings();
            if (stream) { close(); await I.refresh(); }
        },
        setTrim(db) {
            settings.trimDb = db; saveSettings();
            if (trim) trim.gain.setTargetAtTime(WD.dbToGain(db), WD.engine.ctx.currentTime, 0.01);
        },
        // Vom Browser gemeldete Eingangslatenz in Sekunden, falls verfügbar
        inputLatency() {
            if (!stream) return 0;
            const st = stream.getAudioTracks()[0].getSettings();
            return typeof st.latency === 'number' ? st.latency : 0;
        },
        // Verschiebung für Takes: Hin- und Rückweg plus eigene Korrektur
        roundTripSec() {
            const ctx = WD.engine.ctx;
            return (ctx.outputLatency || 0) + (ctx.baseLatency || 0) + I.inputLatency() + settings.latencyOffsetMs / 1000;
        },
        peak: () => (analyser ? WD.meters.peak(analyser) : 0),
    };

    bus.on('frame', () => {
        if (!stream) return;
        WD.meters.setH($('inMeter').firstElementChild, I.peak());
    });
    bus.on('project', () => { I.refresh(); });
})();
