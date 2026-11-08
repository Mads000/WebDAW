// Kompakte Handy-Oberfläche zum Festhalten von Ideen: Spuren, Aufnahme, Klänge, Song ans andere Gerät schicken.
// Sie liegt über derselben Engine und demselben Projekt wie die PC-Ansicht; Feinarbeit bleibt am PC.
'use strict';
(() => {
    const { el, bus, $ } = WD;
    const M = WD.model, T = WD.transport;
    const KEY = 'webdaw_ui';

    const stored = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
    const param = new URLSearchParams(location.search).get('ui');
    const auto = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= 600;
    const active = param ? param === 'phone' : stored() ? stored() === 'phone' : auto;
    const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

    async function setMode(mode) {
        if (WD.storage.dirty) await WD.storage.save();
        try { localStorage.setItem(KEY, mode); } catch { /* nur Komfort */ }
        location.href = location.pathname;
    }

    WD.phone = { active, setMode };
    if (!active) return;

    document.documentElement.classList.add('phone');
    if (navigator.audioSession) navigator.audioSession.type = 'playback'; // Klang auch bei stummgeschaltetem iPhone

    const icon = n => WD.icons.icon(n);
    let keysOpen = false, octave = 0, lock = null;

    const nameEl = el('button', { class: 'p-name', onclick: () => WD.storage.rename() });
    const stateEl = el('span', { class: 'p-saved' });
    const posEl = el('div', { class: 'p-pos' }, '1.1.1');
    const inFill = el('div');
    const inMeter = el('div', { class: 'p-in', hidden: true }, inFill);
    const bpmVal = el('input', { type: 'number', inputmode: 'numeric', class: 'p-bpm', 'aria-label': 'Tempo', min: 30, max: 300 });
    const metroBtn = el('button', { class: 'p-tog', onclick: () => { $('btnMetro').click(); refreshTop(); } }, icon('metronome'), 'Klick');
    const countBtn = el('button', { class: 'p-tog', onclick: () => { $('btnCount').click(); refreshTop(); } }, icon('countin'), 'Einzähler');
    const list = el('div', { class: 'p-list' });
    const keysHost = el('div', { class: 'p-keys', hidden: true });
    const playBtn = el('button', { class: 'p-big', 'aria-label': 'Wiedergabe', onclick: () => T.toggle() });
    const recBtn = el('button', { class: 'p-big p-rec', 'aria-label': 'Aufnahme', onclick: record }, icon('record'));
    const keysBtn = el('button', { class: 'p-side', onclick: () => { keysOpen = !keysOpen; renderKeys(); } }, icon('keys'), 'Tasten');

    function setBpm(v) {
        const b = $('bpm');
        b.value = Math.max(30, Math.min(300, Math.round(v)));
        b.dispatchEvent(new Event('change'));
        bpmVal.value = WD.project.bpm;
    }
    bpmVal.onchange = () => setBpm(+bpmVal.value || WD.project.bpm);

    function openMenu(e) {
        const r = e.currentTarget.getBoundingClientRect();
        WD.ui.menu(r.left, r.bottom + 4, [
            { label: 'An PC senden …', icon: 'file', action: () => WD.sync.sendDialog() },
            { label: 'Vom PC empfangen …', icon: 'file', action: () => WD.sync.receiveDialog() },
            { sep: 1 },
            { label: 'Neues Projekt', action: () => WD.storage.newProject() },
            { label: 'Projekte …', action: () => WD.projectDialogs.projectsDialog() },
            { label: 'Speichern', action: () => WD.storage.save() },
            { sep: 1 },
            { label: 'Stimmgerät …', icon: 'tuner', action: () => WD.tuner.open() },
            !standalone() && { label: 'Auf den Home-Bildschirm …', action: homeHint },
            { label: 'PC-Ansicht', action: () => setMode('desktop') },
        ]);
    }
    function homeHint() {
        WD.ui.alert('Auf den Home-Bildschirm',
            'In Safari unten auf das Teilen-Symbol tippen und „Zum Home-Bildschirm“ wählen. Dann startet WebDAW wie eine App, und iOS löscht deine Songs nicht nach einigen Tagen ohne Nutzung.');
    }

    const root = el('div', { id: 'phone' },
        el('header', { class: 'p-head' },
            el('button', { class: 'p-icon', 'aria-label': 'Menü', onclick: openMenu }, icon('more')),
            el('div', { class: 'p-title' }, nameEl, stateEl),
            el('button', { class: 'p-send', onclick: () => WD.sync.sendDialog() }, 'An PC')),
        el('section', { class: 'p-top' },
            posEl, inMeter,
            el('div', { class: 'p-tempo' },
                el('button', { class: 'p-step', 'aria-label': 'Langsamer', onclick: () => setBpm(WD.project.bpm - 1) }, '−'),
                bpmVal, el('small', {}, 'BPM'),
                el('button', { class: 'p-step', 'aria-label': 'Schneller', onclick: () => setBpm(WD.project.bpm + 1) }, '+'),
                metroBtn, countBtn)),
        list, keysHost,
        el('footer', { class: 'p-foot' },
            el('button', { class: 'p-side', onclick: () => T.rewind() }, icon('rewind'), 'Anfang'),
            playBtn, recBtn, keysBtn,
            el('button', { class: 'p-side', onclick: addMenu }, icon('plus'), 'Spur')));
    document.body.prepend(root);

    function addMenu(e) {
        const r = e.currentTarget.getBoundingClientRect();
        WD.ui.menu(r.right, r.top - 8, [
            { label: 'Aufnahme-Spur (Mikrofon)', icon: 'mic', action: () => WD.tracksView.addTrack('audio') },
            { label: 'Instrument', icon: 'keys', action: () => WD.tracksView.addTrack('inst') },
            { label: 'Drums', icon: 'drums', action: () => WD.tracksView.addTrack('drum') },
        ]);
        const box = document.querySelector('.ctx-menu');
        box.style.top = Math.max(4, r.top - box.offsetHeight - 8) + 'px';
    }

    async function record() {
        if (!WD.project.tracks.length) WD.tracksView.addTrack('audio');
        if (!M.selTrack()) { WD.view.selTrackId = WD.project.tracks[0].id; bus.emit('track:selected'); }
        await WD.recorder.toggle();
    }

    function select(t) { WD.view.selTrackId = t.id; bus.emit('track:selected'); renderTracks(); renderKeys(); }

    function setSound(t, field, name) {
        WD.history.run('Klang', () => {
            t[field] = name;
            if (!t.customName) t.name = WD.instruments.label(name); // Eigene Spurnamen bleiben erhalten
        });
        bus.emit('tracks'); bus.emit('mix');
    }

    function soundSheet(t) {
        const L = WD.instruments.label;
        const groups = [];
        if (t.type === 'drum') groups.push(['Drum-Kits', Object.keys(WD.instruments.KITS).map(n => [L(n), () => setSound(t, 'kit', n), t.kit === n])]);
        else if (t.type === 'inst') {
            const cats = {};
            Object.entries(WD.instruments.INSTR).forEach(([n, d]) => { (cats[d.cat] = cats[d.cat] || []).push([L(n), () => setSound(t, 'inst', n), t.inst === n]); });
            groups.push(...Object.entries(cats));
        } else {
            WD.patches.groupsFor(t).forEach(g => groups.push([g, Object.keys(WD.patches.PATCHES[g]).map(n => [WD.patches.label(n), () => WD.patches.apply(t, n), t.patch === n])]));
        }
        WD.ui.modal((box, close) => {
            box.classList.add('p-sheet');
            const body = el('div', { class: 'p-sheet-body' });
            const draw = () => {
                body.textContent = '';
                groups.forEach(([title, items]) => {
                    body.append(el('h3', {}, title));
                    items.forEach(it => body.append(el('button', {
                        class: 'p-sound' + (it[2] ? ' on' : ''),
                        onclick: () => {
                            groups.forEach(g => g[1].forEach(x => { x[2] = false; }));
                            it[2] = true;
                            it[1]();
                            draw();
                            if (t.type !== 'audio') WD.instruments.preview(t, t.type === 'drum' ? 0 : 60, .6);
                        },
                    }, it[0])));
                });
            };
            draw();
            box.append(el('h2', {}, `Klang: ${t.name}`), body, el('div', { class: 'modal-btns' }, el('button', { class: 'primary', onclick: close }, 'Fertig')));
        });
    }

    function trackMenu(t, e) {
        const r = e.currentTarget.getBoundingClientRect();
        WD.ui.menu(r.right, r.bottom + 2, [
            { label: 'Klang wählen …', action: () => soundSheet(t) },
            { label: 'Umbenennen …', action: () => WD.tracksView.renameTrack(t) },
            t.type === 'audio' && t.regions.length && WD.regionFx.canEdit(t.regions[t.regions.length - 1]) && { label: 'Letzte Aufnahme auf den Tasten spielen', action: () => WD.sampler.fromRegion(t.regions[t.regions.length - 1]) },
            { sep: 1 },
            { label: 'Spur löschen', danger: true, action: () => WD.tracksView.deleteTrack(t) },
        ]);
    }

    const miniBtn = (cls, label, on, aria, fn) => el('button', {
        class: 'p-mini ' + cls + (on ? ' on' : ''), 'aria-label': aria, 'aria-pressed': on ? 'true' : 'false',
        onclick: e => { e.stopPropagation(); fn(); },
    }, label);

    const songLen = () => Math.max(M.contentEnd(), M.barLen() * 8);

    function drawLane(cv, t) {
        const w = cv.clientWidth, h = cv.clientHeight;
        if (!w || !h) return;
        const dpr = Math.min(devicePixelRatio || 1, 3);
        cv.width = w * dpr; cv.height = h * dpr;
        const g = cv.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        const L = songLen();
        g.fillStyle = t.color;
        t.regions.forEach(r => {
            const x = r.startBar / L * w, rw = Math.max(2, r.lengthBars / L * w);
            g.globalAlpha = .9;
            g.beginPath(); g.roundRect(x, 1, rw - 1, h - 2, 3); g.fill();
        });
        g.globalAlpha = 1;
    }
    function drawLanes() {
        list.querySelectorAll('canvas').forEach(cv => { const t = M.track(cv.dataset.id); if (t) drawLane(cv, t); });
        updatePos(true);
    }
    const drawSoon = WD.debounce(drawLanes, 80);

    function renderTracks() {
        list.textContent = '';
        const tracks = WD.project.tracks;
        if (!tracks.length) {
            list.append(el('div', { class: 'p-empty' },
                el('h2', {}, 'Idee festhalten'),
                el('p', {}, 'Tippe auf den roten Knopf, um sofort aufzunehmen. Die Spur wird automatisch angelegt.')));
            return;
        }
        tracks.forEach(t => {
            const L = WD.instruments.label;
            const named = t.type === 'drum' ? L(t.kit) : t.type === 'inst' ? L(t.inst) : (t.patch ? WD.patches.label(t.patch) : 'Mikrofon');
            const sound = named === t.name ? (t.type === 'drum' ? 'Drums' : 'Instrument') : named;
            const cv = el('canvas', { dataset: { id: t.id }, 'aria-label': 'Position setzen' });
            cv.onclick = e => {
                e.stopPropagation();
                const r = cv.getBoundingClientRect();
                T.seek((e.clientX - r.left) / r.width * songLen());
            };
            const vol = WD.controls.slider({
                min: 0, max: 100, label: 'Lautstärke', cls: 'slider p-vol',
                get: () => Math.round(t.vol * 100), set: v => { t.vol = v / 100; },
            });
            list.append(el('article', { class: 'p-track' + (WD.view.selTrackId === t.id ? ' sel' : ''), onclick: () => select(t) },
                el('div', { class: 'p-row' },
                    el('div', { class: 'p-tile', style: { background: t.color } }, icon(WD.icons.trackIcon(t))),
                    el('button', { class: 'p-tinfo', onclick: e => { e.stopPropagation(); select(t); soundSheet(t); } },
                        el('b', {}, t.name), el('small', {}, sound)),
                    miniBtn('m', 'M', t.mute, 'Stumm', () => { WD.history.run('Mute', () => { t.mute = !t.mute; }); bus.emit('mix'); bus.emit('tracks'); }),
                    miniBtn('s', 'S', t.solo, 'Solo', () => { WD.history.run('Solo', () => { t.solo = !t.solo; }); bus.emit('mix'); bus.emit('tracks'); }),
                    miniBtn('r', '●', t.arm, 'Aufnahmebereit', () => { t.arm = !t.arm; bus.emit('tracks'); bus.emit('dirty'); WD.input.refresh(); }),
                    el('button', { class: 'p-mini', 'aria-label': 'Spur-Optionen', onclick: e => { e.stopPropagation(); trackMenu(t, e); } }, icon('more'))),
                el('div', { class: 'p-lane' }, cv),
                vol));
        });
        drawLanes();
    }

    const KEYS = [[0, 0], [1, 1], [2, 0], [3, 1], [4, 0], [5, 0], [6, 1], [7, 0], [8, 1], [9, 0], [10, 1], [11, 0], [12, 0]];
    const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'H'];

    function bindKey(node, t, n, recKey) {
        let down = false;
        node.addEventListener('pointerdown', e => {
            e.preventDefault();
            node.setPointerCapture(e.pointerId);
            down = true;
            node.classList.add('down');
            WD.instruments.preview(t, n, t.type === 'drum' ? .4 : .7);
            WD.recorder.noteOn(t, n, t.type === 'drum' ? null : recKey);
        });
        const up = () => { if (!down) return; down = false; node.classList.remove('down'); WD.recorder.noteOff(recKey); };
        node.addEventListener('pointerup', up);
        node.addEventListener('pointercancel', up);
    }

    function renderKeys() {
        const t = M.selTrack();
        const show = keysOpen && t && t.type !== 'audio';
        keysBtn.classList.toggle('on', !!show);
        keysBtn.disabled = !t || t.type === 'audio';
        keysHost.hidden = !show;
        keysHost.textContent = '';
        if (!show) return;
        if (t.type === 'drum') {
            keysHost.append(el('div', { class: 'p-pads' }, WD.instruments.DRUMLANES.map((name, i) => {
                const pad = el('button', { class: 'p-pad' }, name);
                bindKey(pad, t, i, 'pad' + i);
                return pad;
            })));
            return;
        }
        const whites = KEYS.filter(k => !k[1]);
        const base = 60 + octave * 12;
        const kb = el('div', { class: 'p-piano' });
        let wi = 0;
        KEYS.forEach(([offset, black]) => {
            const n = base + offset;
            const k = el('button', { class: black ? 'p-black' : 'p-white', 'aria-label': NAMES[offset % 12] });
            if (black) k.style.left = `calc(${wi / whites.length * 100}% - ${100 / whites.length * .3}%)`;
            else { k.textContent = offset % 12 === 0 ? `C${4 + octave + (offset ? 1 : 0)}` : ''; k.style.left = wi / whites.length * 100 + '%'; wi++; }
            k.style.width = (black ? 100 / whites.length * .6 : 100 / whites.length) + '%';
            bindKey(k, t, WD.musicalKeyboard.snapToKey(n), 'touch' + offset);
            kb.append(k);
        });
        keysHost.append(
            el('div', { class: 'p-oct' },
                el('button', { 'aria-label': 'Oktave tiefer', onclick: () => { octave = Math.max(-2, octave - 1); renderKeys(); } }, '−'),
                el('span', {}, 'Oktave'),
                el('button', { 'aria-label': 'Oktave höher', onclick: () => { octave = Math.min(2, octave + 1); renderKeys(); } }, '+')),
            kb);
    }

    function refreshTop() {
        const p = WD.project;
        nameEl.textContent = p.name;
        if (document.activeElement !== bpmVal) bpmVal.value = p.bpm;
        metroBtn.classList.toggle('on', !!p.metronome);
        countBtn.classList.toggle('on', !!p.countIn);
    }

    function refreshTransport() {
        playBtn.textContent = '';
        playBtn.append(icon(T.playing ? 'stop' : 'play'));
        playBtn.classList.toggle('on', T.playing);
        const rec = WD.recorder.isCapturing() || T.playing && WD.project.tracks.some(t => WD.recorder.activeMidiTrack(t.id));
        recBtn.classList.toggle('on', !!rec);
        wakeLock(T.playing);
    }

    async function wakeLock(on) {
        if (!navigator.wakeLock) return;
        try {
            if (on && !lock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); }
            else if (!on && lock) { const l = lock; lock = null; await l.release(); }
        } catch { /* nur Komfort */ }
    }

    let lastPos = '';
    function updatePos(force) {
        const pos = T.audible(), bb = T.barBeat(pos);
        const text = `${bb.bar}.${bb.beat}.${bb.sub}`;
        if (force || text !== lastPos) { posEl.textContent = text; lastPos = text; }
        list.style.setProperty('--ph', (pos / songLen() * 100).toFixed(3) + '%');
        const inp = WD.input.active;
        inMeter.hidden = !inp;
        if (inp) WD.meters.setH(inFill, WD.input.peak());
    }

    new MutationObserver(() => { stateEl.textContent = $('saveState').textContent; }).observe($('saveState'), { childList: true, characterData: true, subtree: true });
    bus.on('frame', () => updatePos(false));
    bus.on('transport', refreshTransport);
    bus.on('rec:state', refreshTransport);
    bus.on('tempo', refreshTop);
    bus.on('input:changed', () => { updatePos(true); WD.frame.kick(); });
    bus.on('tracks', () => { renderTracks(); renderKeys(); });
    bus.on('regions', drawSoon);
    bus.on('project', () => { refreshTop(); renderTracks(); renderKeys(); refreshTransport(); });
    bus.on('dirty', refreshTop);
    addEventListener('resize', drawSoon);

    // iOS unterbricht den Ton bei Anrufen und im Hintergrund; beim Zurückkommen wieder anlaufen lassen
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && WD.engine.ready) WD.engine.ensure();
    });

    // Einmalig auf den Home-Bildschirm hinweisen: nur dort sind die Songs auf dem iPhone dauerhaft sicher
    let hinted = false;
    try { hinted = !!localStorage.getItem('webdaw_homehint'); localStorage.setItem('webdaw_homehint', '1'); } catch { /* nur Komfort */ }
    if (!hinted && !standalone() && location.protocol === 'https:') {
        setTimeout(() => WD.ui.toast('Tipp: Auf den Home-Bildschirm legen, damit iOS deine Songs nicht löscht.', { ms: 12000, action: { label: 'Wie?', fn: homeHint } }), 1500);
    }
})();
