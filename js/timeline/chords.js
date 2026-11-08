// Akkord-Spur: Akkorde einmal eintragen, Bass und Keys werden daraus erzeugt und folgen jeder Änderung.
// Nur die automatisch erzeugten Regionen (fromChords) werden ersetzt; eigene Regionen auf diesen Spuren bleiben.
'use strict';
(() => {
    const { $, el, bus } = WD;
    const M = WD.model;
    const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, H: 11, B: 11 };
    const TYPES = {
        '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11],
        sus4: [0, 5, 7], sus2: [0, 2, 7], dim: [0, 3, 6], add9: [0, 4, 7, 14],
    };

    // "F#m7" → {name, pc, type}. Deutsche Schreibweise: H ist die weiße Taste, Bb und B♭ das erniedrigte H.
    function parseChord(text) {
        const m = /^([A-Ha-h])([#♯b♭]?)(m7|maj7|sus4|sus2|dim|add9|m|7|)$/.exec(text.trim());
        if (!m) return null;
        const letter = m[1].toUpperCase();
        let pc = PC[letter];
        const acc = m[2];
        if (acc === '#' || acc === '♯') pc += 1; else if (acc === 'b' || acc === '♭') pc -= 1;
        return { name: letter + acc + m[3], pc: (pc + 12) % 12, type: m[3] };
    }

    // Ein Token je Abschnitt; "-" hält den vorigen Akkord, "." ist eine Pause
    function parseLine(line, barsEach) {
        const out = [], bad = [];
        const barL = M.barLen();
        line.replace(/\|/g, ' ').split(/\s+/).filter(Boolean).forEach((tok, i) => {
            const bar = i * barsEach * barL;
            if (tok === '.') return;
            if (tok === '-') { if (out.length) out[out.length - 1].len += barsEach * barL; return; }
            const c = parseChord(tok);
            if (!c) { bad.push(tok); return; }
            out.push({ bar, len: barsEach * barL, name: c.name, pc: c.pc, type: c.type });
        });
        return { chords: out, bad };
    }

    function roleTrack(role, name, inst) {
        return WD.project.tracks.find(t => t.chordRole === role) || M.addTrack('inst', name, { inst, chordRole: role, customName: true });
    }

    function bassNotes(c, barL) {
        const root = 36 + c.pc > 47 ? 24 + c.pc : 36 + c.pc, out = [];
        const halves = Math.max(1, Math.round(c.len / (barL / 2)));
        for (let i = 0; i < halves; i++) out.push({ t: c.bar + i * barL / 2, n: root, d: barL * .45, v: i % 2 ? .75 : .9 });
        return out;
    }
    function keysNotes(c, barL) {
        const iv = TYPES[c.type] || TYPES[''];
        const root = 55 + ((c.pc - 7 + 12) % 12); // bleibt in der Mittellage um G3–F#4
        const out = [];
        const count = Math.max(1, Math.round(c.len / barL));
        for (let i = 0; i < count; i++) iv.forEach(x => out.push({ t: c.bar + i * barL, n: root + x, d: barL * .94, v: .7 }));
        return out;
    }

    function rebuild() {
        const list = WD.project.chords || [];
        const hasTracks = WD.project.tracks.some(t => t.chordRole);
        if (!list.length && !hasTracks) return;
        const barL = M.barLen();
        const end = list.reduce((e, c) => Math.max(e, c.bar + c.len), barL);
        [['bass', 'Akkord-Bass', 'Sampled Bass', bassNotes], ['keys', 'Akkord-Keys', 'Sampled Grand', keysNotes]].forEach(([role, name, inst, gen]) => {
            const t = roleTrack(role, name, inst);
            t.regions = t.regions.filter(r => !r.fromChords);
            if (!list.length) return;
            const notes = [];
            list.forEach(c => notes.push(...gen(c, barL)));
            t.regions.push(M.normalizeRegion({ startBar: 0, lengthBars: end, notes, name: 'Akkorde', fromChords: true }));
        });
    }

    function apply(chords) {
        WD.history.run('Akkord-Spur', () => { WD.project.chords = chords; rebuild(); });
        bus.emit('tracks'); bus.emit('regions'); bus.emit('chords');
    }

    const lineOf = (chords, barsEach) => {
        if (!chords.length) return '';
        const step = barsEach * M.barLen(), out = [];
        const end = chords.reduce((e, c) => Math.max(e, c.bar + c.len), 0);
        for (let i = 0; i * step < end - 1e-6; i++) {
            const at = i * step, c = chords.find(x => Math.abs(x.bar - at) < 1e-6);
            out.push(c ? c.name : chords.some(x => x.bar < at && x.bar + x.len > at + 1e-6) ? '-' : '.');
        }
        return out.join(' ');
    };

    function dialog() {
        const cur = WD.project.chords || [];
        WD.ui.modal((box, close) => {
            const each = el('select', { 'aria-label': 'Takte je Akkord' }, [1, 2, 4].map(n => new Option(n === 1 ? '1 Takt' : n + ' Takte', n)));
            const input = el('input', { type: 'text', value: lineOf(cur, 1), placeholder: 'C G Am F', 'aria-label': 'Akkorde' });
            const status = el('p', { class: 'sync-status' });
            const submit = () => {
                const { chords, bad } = parseLine(input.value, +each.value);
                if (bad.length) { status.textContent = 'Nicht erkannt: ' + bad.join(', '); status.classList.add('err'); return; }
                close();
                apply(chords);
                WD.ui.toast(chords.length ? 'Bass und Keys folgen jetzt den Akkorden.' : 'Akkord-Spur geleert.', { type: 'ok' });
            };
            input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
            box.append(el('h2', {}, 'Akkord-Spur'),
                el('p', {}, 'Akkorde mit Leerzeichen trennen, zum Beispiel: C G Am F. Ein Minus hält den vorigen Akkord, ein Punkt ist eine Pause. Möglich sind m, 7, m7, maj7, sus2, sus4, dim und add9.'),
                input, el('label', { class: 'pane-field' }, 'Dauer je Akkord: ', each), status,
                el('div', { class: 'modal-btns' }, el('button', { onclick: close }, 'Abbrechen'), el('button', { class: 'primary', onclick: submit }, 'Übernehmen')));
        }, { onEscape: () => { } });
    }

    const row = $('chordRow'), lane = $('chordLane');
    function render() {
        const list = WD.project.chords || [], ppb = WD.view.ppb;
        row.hidden = !list.length;
        lane.textContent = '';
        lane.style.width = WD.timeline.laneWidth() + 'px';
        list.forEach(c => lane.append(el('button', {
            class: 'chord-pill', style: { left: c.bar * ppb + 'px', width: Math.max(18, c.len * ppb - 2) + 'px' }, onclick: dialog, 'data-tip': 'Akkorde bearbeiten',
        }, c.name)));
    }
    ['chords', 'project', 'zoom', 'timesig', 'regions'].forEach(ev => bus.on(ev, render));

    WD.chords = { parseChord, parseLine, apply, rebuild, dialog };
})();
