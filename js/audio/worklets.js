// AudioWorklet-Prozessoren: Aufnahme, Noise Gate, Limiter, Bitcrusher.
// Als data:-URL geladen: Über file:// (Doppelklick auf index.html) blockiert Chrome sowohl Dateien als auch Blob-URLs.
'use strict';
(() => {
    const source = `
class RecorderProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.size = 4096; this.fill = 0; this.bufs = null; this.startFrame = 0; this.on = true;
        this.port.onmessage = e => { if (e.data === 'stop') { this.flush(); this.on = false; this.port.postMessage({ done: true }); } };
    }
    flush() {
        if (!this.bufs || !this.fill) return;
        const channels = this.bufs.map(b => b.slice(0, this.fill));
        this.port.postMessage({ frame: this.startFrame, channels }, channels.map(c => c.buffer));
        this.fill = 0;
    }
    process(inputs) {
        if (!this.on) return false;
        const inp = inputs[0];
        const n = inp.length ? inp[0].length : 128;
        const nCh = Math.max(1, inp.length);
        if (!this.bufs || this.bufs.length !== nCh) {
            this.flush();
            this.bufs = Array.from({ length: nCh }, () => new Float32Array(this.size));
        }
        if (this.fill === 0) this.startFrame = currentFrame;
        for (let c = 0; c < nCh; c++) {
            if (inp[c]) this.bufs[c].set(inp[c], this.fill);
        }
        this.fill += n;
        if (this.fill + 128 > this.size) this.flush();
        return true;
    }
}
registerProcessor('wd-recorder', RecorderProcessor);

class GateProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'threshold', defaultValue: -50, minValue: -90, maxValue: 0, automationRate: 'k-rate' },
            { name: 'attack', defaultValue: 0.002, minValue: 0.0001, maxValue: 0.1, automationRate: 'k-rate' },
            { name: 'release', defaultValue: 0.12, minValue: 0.005, maxValue: 1, automationRate: 'k-rate' },
        ];
    }
    constructor() { super(); this.env = 0; this.g = 0; this.hold = 0; }
    process(inputs, outputs, params) {
        const inp = inputs[0], out = outputs[0];
        if (!inp.length) return true;
        const open = Math.pow(10, params.threshold[0] / 20), close = open * 0.6;
        const aC = 1 - Math.exp(-1 / (params.attack[0] * sampleRate));
        const rC = 1 - Math.exp(-1 / (params.release[0] * sampleRate));
        const envC = 1 - Math.exp(-1 / (0.002 * sampleRate));
        const holdN = 0.03 * sampleRate;
        const n = inp[0].length;
        for (let i = 0; i < n; i++) {
            let peak = 0;
            for (let c = 0; c < inp.length; c++) peak = Math.max(peak, Math.abs(inp[c][i]));
            this.env += (peak - this.env) * envC;
            if (this.env > open) this.hold = holdN;
            else if (this.env < close && this.hold > 0) this.hold--;
            const target = this.hold > 0 ? 1 : 0;
            this.g += (target - this.g) * (target > this.g ? aC : rC);
            for (let c = 0; c < out.length; c++) out[c][i] = (inp[c] || inp[0])[i] * this.g;
        }
        return true;
    }
}
registerProcessor('wd-gate', GateProcessor);

// Brickwall-Limiter mit Vorausschau: gleitendes Minimum der Zielverstärkung, danach Boxfilter.
// Dadurch ist die Verstärkung garantiert gesenkt, bevor die verzögerte Spitze den Ausgang erreicht.
class LimiterProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'ceiling', defaultValue: -1, minValue: -24, maxValue: 0, automationRate: 'k-rate' },
            { name: 'release', defaultValue: 0.12, minValue: 0.01, maxValue: 1, automationRate: 'k-rate' },
        ];
    }
    constructor() {
        super();
        this.L = Math.max(16, Math.round(0.0025 * sampleRate));
        this.delay = null;
        this.minBuf = new Float32Array(this.L).fill(1); this.boxBuf = new Float32Array(this.L).fill(1);
        this.pos = 0; this.env = 1; this.boxSum = this.L;
    }
    process(inputs, outputs, params) {
        const inp = inputs[0], out = outputs[0];
        if (!inp.length) { return true; }
        const L = this.L, n = inp[0].length, nCh = inp.length;
        if (!this.delay || this.delay.length !== nCh) this.delay = Array.from({ length: nCh }, () => new Float32Array(L));
        const ceil = Math.pow(10, params.ceiling[0] / 20);
        const rel = 1 - Math.exp(-1 / (params.release[0] * sampleRate));
        for (let i = 0; i < n; i++) {
            let peak = 0;
            for (let c = 0; c < nCh; c++) peak = Math.max(peak, Math.abs(inp[c][i]));
            const target = peak > ceil ? ceil / peak : 1;
            this.minBuf[this.pos] = target;
            let m = 1;
            for (let k = 0; k < L; k++) if (this.minBuf[k] < m) m = this.minBuf[k];
            this.env = m < this.env ? m : this.env + (Math.min(1, m) - this.env) * rel;
            this.boxSum += this.env - this.boxBuf[this.pos];
            this.boxBuf[this.pos] = this.env;
            const g = this.boxSum / L;
            for (let c = 0; c < nCh; c++) {
                const d = this.delay[c], delayed = d[this.pos];
                d[this.pos] = inp[c][i];
                if (out[c]) out[c][i] = delayed * g;
            }
            this.pos = (this.pos + 1) % L;
        }
        return true;
    }
}
registerProcessor('wd-limiter', LimiterProcessor);

class CrushProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'amount', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
        ];
    }
    constructor() { super(); this.hold = []; this.cnt = 0; }
    process(inputs, outputs, params) {
        const inp = inputs[0], out = outputs[0];
        if (!inp.length) return true;
        const a = params.amount[0];
        const bits = 16 - a * 11, step = Math.pow(2, 1 - bits);
        const every = Math.max(1, Math.round(1 + a * a * 15));
        const n = inp[0].length;
        for (let i = 0; i < n; i++) {
            if (this.cnt++ % every === 0) {
                for (let c = 0; c < inp.length; c++) this.hold[c] = Math.round(inp[c][i] / step) * step;
            }
            for (let c = 0; c < out.length; c++) out[c][i] = this.hold[c] !== undefined ? this.hold[c] : (this.hold[0] || 0);
        }
        return true;
    }
}
registerProcessor('wd-crush', CrushProcessor);
`;
    let url = null;
    WD.worklets = {
        LOOKAHEAD_SEC: 0.0025,
        load(ctx) {
            if (!url) url = 'data:text/javascript;charset=utf-8,' + encodeURIComponent(source);
            return ctx.audioWorklet.addModule(url);
        },
    };
})();
