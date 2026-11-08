// MIDI-Keyboard über Web MIDI: spielt und nimmt auf der ausgewählten Instrument- oder Drum-Spur auf.
'use strict';
(() => {
    const SETTING = 'webdaw_midi';
    const GM_DRUMS = { 35: 0, 36: 0, 37: 1, 38: 1, 40: 1, 42: 2, 44: 2, 46: 3, 39: 4, 41: 5, 43: 5, 45: 5, 47: 5, 48: 5, 50: 5, 49: 6, 51: 6, 52: 6, 55: 6, 57: 6, 54: 7, 56: 7 };
    let access = null, sustain = false;
    const held = new Map();     // Note → Stoppfunktion
    const sustained = new Set();

    function bindInputs() {
        if (!access) return 0;
        let n = 0;
        access.inputs.forEach(inp => { inp.onmidimessage = e => Midi.handle(e.data); n++; });
        return n;
    }
    function release(n) {
        const stop = held.get(n);
        if (stop) { stop(); held.delete(n); }
        WD.recorder.noteOff('midi:' + n);
    }

    const Midi = WD.midi = {
        get connected() { return !!access && access.inputs.size > 0; },
        get supported() { return !!navigator.requestMIDIAccess; },
        deviceNames: () => (access ? [...access.inputs.values()].map(i => i.name) : []),

        // Drei MIDI-Bytes verarbeiten; auch der Testeinstieg
        handle([status, d1, d2]) {
            const cmd = status & 0xF0;
            if (cmd === 0xB0 && d1 === 64) {
                sustain = d2 >= 64;
                if (!sustain) { sustained.forEach(release); sustained.clear(); }
                return;
            }
            const on = cmd === 0x90 && d2 > 0, off = cmd === 0x80 || (cmd === 0x90 && d2 === 0);
            if (!on && !off) return;
            const t = WD.model.selTrack();
            if (!t || t.type === 'audio') return;
            let n = d1;
            if (t.type === 'drum') {
                n = GM_DRUMS[d1];
                if (n === undefined) n = ((d1 % 8) + 8) % 8;
            } else if (WD.project.keySnap && WD.musicalKeyboard.snapToKey) n = WD.musicalKeyboard.snapToKey(d1);
            if (on) {
                const vel = d2 / 127;
                sustained.delete(n);
                if (held.has(n)) release(n);
                WD.engine.ensure().then(() => { held.set(n, WD.instruments.hold(t, n, vel)); });
                WD.recorder.noteOn(t, n, t.type === 'drum' ? null : 'midi:' + n, vel);
            } else if (sustain && t.type !== 'drum') sustained.add(n);
            else release(n);
        },

        async connect({ quiet = false } = {}) {
            if (!Midi.supported) {
                if (!quiet) WD.ui.alert('Web MIDI nicht verfügbar', 'Dieser Browser unterstützt kein MIDI. Nutze Chrome oder Edge.');
                return false;
            }
            try {
                access = await navigator.requestMIDIAccess();
                access.onstatechange = () => bindInputs();
                const n = bindInputs();
                try { localStorage.setItem(SETTING, '1'); } catch { /* nur Komfort */ }
                if (!quiet) {
                    if (n) WD.ui.toast(`MIDI verbunden: ${Midi.deviceNames().join(', ')}. Es spielt die ausgewählte Spur.`, { type: 'ok', ms: 5000 });
                    else WD.ui.toast('Kein MIDI-Gerät gefunden. Sobald du eines einsteckst, wird es automatisch verwendet.', { ms: 6000 });
                }
                return true;
            } catch (err) {
                if (!quiet) WD.ui.alert('MIDI nicht freigegeben', 'Der Browser hat den Zugriff auf MIDI-Geräte abgelehnt. Erlaube ihn in den Website-Einstellungen und versuche es erneut.');
                return false;
            }
        },
    };

    // Wer MIDI einmal verbunden hat, muss es beim nächsten Start nicht erneut tun
    let wanted = false;
    try { wanted = localStorage.getItem(SETTING) === '1'; } catch { /* */ }
    if (wanted) addEventListener('pointerdown', () => Midi.connect({ quiet: true }), { once: true });
})();
