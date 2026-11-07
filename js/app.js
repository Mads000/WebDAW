// Start der Anwendung.
'use strict';
(() => {
    const { $, bus } = WD;

    WD.icons.applyAll();

    // Datei-Eingaben
    $('fileProj').onchange = async e => {
        const f = e.target.files[0];
        e.target.value = '';
        if (f) await WD.storage.importFile(f);
    };
    $('fileAudio').onchange = async e => {
        const files = [...e.target.files];
        e.target.value = '';
        if (files.length) await WD.projectDialogs.importAudio(files);
    };

    // Audio- und Projektdateien von außen ablegen
    addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    addEventListener('drop', e => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        const files = [...e.dataTransfer.files];
        const project = files.find(f => /\.(webdaw|json)$/i.test(f.name));
        if (project) { WD.storage.importFile(project); return; }
        const lane = e.target.closest && e.target.closest('.tlane');
        const opts = {};
        if (lane) {
            const t = WD.model.track(lane.dataset.id);
            const r = lane.getBoundingClientRect();
            opts.bar = WD.timeline.snap((e.clientX - r.left) / WD.view.ppb);
            if (t && t.type === 'audio' && files.length === 1) opts.track = t;
        }
        WD.projectDialogs.importAudio(files, opts);
    });

    // Auswahlfelder geben nach der Wahl den Fokus ab, damit die Tastatur sofort wieder funktioniert
    document.addEventListener('change', e => { if (e.target.tagName === 'SELECT') e.target.blur(); });
    document.addEventListener('pointerup', e => {
        if (e.target.tagName === 'INPUT' && e.target.type === 'range') e.target.blur();
        if (e.target.closest && e.target.closest('button')) e.target.closest('button').blur();
    });

    // Unerwartete Fehler sichtbar machen, statt sie still zu verschlucken
    addEventListener('unhandledrejection', e => {
        console.error(e.reason);
        WD.ui.toast('Unerwarteter Fehler: ' + (e.reason && e.reason.message || e.reason), { type: 'error' });
    });

    // Der AudioContext darf erst nach einer Geste starten; danach sofort vorbereiten, damit der erste Ton nicht fehlt
    const firstGesture = () => { WD.engine.ensure().catch(err => WD.ui.alert('Audio nicht verfügbar', err.message)); };
    addEventListener('pointerdown', firstGesture, { once: true, capture: true });
    addEventListener('keydown', firstGesture, { once: true, capture: true });

    bus.emit('project', { soft: false });
    WD.libraryPanel.render();
    WD.storage.refreshTitle();
    WD.frame.kick();
    WD.storage.startup().catch(err => console.error(err));
})();
