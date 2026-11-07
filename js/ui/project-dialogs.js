// Dialoge: Projekte, Sicherungen, Audio-Eingang, Tastaturkürzel. Außerdem Audio-Import.
'use strict';
(() => {
    const { el, bus, $ } = WD;
    const M = WD.model;
    const fmtDate = ts => new Date(ts).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
    const fmtMB = n => (n / 1048576).toFixed(n > 104857600 ? 0 : 1) + ' MB';

    async function projectsDialog() {
        let rows;
        try { rows = await WD.storage.listProjects(); }
        catch (err) { WD.ui.alert('Speicher nicht verfügbar', err.message); return; }
        const est = await WD.db.estimate().catch(() => null);
        WD.ui.modal((box, close) => {
            box.append(el('h2', {}, 'Projekte'));
            const list = el('div', { class: 'list-table' });
            if (!rows.length) list.append(el('div', { class: 'list-empty' }, 'Noch keine gespeicherten Projekte. Mit Strg+S speicherst du das aktuelle.'));
            rows.forEach(r => {
                list.append(el('div', { class: 'list-row' + (r.id === WD.project.id ? ' current' : '') },
                    el('div', { class: 'name', 'data-tip': r.name }, r.name),
                    el('div', { class: 'meta' }, fmtDate(r.updatedAt)),
                    el('button', { class: 'primary', onclick: () => { close(); WD.storage.openProject(r.id); } }, 'Öffnen'),
                    el('button', {
                        onclick: async () => {
                            const ok = await WD.ui.confirm(`„${r.name}“ löschen?`, 'Das Projekt verschwindet aus der Liste. Eine Sicherung bleibt unter „Sicherungen“ erhalten.', { ok: 'Löschen', danger: true });
                            if (!ok) return;
                            await WD.storage.deleteProject(r.id);
                            close(); projectsDialog();
                        },
                    }, 'Löschen')));
            });
            box.append(list);
            if (est && est.quota) box.append(el('div', { class: 'modal-note' }, `Browser-Speicher: ${fmtMB(est.usage || 0)} von ${fmtMB(est.quota)} belegt. Die Projekte liegen nur in diesem Browser; exportiere wichtige Songs zusätzlich als Datei.`));
            box.append(el('div', { class: 'modal-btns' },
                el('button', { class: 'left', onclick: () => { close(); backupsDialog(); } }, 'Sicherungen …'),
                el('button', { onclick: () => { close(); $('fileProj').click(); } }, 'Datei öffnen …'),
                el('button', { onclick: close }, 'Schließen')));
        }, { wide: true, onEscape: () => { } });
    }

    async function backupsDialog() {
        const rows = await WD.storage.listBackups();
        const unref = await WD.storage.unreferencedBuffers().catch(() => []);
        WD.ui.modal((box, close) => {
            box.append(el('h2', {}, 'Sicherungen'),
                el('p', {}, 'Jedes Speichern legt automatisch eine Sicherung an (die letzten 10 pro Projekt). Auch verworfene Stände und abgelehnte Wiederherstellungen landen hier.'));
            const list = el('div', { class: 'list-table' });
            if (!rows.length) list.append(el('div', { class: 'list-empty' }, 'Noch keine Sicherungen vorhanden.'));
            rows.slice(0, 80).forEach(r => list.append(el('div', { class: 'list-row' },
                el('div', { class: 'name' }, r.name),
                el('div', { class: 'meta' }, `${r.reason || ''} · ${fmtDate(r.savedAt)}`),
                el('button', { onclick: () => { close(); WD.storage.restoreBackup(r); } }, 'Laden'))));
            box.append(list);
            const btns = el('div', { class: 'modal-btns' });
            if (unref.length) {
                btns.append(el('button', {
                    class: 'left', 'data-tip': 'Audio, auf das weder Projekt noch Sicherung verweist',
                    onclick: async () => {
                        const ok = await WD.ui.confirm('Speicher aufräumen?', `${unref.length} Audio-Datei(en) werden von keinem Projekt und keiner Sicherung mehr verwendet und lassen sich endgültig entfernen.`, { ok: 'Entfernen', danger: true });
                        if (!ok) return;
                        await WD.storage.purgeBuffers(unref);
                        close(); backupsDialog();
                    },
                }, `Aufräumen (${unref.length})`));
            }
            btns.append(el('button', { onclick: () => { close(); projectsDialog(); } }, 'Zurück'), el('button', { onclick: close }, 'Schließen'));
            box.append(btns);
        }, { wide: true, onEscape: () => { } });
    }

    async function inputSettings() {
        const I = WD.input;
        await WD.engine.ensure();
        let needsPermission = false;
        const devices = await I.devices().catch(() => []);
        if (devices.every(d => !d.label)) needsPermission = true;
        WD.ui.modal((box, close) => {
            const devSel = el('select', { 'aria-label': 'Eingangsgerät' }, new Option('Standardgerät', ''));
            devices.forEach((d, i) => devSel.add(new Option(d.label || `Eingang ${i + 1}`, d.deviceId, false, d.deviceId === I.settings.deviceId)));
            devSel.onchange = () => I.setDevice(devSel.value);

            const t = M.selTrack();
            const chanSel = el('select', { 'aria-label': 'Eingangskanal', disabled: !t || t.type !== 'audio' },
                new Option('Mono, Kanal 1', 'mono1'), new Option('Mono, Kanal 2', 'mono2'), new Option('Stereo, Kanal 1+2', 'stereo'));
            if (t && t.type === 'audio') chanSel.value = t.inputCh;
            chanSel.onchange = () => {
                WD.history.run('Eingangskanal', () => { t.inputCh = chanSel.value; });
                I.refresh();
            };

            const trimV = el('span', { style: { minWidth: '56px', textAlign: 'right' } });
            const trim = el('input', { type: 'range', class: 'slider', min: -24, max: 24, value: I.settings.trimDb, 'aria-label': 'Eingangspegel' });
            const upd = () => { trimV.textContent = (+trim.value > 0 ? '+' : '') + trim.value + ' dB'; };
            upd();
            trim.oninput = () => { upd(); I.setTrim(+trim.value); };

            const off = el('input', { type: 'number', min: -500, max: 500, step: 1, value: I.settings.latencyOffsetMs, 'aria-label': 'Latenz-Korrektur' });
            off.onchange = () => { I.settings.latencyOffsetMs = +off.value || 0; I.saveSettings(); };

            const ctx = WD.engine.ctx;
            const latInfo = el('div', { class: 'modal-note' });
            const showLat = () => {
                const parts = [`Abtastrate ${ctx.sampleRate} Hz`, `Ausgang ${(1000 * ((ctx.outputLatency || 0) + (ctx.baseLatency || 0))).toFixed(1)} ms`];
                if (I.active) parts.push(`Eingang ${(1000 * I.inputLatency()).toFixed(1)} ms`, `Takes werden um ${(1000 * I.roundTripSec()).toFixed(1)} ms vorgezogen`);
                latInfo.textContent = parts.join(' · ');
            };
            showLat();

            const levelFill = el('div', { class: 'hmeter-fill' });
            const offFrame = bus.on('frame', () => { WD.meters.setH(levelFill, I.peak()); showLat(); });
            let testing = false;
            const testBtn = el('button', {
                onclick: async () => {
                    if (testing) { testing = false; if (!I.needed()) I.close(); testBtn.textContent = 'Pegel testen'; return; }
                    try { await I.open(); testing = true; testBtn.textContent = 'Test beenden'; }
                    catch (err) { WD.ui.alert('Kein Audio-Eingang', I.explain(err)); }
                },
            }, 'Pegel testen');

            box.append(
                el('h2', {}, 'Audio-Eingang'),
                needsPermission ? el('p', {}, 'Die Gerätenamen erscheinen, sobald du den Mikrofon-Zugriff erlaubt hast: „Pegel testen“ klicken.') : null,
                el('div', { class: 'form-row' }, el('label', {}, 'Gerät'), devSel),
                el('div', { class: 'form-row' }, el('label', {}, t && t.type === 'audio' ? `Kanal für „${t.name}“` : 'Kanal (Audio-Spur wählen)'), chanSel),
                el('div', { class: 'form-row' }, el('label', {}, 'Eingangspegel (digital)'), trim, trimV),
                el('div', { class: 'form-row' }, el('label', {}, 'Pegel'), el('div', { class: 'hmeter', style: { flex: 1 } }, levelFill), testBtn),
                el('div', { class: 'form-row' }, el('label', {}, 'Latenz-Korrektur (ms)'), off, el('button', {
                    'data-tip': 'Spielt Klicks ab und sucht sie im Eingang. Mikrofon muss die Lautsprecher hören, oder Ausgang und Eingang sind per Kabel verbunden.',
                    onclick: async e => {
                        const b = e.currentTarget;
                        b.disabled = true; b.textContent = 'Messe …';
                        try {
                            const m = await WD.latencyTest.run();
                            if (m === null) {
                                WD.ui.toast('Klicks nicht zuverlässig erkannt. Lauter stellen, Mikrofon näher an die Lautsprecher oder Kabel-Schleife nutzen, dann erneut messen.', { type: 'error' });
                            } else {
                                WD.latencyTest.apply(m);
                                off.value = I.settings.latencyOffsetMs;
                                WD.ui.toast(`Gemessen: ${(m * 1000).toFixed(1)} ms. Takes werden jetzt entsprechend vorgezogen.`, { type: 'ok', ms: 6000 });
                            }
                        } catch (err) { WD.ui.alert('Messung fehlgeschlagen', I.explain(err)); }
                        finally { b.disabled = false; b.textContent = 'Messen'; }
                    },
                }, 'Messen')),
                latInfo,
                el('div', { class: 'modal-note' }, 'Ziel: Spitzen im grünen bis gelben Bereich. Stelle den Pegel möglichst am Interface ein, der Regler hier verstärkt nur digital. Liegen Takes hörbar zu spät oder zu früh, gleiche das mit der Latenz-Korrektur aus (positiv = Take weiter nach vorn). Der Browser bestimmt die Puffergröße selbst.'),
                el('div', { class: 'modal-btns' }, el('button', {
                    class: 'primary', onclick: () => { close(); offFrame(); if (testing && !I.needed()) I.close(); },
                }, 'Fertig')));
        }, { onEscape: () => { } });
        WD.frame.kick();
    }

    const SHORTCUTS = [
        ['Wiedergabe', [['Leertaste', 'Start / Stop (zurück zum Startpunkt)'], ['Enter', 'Pause an aktueller Stelle'], ['Pos1', 'Zum Anfang'], ['R', 'Aufnahme'], ['C', 'Cycle'], ['N', 'Metronom'], ['← →', 'Einen Takt zurück / vor']]],
        ['Bearbeiten', [['Strg+Z / Strg+Y', 'Rückgängig / Wiederholen'], ['Strg+C / X / V', 'Kopieren / Ausschneiden / Einfügen'], ['Strg+D', 'Duplizieren'], ['Strg+T', 'Am Playhead teilen'], ['L', 'Region loopen bis Songende / Loop entfernen'], ['Ecke oben rechts ziehen', 'Region loopen'], ['Entf', 'Löschen'], ['Strg+A', 'Alles auswählen'], ['Alt+Ziehen', 'Region kopieren'], ['Strg halten', 'Raster beim Ziehen aus']]],
        ['Ansicht', [['V', 'Bibliothek'], ['B', 'Smart Controls'], ['P', 'Editor'], ['X', 'Mixer'], ['+ / −', 'Zoom'], ['0', 'Song einpassen'], ['Strg+Mausrad', 'Zoom'], ['Alt+Mausrad', 'Spurhöhe']]],
        ['Spur', [['M', 'Mute'], ['Umschalt+S', 'Solo'], ['A W S E D F T G Z H U J K', 'Noten spielen'], ['A S D F G H J K', 'Drums spielen'], ['1–7', 'Akkorde der Tonart'], [', / .', 'Oktave']]],
        ['Projekt', [['Strg+S', 'Speichern'], ['Strg+Umschalt+S', 'Speichern unter'], ['Strg+O', 'Projekte'], ['Strg+N', 'Neues Projekt'], ['Strg+E', 'Als WAV exportieren'], ['Strg+I', 'Audio importieren'], ['Strg+U', 'Stimmgerät']]],
    ];
    function shortcutsDialog() {
        WD.ui.modal((box, close) => {
            box.append(el('h2', {}, 'Tastaturkürzel'));
            const grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: '12px' } });
            SHORTCUTS.forEach(([title, rows]) => grid.append(el('div', {},
                el('div', { class: 'fx-title' }, title),
                ...rows.map(([k, d]) => el('div', { style: { display: 'flex', gap: '10px', justifyContent: 'space-between', padding: '2px 0' } },
                    el('span', { style: { color: 'var(--text-2)' } }, d), el('b', { style: { whiteSpace: 'nowrap', fontWeight: 600 } }, k))))));
            box.append(grid, el('div', { class: 'modal-btns' }, el('button', { class: 'primary', onclick: close }, 'Schließen')));
        }, { wide: true, onEscape: () => { } });
    }

    // Audio-Dateien einlesen; pro Datei eine Region, bei Bedarf eine neue Spur
    async function importAudio(files, { track, bar } = {}) {
        await WD.engine.ensure();
        const list = [...files];
        const failed = [];
        for (const f of list) {
            const stop = WD.ui.busy(`„${f.name}“ wird importiert …`);
            try {
                const buf = await WD.engine.ctx.decodeAudioData(await f.arrayBuffer());
                const nm = f.name.replace(/\.[^.]+$/, '');
                WD.history.run('Audio importieren', () => {
                    let tr = track;
                    if (!tr) {
                        const sel = M.selTrack();
                        tr = sel && sel.type === 'audio' && list.length === 1 ? sel : M.addTrack('audio', nm);
                    }
                    const start = bar !== undefined ? bar : Math.floor(WD.transport.current());
                    tr.regions.push(M.normalizeRegion({
                        startBar: start, lengthBars: buf.duration / M.secPerBar(),
                        bufId: WD.audioStore.put(buf), name: nm, notes: [],
                    }));
                });
                bus.emit('tracks');
                bus.emit('audio:edited');
            } catch (err) {
                console.warn(err);
                failed.push(f.name);
            } finally { stop(); }
        }
        if (failed.length) WD.ui.alert('Import fehlgeschlagen', `Diese Datei(en) konnte der Browser nicht als Audio lesen: ${failed.join(', ')}. WAV, MP3, FLAC oder M4A funktionieren in der Regel.`);
    }

    WD.projectDialogs = { projectsDialog, backupsDialog, inputSettings, shortcutsDialog, importAudio };
})();
