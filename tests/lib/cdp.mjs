// Minimaler Chrome-DevTools-Treiber ohne npm-Abhängigkeiten (Node >= 22: globales WebSocket + fetch).
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME_PATHS = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

export { sleep };

// realistic: ohne Autoplay-Freigabe, wie bei einem normalen Browserstart
export async function launch({ width = 1440, height = 900, fakeAudioFile = null, downloadDir = null, realistic = false } = {}) {
    // WEBDAW_BROWSER: anderer Chromium-Browser, z. B. Opera GX
    const exe = process.env.WEBDAW_BROWSER || CHROME_PATHS.find(existsSync);
    if (!exe) throw new Error('Kein Chrome/Edge gefunden');
    const dataDir = mkdtempSync(join(tmpdir(), 'webdaw-test-'));
    const args = [
        '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dataDir}`,
        `--window-size=${width},${height}`, '--no-first-run', '--no-default-browser-check',
        ...(realistic ? [] : ['--autoplay-policy=no-user-gesture-required']),
        '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
        'about:blank',
    ];
    if (fakeAudioFile) args.push(`--use-file-for-fake-audio-capture=${fakeAudioFile}`);
    const proc = spawn(exe, args, { stdio: 'ignore' });

    let port = null;
    for (let i = 0; i < 100 && !port; i++) {
        await sleep(100);
        const f = join(dataDir, 'DevToolsActivePort');
        try { if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0].trim(); } catch { /* Chrome schreibt noch */ }
    }
    if (!port) { proc.kill(); throw new Error('Chrome hat keinen Debug-Port geöffnet'); }

    let target = null;
    for (let i = 0; i < 30 && !target; i++) {
        const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = targets.find(t => t.type === 'page');
        if (!target) await sleep(100);
    }
    // Manche Browser (z. B. Opera) öffnen ohne Fenster keinen Tab
    if (!target) target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const page = new Page(target.webSocketDebuggerUrl);
    await page.connect();
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Log.enable');
    await page.send('DOM.enable');
    await page.setViewport(width, height);
    if (downloadDir) {
        mkdirSync(downloadDir, { recursive: true });
        await page.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
    }
    return {
        page,
        close: async () => {
            try { await page.send('Browser.close'); } catch { /* bereits weg */ }
            proc.kill();
            await sleep(300);
            try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* Windows-Dateisperre */ }
        },
    };
}

