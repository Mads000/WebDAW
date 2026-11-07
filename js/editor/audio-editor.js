// Editor für Audio-Regionen: Takes, Varispeed, Regions-Pegel, Fades, Noten-Erkennung.
'use strict';
(() => {
    const { el, bus, gainToDb, dbToGain } = WD;
    const M = WD.model;

    function drawOverview(cv, r) {
        const buf = WD.audioStore.get(r.bufId), peaks = WD.audioStore.peaks(r.bufId);
        const w = cv.clientWidth, h = cv.clientHeight;
        const dpr = devicePixelRatio || 1;
        cv.width = Math.max(1, w * dpr); cv.height = Math.max(1, h * dpr);
        const g = cv.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, h);
        if (!peaks) return;
        const total = peaks.length / 2;
        const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
        // Der genutzte Teil der Aufnahme ist hervorgehoben
        const u0 = (r.offset || 0) / buf.duration;
        const u1 = Math.min(1, u0 + r.lengthBars * M.secPerBar() * (r.rate || 1) / buf.duration);
        g.fillStyle = css('--sel');
        g.fillRect(u0 * w, 0, (u1 - u0) * w, h);
        for (let x = 0; x < w; x++) {
            const f = x / w;
            const i0 = Math.floor(f * total), i1 = Math.max(i0 + 1, Math.floor((x + 1) / w * total));
            let mn = 1, mx = -1;
            for (let i = i0; i < i1 && i < total; i++) {
                if (peaks[i * 2] < mn) mn = peaks[i * 2];
                if (peaks[i * 2 + 1] > mx) mx = peaks[i * 2 + 1];
            }
            g.fillStyle = f >= u0 && f <= u1 ? css('--accent') : css('--text-3');
            g.fillRect(x, (1 - mx) * h / 2, 1, Math.max(1, (mx - mn) * h / 2));
        }
    }

    WD.audioEditor = {
        mount(body, head, tr, r) {
            if (!WD.audioStore.get(r.bufId)) {
                body.append(el('div', { class: 'pane-empty' }, 'Die Audiodaten dieser Region sind nicht verfügbar.'));
                return {};
            }
            // Takes
            if (r.takes && r.takes.length > 1) {
                const list = el('span', { class: 'take-list' });
                r.takes.forEach((tk, i) => list.append(el('button', {
                    class: i === (r.takeIdx || 0) ? 'on' : '',
                    onclick: () => {
                        WD.history.run('Take wählen', () => {
                            r.takeIdx = i; r.bufId = tk.bufId; r.offset = tk.offset || 0;
                        });
                        bus.emit('regions'); bus.emit('audio:edited'); bus.emit('editor:refresh');
                    },
                }, `Take ${i + 1}`)));
                head.append(el('label', { class: 'pane-field' }, 'Takes', list), el('span', { class: 'pane-sep' }));
            }
            // Varispeed
            const rateLabel = el('b', { style: { fontVariantNumeric: 'tabular-nums' } });
            const rate = el('input', { type: 'range', class: 'slider', min: 50, max: 200, value: Math.round((r.rate || 1) * 100), style: { width: '140px' }, 'aria-label': 'Varispeed' });
            const upd = () => { const v = rate.value / 100; rateLabel.textContent = `${rate.value} % / ${(12 * Math.log2(v)).toFixed(1)} HT`; };
            upd();
            rate.oninput = upd;
            const applyRate = () => {
                const old = r.rate || 1, rt = rate.value / 100;
                if (old === rt) return;
                WD.history.run('Varispeed', () => {
                    r.rate = rt;
                    r.lengthBars = Math.max(.01, r.lengthBars * old / rt);
                });
                bus.emit('regions'); bus.emit('audio:edited');
                bus.emit('editor:refresh');
            };
            rate.onchange = () => { applyRate(); rate.blur(); };
            // Regions-Pegel
            const gainV = el('span', { style: { minWidth: '52px', fontVariantNumeric: 'tabular-nums' } });
            const gain = el('input', { type: 'range', class: 'slider', min: -24, max: 12, step: .5, value: gainToDb(r.gain === undefined ? 1 : r.gain), style: { width: '90px' }, 'aria-label': 'Pegel der Region' });
            const updG = () => { gainV.textContent = (+gain.value > 0 ? '+' : '') + (+gain.value).toFixed(1) + ' dB'; };
            updG();
            gain.oninput = updG;
            gain.onchange = () => { WD.history.run('Regions-Pegel', () => { r.gain = dbToGain(+gain.value); }); bus.emit('regions'); bus.emit('audio:edited'); gain.blur(); };
            // Fades
            const fade = (label, key) => {
                const inp = el('input', { type: 'number', min: 0, max: 30, step: .05, value: +(r[key] || 0).toFixed(2), 'aria-label': label });
                inp.onchange = () => { WD.history.run(label, () => { r[key] = Math.max(0, +inp.value || 0); }); bus.emit('regions'); bus.emit('audio:edited'); inp.blur(); };
                return el('label', { class: 'pane-field' }, label, inp, 's');
            };
            const p2m = el('button', {
                'data-tip': 'Einstimmige Melodie als MIDI-Noten auf eine neue Spur übertragen',
                onclick: () => WD.pitchDetect.toMidi(tr, r),
            }, 'Noten erkennen');

            head.append(
                el('label', { class: 'pane-field' }, 'Varispeed', rate, rateLabel),
                el('button', { onclick: () => { rate.value = 100; upd(); applyRate(); } }, '100 %'),
                el('span', { class: 'pane-sep' }),
                el('label', { class: 'pane-field' }, 'Pegel', gain, gainV),
                fade('Fade In', 'fadeIn'), fade('Fade Out', 'fadeOut'),
                el('span', { class: 'pane-sep' }), p2m,
            );

            const cv = el('canvas');
            const buf = WD.audioStore.get(r.bufId);
            const info = el('div', { class: 'help' },
                `${buf.duration.toFixed(2)} s · ${buf.numberOfChannels === 2 ? 'Stereo' : 'Mono'} · ${buf.sampleRate} Hz. ` +
                'Kanten der Region ziehen trimmt ohne Datenverlust. Varispeed ändert Tempo und Tonhöhe gemeinsam, wie eine Bandmaschine.');
            const wrap = el('div', { class: 'audio-ed' }, cv, info);
            body.append(wrap);
            const ro = new ResizeObserver(() => drawOverview(cv, r));
            ro.observe(cv);
            return { dispose: () => ro.disconnect() };
        },
    };
})();
