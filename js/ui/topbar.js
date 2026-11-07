// Kopfleiste: Verbindung der Bedienelemente mit Transport, Projekt und Ansichten.
'use strict';
(() => {
    const { $, bus } = WD;
    const T = WD.transport, M = WD.model;

    const on = (id, fn) => { $(id).onclick = fn; };

    on('btnRewind', () => T.rewind());
    on('btnPlay', () => { if (T.playing) T.pause(); else T.play(); });
    on('btnPause', () => { if (T.playing) T.pause(); else T.play(); });
    on('btnStop', () => T.stop());
    on('btnRec', () => WD.recorder.toggle());
    on('btnCycle', () => T.toggleCycle());
    on('btnPunch', () => { WD.project.punch = !WD.project.punch; refreshToggles(); bus.emit('dirty'); });
    on('btnMetro', () => { WD.project.metronome = !WD.project.metronome; refreshToggles(); bus.emit('dirty'); });
    on('btnCount', () => { WD.project.countIn = !WD.project.countIn; refreshToggles(); bus.emit('dirty'); });
    on('btnKeySnap', () => { WD.project.keySnap = !WD.project.keySnap; refreshToggles(); bus.emit('dirty'); });
    on('btnUndo', () => WD.history.undo());
    on('btnRedo', () => WD.history.redo());
    on('btnSplit', () => WD.regionOps.splitAtPlayhead());
    on('btnDup', () => WD.regionOps.duplicate());
    on('btnDel', () => WD.regionOps.remove());
    on('btnSnap', () => { WD.view.snap = !WD.view.snap; refreshToggles(); });
    on('btnLibrary', () => WD.libraryPanel.toggle());
    on('btnSmart', () => WD.bottom.toggle('smart'));
    on('btnEditor', () => WD.bottom.toggle('editor'));
    on('btnMixer', () => WD.bottom.toggle('mixer'));
    on('btnInput', () => WD.projectDialogs.inputSettings());
    on('btnTuner', () => WD.tuner.open());

    $('gridSel').onchange = e => { WD.view.grid = e.target.value; WD.timeline.requestDraw(); };

    // Tempo: Eingabe wird geprüft, ungültige Werte setzen auf den letzten gültigen zurück
    const bpm = $('bpm');
    const commitBpm = () => {
        const v = parseFloat(bpm.value);
        if (!isFinite(v) || v < 30 || v > 300) {
            bpm.value = WD.project.bpm;
            WD.ui.toast('Das Tempo muss zwischen 30 und 300 BPM liegen.');
            return;
        }
        if (Math.round(v) !== WD.project.bpm) WD.history.run('Tempo', () => M.setBpm(v));
        bpm.value = WD.project.bpm;
    };
    bpm.onchange = commitBpm;
    bpm.onkeydown = e => { if (e.key === 'Enter' || e.key === 'Escape') { if (e.key === 'Escape') bpm.value = WD.project.bpm; bpm.blur(); } e.stopPropagation(); };
    bpm.addEventListener('wheel', e => {
        e.preventDefault();
        WD.history.run('Tempo', () => M.setBpm(WD.project.bpm + (e.deltaY < 0 ? 1 : -1)));
        bpm.value = WD.project.bpm;
    }, { passive: false });

    $('timeSig').onchange = e => {
        const [a, b] = e.target.value.split('/').map(Number);
        WD.history.run('Taktart', () => { WD.project.timeSig = [a, b]; });
        bus.emit('timesig'); bus.emit('regions');
    };
    $('keyRoot').onchange = e => { WD.history.run('Tonart', () => { WD.project.keyRoot = e.target.value; }); bus.emit('editor:refresh'); };
    $('keyMode').onchange = e => { WD.history.run('Tonart', () => { WD.project.keyMode = e.target.value; }); bus.emit('editor:refresh'); };
    $('masterMode').onchange = e => { WD.history.run('Master-Klang', () => WD.engine.setMasterMode(e.target.value)); bus.emit('dirty'); };

    let masterTx = null;
    const master = $('master');
    master.onpointerdown = () => { masterTx = WD.history.begin('Master-Lautstärke'); };
    master.oninput = () => { WD.project.master.vol = master.value / 100; bus.emit('mix'); };
    master.onpointerup = () => { if (masterTx) masterTx.end(); masterTx = null; master.blur(); };

    function refreshToggles() {
        const p = WD.project;
        const set = (id, v) => { const b = $(id); b.classList.toggle('on', !!v); b.setAttribute('aria-pressed', v ? 'true' : 'false'); };
        set('btnCycle', p.cycle.on);
        set('btnPunch', p.punch);
        set('btnMetro', p.metronome);
        set('btnCount', p.countIn);
        set('btnKeySnap', p.keySnap);
        set('btnSnap', WD.view.snap);
    }

    function refreshHistory() {
        const u = $('btnUndo'), r = $('btnRedo'), H = WD.history;
        u.disabled = !H.canUndo(); r.disabled = !H.canRedo();
        u.dataset.tip = H.canUndo() ? `Rückgängig: ${H.undoLabel()} (Strg+Z)` : 'Rückgängig (Strg+Z)';
        r.dataset.tip = H.canRedo() ? `Wiederholen: ${H.redoLabel()} (Strg+Y)` : 'Wiederholen (Strg+Y)';
    }

    function refreshTransport() {
        const playing = T.playing;
        $('btnPlay').classList.toggle('on', playing);
        $('btnPlay').setAttribute('aria-pressed', playing ? 'true' : 'false');
    }
    function refreshRec() {
        const st = WD.recorder.state(), b = $('btnRec');
        b.classList.toggle('on', st === 'rec');
        b.classList.toggle('armed', st === 'count');
    }

    function refreshProject() {
        const p = WD.project;
        bpm.value = p.bpm;
        const sig = p.timeSig.join('/');
        const ts = $('timeSig');
        if (![...ts.options].some(o => o.value === sig)) ts.add(new Option(sig));
        ts.value = sig;
        $('keyRoot').value = p.keyRoot;
        $('keyMode').value = p.keyMode;
        master.value = Math.round(p.master.vol * 100);
        $('masterMode').value = p.master.mode;
        $('gridSel').value = WD.view.grid;
        refreshToggles(); refreshHistory();
    }

    $('projectName').onclick = () => WD.storage.rename();

    const fills = $('masterMeter').querySelectorAll('.hmeter-fill');
    bus.on('frame', () => {
        WD.meters.setH(fills[0], WD.meters.level('L'));
        WD.meters.setH(fills[1], WD.meters.level('R'));
    });

    bus.on('tempo', () => { bpm.value = WD.project.bpm; });
    bus.on('transport', refreshTransport);
    bus.on('rec:state', refreshRec);
    bus.on('history', refreshHistory);
    bus.on('cycle', refreshToggles);
    bus.on('project', refreshProject);
    bus.on('history', () => { $('masterMode').value = WD.project.master.mode; master.value = Math.round(WD.project.master.vol * 100); });

    // Motive
    const THEME_KEY = 'webdaw_theme';
    function setTheme(v) {
        if (v === 'dark' || v === 'light') document.documentElement.dataset.theme = v;
        else delete document.documentElement.dataset.theme;
        try { localStorage.setItem(THEME_KEY, v); } catch { /* nur Komfort */ }
        WD.timeline.drawNow();
        WD.bus.emit('regions');
        if (WD.view.bottom) WD.bottom.render();
    }
    const getTheme = () => { try { return localStorage.getItem(THEME_KEY) || 'system'; } catch { return 'system'; } };
    if (getTheme() !== 'system') document.documentElement.dataset.theme = getTheme();

    WD.topbar = {
        refreshProject, refreshToggles, setTheme, getTheme,
        refreshMaster: () => { master.value = Math.round(WD.project.master.vol * 100); bus.emit('mix'); },
    };
})();
