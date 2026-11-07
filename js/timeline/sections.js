// Songabschnitte (Arrangement-Spur). Ziehen verschiebt den Abschnitt samt Inhalt und schiebt den Rest nach;
// mit gedrückter Umschalt-Taste bewegt sich nur die Markierung.
'use strict';
(() => {
    const { $, el, bus, uid } = WD;
    const M = WD.model;
    const lane = $('arrLane');
    const COLORS = {
        intro: '#6a7fa8', verse: '#4f8a78', pre: '#a08648', chorus: '#b65a68', bridge: '#8a68b0', outro: '#6a7fa8', solo: '#c0763a',
    };
    const colorOf = m => {
        if (m.color) return m.color;
        const n = m.name.toLowerCase();
        if (n.startsWith('pre')) return COLORS.pre;
        for (const k of Object.keys(COLORS)) if (n.includes(k)) return COLORS[k];
        if (n.includes('refrain')) return COLORS.chorus;
        if (n.includes('strophe')) return COLORS.verse;
        return '#7b7f88';
    };
    const SECTION_NAMES = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Solo', 'Outro'];

    // Alle Regionen an einer Position teilen
    function splitAll(bar) {
        WD.project.tracks.forEach(t => {
            [...t.regions].forEach(r => {
                if (bar > r.startBar + 1e-6 && bar < r.startBar + r.lengthBars - 1e-6) WD.regionOps.splitAt(t, r, bar);
            });
        });
    }
    // Wendet eine Positions-Abbildung auf Regionen, Automation und andere Abschnitte an
    function remap(fn, { skipMarker } = {}) {
        WD.project.tracks.forEach(t => {
            t.regions.forEach(r => { r.startBar = fn(r.startBar); });
            (t.auto || []).forEach(p => { p.bar = fn(p.bar); });
        });
        WD.project.markers.forEach(m => { if (m !== skipMarker) m.startBar = fn(m.startBar); });
    }

    const S = WD.sections = {
        // Abschnitt mit Inhalt an Einfügepunkt x verschieben
        moveWithContent(m, x) {
            const A = m.startBar, B = A + m.lengthBars, L = m.lengthBars;
            if (x > A && x < B) return;
            if (x === A || x === B) return;
            WD.history.run('Abschnitt verschieben', () => {
                [A, B, x].forEach(splitAll);
                const map = x >= B
                    ? p => (p >= A - 1e-6 && p < B - 1e-6) ? p + (x - B) : (p >= B - 1e-6 && p < x - 1e-6) ? p - L : p
                    : p => (p >= A - 1e-6 && p < B - 1e-6) ? p - (A - x) : (p >= x - 1e-6 && p < A - 1e-6) ? p + L : p;
                remap(map);
                WD.project.markers.sort((a, b) => a.startBar - b.startBar);
            });
            S.changed();
        },
        duplicateWithContent(m) {
            const A = m.startBar, B = A + m.lengthBars, L = m.lengthBars;
            WD.history.run('Abschnitt duplizieren', () => {
                [A, B].forEach(splitAll);
                const copies = [];
                WD.project.tracks.forEach(t => t.regions.forEach(r => {
                    if (r.startBar >= A - 1e-6 && r.startBar < B - 1e-6) {
                        copies.push([t, Object.assign(JSON.parse(JSON.stringify(r)), { id: uid(), startBar: r.startBar + L })]);
                    }
                }));
                const newM = { name: m.name, startBar: B, lengthBars: L, color: m.color };
                remap(p => p >= B - 1e-6 ? p + L : p);
                copies.forEach(([t, r]) => t.regions.push(r));
                WD.project.markers.push(newM);
                WD.project.markers.sort((a, b) => a.startBar - b.startBar);
            });
            S.changed();
        },
        deleteWithContent(m) {
            const A = m.startBar, B = A + m.lengthBars, L = m.lengthBars;
            WD.history.run('Abschnitt löschen', () => {
                [A, B].forEach(splitAll);
                WD.project.tracks.forEach(t => {
                    t.regions = t.regions.filter(r => !(r.startBar >= A - 1e-6 && r.startBar < B - 1e-6));
                    t.auto = (t.auto || []).filter(p => !(p.bar >= A && p.bar < B));
                });
                WD.project.markers = WD.project.markers.filter(x => x !== m);
                remap(p => p >= B - 1e-6 ? p - L : p);
            });
            S.changed();
        },
        changed() {
            render();
            bus.emit('markers');
            bus.emit('regions');
            bus.emit('audio:edited');
        },
        async add(name) {
            const label = name || await WD.ui.prompt('Name des Abschnitts', 'Verse');
            if (!label) return;
            const ms = WD.project.markers;
            const last = ms.reduce((e, m) => Math.max(e, m.startBar + m.lengthBars), 0);
            const barL = M.barLen();
            WD.history.run('Abschnitt hinzufügen', () => ms.push({ name: label, startBar: last, lengthBars: barL * (label === 'Intro' || label === 'Outro' ? 4 : 8) }));
            render(); bus.emit('markers');
        },
        addMenu(x, y) {
            WD.ui.menu(x, y, [
                ...SECTION_NAMES.map(n => ({ label: n, action: () => S.add(n) })),
                { sep: 1 },
                { label: 'Eigener Name …', action: () => S.add() },
                { label: 'Vorlage: Standard-Songform', action: applyForm },
            ]);
        },
        render: () => render(),
    };

    function applyForm() {
        WD.history.run('Songform', () => {
            const b = M.barLen();
            let pos = 0;
            WD.project.markers = [['Intro', 4], ['Verse 1', 8], ['Pre-Chorus', 4], ['Chorus', 8], ['Verse 2', 8], ['Pre-Chorus', 4], ['Chorus', 8], ['Bridge', 8], ['Chorus', 8], ['Outro', 4]].map(([name, bars]) => {
                const m = { name, startBar: pos, lengthBars: bars * b }; pos += bars * b; return m;
            });
        });
        render(); bus.emit('markers');
        bus.emit('regions');
    }

    function boundaries(except) {
        const pts = new Set([0]);
        WD.project.markers.forEach(m => {
            if (m === except) return;
            pts.add(m.startBar); pts.add(m.startBar + m.lengthBars);
        });
        return [...pts].sort((a, b) => a - b);
    }

    function startDrag(e, m, node) {
        e.preventDefault();
        const tx = WD.history.begin('Abschnitt');
        const sx = e.clientX, orig = m.startBar;
        const markerOnly = e.shiftKey;
        let moved = false, indicator = null, target = null;
        const onMove = ev => {
            const dx = ev.clientX - sx;
            if (!moved && Math.abs(dx) < 4) return;
            moved = true;
            if (markerOnly) {
                m.startBar = WD.timeline.snap(orig + dx / WD.view.ppb, ev);
                node.style.left = m.startBar * WD.view.ppb + 'px';
                return;
            }
            const pos = orig + dx / WD.view.ppb;
            const edges = boundaries(m).filter(p => p <= orig || p >= orig + m.lengthBars);
            target = edges.reduce((best, p) => Math.abs(p - pos) < Math.abs(best - pos) ? p : best, edges[0]);
            node.style.transform = `translateX(${dx}px)`;
            node.style.zIndex = 3; node.style.opacity = .85;
            if (!indicator) { indicator = el('div', { class: 'marker-drop' }); lane.append(indicator); }
            indicator.style.left = target * WD.view.ppb + 'px';
        };
        const onUp = () => {
            removeEventListener('pointermove', onMove);
            removeEventListener('pointerup', onUp);
            if (indicator) indicator.remove();
            node.style.transform = ''; node.style.zIndex = ''; node.style.opacity = '';
            if (!moved) { selectMarker(m); tx.end(); return; }
            if (markerOnly) { tx.end(); render(); bus.emit('markers'); return; }
            tx.end();
            if (target !== null) S.moveWithContent(m, target);
        };
        addEventListener('pointermove', onMove);
        addEventListener('pointerup', onUp);
    }

    function startResize(e, m, node) {
        e.preventDefault(); e.stopPropagation();
        const tx = WD.history.begin('Abschnittslänge');
        const sx = e.clientX, orig = m.lengthBars;
        const onMove = ev => {
            const end = WD.timeline.snap(m.startBar + orig + (ev.clientX - sx) / WD.view.ppb, ev);
            m.lengthBars = Math.max(M.beatLen(), end - m.startBar);
            node.style.width = m.lengthBars * WD.view.ppb - 1 + 'px';
        };
        const onUp = () => {
            removeEventListener('pointermove', onMove);
            removeEventListener('pointerup', onUp);
            tx.end(); bus.emit('markers');
        };
        addEventListener('pointermove', onMove);
        addEventListener('pointerup', onUp);
    }

    let selected = null;
    function selectMarker(m) {
        selected = m;
        lane.querySelectorAll('.marker').forEach(n => n.classList.toggle('sel', n._m === m));
    }

    async function renameMarker(m) {
        const nn = await WD.ui.prompt('Abschnitt umbenennen', m.name);
        if (nn) { WD.history.run('Abschnitt umbenennen', () => { m.name = nn; }); render(); }
    }

    function menuFor(m, x, y) {
        WD.ui.menu(x, y, [
            { label: 'Umbenennen …', action: () => renameMarker(m) },
            { colors: WD.PALETTE, action: c => { WD.history.run('Abschnittsfarbe', () => { m.color = c; }); render(); } },
            { sep: 1 },
            {
                label: 'Cycle auf diesen Abschnitt', icon: 'cycle', action: () => {
                    WD.history.run('Cycle-Bereich', () => {
                        WD.project.cycle.on = true;
                        WD.transport.setCycle(m.startBar, m.startBar + m.lengthBars);
                    });
                },
            },
            { label: 'Zum Anfang des Abschnitts springen', action: () => WD.transport.seek(m.startBar) },
            {
                label: 'Inhalt auswählen', action: () => {
                    const ids = [];
                    WD.project.tracks.forEach(t => t.regions.forEach(r => {
                        if (r.startBar >= m.startBar - 1e-6 && r.startBar < m.startBar + m.lengthBars - 1e-6) ids.push(r.id);
                    }));
                    WD.regionOps.selectOnly(ids);
                },
            },
            { sep: 1 },
            { label: 'Duplizieren (mit Inhalt)', icon: 'copy', action: () => S.duplicateWithContent(m) },
            { label: 'Nur Markierung löschen', action: () => { WD.history.run('Abschnitt löschen', () => { WD.project.markers = WD.project.markers.filter(x => x !== m); }); render(); bus.emit('markers'); } },
            {
                label: 'Löschen mit Inhalt', icon: 'trash', danger: true,
                action: async () => {
                    const ok = await WD.ui.confirm(`„${m.name}“ mit Inhalt löschen?`, 'Der Abschnitt und alle Regionen darin werden entfernt, der Rest rückt nach. Mit Strg+Z rückgängig.', { ok: 'Löschen', danger: true });
                    if (ok) S.deleteWithContent(m);
                },
            },
        ]);
    }

    function render() {
        const ppb = WD.view.ppb;
        lane.textContent = '';
        WD.project.markers.forEach(m => {
            const node = el('div', {
                class: 'marker' + (m === selected ? ' sel' : ''),
                style: { left: m.startBar * ppb + 'px', width: Math.max(4, m.lengthBars * ppb - 1) + 'px', '--mk': colorOf(m) },
                'data-tip': `${m.name} – ziehen verschiebt den Inhalt mit, Umschalt: nur Markierung`,
            }, m.name);
            node.style.setProperty('--mk', colorOf(m));
            node._m = m;
            const rs = el('div', { class: 'mrk-rsz' });
            rs.addEventListener('pointerdown', e => startResize(e, m, node));
            node.append(rs);
            node.addEventListener('pointerdown', e => { if (e.button === 0 && e.target !== rs) startDrag(e, m, node); });
            node.ondblclick = () => renameMarker(m);
            node.oncontextmenu = e => { e.preventDefault(); selectMarker(m); menuFor(m, e.clientX, e.clientY); };
            lane.append(node);
        });
    }

    const corner = $('arrCorner');
    corner.append(
        el('span', {}, 'Abschnitte'),
        el('span', { class: 'spacer' }),
        el('button', {
            id: 'btnAddMark', 'aria-label': 'Abschnitt hinzufügen', 'data-tip': 'Songabschnitt hinzufügen',
            onclick: e => { const r = e.currentTarget.getBoundingClientRect(); S.addMenu(r.left, r.bottom + 2); },
        }, WD.icons.icon('plus')));

    bus.on('zoom', render);
    bus.on('project', render);
    bus.on('markers:changed', render);
})();
