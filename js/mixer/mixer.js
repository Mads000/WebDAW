// Mischpult: pro Spur Fader, Panorama, Sends, Mute/Solo und Pegel, plus Master.
'use strict';
(() => {
    const { el, bus, gainToDb } = WD;
    const K = WD.controls;

    function fmtDb(g) { return g <= 0.001 ? '−∞' : (gainToDb(g) > 0 ? '+' : '') + gainToDb(g).toFixed(1); }

    function strip(t, meters) {
        const dbLabel = el('div', { class: 'mx-db' }, fmtDb(t.vol));
        const fader = K.slider({
            min: 0, max: 100, def: 80, label: 'Lautstärke ' + t.name, cls: '',
            get: () => Math.round(t.vol * 100),
            set: v => { t.vol = v / 100; dbLabel.textContent = fmtDb(t.vol); bus.emit('mix:head'); },
        });
        const meterBar = el('div');
        meters.set(t.id, meterBar);

        const toggles = el('div', { class: 'mx-row' },
            el('button', {
                class: 'tbtn-s m' + (t.mute ? ' on' : ''), 'data-tip': 'Stumm',
                onclick: () => { WD.history.run('Mute', () => { t.mute = !t.mute; }); bus.emit('mix'); bus.emit('tracks'); },
            }, 'M'),
            el('button', {
                class: 'tbtn-s s' + (t.solo ? ' on' : ''), 'data-tip': 'Solo',
                onclick: () => { WD.history.run('Solo', () => { t.solo = !t.solo; }); bus.emit('mix'); bus.emit('tracks'); },
            }, 'S'));

        return el('div', {
            class: 'mx-strip' + (WD.view.selTrackId === t.id ? ' sel' : ''),
            onpointerdown: () => { WD.regionInput.selectTrack(t.id); document.querySelectorAll('.mx-strip').forEach(s => s.classList.remove('sel')); },
        },
            el('div', { class: 'mx-tile', style: { background: t.color } }),
            el('div', { class: 'mx-name', 'data-tip': t.name }, t.name),
            el('div', { class: 'mx-sends' },
                K.knob({ size: 'sm', label: 'Hall', historyLabel: 'Hall', get: () => t.fxRev || 0, set: v => { t.fxRev = v; } }),
                K.knob({ size: 'sm', label: 'Delay', historyLabel: 'Delay', get: () => t.fxDly || 0, set: v => { t.fxDly = v; } })),
            el('div', { class: 'mx-cap' }, 'Hall · Echo'),
            K.knob({ size: 'sm', min: -1, max: 1, def: 0, label: 'Panorama', historyLabel: 'Panorama', get: () => t.pan || 0, set: v => { t.pan = Math.abs(v) < .02 ? 0 : v; } }),
            el('div', { class: 'mx-cap' }, 'Pan'),
            toggles,
            el('div', { class: 'mx-fader' }, fader, el('div', { class: 'vmeter' }, meterBar)),
            dbLabel);
    }

    function build(root) {
        const meters = new Map();
        const box = el('div', { class: 'mixer' });
        WD.project.tracks.forEach(t => box.append(strip(t, meters)));
        if (!WD.project.tracks.length) box.append(el('div', { class: 'pane-empty' }, 'Noch keine Spuren im Projekt.'));

        // Master
        const master = WD.project.master;
        const mL = el('div'), mR = el('div');
        const dbLabel = el('div', { class: 'mx-db' }, fmtDb(master.vol));
        const fader = K.slider({
            min: 0, max: 100, def: 80, label: 'Master', cls: '',
            get: () => Math.round(master.vol * 100),
            set: v => { master.vol = v / 100; dbLabel.textContent = fmtDb(master.vol); WD.topbar.refreshMaster(); },
        });
        box.append(el('div', { class: 'mx-strip master' },
            el('div', { class: 'mx-tile', style: { background: 'var(--text-3)' } }),
            el('div', { class: 'mx-name' }, 'Master'),
            el('div', { class: 'mx-fader' }, fader, el('div', { class: 'vmeter' }, mL), el('div', { class: 'vmeter' }, mR)),
            dbLabel));
        root.append(box);

        const onFrame = () => {
            meters.forEach((node, id) => WD.meters.setV(node, WD.meters.level(id)));
            WD.meters.setV(mL, WD.meters.level('L'));
            WD.meters.setV(mR, WD.meters.level('R'));
        };
        const off = bus.on('frame', onFrame);
        return () => off();
    }

    WD.bottom.register('mixer', root => {
        let cleanup = build(root);
        const offT = bus.on('tracks', () => {
            cleanup();
            root.textContent = '';
            cleanup = build(root);
        });
        return { dispose: () => { cleanup(); offT(); } };
    });
})();
