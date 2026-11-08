// Smart Controls: wenige große Regler, passend zum Instrument. Darunter liegt die volle Effektkette.
// Alle Regler wirken direkt auf die Parameter des echten Kanalzugs.
'use strict';
(() => {
    const { el, bus } = WD;
    const K = WD.controls;
    const bi = v => (v > 0 ? '+' : '') + v.toFixed(1) + ' dB';

    const m = {
        drive: { label: 'Drive', get: t => t.fx.drive, set: (t, v) => { t.fx.drive = v; } },
        tone: { label: 'Höhen', min: -12, max: 12, def: 0, fmt: bi, get: t => t.eqH || 0, set: (t, v) => { t.eqH = v; } },
        mids: { label: 'Mitten', min: -12, max: 12, def: 0, fmt: bi, get: t => t.eqM || 0, set: (t, v) => { t.eqM = v; } },
        body: { label: 'Bässe', min: -12, max: 12, def: 0, fmt: bi, get: t => t.eqL || 0, set: (t, v) => { t.eqL = v; } },
        chorus: { label: 'Chorus', get: t => t.fx.chorus, set: (t, v) => { t.fx.chorus = v; } },
        delay: { label: 'Echo', get: t => t.fxDly || 0, set: (t, v) => { t.fxDly = v; } },
        room: { label: 'Hall', get: t => t.fxRev || 0, set: (t, v) => { t.fxRev = v; } },
        punch: { label: 'Punch', get: t => t.fxCmp || 0, set: (t, v) => { t.fxCmp = v; } },
        level: { label: 'Dichte', get: t => t.fxCmp || 0, set: (t, v) => { t.fxCmp = v; } },
        crush: { label: 'Lo-Fi', get: t => t.fx.crush, set: (t, v) => { t.fx.crush = v; } },
        muffle: { label: 'Dumpf', get: t => t.fx.lp, set: (t, v) => { t.fx.lp = v; } },
        clean: { label: 'Low-Cut', get: t => t.fx.hp, set: (t, v) => { t.fx.hp = v; } },
        gate: { label: 'Gate', get: t => t.fx.gate, set: (t, v) => { t.fx.gate = v; } },
    };
    const SETS = {
        guitar: ['drive', 'tone', 'mids', 'chorus', 'delay', 'room'],
        bass: ['drive', 'body', 'tone', 'punch', 'muffle'],
        keys: ['tone', 'body', 'chorus', 'delay', 'room', 'crush'],
        synth: ['muffle', 'tone', 'chorus', 'delay', 'room', 'crush'],
        orchestral: ['tone', 'body', 'chorus', 'delay', 'room'],
        drums: ['punch', 'body', 'tone', 'room', 'crush', 'drive'],
        audio: ['level', 'clean', 'tone', 'gate', 'delay', 'room'],
    };
    const CAT_SET = {
        Gitarren: 'guitar', Britpop: 'guitar', Akustisch: 'guitar', Bass: 'bass', Keys: 'keys', Mallets: 'keys',
        Synth: 'synth', Elektronisch: 'synth', Orchestral: 'orchestral',
    };
    const DIV_LABELS = [['1/4.', '1/4 punkt.'], ['1/4', '1/4'], ['1/8.', '1/8 punkt.'], ['1/8', '1/8'], ['1/8T', '1/8 Triole'], ['1/16', '1/16']];
    const setFor = t => {
        if (t.type === 'drum') return 'drums';
        if (t.type === 'audio') return 'audio';
        const d = WD.instruments.INSTR[t.inst];
        if (d && d.family === 'bass') return 'bass';
        return (d && CAT_SET[d.cat]) || 'keys';
    };

    const pct = v => Math.round(v * 100) + ' %';

    // Volle Effektkette in Signalreihenfolge
    function fxCards(t) {
        const card = (title, active, ...kids) => el('div', { class: 'fx-card' + (active ? '' : ' off') }, el('div', { class: 'fx-card-head' }, title), ...kids);
        const kn = (label, get, set, o = {}) => K.knob(Object.assign({ size: 'md', label, historyLabel: label, get, set, fmt: pct }, o));
        const refresh = () => bus.emit('patch');

        const driveType = el('select', { 'aria-label': 'Drive-Art', onchange: e => { WD.history.run('Drive-Art', () => { t.fx.driveType = e.target.value; }); bus.emit('mix'); e.target.blur(); } },
            new Option('Overdrive', 'overdrive', false, t.fx.driveType !== 'distortion'),
            new Option('Distortion', 'distortion', false, t.fx.driveType === 'distortion'));
        const dlyDiv = el('select', { 'aria-label': 'Echo-Zeit', onchange: e => { WD.history.run('Echo-Zeit', () => { t.fxDlyDiv = e.target.value; }); bus.emit('mix'); e.target.blur(); } },
            DIV_LABELS.map(([v, l]) => new Option(l, v, false, (t.fxDlyDiv || '1/8.') === v)));
        const dbl = el('input', {
            type: 'checkbox', checked: !!t.dbl, 'aria-label': 'Doubler',
            onchange: e => { WD.history.run('Doubler', () => { t.dbl = e.target.checked; }); bus.emit('mix'); e.target.blur(); refresh(); },
        });

        return el('div', { class: 'fx-chain' },
            t.type === 'audio' ? card('Tonkorrektur', t.fxTune > 0, kn('Stärke', () => t.fxTune || 0, v => { t.fxTune = v; })) : null,
            card('Doubler', t.dbl, el('label', { class: 'pane-field' }, dbl, 'an')),
            card('Noise Gate', t.fx.gate > 0, kn('Schwelle', () => t.fx.gate, v => { t.fx.gate = v; })),
            card('Filter', t.fx.hp > 0 || t.fx.lp > 0, el('div', { class: 'fx-card-row' },
                kn('Hochpass', () => t.fx.hp, v => { t.fx.hp = v; }),
                kn('Tiefpass', () => t.fx.lp, v => { t.fx.lp = v; }))),
            card('Equalizer', t.eqL || t.eqM || t.eqH, el('div', { class: 'fx-card-row' },
                kn('Bässe', () => t.eqL || 0, v => { t.eqL = v; }, { min: -12, max: 12, def: 0, fmt: bi }),
                kn('Mitten', () => t.eqM || 0, v => { t.eqM = v; }, { min: -12, max: 12, def: 0, fmt: bi }),
                kn('Höhen', () => t.eqH || 0, v => { t.eqH = v; }, { min: -12, max: 12, def: 0, fmt: bi }))),
            card('Kompressor', t.fxCmp > 0, kn('Stärke', () => t.fxCmp || 0, v => { t.fxCmp = v; })),
            card('Drive', t.fx.drive > 0, kn('Stärke', () => t.fx.drive, v => { t.fx.drive = v; }), driveType),
            card('Bitcrush', t.fx.crush > 0, kn('Stärke', () => t.fx.crush, v => { t.fx.crush = v; })),
            card('Chorus', t.fx.chorus > 0, kn('Mix', () => t.fx.chorus, v => { t.fx.chorus = v; })),
            card('Limiter', t.fx.limit > 0, kn('Stärke', () => t.fx.limit, v => { t.fx.limit = v; })),
            card('Echo', t.fxDly > 0, kn('Send', () => t.fxDly || 0, v => { t.fxDly = v; }), dlyDiv),
            card('Hall', t.fxRev > 0, el('div', { class: 'fx-card-row' },
                kn('Send', () => t.fxRev || 0, v => { t.fxRev = v; }),
                kn('Raum', () => (t.fxRevSize === undefined ? .5 : t.fxRevSize), v => { t.fxRevSize = v; }, { def: .5, fmt: roomFmt }))));
    }
    const roomFmt = v => (v < .2 ? 'Kammer' : v < .4 ? 'Klein' : v < .62 ? 'Mittel' : v < .85 ? 'Groß' : 'Halle');

    WD.bottom.register('smart', host => {
        const t = WD.model.selTrack();
        if (!t) {
            host.append(el('div', { class: 'pane-empty' }, 'Wähle eine Spur aus, um ihre Smart Controls zu sehen.'));
            return null;
        }
        const set = SETS[setFor(t)];
        const typeLabel = t.type === 'drum' ? `Kit: ${WD.instruments.label(t.kit)}` : t.type === 'audio' ? 'Audio-Spur' : WD.instruments.label(t.inst);
        const knobs = el('div', { class: 'smart-knobs' });
        set.forEach(key => {
            const d = m[key];
            knobs.append(K.knob({
                label: d.label, min: d.min, max: d.max, def: d.def, fmt: d.fmt || pct, historyLabel: d.label,
                get: () => d.get(t), set: v => d.set(t, v),
            }));
        });
        knobs.append(K.knob({ label: 'Panorama', min: -1, max: 1, def: 0, historyLabel: 'Panorama', fmt: v => Math.abs(v) < .02 ? 'Mitte' : (v < 0 ? 'L ' : 'R ') + Math.round(Math.abs(v) * 100), get: () => t.pan || 0, set: v => { t.pan = v; } }));

        if (t.type !== 'drum') knobs.append(K.knob({ label: 'Pumpen', tip: 'Duckt die Spur bei jeder Kick', min: 0, max: 1, def: 0, fmt: pct, historyLabel: 'Pumpen', get: () => t.fxPump || 0, set: v => { t.fxPump = v; } }));

        const head = el('div', { class: 'pane-head' },
            el('span', { class: 'pane-title' }, t.name),
            el('span', { class: 'smart-sub' }, typeLabel + (t.patch ? ' · ' + WD.patches.label(t.patch) : '')),
            el('span', { class: 'spacer' }),
            el('button', { onclick: () => WD.patches.doubleTrack(t), 'data-tip': 'Neue Spur mit gleichem Klang und gespiegeltem Panorama, aufnahmebereit' }, 'Doppeln'),
            t.type === 'audio' ? el('button', { onclick: () => WD.patches.harmonyTrack(t), 'data-tip': 'Neue, leisere Spur für eine zweite Stimme' }, 'Harmonie') : null);

        const viz = el('canvas', { width: 220, height: 76 });
        const body = el('div', { class: 'smart' },
            el('div', { class: 'smart-main' }, knobs),
            el('div', { class: 'smart-fx' }, el('div', { class: 'fx-title' }, 'Effektkette'), fxCards(t)),
            el('div', { class: 'smart-viz' }, el('div', { class: 'fx-title' }, 'Spektrum (Summe)'), viz));
        host.append(head, body);

        const data = new Uint8Array(256);
        const offFrame = bus.on('frame', () => {
            if (!WD.engine.ready || !viz.isConnected) return;
            WD.engine.nodes.spec.getByteFrequencyData(data);
            const g = viz.getContext('2d'), w = viz.width, h = viz.height;
            g.clearRect(0, 0, w, h);
            const n = 56, bw = w / n;
            g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent');
            for (let i = 0; i < n; i++) {
                const v = data[Math.floor(Math.pow(i / n, 1.7) * 200)] / 255;
                g.fillRect(i * bw + .5, h - v * h, bw - 1, v * h);
            }
        });
        const offPatch = bus.on('patch', () => { if (WD.view.bottom === 'smart') WD.bottom.render(); });
        return { dispose: () => { offFrame(); offPatch(); } };
    });

    bus.on('track:selected', () => { if (WD.view.bottom === 'smart') WD.bottom.render(); });
})();
