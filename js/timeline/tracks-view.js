// Spurköpfe und Spurzeilen. Köpfe haben eine feste Breite, damit Lineal und Regionen deckungsgleich bleiben.
'use strict';
(() => {
    const { $, el, bus } = WD;
    const M = WD.model;
    const host = $('trackRows');
    const meterEls = new Map();
    const headCtrls = new Map();

    const hist = (label, fn) => WD.history.run(label, fn);

    function miniBtn(cls, label, on, tip, fn, iconName) {
        const b = el('button', {
            class: 'tbtn-s ' + cls + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', 'data-tip': tip,
            onclick: e => { e.stopPropagation(); fn(); },
        }, iconName ? WD.icons.icon(iconName) : label);
        return b;
    }

    async function renameTrack(t) {
        const nn = await WD.ui.prompt('Spur umbenennen', t.name);
        if (nn) { hist('Umbenennen', () => { t.name = nn; t.customName = true; }); bus.emit('tracks'); }
    }
    async function deleteTrack(t) {
        const hasContent = t.regions.length > 0;
        const ok = !hasContent || await WD.ui.confirm(`Spur „${t.name}“ löschen?`,
            `Die Spur enthält ${t.regions.length} Region(en). Mit Strg+Z lässt sich das rückgängig machen.`,
            { ok: 'Löschen', danger: true });
        if (ok) hist('Spur löschen', () => M.removeTrack(t.id));
    }

    function trackMenu(t, x, y) {
        const idx = WD.project.tracks.indexOf(t);
        const armable = t.type === 'audio';
        WD.ui.menu(x, y, [
            { label: 'Umbenennen …', action: () => renameTrack(t) },
            { label: 'Duplizieren (mit Regionen)', icon: 'copy', action: () => hist('Spur duplizieren', () => M.duplicateTrack(t.id)) },
            {
                label: t.type === 'audio' ? 'Doppeln: neue Spur zum Einspielen' : 'Doppeln: neue leere Spur', icon: 'plus',
                action: () => WD.patches.doubleTrack(t),
            },
            { sep: 1 },
            { label: 'Nach oben', disabled: idx === 0, action: () => hist('Spur verschieben', () => M.moveTrack(t.id, idx - 1)) },
            { label: 'Nach unten', disabled: idx === WD.project.tracks.length - 1, action: () => hist('Spur verschieben', () => M.moveTrack(t.id, idx + 1)) },
            { sep: 1 },
            { colors: WD.PALETTE, action: c => { hist('Spurfarbe', () => { t.color = c; }); bus.emit('tracks'); bus.emit('regions'); } },
            { sep: 1 },
            armable && { label: 'Audio-Eingang …', icon: 'mic', action: () => WD.projectDialogs.inputSettings() },
            { label: 'Smart Controls öffnen', icon: 'knob', action: () => { WD.view.selTrackId = t.id; WD.bottom.show('smart'); bus.emit('track:selected'); } },
            { label: t.showAuto ? 'Automation ausblenden' : 'Automation einblenden', icon: 'auto', action: () => { t.showAuto = !t.showAuto; bus.emit('tracks'); } },
            ...Object.entries(M.AUTO).map(([key, a]) => ({ label: 'Automation: ' + a.label, checked: !!t.showAuto && t.autoParam === key, action: () => { t.autoParam = key; t.showAuto = true; bus.emit('tracks'); } })),
            { sep: 1 },
            { label: 'Diese Spur exportieren …', icon: 'file', disabled: !t.regions.length, action: () => WD.exporter.trackDialog(t) },
            { sep: 1 },
            { label: 'Spur löschen', icon: 'trash', danger: true, action: () => deleteTrack(t) },
        ]);
    }

    function dragReorder(e, t) {
        const y0 = e.clientY;
        let active = false, dropIdx = null;
        const list = () => [...host.querySelectorAll('.trow')];
        const clear = () => list().forEach(r => r.classList.remove('drag-over-top', 'drag-over-bot'));
        const move = ev => {
            if (!active && Math.abs(ev.clientY - y0) < 5) return;
            active = true;
            clear();
            const rows = list();
            dropIdx = rows.length;
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i].getBoundingClientRect();
                if (ev.clientY < r.top + r.height / 2) { dropIdx = i; break; }
            }
            if (dropIdx < rows.length) rows[dropIdx].classList.add('drag-over-top');
            else rows[rows.length - 1].classList.add('drag-over-bot');
        };
        const up = () => {
            removeEventListener('pointermove', move); removeEventListener('pointerup', up);
            clear();
            if (active && dropIdx !== null) {
                const from = WD.project.tracks.indexOf(t);
                const to = dropIdx > from ? dropIdx - 1 : dropIdx;
                if (to !== from) hist('Spur verschieben', () => M.moveTrack(t.id, to));
            }
        };
        addEventListener('pointermove', move); addEventListener('pointerup', up);
    }

    function autoSelect(t) {
        const s = el('select', { class: 'tauto', 'aria-label': 'Automations-Parameter', 'data-tip': 'Welcher Parameter wird automatisiert?' },
            Object.entries(M.AUTO).map(([key, a]) => new Option(a.short, key, false, (t.autoParam || 'vol') === key)));
        s.onchange = () => { t.autoParam = s.value; bus.emit('tracks'); };
        return s;
    }

    function buildHead(t) {
        const sel = WD.view.selTrackId === t.id;
        const tile = el('div', { class: 'ttile', style: { background: t.color }, 'data-tip': 'Ziehen: Spur verschieben' }, WD.icons.icon(WD.icons.trackIcon(t)));
        tile.addEventListener('pointerdown', e => { if (e.button === 0) dragReorder(e, t); });

        const nameEl = el('div', { class: 'tname', ondblclick: e => { e.stopPropagation(); renameTrack(t); } }, t.name);
        const more = el('button', {
            class: 'tmore', 'aria-label': 'Spur-Optionen', 'data-tip': 'Spur-Optionen',
            onclick: e => { e.stopPropagation(); const r = more.getBoundingClientRect(); trackMenu(t, r.left, r.bottom + 2); },
        }, WD.icons.icon('more'));

        const buttons = el('div', { class: 'tline' });
        buttons.append(
            miniBtn('m', 'M', t.mute, 'Stumm (M)', () => { hist('Mute', () => { t.mute = !t.mute; }); bus.emit('mix'); bus.emit('tracks'); }),
            miniBtn('s', 'S', t.solo, 'Solo (Umschalt+S)', () => { hist('Solo', () => { t.solo = !t.solo; }); bus.emit('mix'); bus.emit('tracks'); }),
            miniBtn('r', '', t.arm, t.type === 'audio' ? 'Aufnahmebereit' : 'Aufnahmebereit (Tastatur)', () => {
                t.arm = !t.arm;
                bus.emit('tracks');
                bus.emit('dirty');
                WD.input.refresh();
            }, 'record'),
        );
        if (t.type === 'audio') {
            buttons.append(miniBtn('i', '', t.monitor, 'Monitoring: Eingang hören', () => WD.input.toggleMonitor(t), 'monitor'));
        }
        buttons.append(miniBtn('a', '', t.showAuto, 'Automation: Lautstärke, Panorama, Hall, Filter', () => { t.showAuto = !t.showAuto; bus.emit('tracks'); }, 'auto'));

        const pan = WD.controls.knob({
            size: 'sm', min: -1, max: 1, def: 0, label: 'Panorama', historyLabel: 'Panorama',
            get: () => t.pan || 0, set: v => { t.pan = Math.abs(v) < .02 ? 0 : v; },
        });
        pan.classList.add('tpan');

        const vol = WD.controls.slider({
            min: 0, max: 100, def: 80, label: 'Lautstärke', cls: 'slider tvol',
            get: () => Math.round(t.vol * 100), set: v => { t.vol = v / 100; },
        });
        const meter = el('div', { class: 'tmeter' }, el('div'));
        meterEls.set(t.id, meter);
        headCtrls.set(t.id, [vol, pan]);

        const meta = el('div', { class: 'tmeta' },
            el('div', { class: 'tline' }, nameEl, more),
            el('div', { class: 'tline' }, buttons, el('div', { style: { flex: 1 } }), pan),
            el('div', { class: 'tline tvolline' }, t.showAuto ? autoSelect(t) : null, vol),
            meter);

        const head = el('div', {
            class: 'thead' + (sel ? ' sel' : ''), dataset: { id: t.id },
            oncontextmenu: e => { e.preventDefault(); WD.regionInput.selectTrack(t.id); trackMenu(t, e.clientX, e.clientY); },
        }, el('div', { class: 'tstripe', style: { background: t.color } }), tile, meta);
        head.addEventListener('pointerdown', () => {
            WD.view.focus = 'timeline';
            WD.regionInput.selectTrack(t.id);
        });
        return head;
    }

    function render() {
        const p = WD.project, v = WD.view;
        const lanesById = new Map([...host.querySelectorAll('.tlane')].map(l => [l.dataset.id, l]));
        meterEls.clear();
        headCtrls.clear();
        const frag = document.createDocumentFragment();
        const w = WD.timeline.laneWidth();
        p.tracks.forEach(t => {
            const row = el('div', { class: 'trow' + (v.rowH < 64 ? ' compact' : ''), style: { height: v.rowH + 'px' } });
            let lane = lanesById.get(t.id);
            if (!lane) lane = el('div', { class: 'tlane', dataset: { id: t.id } });
            lane.style.width = w + 'px';
            lane.className = 'tlane' + (v.selTrackId === t.id ? ' sel' : '') + (t.arm ? ' rec-armed' : '');
            lane.querySelectorAll('.autoCv').forEach(c => c.remove());
            if (t.showAuto) {
                const cv = WD.automation.create(t, w, v.rowH - 1);
                Object.assign(cv.style, { bottom: 'auto', height: v.rowH - 1 + 'px' });
                lane.append(cv);
            }
            row.append(buildHead(t), lane);
            frag.append(row);
        });
        host.replaceChildren(frag);
        WD.lanes.renderAll();
        renderEmptyHint();
    }

    function renderEmptyHint() {
        const hint = $('emptyHint');
        hint.textContent = '';
        hint.style.display = WD.project.tracks.length ? 'none' : 'block';
        if (WD.project.tracks.length) return;
        hint.append(
            el('b', {}, 'Noch keine Spuren. '), 'Starte mit einer Aufnahme, einem Instrument oder einer Song-Vorlage. Audiodateien kannst du einfach hierher ziehen.',
            el('div', { class: 'hint-actions' },
                el('button', { onclick: () => WD.tracksView.addTrack('audio') }, 'Audio-Spur'),
                el('button', { onclick: () => WD.tracksView.addTrack('inst') }, 'Instrument'),
                el('button', { onclick: () => WD.tracksView.addTrack('drum') }, 'Drums'),
                el('button', { class: 'primary', onclick: () => WD.templates.showDialog() }, 'Song-Vorlage …')));
    }

    function updateSelection() {
        document.querySelectorAll('.thead').forEach(h => h.classList.toggle('sel', h.dataset.id === WD.view.selTrackId));
        document.querySelectorAll('.tlane').forEach(l => l.classList.toggle('sel', l.dataset.id === WD.view.selTrackId));
    }

    bus.on('frame', () => {
        meterEls.forEach((node, id) => {
            const lvl = WD.meters.level(id);
            node.firstChild.style.transform = `scaleX(${WD.meters.scaleDb(lvl)})`;
            node.classList.toggle('hot', lvl >= 0.99);
        });
    });
    bus.on('mix', () => headCtrls.forEach(list => list.forEach(c => { if (document.activeElement !== c) c.refresh(); })));
    bus.on('tracks', render);
    bus.on('project', render);
    bus.on('track:selected', updateSelection);

    // Kopf-Ecke: neue Spur
    function addTrackMenu(x, y) {
        WD.ui.menu(x, y, [
            { label: 'Audio-Spur (Mikrofon, Gitarre)', icon: 'mic', action: () => WD.tracksView.addTrack('audio') },
            { label: 'Instrument', icon: 'keys', action: () => WD.tracksView.addTrack('inst') },
            { label: 'Drums', icon: 'drums', action: () => WD.tracksView.addTrack('drum') },
            { sep: 1 },
            { label: 'Audiodatei importieren …', icon: 'file', action: () => $('fileAudio').click() },
        ]);
    }

    WD.tracksView = {
        render, addTrackMenu,
        addTrack(type) {
            const n = WD.project.tracks.filter(t => t.type === type).length + 1;
            const extra = type === 'drum' ? { kit: 'Brit Pop' } : type === 'inst' ? { inst: 'Clean Guitar' } : {};
            const L = WD.instruments.label;
            const name = type === 'drum' ? L('Brit Pop') : type === 'inst' ? L('Clean Guitar') : 'Audio ' + n;
            return hist('Spur hinzufügen', () => M.addTrack(type, name, extra));
        },
        renameTrack, deleteTrack,
    };

    const corner = $('headCorner');
    corner.append(
        el('button', {
            'aria-label': 'Spur hinzufügen', 'data-tip': 'Spur hinzufügen',
            onclick: e => { const r = e.currentTarget.getBoundingClientRect(); addTrackMenu(r.left, r.bottom + 2); },
        }, WD.icons.icon('plus')),
        el('span', { class: 'label' }, 'Spuren'),
        el('span', { class: 'spacer' }),
        el('button', { 'aria-label': 'Verkleinern', 'data-tip': 'Rauszoomen (−)', onclick: () => WD.timeline.zoomBy(0.8) }, WD.icons.icon('zoomOut')),
        el('button', { 'aria-label': 'Vergrößern', 'data-tip': 'Reinzoomen (+)', onclick: () => WD.timeline.zoomBy(1.25) }, WD.icons.icon('zoomIn')),
    );
})();
