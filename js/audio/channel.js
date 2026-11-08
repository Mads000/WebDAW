// Kanalzug einer Spur. Wird live und im Offline-Rendering identisch aufgebaut,
// deshalb klingt der Bounce wie die Wiedergabe. Effekte mit Wert 0 werden umgangen und kosten keine CPU.
//
// Reihenfolge: Eingang → Doubler → Gate → Hochpass → Tiefpass → EQ → Kompressor → Drive → Bitcrush
//              → Chorus → Limiter → Fader → Mute → Panorama → Ausgang, Sends für Reverb/Delay hinter dem Panorama.
'use strict';
(() => {
    const { dbToGain } = WD;

    const lpFreq = v => 18000 * Math.pow(1 - v, 2.2) + 300;

    function driveCurve(amount, type) {
        const n = 2049, c = new Float32Array(n); // ungerade: Eingang 0 trifft exakt die Mitte, kein Gleichanteil
        // Overdrive: weiche, asymmetrische Röhren-Kurve. Distortion: härter, fast Rechteck.
        const k = type === 'distortion' ? 4 + amount * 40 : 1.5 + amount * 9;
        for (let i = 0; i < n; i++) {
            const x = i / ((n - 1) / 2) - 1;
            if (type === 'distortion') c[i] = Math.tanh(k * x) / Math.tanh(k);
            else c[i] = (Math.tanh(k * (x + 0.08)) - Math.tanh(k * 0.08)) / Math.tanh(k);
        }
        return c;
    }

    // Töne der eingestellten Tonart für die Tonhöhenkorrektur
    const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const scaleSig = () => WD.project.keyRoot + WD.project.keyMode;
    function scaleOf() {
        const root = Math.max(0, NOTES.indexOf(WD.project.keyRoot));
        const steps = WD.project.keyMode === 'minor' ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
        const out = new Array(12).fill(false);
        steps.forEach(s => { out[(root + s) % 12] = true; });
        return out;
    }

    function createStrip(ctx, track, dests) {
        const live = {};
        const input = ctx.createGain();
        const fader = ctx.createGain();
        const muteG = ctx.createGain();
        const pan = ctx.createStereoPanner();
        const revSend = ctx.createGain(), dlySend = ctx.createGain();
        const pump = ctx.createGain(); // Sidechain-Effekt: wird zu jeder Kick kurz abgesenkt
        fader.connect(pump); pump.connect(muteG); muteG.connect(pan);
        pan.connect(dests.output);
        // Hall: Send → Überblendung zwischen zwei Raumgrößen. Echo: Send → Bus der gewählten Notenlänge.
        const revA = ctx.createGain(), revB = ctx.createGain();
        pan.connect(revSend); pan.connect(dlySend);
        revSend.connect(revA); revSend.connect(revB);
        let revRoute = null, dlyRoute = null;
        const hasAuto = (t, key) => (t.autos && t.autos[key] && t.autos[key].length > 0);
        function routeSends(t) {
            const wantsRev = (t.fxRev || 0) > 0 || hasAuto(t, 'rev');
            const size = t.fxRevSize === undefined ? 0.5 : WD.clamp(t.fxRevSize, 0, 1);
            const pos = size * 2, i = Math.min(1, Math.floor(pos)), f = pos - i;
            const route = wantsRev ? i + (f > 0 ? ':2' : ':1') : '';
            if (route !== revRoute) {
                revRoute = route;
                revA.disconnect(); revB.disconnect();
                if (wantsRev) { revA.connect(dests.reverb(i)); if (f > 0) revB.connect(dests.reverb(i + 1)); }
            }
            revA.gain.value = Math.cos(f * Math.PI / 2);
            revB.gain.value = Math.sin(f * Math.PI / 2);
            const div = (t.fxDly || 0) > 0 ? (t.fxDlyDiv || '1/8.') : '';
            if (div !== dlyRoute) {
                dlyRoute = div;
                dlySend.disconnect();
                if (div) dlySend.connect(dests.delay(div));
            }
        }

        // Lazy angelegte Effekt-Blöcke, jeder als {in, out}
        const blocks = {};
        const make = {
            dbl() {
                const inp = ctx.createGain(), out = ctx.createGain();
                const d = ctx.createDelay(0.1); d.delayTime.value = 0.028;
                const g = ctx.createGain(); g.gain.value = 0.7;
                const p = ctx.createStereoPanner(); p.pan.value = 0.45;
                inp.connect(out); inp.connect(d); d.connect(g); g.connect(p); p.connect(out);
                return { in: inp, out };
            },
            gate() {
                const n = new AudioWorkletNode(ctx, 'wd-gate', { outputChannelCount: [2] });
                return { in: n, out: n, node: n };
            },
            tune() {
                const n = new AudioWorkletNode(ctx, 'wd-tune', { outputChannelCount: [2], processorOptions: { scale: scaleOf() } });
                return { in: n, out: n, node: n, sig: scaleSig() };
            },
            hp() { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.Q.value = 0.7; return { in: f, out: f, node: f }; },
            lp() { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.7; return { in: f, out: f, node: f }; },
            eqL() { const f = ctx.createBiquadFilter(); f.type = 'lowshelf'; f.frequency.value = 220; return { in: f, out: f, node: f }; },
            eqM() { const f = ctx.createBiquadFilter(); f.type = 'peaking'; f.frequency.value = 1000; f.Q.value = 0.8; return { in: f, out: f, node: f }; },
            eqH() { const f = ctx.createBiquadFilter(); f.type = 'highshelf'; f.frequency.value = 4200; return { in: f, out: f, node: f }; },
            cmp() {
                const c = ctx.createDynamicsCompressor();
                c.attack.value = 0.005; c.release.value = 0.15; c.knee.value = 6;
                return { in: c, out: c, node: c };
            },
            drive() {
                const pre = ctx.createGain(), ws = ctx.createWaveShaper(), tone = ctx.createBiquadFilter(), out = ctx.createGain();
                const dcBlock = ctx.createBiquadFilter(); dcBlock.type = 'highpass'; dcBlock.frequency.value = 18;
                ws.oversample = '2x'; tone.type = 'lowpass';
                pre.connect(ws); ws.connect(tone); tone.connect(dcBlock); dcBlock.connect(out);
                return { in: pre, out, pre, ws, tone, post: out };
            },
            crush() {
                const n = new AudioWorkletNode(ctx, 'wd-crush', { outputChannelCount: [2] });
                return { in: n, out: n, node: n };
            },
            chorus() {
                const inp = ctx.createGain(), out = ctx.createGain(), wet = ctx.createGain();
                inp.connect(out);
                const lfos = [[0.018, 0.6, -0.8], [0.023, 0.83, 0.8]].map(([base, rate, panV]) => {
                    const d = ctx.createDelay(0.05); d.delayTime.value = base;
                    const lfo = ctx.createOscillator(); lfo.frequency.value = rate;
                    const depth = ctx.createGain(); depth.gain.value = 0.003;
                    const p = ctx.createStereoPanner(); p.pan.value = panV;
                    lfo.connect(depth); depth.connect(d.delayTime); lfo.start();
                    inp.connect(d); d.connect(p); p.connect(wet);
                    return lfo;
                });
                wet.connect(out);
                return { in: inp, out, wet, lfos };
            },
            limit() {
                const n = new AudioWorkletNode(ctx, 'wd-limiter', { outputChannelCount: [2] });
                return { in: n, out: n, node: n };
            },
        };
        const ORDER = ['dbl', 'gate', 'tune', 'hp', 'lp', 'eqL', 'eqM', 'eqH', 'cmp', 'drive', 'crush', 'chorus', 'limit'];

        const isActive = (t, key) => {
            const fx = t.fx || {};
            switch (key) {
                case 'dbl': return !!t.dbl;
                case 'eqL': case 'eqM': case 'eqH': return !!t[key];
                case 'cmp': return (t.fxCmp || 0) > 0;
                case 'tune': return (t.fxTune || 0) > 0;
                case 'lp': return (fx.lp || 0) > 0 || hasAuto(t, 'lp');
                default: return (fx[key] || 0) > 0;
            }
        };

        let wired = null; // null: noch nie verbunden (auch eine leere Effektkette muss verbunden werden)
        function rewire(t) {
            const active = ORDER.filter(k => isActive(t, k));
            const sig = active.join(',');
            if (sig === wired) return;
            wired = sig;
            input.disconnect();
            Object.values(blocks).forEach(b => { try { b.out.disconnect(); } catch { /* war nicht verbunden */ } });
            let prev = input;
            active.forEach(k => {
                if (!blocks[k]) blocks[k] = make[k]();
                prev.connect(blocks[k].in);
                prev = blocks[k].out;
            });
            prev.connect(fader);
        }

        function update(t, { immediate = false } = {}) {
            const fx = t.fx || {};
            rewire(t);
            routeSends(t);
            const set = (param, v) => {
                if (immediate) param.value = v; else param.setTargetAtTime(v, ctx.currentTime, 0.012);
            };
            if (blocks.eqL) set(blocks.eqL.node.gain, t.eqL || 0);
            if (blocks.eqM) set(blocks.eqM.node.gain, t.eqM || 0);
            if (blocks.eqH) set(blocks.eqH.node.gain, t.eqH || 0);
            if (blocks.hp) blocks.hp.node.frequency.value = 20 + Math.pow(fx.hp, 2) * 780;
            if (blocks.lp && !hasAuto(t, 'lp')) blocks.lp.node.frequency.value = lpFreq(fx.lp);
            if (blocks.cmp) {
                blocks.cmp.node.threshold.value = -(t.fxCmp || 0) * 35;
                blocks.cmp.node.ratio.value = 1 + (t.fxCmp || 0) * 9;
            }
            if (blocks.tune) {
                blocks.tune.node.parameters.get('amount').value = t.fxTune || 0;
                if (blocks.tune.sig !== scaleSig()) { blocks.tune.sig = scaleSig(); blocks.tune.node.port.postMessage(scaleOf()); }
            }
            if (blocks.gate) blocks.gate.node.parameters.get('threshold').value = -70 + fx.gate * 50;
            if (blocks.limit) blocks.limit.node.parameters.get('ceiling').value = -fx.limit * 12;
            if (blocks.crush) blocks.crush.node.parameters.get('amount').value = fx.crush;
            if (blocks.chorus) set(blocks.chorus.wet.gain, fx.chorus * 0.9);
            if (blocks.drive) {
                const b = blocks.drive, type = fx.driveType || 'overdrive';
                const sig = fx.drive + type;
                if (b.sig !== sig) { b.ws.curve = driveCurve(fx.drive, type); b.sig = sig; }
                b.pre.gain.value = 1 + fx.drive * (type === 'distortion' ? 6 : 3);
                b.tone.frequency.value = type === 'distortion' ? 4200 : 6500;
                b.post.gain.value = dbToGain(-fx.drive * (type === 'distortion' ? 11 : 7));
            }
            if (!hasAuto(t, 'pan')) set(pan.pan, t.pan || 0);
            if (!hasAuto(t, 'rev')) set(revSend.gain, t.fxRev || 0);
            set(dlySend.gain, t.fxDly || 0);
        }

        update(track, { immediate: true });

        // Ziel einer Automation: Audio-Parameter und Umrechnung vom Wert 0…1
        function autoParam(key) {
            if (key === 'vol') return { param: fader.gain, map: v => v };
            if (key === 'pan') return { param: pan.pan, map: v => v * 2 - 1 };
            if (key === 'rev') return { param: revSend.gain, map: v => v };
            if (key === 'lp' && blocks.lp) return { param: blocks.lp.node.frequency, map: v => lpFreq(1 - v) };
            return null;
        }

        return {
            input, fader, muteG, pan, live, update, autoParam,
            pumpAt(t, amount, dur) {
                const low = 1 - amount * .9, p = pump.gain;
                p.setTargetAtTime(low, t, .003);
                p.setValueAtTime(low, t + .015);
                p.linearRampToValueAtTime(1, t + .015 + dur);
            },
            setMuted(on, immediate) {
                if (immediate) muteG.gain.value = on ? 0 : 1;
                else muteG.gain.setTargetAtTime(on ? 0 : 1, ctx.currentTime, 0.006);
            },
            destroy() {
                [input, fader, muteG, pan, revSend, dlySend, revA, revB].forEach(n => { try { n.disconnect(); } catch { /* */ } });
                Object.values(blocks).forEach(b => {
                    try { b.in.disconnect(); b.out.disconnect(); } catch { /* */ }
                    if (b.lfos) b.lfos.forEach(l => { try { l.stop(); } catch { /* */ } });
                });
            },
        };
    }

    // Spielt eine Audio-Region ab, mit Regions-Lautstärke, Fades und Mikro-Fades gegen Knackser.
    function startRegionSource(ctx, dest, region, when, skipSec, durSec) {
        const buffer = WD.audioStore.get(region.bufId);
        if (!buffer || durSec <= 0.001) return null;
        const rate = region.rate || 1;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = rate;
        const g = ctx.createGain();
        const vol = region.gain === undefined ? 1 : region.gain;
        const total = region.lengthBars * WD.model.secPerBar();
        const pos0 = skipSec, pos1 = skipSec + durSec;
        const MICRO = 0.003;
        const fi = Math.max(region.fadeIn || 0, MICRO), fo = Math.max(region.fadeOut || 0, MICRO);
        const envAt = p => Math.min(1, p / fi) * Math.min(1, Math.max(0, total - p) / fo);
        g.gain.setValueAtTime(vol * (skipSec > 0 ? Math.max(envAt(pos0), 0) : 0), when);
        // Stützstellen der Hüllkurve innerhalb des gespielten Abschnitts
        [fi, total - fo].forEach(p => {
            if (p > pos0 && p < pos1) g.gain.linearRampToValueAtTime(vol * envAt(p), when + p - pos0);
        });
        g.gain.linearRampToValueAtTime(vol * envAt(pos1), when + durSec);
        src.connect(g); g.connect(dest);
        src.start(when, (region.offset || 0) + skipSec * rate, durSec * rate);
        return src;
    }

    WD.channel = { createStrip, startRegionSource, driveCurve };
})();
