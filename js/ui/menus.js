// Menüleiste.
'use strict';
(() => {
    const { $, el } = WD;
    const Ops = () => WD.regionOps;
    const D = () => WD.projectDialogs;

    const MENUS = {
        Ablage: () => [
            { label: 'Neues Projekt', shortcut: 'Strg+N', action: () => WD.storage.newProject() },
            { label: 'Neu aus Vorlage …', action: () => WD.templates.showDialog() },
            { label: 'Projekte …', shortcut: 'Strg+O', action: () => D().projectsDialog() },
            { sep: 1 },
            { label: 'Speichern', shortcut: 'Strg+S', action: () => WD.storage.save() },
            { label: 'Speichern unter …', shortcut: 'Strg+Umschalt+S', action: () => WD.storage.saveAs() },
            { label: 'Projekt umbenennen …', action: () => WD.storage.rename() },
            { label: 'Sicherungen …', action: () => D().backupsDialog() },
            { sep: 1 },
            { label: 'Als Datei exportieren (.webdaw)', action: () => WD.storage.exportFile() },
            { label: 'Datei öffnen (.webdaw, .json) …', action: () => $('fileProj').click() },
            { sep: 1 },
            { label: 'Als Audio exportieren (WAV, MP3) …', shortcut: 'Strg+E', action: () => WD.exporter.dialog() },
            { label: 'Stems exportieren (ZIP) …', action: () => WD.exporter.stemsDialog() },
            { label: 'Audiodatei importieren …', shortcut: 'Strg+I', action: () => $('fileAudio').click() },
            { sep: 1 },
            { label: 'Von anderem Gerät empfangen …', action: () => WD.sync.receiveDialog() },
            { label: 'An anderes Gerät senden …', action: () => WD.sync.sendDialog() },
            { sep: 1 },
            WD.install.menuItem(),
        ],
        Bearbeiten: () => {
            const H = WD.history, sel = WD.model.selRegions().length > 0;
            return [
                { label: H.canUndo() ? `Rückgängig: ${H.undoLabel()}` : 'Rückgängig', shortcut: 'Strg+Z', disabled: !H.canUndo(), action: H.undo },
                { label: H.canRedo() ? `Wiederholen: ${H.redoLabel()}` : 'Wiederholen', shortcut: 'Strg+Y', disabled: !H.canRedo(), action: H.redo },
                { sep: 1 },
                { label: 'Ausschneiden', shortcut: 'Strg+X', disabled: !sel, action: () => Ops().cut() },
                { label: 'Kopieren', shortcut: 'Strg+C', disabled: !sel, action: () => Ops().copy() },
                { label: 'Einfügen', shortcut: 'Strg+V', action: () => Ops().paste() },
                { label: 'Duplizieren', shortcut: 'Strg+D', disabled: !sel, action: () => Ops().duplicate() },
                { label: 'Löschen', shortcut: 'Entf', disabled: !sel, action: () => Ops().remove() },
                { sep: 1 },
                { label: 'Am Playhead teilen', shortcut: 'Strg+T', action: () => Ops().splitAtPlayhead() },
                { label: 'Loopen bis Songende / Loop entfernen', shortcut: 'L', disabled: !sel, action: () => Ops().toggleLoop() },
                { label: 'Alles auswählen', shortcut: 'Strg+A', action: () => Ops().selectAll() },
            ];
        },
        Spur: () => {
            const t = WD.model.selTrack();
            return [
                { label: 'Neue Audio-Spur', icon: 'mic', action: () => WD.tracksView.addTrack('audio') },
                { label: 'Neues Instrument', icon: 'keys', action: () => WD.tracksView.addTrack('inst') },
                { label: 'Neue Drum-Spur', icon: 'drums', action: () => WD.tracksView.addTrack('drum') },
                { sep: 1 },
                { label: 'Spur duplizieren', disabled: !t, action: () => WD.history.run('Spur duplizieren', () => WD.model.duplicateTrack(t.id)) },
                { label: 'Spur doppeln (neu einspielen)', disabled: !t, action: () => WD.patches.doubleTrack(t) },
                { label: 'Harmonie-Spur anlegen', disabled: !t || t.type !== 'audio', action: () => WD.patches.harmonyTrack(t) },
                { label: 'Spur umbenennen …', disabled: !t, action: () => WD.tracksView.renameTrack(t) },
                { label: 'Spur löschen', danger: true, disabled: !t, action: () => WD.tracksView.deleteTrack(t) },
                { sep: 1 },
                { label: 'Audio-Eingang …', icon: 'mic', action: () => D().inputSettings() },
                { label: 'Stimmgerät …', icon: 'tuner', shortcut: 'Strg+U', action: () => WD.tuner.open() },
                { label: WD.midi.connected ? 'MIDI-Keyboard: verbunden' : 'MIDI-Keyboard verbinden …', icon: 'keys', action: () => WD.midi.connect() },
                { sep: 1 },
                { label: 'Diese Spur exportieren …', icon: 'file', disabled: !t || !t.regions.length, action: () => WD.exporter.trackDialog(t) },
            ];
        },
        Song: () => [
            { label: 'Akkord-Spur …', action: () => WD.chords.dialog() },
            { sep: 1 },
            ...WD.templates.names().map(n => ({ label: 'Vorlage: ' + n, action: () => WD.templates.create(n) })),
            { label: 'Song-Form auf aktuelles Projekt anwenden', action: () => WD.templates.applySongForm() },
            { sep: 1 },
            ...WD.demos.names().map(n => ({ label: 'Demo: ' + n, action: () => WD.demos.load(n) })),
        ],
        Ansicht: () => {
            const v = WD.view, theme = WD.topbar.getTheme();
            return [
                { label: 'Bibliothek', checked: v.libraryOpen, shortcut: 'V', action: () => WD.libraryPanel.toggle() },
                { label: 'Smart Controls', checked: v.bottom === 'smart', shortcut: 'B', action: () => WD.bottom.toggle('smart') },
                { label: 'Editor', checked: v.bottom === 'editor', shortcut: 'P', action: () => WD.bottom.toggle('editor') },
                { label: 'Mixer', checked: v.bottom === 'mixer', shortcut: 'X', action: () => WD.bottom.toggle('mixer') },
                { sep: 1 },
                { label: 'Reinzoomen', shortcut: '+', action: () => WD.timeline.zoomBy(1.25) },
                { label: 'Rauszoomen', shortcut: '−', action: () => WD.timeline.zoomBy(.8) },
                { label: 'Song einpassen', shortcut: '0', action: () => WD.timeline.zoomToFit() },
                { label: 'Handy-Ansicht', action: () => WD.phone.setMode('phone') },
                { label: 'Spuren niedriger', action: () => WD.timeline.setRowHeight(v.rowH - 12) },
                { label: 'Spuren höher', action: () => WD.timeline.setRowHeight(v.rowH + 12) },
                { sep: 1 },
                { label: 'Motiv: System', checked: theme === 'system', action: () => WD.topbar.setTheme('system') },
                { label: 'Motiv: Dunkel', checked: theme === 'dark', action: () => WD.topbar.setTheme('dark') },
                { label: 'Motiv: Hell', checked: theme === 'light', action: () => WD.topbar.setTheme('light') },
            ];
        },
        Hilfe: () => [
            { label: 'Erste Schritte …', action: () => D().firstStepsDialog() },
            { label: 'Tastaturkürzel …', action: () => D().shortcutsDialog() },
            { sep: 1 },
            { label: 'Klangquellen und Lizenzen …', action: () => D().creditsDialog() },
        ],
    };

    const host = $('menus');
    let openBtn = null;
    function open(btn, name) {
        close();
        const r = btn.getBoundingClientRect();
        btn.classList.add('open');
        openBtn = btn;
        WD.ui.menu(r.left, r.bottom + 2, MENUS[name](), { onClose: () => { btn.classList.remove('open'); if (openBtn === btn) openBtn = null; } });
    }
    function close() { WD.ui.closeMenu(); }

    Object.keys(MENUS).forEach(name => {
        const btn = el('button', { class: 'menu-btn', 'aria-haspopup': 'true', dataset: { menu: name } }, name);
        btn.onclick = () => { if (openBtn === btn) close(); else open(btn, name); };
        btn.onpointerenter = () => { if (openBtn && openBtn !== btn) open(btn, name); };
        host.append(btn);
    });
})();
