// Stimmgerät für echte Gitarren und Ukulelen. Tonhöhe per normierter Autokorrelation mit Interpolation.
'use strict';
(() => {
    const { el, bus } = WD;
    const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'H'];
    const TUNINGS = {
        'Gitarre (E A D G H E)': [40, 45, 50, 55, 59, 64],
        'Ukulele (G C E A)': [67, 60, 64, 69],
        'Bass (E A D G)': [28, 33, 38, 43],
        'Gitarre Drop D': [38, 45, 50, 55, 59, 64],
    };
    const noteName = m => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

    // Rückgabe: Frequenz in Hz oder 0, wenn kein klarer Ton erkannt wurde
    function detectPitch(d, sr, minHz = 38, maxHz = 1200) {
        const n = d.length;
        let rms = 0;
        for (let i = 0; i < n; i++) rms += d[i] * d[i];
        rms = Math.sqrt(rms / n);
        if (rms < 0.004) return 0;
        const lagMin = Math.floor(sr / maxHz), lagMax = Math.min(Math.floor(sr / minHz), Math.floor(n / 2));
        const win = n - lagMax;
        const c = new Float32Array(lagMax + 2);
        let e0 = 0;
        for (let i = 0; i < win; i++) e0 += d[i] * d[i];
        let eL = 0;
        for (let i = 0; i < win; i++) eL += d[i + lagMin] * d[i + lagMin];
        for (let lag = lagMin; lag <= lagMax; lag++) {
            let s = 0;
            for (let i = 0; i < win; i++) s += d[i] * d[i + lag];
            c[lag] = s / Math.sqrt(e0 * eL + 1e-12);
            eL += d[win + lag] * d[win + lag] - d[lag] * d[lag];
        }
        let top = 0;
        for (let lag = lagMin; lag <= lagMax; lag++) if (c[lag] > top) top = c[lag];
        if (top < 0.8) return 0;
        // Erstes deutliches Maximum nehmen, sonst würden Vielfache der Periode gewinnen (Oktavfehler)
        let best = -1;
        for (let lag = lagMin + 1; lag < lagMax; lag++) {
            if (c[lag] >= top * 0.93 && c[lag] >= c[lag - 1] && c[lag] >= c[lag + 1]) { best = lag; break; }
        }
        if (best < 0) return 0;
        const a = c[best - 1], b = c[best], g = c[best + 1];
        const shift = (a - g) / (2 * (a - 2 * b + g) || 1);
        return sr / (best + shift);
    }

    WD.tuner = {
        detectPitch,
        async open() {
            await WD.engine.ensure();
            try { await WD.input.open(); }
            catch (err) { WD.ui.alert('Kein Audio-Eingang', WD.input.explain(err)); return; }
            const ctx = WD.engine.ctx;
            const ana = ctx.createAnalyser();
            ana.fftSize = 8192;
            WD.input.node.connect(ana);
            const buf = new Float32Array(ana.fftSize);

            const noteEl = el('div', { style: { font: '600 46px/1.1 var(--font-num)', textAlign: 'center', minHeight: '52px' } }, '–');
            const hzEl = el('div', { class: 'modal-note', style: { textAlign: 'center' } }, 'Eine Saite anschlagen');
            const needle = el('div', { style: { position: 'absolute', top: 0, bottom: 0, width: '3px', left: '50%', marginLeft: '-1.5px', background: 'var(--text-3)', borderRadius: '2px', transition: 'left .08s linear, background .1s' } });
            const scale = el('div', { style: { position: 'relative', height: '26px', background: 'var(--meter-track)', borderRadius: '6px', overflow: 'hidden' } },
                el('div', { style: { position: 'absolute', top: 0, bottom: 0, left: '46%', width: '8%', background: 'rgba(63,191,106,.28)' } }), needle);
            const strings = el('div', { style: { display: 'flex', gap: '4px', justifyContent: 'center', flexWrap: 'wrap' } });
            const tuningSel = el('select', { 'aria-label': 'Stimmung' }, ...Object.keys(TUNINGS).map(k => new Option(k)));
            let saved = '';
            try { saved = localStorage.getItem('webdaw_tuning') || ''; } catch { /* nur Komfort */ }
            const sel = WD.model.selTrack();
            if (sel && /uke/i.test(sel.name + (sel.patch || ''))) saved = 'Ukulele (G C E A)';
            if (TUNINGS[saved]) tuningSel.value = saved;

            let refFreq = 440;
            const refInput = el('input', { type: 'number', min: 415, max: 466, value: 440, 'aria-label': 'Kammerton' });
            refInput.onchange = () => { refFreq = WD.clamp(+refInput.value || 440, 415, 466); };

            let chips = [];
            const drawStrings = () => {
                strings.textContent = '';
                chips = TUNINGS[tuningSel.value].map(m => {
                    const chip = el('button', {
                        'data-tip': 'Referenzton hören',
                        onclick: () => {
                            const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
                            o.type = 'triangle'; o.frequency.value = refFreq * Math.pow(2, (m - 69) / 12);
                            g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.3, t + .01);
                            g.gain.setValueAtTime(.3, t + 1); g.gain.linearRampToValueAtTime(0, t + 1.4);
                            o.connect(g); g.connect(WD.engine.nodes.monitor); o.start(t); o.stop(t + 1.45);
                        },
                    }, noteName(m));
                    chip._m = m;
                    strings.append(chip);
                    return chip;
                });
            };
            tuningSel.onchange = () => {
                drawStrings();
                try { localStorage.setItem('webdaw_tuning', tuningSel.value); } catch { /* nur Komfort */ }
            };
            drawStrings();

            let frameCount = 0, lastSeen = 0;
            const off = bus.on('frame', () => {
                if (frameCount++ % 3) return; // die Tonerkennung braucht nicht 60-mal pro Sekunde
                ana.getFloatTimeDomainData(buf);
                const f = detectPitch(buf, ctx.sampleRate);
                WD.tuner.last = f;
                if (!f) {
                    if (performance.now() - lastSeen > 1200) {
                        noteEl.textContent = '–'; hzEl.textContent = 'Eine Saite anschlagen';
                        needle.style.left = '50%'; needle.style.background = 'var(--text-3)';
                        chips.forEach(c => c.classList.remove('primary'));
                    }
                    return;
                }
                lastSeen = performance.now();
                const exact = 69 + 12 * Math.log2(f / refFreq), m = Math.round(exact), cents = Math.round((exact - m) * 100);
                noteEl.textContent = noteName(m);
                hzEl.textContent = `${f.toFixed(1)} Hz · ${cents > 0 ? '+' : ''}${cents} Cent`;
                needle.style.left = WD.clamp(50 + cents, 2, 98) + '%';
                needle.style.background = Math.abs(cents) <= 4 ? 'var(--play)' : Math.abs(cents) <= 15 ? 'var(--cycle)' : 'var(--rec)';
                chips.forEach(c => c.classList.toggle('primary', c._m === m));
            });
            const keepAlive = setInterval(() => WD.frame.kick(), 300);
            WD.frame.kick();

            const finish = () => {
                off(); clearInterval(keepAlive);
                try { WD.input.node && WD.input.node.disconnect(ana); } catch { /* */ }
                if (!WD.input.needed()) WD.input.close();
            };
            WD.ui.modal((box, close) => {
                box.append(
                    el('h2', {}, 'Stimmgerät'),
                    el('div', { class: 'form-row' }, el('label', {}, 'Stimmung'), tuningSel),
                    noteEl, scale, hzEl, strings,
                    el('div', { class: 'form-row' }, el('label', {}, 'Kammerton (Hz)'), refInput),
                    el('div', { class: 'modal-btns' }, el('button', { class: 'primary', onclick: () => { finish(); close(); } }, 'Fertig')));
            }, { onEscape: finish });
        },
    };
})();
