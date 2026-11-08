// Bibliothek rechts: passt sich der gewählten Spur an (Instrumente, Kits, Klang-Presets, Loops).
'use strict';
(() => {
    const { $, el, bus } = WD;
    const head = $('libHead'), list = $('libList');
    const { INSTR, KITS } = WD.instruments;
    let tab = 'sounds', query = '';

    function auditionInstrument(track) { WD.instruments.preview(track, track.type === 'drum' ? 0 : 60, .6); }
    function setSound(t, key, value) {
        WD.history.run('Sound wechseln', () => {
            t[key] = value;
            // Eigene Spurnamen bleiben erhalten
            if (!t.customName) t.name = WD.instruments.label(value);
        });
        bus.emit('tracks');
        render();
        auditionInstrument(t);
    }

    function addLoopRegion(t, lp, bar) {
        const start = bar !== undefined ? bar : Math.floor(WD.transport.current() / WD.model.barLen()) * WD.model.barLen();
        WD.history.run('Loop einfügen', () => t.regions.push(WD.model.normalizeRegion({
            startBar: start, lengthBars: lp.len, loopLen: lp.len,
            notes: JSON.parse(JSON.stringify(lp.notes)), name: lp.name,
        })));
        bus.emit('regions');
    }

    function item(label, iconName, on, fn, extra) {
        return el('div', Object.assign({ class: 'libitem' + (on ? ' on' : ''), onclick: fn, 'data-tip': extra && extra.tip }, extra && extra.attrs), iconName ? WD.icons.icon(iconName) : null,
            el('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, label));
    }
    const matches = s => !query || s.toLowerCase().includes(query);
    const L = WD.instruments.label;

    function renderSounds(t) {
        const secs = [];
        if (t.type === 'drum') {
            secs.push(['Drum-Kits', Object.keys(KITS).filter(nm => matches(L(nm))).map(nm => item(L(nm), 'drums', t.kit === nm, () => setSound(t, 'kit', nm)))]);
        } else if (t.type === 'inst') {
            const cats = [];
            Object.keys(INSTR).forEach(nm => { const c = INSTR[nm].cat || 'Sonstige'; if (!cats.includes(c)) cats.push(c); });
            cats.forEach(c => {
                const names = Object.keys(INSTR).filter(nm => (INSTR[nm].cat || 'Sonstige') === c && matches(L(nm)));
                if (names.length) secs.push([c, names.map(nm => item(L(nm), INSTR[nm].iconName || WD.icons.CAT_ICON[c] || 'keys', t.inst === nm, () => setSound(t, 'inst', nm)))]);
            });
        }
        WD.patches.groupsFor(t).forEach(group => {
            const names = Object.keys(WD.patches.PATCHES[group]).filter(nm => matches(WD.patches.label(nm)));
            if (names.length) secs.push(['Klang: ' + group, names.map(nm => item(WD.patches.label(nm), 'knob', t.patch === nm, () => { WD.patches.apply(t, nm); render(); }))]);
        });
        secs.forEach(([title, items]) => { list.append(el('div', { class: 'libsec' }, title), ...items); });
        if (!secs.length) list.append(el('div', { class: 'libitem empty' }, 'Nichts gefunden.'));
    }

    function renderLoops(t) {
        if (t.type === 'audio') {
            list.append(el('div', { class: 'libitem empty' }, 'Loops sind Noten-Pattern und passen auf Instrument- und Drum-Spuren. Für Audio-Spuren: aufnehmen oder eine Datei auf die Spur ziehen.'));
            return;
        }
        const loops = WD.LOOPS.filter(lp => lp.type === t.type && matches(lp.name));
        if (!loops.length) { list.append(el('div', { class: 'libitem empty' }, 'Nichts gefunden.')); return; }
        loops.forEach(lp => {
            const node = item(lp.name, 'loop', false, () => addLoopRegion(t, lp), { tip: 'Klick: am Playhead einfügen. Oder auf eine Spur ziehen.', attrs: { draggable: true } });
            node.addEventListener('dragstart', e => {
                e.dataTransfer.setData('application/x-webdaw-loop', lp.name);
                e.dataTransfer.effectAllowed = 'copy';
            });
            list.append(node);
        });
    }

    let shownKey = null;
    function render() {
        const v = WD.view;
        const cur = WD.model.selTrack();
        shownKey = cur ? cur.id + '|' + cur.type + '|' + (cur.inst || cur.kit || '') + '|' + (cur.patch || '') : '';
        $('library').classList.toggle('closed', !v.libraryOpen);
        const lb = $('btnLibrary');
        if (lb) lb.classList.toggle('on', v.libraryOpen);
        if (!v.libraryOpen) return;
        const t = WD.model.selTrack();
        head.textContent = '';
        list.textContent = '';
        if (!t) {
            head.append(el('div', { class: 'lib-title' }, 'BIBLIOTHEK'));
            list.append(el('div', { class: 'libitem empty' }, 'Wähle eine Spur aus, um ihren Klang zu ändern.'));
            return;
        }
        const search = el('input', {
            type: 'search', id: 'libSearch', placeholder: 'Suchen …', value: query, 'aria-label': 'Bibliothek durchsuchen',
            oninput: e => { query = e.target.value.toLowerCase(); renderList(); },
        });
        head.append(
            el('div', { class: 'lib-sub' }, t.name),
            el('div', { class: 'lib-tabs' },
                el('button', { class: tab === 'sounds' ? 'on' : '', onclick: () => { tab = 'sounds'; render(); } }, 'Klänge'),
                el('button', { class: tab === 'loops' ? 'on' : '', onclick: () => { tab = 'loops'; render(); } }, 'Loops')),
            search);
        renderList();
    }
    function renderList() {
        list.textContent = '';
        const t = WD.model.selTrack();
        if (!t) return;
        if (tab === 'sounds') renderSounds(t); else renderLoops(t);
    }

    WD.libraryPanel = { render, addLoopRegion, toggle() { WD.view.libraryOpen = !WD.view.libraryOpen; render(); WD.timeline.requestDraw(); } };

    // Bei schmalem Fenster würde die Bibliothek die Spuren verdecken: dort anfangs und beim Verkleinern schließen
    const NARROW = 1000;
    if (innerWidth < NARROW) WD.view.libraryOpen = false;
    let wasNarrow = innerWidth < NARROW;
    addEventListener('resize', () => {
        const narrow = innerWidth < NARROW;
        if (narrow && !wasNarrow && WD.view.libraryOpen) { WD.view.libraryOpen = false; render(); }
        wasNarrow = narrow;
    });
    bus.on('track:selected', render);
    // Bei gleicher Spur nur den Namen nachführen; eine neue oder andere Spur braucht die passende Liste
    bus.on('tracks', () => {
        const t = WD.model.selTrack();
        const key = t ? t.id + '|' + t.type + '|' + (t.inst || t.kit || '') + '|' + (t.patch || '') : '';
        const sub = head.querySelector('.lib-sub');
        if (key !== shownKey || !sub) { render(); return; }
        sub.textContent = t.name;
    });
    bus.on('project', render);

    // Loop per Drag & Drop auf eine Spur
    const rows = $('trackRows');
    rows.addEventListener('dragover', e => {
        if (!e.dataTransfer.types.includes('application/x-webdaw-loop')) return;
        const lane = e.target.closest('.tlane');
        const t = lane && WD.model.track(lane.dataset.id);
        const lp = t && WD.LOOPS.find(x => x.type === t.type);
        if (!lp) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        document.querySelectorAll('.tlane.drop-ok').forEach(n => n.classList.remove('drop-ok'));
        lane.classList.add('drop-ok');
    });
    rows.addEventListener('dragleave', e => { const l = e.target.closest('.tlane'); if (l) l.classList.remove('drop-ok'); });
    rows.addEventListener('drop', e => {
        const name = e.dataTransfer.getData('application/x-webdaw-loop');
        document.querySelectorAll('.tlane.drop-ok').forEach(n => n.classList.remove('drop-ok'));
        if (!name) return;
        e.preventDefault(); e.stopPropagation();
        const lane = e.target.closest('.tlane');
        if (!lane) return;
        const t = WD.model.track(lane.dataset.id);
        const lp = WD.LOOPS.find(x => x.name === name);
        if (!lp || lp.type !== t.type) { WD.ui.toast('Dieser Loop passt nicht auf diesen Spurtyp.'); return; }
        const r = lane.getBoundingClientRect();
        const barL = WD.model.barLen();
        addLoopRegion(t, lp, Math.max(0, Math.round((e.clientX - r.left) / WD.view.ppb / barL) * barL));
    });
})();
