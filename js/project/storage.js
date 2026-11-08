// Projektverwaltung und Datensicherheit.
// - Audio wird sofort beim Entstehen gesichert, Aufnahmen schon während des Spielens.
// - Autosave schreibt nur den JSON-Stand, belastet also die Wiedergabe nicht.
// - Nichts wird überschrieben oder gelöscht, ohne dass vorher eine Sicherung existiert oder gefragt wurde.
'use strict';
(() => {
    const { bus, $, uid } = WD;
    const AUTOSAVE_MS = 2500, BACKUPS_PER_PROJECT = 10;
    let dirty = false, savedAt = null, lastError = null;
    const pendingBuffers = new Map();

    function setState(text, isError) {
        const n = $('saveState');
        n.textContent = text;
        n.classList.toggle('err', !!isError);
    }
    function refreshTitle() {
        const p = WD.project;
        $('projectName').textContent = p.name;
        document.title = (dirty ? '• ' : '') + p.name + ' – WebDAW';
    }
    const timeStr = ts => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

    function reportError(what, err) {
        lastError = err;
        console.error(what, err);
        const quota = err && (err.name === 'QuotaExceededError' || /quota/i.test(err.message || ''));
        setState(quota ? 'Speicher voll!' : 'Speicherfehler!', true);
        const msg = quota
            ? 'Der Browser-Speicher ist voll. Exportiere das Projekt als Datei (Ablage → Als Datei exportieren) und räume alte Projekte auf.'
            : `${what} ist fehlgeschlagen: ${err.message || err}. Exportiere das Projekt zur Sicherheit als Datei.`;
        WD.ui.toast(msg, { type: 'error', ms: 12000, action: { label: 'Exportieren', fn: () => S.exportFile() } });
    }

    // ----- Audiodaten -----
    function bufferRecord(id, b) {
        const channels = [];
        for (let c = 0; c < b.numberOfChannels; c++) channels.push(b.getChannelData(c));
        return { id, sr: b.sampleRate, length: b.length, channels };
    }
    async function persistBuffer(id) {
        const b = WD.audioStore.get(id);
        if (!b) return;
        await WD.db.put('buffers', bufferRecord(id, b));
        pendingBuffers.delete(id);
    }
    async function flushBuffers() { for (const id of [...pendingBuffers.keys()]) await persistBuffer(id); }
    bus.on('audio:added', id => {
        pendingBuffers.set(id, true);
        persistBuffer(id).catch(err => reportError('Das Sichern der Audiodaten', err));
    });

    async function loadBuffers(project) {
        const missing = [];
        for (const id of WD.fileFormat.collectBufferIds(project)) {
            if (WD.audioStore.has(id)) continue;
            const rec = await WD.db.get('buffers', id);
            if (!rec) { missing.push(id); continue; }
            const buf = new AudioBuffer({ length: rec.length, numberOfChannels: rec.channels.length, sampleRate: rec.sr });
            rec.channels.forEach((c, i) => buf.copyToChannel(c, i));
            WD.audioStore.adopt(id, buf);
        }
        return missing;
    }

    // ----- Projekt in die App laden -----
    function activate(project) {
        const T = WD.transport;
        T.stop();
        WD.project = project;
        const v = WD.view;
        v.selRegionIds = new Set(); v.editRegionId = null;
        v.selTrackId = project.tracks.length ? project.tracks[0].id : null;
        WD.history.clear();
        dirty = false;
        bus.emit('project', { soft: false });
        if (WD.engine.ready) WD.engine.setMasterMode(project.master.mode);
        refreshTitle();
        // Speicher freigeben: nur die Puffer des offenen Projekts bleiben geladen
        WD.audioStore.clearMemory(WD.fileFormat.collectBufferIds(project));
    }

    function autosaveRecord() {
        const p = WD.project;
        return { id: p.id, name: p.name, savedAt: Date.now(), json: JSON.stringify(p) };
    }

    const autosave = WD.debounce(async () => {
        if (!dirty) return;
        try {
            await flushBuffers();
            await WD.db.put('autosave', autosaveRecord());
            savedAt = Date.now();
            lastError = null;
            setState('Automatisch gesichert ' + timeStr(savedAt));
        } catch (err) { reportError('Das automatische Sichern', err); }
    }, AUTOSAVE_MS);

    bus.on('dirty', () => {
        if (!dirty) { dirty = true; refreshTitle(); }
        autosave();
    });

    async function pushBackup(project, reason) {
        await WD.db.put('backups', {
            projectId: project.id, name: project.name, savedAt: Date.now(), reason,
            json: JSON.stringify(project),
        });
        const list = await WD.db.byIndex('backups', 'projectId', project.id);
        if (list.length > BACKUPS_PER_PROJECT) {
            list.sort((a, b) => a.savedAt - b.savedAt);
            for (const old of list.slice(0, list.length - BACKUPS_PER_PROJECT)) await WD.db.delete('backups', old.key);
        }
    }

    const S = WD.storage = {
        get dirty() { return dirty; },
        get lastError() { return lastError; },
        refreshTitle,
        activate,

        async save() {
            const p = WD.project;
            try {
                await flushBuffers();
                await pushBackup(p, 'Speichern');
                await WD.db.put('projects', { id: p.id, name: p.name, updatedAt: Date.now(), json: JSON.stringify(p), tracks: p.tracks.length });
                await WD.db.delete('autosave', p.id);
                rememberLast(p.id);
                dirty = false;
                savedAt = Date.now();
                setState('Gespeichert ' + timeStr(savedAt));
                refreshTitle();
                return true;
            } catch (err) { reportError('Das Speichern', err); return false; }
        },
        async saveAs() {
            const nn = await WD.ui.prompt('Speichern unter', WD.project.name + ' Kopie', { ok: 'Speichern' });
            if (!nn) return false;
            const copy = JSON.parse(JSON.stringify(WD.project));
            copy.id = uid(); copy.name = nn;
            WD.project = copy;
            refreshTitle();
            return S.save();
        },
        async rename(nameArg) {
            const nn = nameArg || await WD.ui.prompt('Projekt umbenennen', WD.project.name);
            if (!nn) return;
            WD.history.run('Projekt umbenennen', () => { WD.project.name = nn; });
            refreshTitle();
        },

        // Vor dem Verlassen des Projekts: Rückfrage, wenn etwas ungesichert ist.
        async confirmLeave() {
            if (!dirty || !WD.project.tracks.length) return true;
            return new Promise(res => {
                WD.ui.modal((box, close) => {
                    box.append(
                        WD.el('h2', {}, `„${WD.project.name}“ speichern?`),
                        WD.el('p', {}, 'Das Projekt hat ungespeicherte Änderungen. Beim Verwerfen bleibt der letzte Stand als Sicherung erhalten.'),
                        WD.el('div', { class: 'modal-btns' },
                            WD.el('button', { class: 'left', onclick: () => { close(); res(false); } }, 'Abbrechen'),
                            WD.el('button', { onclick: async () => { close(); await pushBackup(WD.project, 'Verworfen').catch(() => { }); res(true); } }, 'Nicht speichern'),
                            WD.el('button', { class: 'primary', onclick: async () => { close(); res(await S.save()); } }, 'Speichern')));
                }, { onEscape: () => res(false) });
            });
        },

        async newProject() {
            if (!await S.confirmLeave()) return false;
            activate(WD.newProject());
            setState('');
            return true;
        },
        async openProject(id) {
            if (!await S.confirmLeave()) return false;
            const stop = WD.ui.busy('Projekt wird geladen …');
            try {
                const rec = await WD.db.get('projects', id);
                if (!rec) throw new Error('Das Projekt wurde nicht gefunden.');
                const project = WD.fileFormat.sanitize(JSON.parse(rec.json));
                const missing = await loadBuffers(project);
                activate(project);
                rememberLast(project.id);
                setState('Gespeichert ' + timeStr(rec.updatedAt));
                if (missing.length) WD.ui.toast(`${missing.length} Audio-Datei(en) dieses Projekts fehlen im Browser-Speicher.`, { type: 'error' });
                return true;
            } catch (err) {
                WD.ui.alert('Projekt konnte nicht geöffnet werden', err.message);
                return false;
            } finally { stop(); }
        },
        async restoreBackup(rec) {
            if (!await S.confirmLeave()) return false;
            const project = WD.fileFormat.sanitize(JSON.parse(rec.json));
            await loadBuffers(project);
            activate(project);
            dirty = true; refreshTitle();
            WD.ui.toast('Sicherung geladen. Speichern übernimmt sie als aktuellen Stand.', { type: 'ok' });
            return true;
        },
        async deleteProject(id) {
            const rec = await WD.db.get('projects', id);
            if (rec) await pushBackup(JSON.parse(rec.json), 'Vor dem Löschen').catch(() => { });
            await WD.db.delete('projects', id);
            await WD.db.delete('autosave', id);
        },
        listProjects: async () => (await WD.db.all('projects')).sort((a, b) => b.updatedAt - a.updatedAt),
        listBackups: async () => (await WD.db.all('backups')).sort((a, b) => b.savedAt - a.savedAt),

        // Puffer, auf die weder Projekt noch Sicherung verweist, können entfernt werden
        async unreferencedBuffers() {
            const used = new Set(WD.fileFormat.collectBufferIds(WD.project));
            const stores = [...await WD.db.all('projects'), ...await WD.db.all('backups'), ...await WD.db.all('autosave')];
            stores.forEach(rec => {
                try { WD.fileFormat.collectBufferIds(JSON.parse(rec.json)).forEach(i => used.add(i)); } catch { /* defekter Eintrag */ }
            });
            return (await WD.db.allKeys('buffers')).filter(k => !used.has(k));
        },
        async purgeBuffers(ids) { for (const id of ids) await WD.db.delete('buffers', id); },

        // ----- Datei-Export und -Import -----
        exportFile() {
            const name = WD.exporter.safeName(WD.project.name) + '.webdaw';
            WD.exporter.download(WD.fileFormat.write(WD.project), name);
            WD.ui.toast('Projektdatei exportiert: ' + name, { type: 'ok' });
        },
        // Eingelesene Datei wird als neues Projekt geöffnet, ein vorhandenes wird nie überschrieben
        async importFile(file) {
            let data;
            const stop = WD.ui.busy('Projektdatei wird gelesen …');
            try { data = await WD.fileFormat.read(file); }
            catch (err) {
                const msg = err instanceof WD.fileFormat.ProjectFileError ? err.message : 'Die Datei konnte nicht gelesen werden: ' + err.message;
                WD.ui.alert('Projekt nicht geöffnet', msg + ' Dein aktuelles Projekt ist unverändert.');
                return false;
            } finally { stop(); }
            if (!await S.confirmLeave()) return false;
            const { project, buffers } = data;
            if (await WD.db.get('projects', project.id).catch(() => null)) project.id = uid();
            if (!project.name || project.name === 'Neues Projekt' || project.name === 'Importiertes Projekt') {
                project.name = file.name.replace(/(\.webdaw)?(\.json)?$/i, '') || 'Importiertes Projekt';
            }
            buffers.forEach((buf, id) => {
                WD.audioStore.adopt(id, buf);
                pendingBuffers.set(id, true);
            });
            activate(project);
            dirty = true; refreshTitle();
            flushBuffers().then(() => S.save()).catch(err => reportError('Das Sichern des Imports', err));
            return true;
        },

        // ----- Sicherung laufender Aufnahmen -----
        recBegin(s) {
            WD.db.put('meta', {
                id: 'rec:' + s.id, session: s.id, sr: s.sr, startBar: s.startBar, startT: s.startT, comp: s.comp,
                projectId: WD.project.id, projectName: WD.project.name, startedAt: Date.now(),
                tracks: s.tracks.map(t => ({ id: t.id, name: t.name, inputCh: t.inputCh })),
            }).catch(err => reportError('Das Sichern der Aufnahme', err));
        },
        recChunk(s, chunk) {
            WD.db.put('recchunks', { session: s.id, frame: chunk.frame, channels: chunk.channels })
                .catch(err => { if (!s.recErr) { s.recErr = true; reportError('Das laufende Sichern der Aufnahme', err); } });
        },
        recDone(s) {
            WD.db.delete('meta', 'rec:' + s.id).catch(() => { });
            WD.db.deleteByIndex('recchunks', 'session', s.id).catch(() => { });
        },

        // ----- Start: Wiederherstellung -----
        async startup() {
            try { await WD.db.open(); }
            catch (err) {
                setState('Kein Speicher', true);
                WD.ui.alert('Speichern im Browser nicht möglich', err.message + ' Exportiere deine Arbeit regelmäßig als Datei.');
                return;
            }
            if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
            await importLegacyAutosave();
            await recoverRecordings();
            await reopenLast();
        },
        selfTest: { pendingCount: () => pendingBuffers.size },
    };

    // Autosave der alten Version aus localStorage wird einmalig als eigenes Projekt übernommen, nichts wird gelöscht.
    async function importLegacyAutosave() {
        let raw = null;
        try { raw = localStorage.getItem('webdaw_autosave'); } catch { return; }
        if (!raw) return;
        if (await WD.db.get('meta', 'legacyImported')) return;
        try {
            const { project, buffers } = WD.fileFormat.fromLegacy(JSON.parse(raw));
            project.name = 'Autosave der alten Version';
            for (const [id, buf] of buffers) { WD.audioStore.adopt(id, buf); await WD.db.put('buffers', bufferRecord(id, buf)); }
            await WD.db.put('projects', { id: project.id, name: project.name, updatedAt: Date.now(), json: JSON.stringify(project), tracks: project.tracks.length });
            await WD.db.put('meta', { id: 'legacyImported', at: Date.now() });
            WD.ui.toast('Das Autosave der alten Version wurde als Projekt übernommen (Ablage → Projekte).', { ms: 6000 });
        } catch (err) {
            console.warn('Altes Autosave nicht lesbar:', err);
            await WD.db.put('meta', { id: 'legacyImported', at: Date.now(), failed: true });
        }
    }

    // Beim Start weiterarbeiten, wo man aufgehört hat: zuerst ungespeicherte Änderungen, sonst das zuletzt benutzte Projekt.
    // Weitere ungespeicherte Stände anderer Projekte wandern in die Sicherungen.
    async function reopenLast() {
        const list = (await WD.db.all('autosave')).sort((a, b) => b.savedAt - a.savedAt);
        if (list.length) {
            const rec = list[0];
            try {
                const project = WD.fileFormat.sanitize(JSON.parse(rec.json));
                const missing = await loadBuffers(project);
                activate(project);
                dirty = true; refreshTitle();
                setState('Wiederhergestellt');
                rememberLast(project.id);
                WD.ui.toast(missing.length ? `${missing.length} Audio-Datei(en) fehlen.` : `„${rec.name}“ ist wieder da, samt der noch nicht gespeicherten Änderungen.`, { type: missing.length ? 'error' : 'ok', ms: 5000 });
            } catch (err) {
                // Der Stand bleibt im Speicher, nichts geht verloren
                WD.ui.alert('Letzte Sitzung konnte nicht geöffnet werden', err.message + ' Der Stand bleibt unter Ablage → Sicherungen erhalten.');
                await WD.db.put('backups', { projectId: rec.id, name: rec.name, savedAt: rec.savedAt, reason: 'Autosave', json: rec.json });
                await WD.db.delete('autosave', rec.id);
            }
            for (const other of list.slice(1)) {
                await WD.db.put('backups', { projectId: other.id, name: other.name, savedAt: other.savedAt, reason: 'Autosave', json: other.json });
                await WD.db.delete('autosave', other.id);
            }
            return;
        }
        const last = await WD.db.get('meta', 'lastProject').catch(() => null);
        const projects = await S.listProjects();
        const target = (last && projects.find(p => p.id === last.projectId)) || projects[0];
        if (target) await S.openProject(target.id);
    }
    function rememberLast(projectId) {
        WD.db.put('meta', { id: 'lastProject', projectId }).catch(() => { });
    }

    // Aufnahmen, die durch Absturz oder Schließen des Tabs nicht abgeschlossen wurden
    async function recoverRecordings() {
        const metas = (await WD.db.all('meta')).filter(m => String(m.id).startsWith('rec:'));
        for (const m of metas) {
            const chunks = (await WD.db.byIndex('recchunks', 'session', m.session)).sort((a, b) => a.frame - b.frame);
            if (!chunks.length) { await WD.db.delete('meta', m.id); continue; }
            const first = chunks[0].frame, last = chunks[chunks.length - 1];
            const len = last.frame + last.channels[0].length - first;
            const nCh = chunks[0].channels.length;
            const buf = new AudioBuffer({ length: len, numberOfChannels: Math.min(2, nCh), sampleRate: m.sr });
            for (let c = 0; c < buf.numberOfChannels; c++) {
                const d = buf.getChannelData(c);
                chunks.forEach(k => d.set(k.channels[c] || k.channels[0], k.frame - first));
            }
            const id = 'b' + uid();
            await WD.db.put('buffers', bufferRecord(id, buf));
            WD.audioStore.adopt(id, buf);
            const project = WD.newProject(`Gerettete Aufnahme (${m.projectName})`);
            project.tracks.push(WD.model.normalizeTrack({
                type: 'audio', name: 'Gerettet',
                regions: [WD.model.normalizeRegion({ startBar: 0, lengthBars: buf.duration / (240 / project.bpm), bufId: id, name: 'Gerettete Aufnahme', notes: [] })],
            }));
            await WD.db.put('projects', { id: project.id, name: project.name, updatedAt: Date.now(), json: JSON.stringify(project), tracks: 1 });
            await WD.db.delete('meta', m.id);
            await WD.db.deleteByIndex('recchunks', 'session', m.session);
            WD.ui.toast(`Eine unterbrochene Aufnahme (${buf.duration.toFixed(0)} s) wurde gerettet: Ablage → Projekte.`, { type: 'ok', ms: 10000 });
        }
    }

    addEventListener('beforeunload', () => {
        if (dirty) WD.db.put('autosave', autosaveRecord()).catch(() => { });
    });
})();