class Page {
    constructor(wsUrl) {
        this.wsUrl = wsUrl; this.nextId = 1; this.pending = new Map();
        this.errors = []; this.console = []; this.dialogs = [];
        this.dialogAnswers = []; // Warteschlange: {accept, text}
    }
    connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.wsUrl);
            this.ws.onopen = resolve;
            this.ws.onerror = reject;
            this.ws.onmessage = ev => this.#onMessage(JSON.parse(ev.data));
        });
    }
    #onMessage(m) {
        if (m.id) {
            const p = this.pending.get(m.id); this.pending.delete(m.id);
            if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`)); else p.resolve(m.result);
            return;
        }
        if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params.exceptionDetails;
            this.errors.push((d.exception && d.exception.description) || d.text);
        } else if (m.method === 'Runtime.consoleAPICalled') {
            const text = m.params.args.map(a => a.value ?? a.description ?? '').join(' ');
            this.console.push({ level: m.params.type, text });
            if (m.params.type === 'error') this.errors.push('console.error: ' + text);
        } else if (m.method === 'Log.entryAdded') {
            if (m.params.entry.level === 'error') this.errors.push('log: ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
        } else if (m.method === 'Page.javascriptDialogOpening') {
            const ans = this.dialogAnswers.shift() || { accept: true };
            this.dialogs.push({ type: m.params.type, message: m.params.message, answered: ans });
            this.send('Page.handleJavaScriptDialog', { accept: ans.accept, promptText: ans.text ?? m.params.defaultPrompt ?? '' }).catch(() => {});
        }
    }
    send(method, params = {}) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject, method });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }
    async setViewport(width, height) {
        await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    }
    async goto(url, { settle = 400 } = {}) {
        const loaded = new Promise(res => {
            const handler = this.ws.onmessage;
            this.ws.onmessage = ev => {
                const m = JSON.parse(ev.data);
                handler(ev);
                if (m.method === 'Page.loadEventFired') { this.ws.onmessage = handler; res(); }
            };
        });
        await this.send('Page.navigate', { url });
        await Promise.race([loaded, sleep(10000)]);
        await sleep(settle);
    }
    async eval(expr) {
        const r = await this.send('Runtime.evaluate', {
            expression: expr, awaitPromise: true, returnByValue: true, userGesture: true,
        });
        if (r.exceptionDetails) {
            const d = r.exceptionDetails;
            throw new Error('eval: ' + ((d.exception && d.exception.description) || d.text) + '\n  in: ' + expr.slice(0, 200));
        }
        return r.result.value;
    }
    // Klick über echtes Eingabe-Event (nicht element.click()), damit auch Überdeckungen auffallen.
    async rect(sel) {
        const r = await this.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;let b=e.getBoundingClientRect();if(b.right<0||b.left>innerWidth||b.bottom<0||b.top>innerHeight){e.scrollIntoView({block:'center',inline:'center'});b=e.getBoundingClientRect()}return {x:b.x,y:b.y,w:b.width,h:b.height}})()`);
        if (!r) throw new Error('Element nicht gefunden: ' + sel);
        return r;
    }
    async click(sel, opts = {}) {
        const r = await this.rect(sel);
        const x = opts.x !== undefined ? r.x + opts.x : r.x + r.w / 2;
        const y = opts.y !== undefined ? r.y + opts.y : r.y + r.h / 2;
        await this.mouseClick(x, y, opts);
    }
    async mouseClick(x, y, { button = 'left', clickCount = 1 } = {}) {
        await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: button === 'left' ? 1 : 2, clickCount });
        await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount });
        await sleep(30);
    }
    async dblclick(sel, opts = {}) {
        const r = await this.rect(sel);
        const x = opts.x !== undefined ? r.x + opts.x : r.x + r.w / 2;
        const y = opts.y !== undefined ? r.y + opts.y : r.y + r.h / 2;
        await this.mouseClick(x, y, { clickCount: 1 });
        await this.mouseClick(x, y, { clickCount: 2 });
    }
    async drag(x0, y0, x1, y1, { steps = 6, button = 'left' } = {}) {
        await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0 });
        await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button, buttons: 1, clickCount: 1 });
        for (let i = 1; i <= steps; i++) {
            const x = x0 + (x1 - x0) * i / steps, y = y0 + (y1 - y0) * i / steps;
            await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button, buttons: 1 });
            await sleep(16);
        }
        await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button, buttons: 0, clickCount: 1 });
        await sleep(40);
    }
    async key(key, { code, modifiers = 0, keyCode, text } = {}) {
        const c = code || (key.length === 1 ? (/[a-z]/i.test(key) ? 'Key' + key.toUpperCase() : /[0-9]/.test(key) ? 'Digit' + key : '') : key);
        const vk = keyCode || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : { Space: 32, ' ': 32, Delete: 46, Backspace: 8, Enter: 13, Escape: 27, Home: 36, ArrowLeft: 37, ArrowRight: 39, ArrowUp: 38, ArrowDown: 40 }[key] || 0);
        const printable = text !== undefined ? text : (key.length === 1 && !(modifiers & 2) ? key : undefined);
        await this.send('Input.dispatchKeyEvent', { type: printable ? 'keyDown' : 'rawKeyDown', key, code: c, windowsVirtualKeyCode: vk, modifiers, text: printable });
        await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: c, windowsVirtualKeyCode: vk, modifiers });
        await sleep(30);
    }
    async holdKey(key, ms) {
        const c = 'Key' + key.toUpperCase(), vk = key.toUpperCase().charCodeAt(0);
        await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: c, windowsVirtualKeyCode: vk, text: key });
        await sleep(ms);
        await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: c, windowsVirtualKeyCode: vk });
    }
    async setFile(sel, path) {
        const { root } = await this.send('DOM.getDocument');
        const { nodeId } = await this.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
        await this.send('DOM.setFileInputFiles', { nodeId, files: [path] });
        await sleep(200);
    }
    async screenshot(path) {
        const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(path, Buffer.from(data, 'base64'));
    }
}

// --- Mini-Testrunner ---------------------------------------------------------
export function makeRunner() {
    const results = [];
    const check = (name, ok, detail = '') => {
        results.push({ name, ok: !!ok, detail: String(detail) });
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? '  — ' + detail : ''}`);
        return !!ok;
    };
    const summary = () => {
        const failed = results.filter(r => !r.ok);
        console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
        failed.forEach(r => console.log('  FAIL ' + r.name + (r.detail ? ' — ' + r.detail : '')));
        return { total: results.length, failed: failed.length, results };
    };
    return { check, summary };
}

// --- WAV-Analyse (PCM 16 Bit), für Bounce-Prüfungen ---------------------------
export function analyzeWav(path) {
    const b = readFileSync(path);
    const ch = b.readUInt16LE(22), sr = b.readUInt32LE(24), bits = b.readUInt16LE(34);
    let off = 12;
    while (off < b.length - 8 && b.toString('ascii', off, off + 4) !== 'data') off += 8 + b.readUInt32LE(off + 4);
    const dataLen = b.readUInt32LE(off + 4); off += 8;
    let peak = 0, sum = 0, clipped = 0, n = 0;
    for (let i = off; i + 1 < off + dataLen; i += 2) {
        const v = b.readInt16LE(i) / 32768, a = Math.abs(v);
        if (a > peak) peak = a;
        if (a >= 0.9995) clipped++;
        sum += v * v; n++;
    }
    return { channels: ch, sampleRate: sr, bits, seconds: n / ch / sr, peak, rms: Math.sqrt(sum / Math.max(1, n)), clipped };
}
