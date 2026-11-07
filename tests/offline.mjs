// Offline-Test: Seite über http laden, Netz abschalten, neu laden. Aufruf: node tests/offline.mjs [URL]
// Ohne URL wird ein lokaler Server auf dem Projektordner gestartet.
import { launch, makeRunner, sleep } from './lib/cdp.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
let server = null, url = process.argv[2];
if (!url) {
    server = createServer(async (req, res) => {
        const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
        const file = p || 'index.html';
        try {
            const body = await readFile(join(root, file));
            res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }); res.end(body);
        } catch { res.writeHead(404); res.end(); }
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${server.address().port}/`;
}

const { check, summary } = makeRunner();
const { page, close } = await launch({ realistic: true });
const E = expr => page.eval(expr);

await page.goto(url, { settle: 500 });
const ready = await E(`Promise.race([navigator.serviceWorker.ready.then(()=>true), new Promise(r=>setTimeout(()=>r(false),15000))])`);
check('Service Worker aktiv', ready);
await sleep(1500);
const cached = await E(`caches.open('webdaw-app').then(c=>c.keys()).then(k=>k.length)`);
const needed = await E(`document.querySelectorAll('script[src], link[href]:not([href^="data:"])').length`);
check('Alle App-Dateien gespeichert', cached >= needed, JSON.stringify({ cached, needed }));

const { installabilityErrors: instErr } = await page.send('Page.getInstallabilityErrors');
check('Chrome hält die Seite für installierbar', instErr.length === 0, instErr.map(e => e.errorId).join(', '));

await page.send('Network.enable');
await page.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
page.errors.length = 0;
await page.goto(url, { settle: 1500 });
check('Offline: DAW startet', await E(`!!(window.WD && WD.transport && document.getElementById('btnPlay'))`));
check('Offline: Skripte vollständig', await E(`typeof WD.install==='object' && typeof WD.storage==='object' && typeof WD.engine==='object'`));
await page.click('#btnPlay'); await sleep(1500);
check('Offline: Wiedergabe läuft', await E(`WD.transport.playing && WD.engine.ctx.state==='running' && WD.transport.current()>0`), await E(`JSON.stringify({p:WD.transport.current(),s:WD.engine.ctx&&WD.engine.ctx.state})`));
await page.click('#btnStop');
check('Offline: keine Fehler', page.errors.length === 0, page.errors.slice(0, 5).join(' | '));

await close();
if (server) server.close();
summary();
