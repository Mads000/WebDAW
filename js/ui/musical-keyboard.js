// Musiktastatur: Buchstaben spielen Noten oder Drums, 1–7 die Akkorde der Tonart, Komma/Punkt wechseln die Oktave.
'use strict';
(() => {
    const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const KEYMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, z: 8, y: 8, h: 9, u: 10, j: 11, k: 12 };
    const DRUMKEYS = { a: 0, s: 1, d: 2, f: 3, g: 4, h: 5, j: 6, k: 7 };
    let liveOct = 0;

    const keyRoot = () => NOTES.indexOf(WD.project.keyRoot);
    const keyScale = () => WD.project.keyMode === 'minor' ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];

    function snapToKey(n) {
        if (!WD.project.keySnap) return n;
        const root = keyRoot(), sc = keyScale();
        const pc = ((n - root) % 12 + 12) % 12;
        if (sc.includes(pc)) return n;
        for (let o = 1; o < 7; o++) {
            if (sc.includes((pc - o + 12) % 12)) return n - o;
            if (sc.includes((pc + o) % 12)) return n + o;
        }
        return n;
    }
    function chordOfDegree(deg) {
        const sc = keyScale(), base = 48 + keyRoot();
        const pick = i => base + sc[i % 7] + (i >= 7 ? 12 : 0);
        const n1 = pick(deg), n3 = pick(deg + 2), n5 = pick(deg + 4);
        return [n1 - 12, n1, n3, n5];
    }

    WD.musicalKeyboard = {
        snapToKey,
        // Rückgabe true: Taste wurde musikalisch verwendet
        keyDown(e) {
            const key = e.key.toLowerCase();
            if (key === ',') { liveOct = Math.max(-2, liveOct - 1); WD.ui.toast('Oktave ' + (liveOct > 0 ? '+' : '') + liveOct, { ms: 900 }); return true; }
            if (key === '.') { liveOct = Math.min(2, liveOct + 1); WD.ui.toast('Oktave ' + (liveOct > 0 ? '+' : '') + liveOct, { ms: 900 }); return true; }
            const t = WD.model.selTrack();
            if (!t || t.type === 'audio') return false;
            if (t.type === 'inst' && '1234567'.includes(key)) {
                const ch = chordOfDegree('1234567'.indexOf(key)).map(x => x + liveOct * 12);
                WD.engine.ensure().then(() => {
                    const strip = WD.engine.strip(t), now = WD.engine.ctx.currentTime;
                    ch.forEach((n, i) => WD.instruments.play(t, n, now + i * .012, .8, undefined, strip.input));
                });
                ch.forEach(n => WD.recorder.noteOn(t, n));
                return true;
            }
            let n;
            if (t.type === 'drum') {
                n = DRUMKEYS[key];
                if (n === undefined) return false;
            } else {
                const k = KEYMAP[key];
                if (k === undefined) return false;
                n = snapToKey(60 + k + liveOct * 12);
            }
            WD.instruments.preview(t, n, .4);
            WD.recorder.noteOn(t, n, t.type === 'drum' ? null : key);
            return true;
        },
        keyUp(e) { WD.recorder.noteOff(e.key.toLowerCase()); },
    };
})();
