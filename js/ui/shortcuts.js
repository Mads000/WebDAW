// Globale Tastaturkürzel. Musiktastatur und Editor-Fokus werden hier zentral verteilt.
'use strict';
(() => {
    const T = WD.transport;
    const Ops = () => WD.regionOps;

    // Nur echte Texteingabe sperrt die Tastatur. Regler und Menüs behalten keinen Tastatur-Fokus.
    function isTyping(el) {
        if (!el) return false;
        if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
        return el.tagName === 'INPUT' && ['text', 'number', 'search'].includes(el.type);
    }

    const go = bar => { const b = Math.max(0, bar); T.seek(b); WD.timeline.reveal(b); };
    // Zur nächsten Rasterlinie in Laufrichtung, auch von einer Position zwischen den Linien
    const gridMove = dir => {
        const g = WD.timeline.gridStep(), q = T.current() / g;
        go((dir > 0 ? Math.floor(q + 1e-6) + 1 : Math.ceil(q - 1e-6) - 1) * g);
    };
    const FINE_SEC = 0.01;
    const fineMove = dir => go(T.current() + dir * FINE_SEC / WD.model.secPerBar());

    addEventListener('keydown', e => {
        if (isTyping(e.target) || e.repeat && !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        if (document.querySelector('.modal-back')) return;
        const ctrl = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();

        // Der Editor bekommt zuerst die Chance
        const a = WD.bottom.active;
        if (WD.view.focus === 'editor' && WD.view.bottom === 'editor' && a && a.onKey && a.onKey(e)) { e.preventDefault(); return; }

        if (ctrl) {
            const act = {
                z: () => (e.shiftKey ? WD.history.redo() : WD.history.undo()),
                y: () => WD.history.redo(),
                s: () => (e.shiftKey ? WD.storage.saveAs() : WD.storage.save()),
                o: () => WD.projectDialogs.projectsDialog(),
                n: () => WD.storage.newProject(),
                e: () => WD.exporter.dialog(),
                i: () => WD.$('fileAudio').click(),
                c: () => Ops().copy(),
                x: () => Ops().cut(),
                v: () => Ops().paste(),
                d: () => Ops().duplicate(),
                a: () => Ops().selectAll(),
                t: () => Ops().splitAtPlayhead(),
                u: () => WD.tuner.open(),
                arrowleft: () => fineMove(-1),
                arrowright: () => fineMove(1),
            }[key];
            if (act) { e.preventDefault(); act(); }
            return;
        }

        switch (e.key) {
            case ' ': e.preventDefault(); T.toggle(); return;
            case 'Enter': e.preventDefault(); if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur(); if (T.playing) T.pause(); else T.play(); return;
            case 'Home': e.preventDefault(); T.rewind(); return;
            case 'Delete': case 'Backspace': e.preventDefault(); Ops().remove(); return;
            case 'Escape': Ops().clearSelection(); return;
            case 'ArrowLeft': e.preventDefault(); if (e.shiftKey) gridMove(-1); else go(T.current() - WD.model.barLen()); return;
            case 'ArrowRight': e.preventDefault(); if (e.shiftKey) gridMove(1); else go(T.current() + WD.model.barLen()); return;
            case '+': WD.timeline.zoomBy(1.25); return;
            case '-': WD.timeline.zoomBy(.8); return;
            case '0': WD.timeline.zoomToFit(); return;
            default:
        }

        if (e.shiftKey && key === 's') {
            const t = WD.model.selTrack();
            if (t) { WD.history.run('Solo', () => { t.solo = !t.solo; }); WD.bus.emit('mix'); WD.bus.emit('tracks'); }
            return;
        }
        if (e.altKey) return;

        // Noten haben Vorrang auf Instrument- und Drum-Spuren; die übrigen Buchstaben sind Befehle.
        if (WD.musicalKeyboard.keyDown(e)) return;
        switch (key) {
            case 'r': WD.recorder.toggle(); break;
            case 'c': T.toggleCycle(); break;
            case 'l': WD.regionOps.toggleLoop(); break;
            case 'n': WD.project.metronome = !WD.project.metronome; WD.topbar.refreshToggles(); break;
            case 'm': {
                const t = WD.model.selTrack();
                if (t) { WD.history.run('Mute', () => { t.mute = !t.mute; }); WD.bus.emit('mix'); WD.bus.emit('tracks'); }
                break;
            }
            case 'v': WD.libraryPanel.toggle(); break;
            case 'b': WD.bottom.toggle('smart'); break;
            case 'p': WD.bottom.toggle('editor'); break;
            case 'x': WD.bottom.toggle('mixer'); break;
            default:
        }
    });

    addEventListener('keyup', e => {
        if (!isTyping(e.target)) WD.musicalKeyboard.keyUp(e);
    });
})();
