// Unterer Bereich: Smart Controls, Editor oder Mixer. Editor-Inhalt richtet sich nach dem Regions-Typ.
'use strict';
(() => {
    const { $, el, bus } = WD;
    const M = WD.model;
    const panel = $('bottom'), body = $('bottomBody');
    const views = {};
    let active = null; // Rückgabe der aktiven Ansicht (mit optionalem dispose)

    function buttons() {
        const v = WD.view.bottom;
        [['btnSmart', 'smart'], ['btnEditor', 'editor'], ['btnMixer', 'mixer']].forEach(([id, tab]) => {
            const b = $(id);
            if (b) { b.classList.toggle('on', v === tab); b.setAttribute('aria-pressed', v === tab ? 'true' : 'false'); }
        });
    }

    // Unten nie so hoch, dass die Spuren keinen Platz mehr haben
    function fitHeight() {
        const free = innerHeight - $('topbar').getBoundingClientRect().height;
        panel.style.height = Math.min(WD.view.bottomH, Math.max(120, free * 0.58)) + 'px';
    }

    function render() {
        if (active && active.dispose) active.dispose();
        active = null;
        body.textContent = '';
        const tab = WD.view.bottom;
        panel.classList.toggle('open', !!tab);
        if (tab) {
            fitHeight();
            if (views[tab]) active = views[tab](body) || null;
        }
        buttons();
        WD.timeline.requestDraw();
    }

    WD.bottom = {
        register(tab, fn) { views[tab] = fn; },
        show(tab) { WD.view.bottom = tab; render(); },
        hide() { WD.view.bottom = null; render(); },
        toggle(tab) { WD.view.bottom = WD.view.bottom === tab ? null : tab; render(); },
        render,
        get active() { return active; },
    };

    // Höhe ziehen
    $('bottomResize').addEventListener('pointerdown', e => {
        e.preventDefault();
        const y0 = e.clientY, h0 = WD.view.bottomH;
        const move = ev => {
            WD.view.bottomH = Math.max(110, Math.min(innerHeight - 180, h0 + (y0 - ev.clientY)));
            fitHeight();
        };
        const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); WD.timeline.requestDraw(); };
        addEventListener('pointermove', move); addEventListener('pointerup', up);
    });
    addEventListener('resize', () => { if (WD.view.bottom) { fitHeight(); WD.timeline.requestDraw(); } });

    // --- Editor-Ansicht ---
    WD.editor = {
        open(regionId) {
            WD.view.editRegionId = regionId;
            const f = M.findRegion(regionId);
            if (f) {
                WD.view.selTrackId = f.track.id;
                WD.view.focus = 'editor';
                bus.emit('track:selected');
            }
            WD.bottom.show('editor');
        },
        close() { WD.bottom.hide(); },
    };

    WD.bottom.register('editor', host => {
        let f = WD.view.editRegionId ? M.findRegion(WD.view.editRegionId) : null;
        if (!f) {
            // Ohne gezielte Wahl: die ausgewählte Region oder die erste der aktiven Spur
            const sel = M.selRegions()[0];
            const t = M.selTrack();
            if (sel) f = sel;
            else if (t && t.regions[0]) f = { track: t, region: t.regions[0] };
            if (f) WD.view.editRegionId = f.region.id;
        }
        const pane = el('div', { class: 'editor-pane' });
        host.append(pane);
        if (!f) {
            pane.append(el('div', { class: 'pane-empty' }, 'Region doppelklicken, um sie hier zu bearbeiten. Auf Instrument- und Drum-Spuren legt ein Doppelklick auf eine leere Stelle eine neue Region an.'));
            return null;
        }
        const { track: tr, region: r } = f;
        const head = el('div', { class: 'pane-head' });
        head.append(el('span', { class: 'pane-title' }, `${tr.name} – ${r.name || 'Region'}`), el('span', { class: 'pane-sep' }));
        pane.append(head);

        if (tr.type === 'audio') {
            const body2 = el('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } });
            pane.append(body2);
            return WD.audioEditor.mount(body2, head, tr, r);
        }
        const R = WD.roll.mount(pane, tr, r);
        R.buildToolbar(head);
        const hint = R.drum
            ? 'Klick setzt oder entfernt einen Schlag · Ziehen verschiebt · Rechtsklick wechselt die Stärke · Umschalt+Ziehen wählt aus'
            : 'Ziehen auf leerer Fläche zeichnet eine Note · Note ziehen verschiebt · rechte Kante ändert die Länge · Rechtsklick löscht · Umschalt+Ziehen wählt aus · Tasten links spielen';
        pane.append(el('div', { class: 'roll-hint' }, hint));
        const off = bus.on('frame', () => R.redraw());
        return { onKey: R.onKey, dispose: () => { off(); R.dispose(); }, redraw: R.redraw };
    });

    bus.on('editor:refresh', () => { if (WD.view.bottom === 'editor') render(); });
    bus.on('project', () => { if (WD.view.bottom) render(); });
})();
