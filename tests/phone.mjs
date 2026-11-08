// Handy-Ansicht und Geräte-Sync in echtem Chrome (zwei Browser, echter PeerJS-Vermittler, Verbindung über localhost).
import { launch, makeRunner, sleep } from './lib/cdp.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.WEBDAW_URL || pathToFileURL(join(root, 'index.html')).href;
const { check, summary } = makeRunner();

const W = 390, H = 844;
const a = await launch({ width: W, height: H });
const P = a.page, E = x => P.eval(x);
await P.goto(base + '?ui=phone', { settle: 900 });

console.log('=== Handy-Ansicht ===');
check('Handy-Oberfläche ist aktiv, PC-Oberfläche verborgen', await E(`getComputedStyle(document.getElementById('phone')).display==='flex'&&getComputedStyle(document.getElementById('topbar')).display==='none'`));
check('Kein horizontales Scrollen', await E(`document.documentElement.scrollWidth<=innerWidth`));
const cramped = await E(`[...document.querySelectorAll('#phone button')].filter(b=>b.offsetParent&&(b.offsetWidth<36||b.offsetHeight<36)).map(b=>b.textContent||b.className)`);
check('Alle Knöpfe sind fingergroß', cramped.length === 0, cramped.join(','));
await P.screenshot(join(root, 'docs/screenshots/neu/29-handy-leer.png'));

await P.click('.p-rec');
await sleep(900);
const r1 = await E(`({n:WD.project.tracks.length,t:WD.project.tracks[0]&&WD.project.tracks[0].type,cap:WD.recorder.isCapturing(),on:document.querySelector('.p-rec').classList.contains('on')})`);
check('Roter Knopf legt Spur an und nimmt sofort auf', r1.n === 1 && r1.t === 'audio' && r1.cap && r1.on, JSON.stringify(r1));
await sleep(900);
await P.screenshot(join(root, 'docs/screenshots/neu/30-handy-aufnahme.png'));
await P.click('.p-rec');
await sleep(700);
const r2 = await E(`(()=>{const r=WD.project.tracks[0].regions[0];const b=r&&WD.audioStore.get(r.bufId);return{dur:b&&b.duration,cap:WD.recorder.isCapturing()}})()`);
check('Aufnahme landet als Region in der Spur', r2.dur > .5 && !r2.cap, JSON.stringify(r2));

await P.click('.p-step[aria-label="Schneller"]');
await P.click('.p-step[aria-label="Schneller"]');
check('Tempo-Knopf ändert das Projekt', await E(`WD.project.bpm`) === 87, await E(`WD.project.bpm`));
await E(`WD.tracksView.addTrack('drum')`); await sleep(100);
await E(`(()=>{const t=WD.project.tracks[1];WD.view.selTrackId=t.id;WD.bus.emit('tracks')})()`);
await E(`[...document.querySelectorAll('.p-side')].find(b=>/Tasten/.test(b.textContent)).click()`); await sleep(100);
check('Drum-Spur zeigt acht Pads', await E(`document.querySelectorAll('.p-pad').length`) === 8);
await P.screenshot(join(root, 'docs/screenshots/neu/31-handy-pads.png'));
await E(`WD.tracksView.addTrack('inst')`); await sleep(100);
await E(`(()=>{const t=WD.project.tracks[2];WD.view.selTrackId=t.id;WD.bus.emit('tracks')})()`); await sleep(100);
check('Instrument zeigt Klaviatur', await E(`document.querySelectorAll('.p-white').length`) === 8);

const rec = await E(`(async()=>{await WD.engine.ensure();const t=WD.project.tracks[2];await WD.recorder.start();await new Promise(r=>setTimeout(r,300));
  const k=document.querySelector('.p-white');const o={bubbles:true,pointerId:1,button:0};
  k.setPointerCapture=()=>{};k.dispatchEvent(new PointerEvent('pointerdown',o));await new Promise(r=>setTimeout(r,250));k.dispatchEvent(new PointerEvent('pointerup',o));await new Promise(r=>setTimeout(r,100));
  WD.recorder.stop();WD.transport.stop();const r=t.regions[0];return{n:r&&r.notes.length,first:r&&r.notes[0]&&r.notes[0].n}})()`);
check('Klaviatur-Noten werden aufgenommen', rec.n === 1 && rec.first === 60, JSON.stringify(rec));
await P.screenshot(join(root, 'docs/screenshots/neu/32-handy-klaviatur.png'));

await E(`document.querySelector('.p-tinfo').click()`); await sleep(120);
check('Klangauswahl passt zum Spurtyp', /Akustikgitarre/.test(await E(`document.querySelector('.modal').textContent`)));
await P.screenshot(join(root, 'docs/screenshots/neu/33-handy-klang.png'));
await E(`[...document.querySelectorAll('.modal button')].find(b=>b.textContent==='Fertig').click()`);
check('Kein horizontales Scrollen mit Spuren', await E(`document.querySelector('.p-list').scrollWidth<=document.querySelector('.p-list').clientWidth+1`));

console.log('\n=== Sync ===');
const b = await launch({ width: 1440, height: 900 });
const Q = b.page, F = x => Q.eval(x);
await Q.goto(base, { settle: 900 });
check('PC bleibt in der PC-Ansicht', await F(`!document.documentElement.classList.contains('phone')`));
const before = await F(`new Promise(r=>WD.db.all('projects').then(l=>r(l.length)))`);

await E(`WD.storage.rename('Handy-Idee')`); await sleep(100);
await E(`WD.sync.sendDialog()`);
let code = '';
for (let i = 0; i < 80 && !/^\d{3} \d{3}$/.test(code); i++) { await sleep(150); code = await E(`document.querySelector('.sync-code').textContent`); }
check('Handy zeigt einen sechsstelligen Code', /^\d{3} \d{3}$/.test(code), code + ' / ' + await E(`document.querySelector('.sync-status').textContent`));
await P.screenshot(join(root, 'docs/screenshots/neu/34-handy-senden.png'));
const src = await E(`(()=>{const t=WD.project.tracks[0],b=WD.audioStore.get(t.regions[0].bufId),d=b.getChannelData(0);let s=0;for(let i=0;i<d.length;i+=97)s+=d[i];return{len:b.length,sum:s,tr:WD.project.tracks.length}})()`);

await F(`WD.sync.receiveDialog()`); await sleep(100);
await F(`document.querySelector('.sync-input').value=${JSON.stringify(code)}`);
await F(`[...document.querySelectorAll('.modal button')].find(b=>b.textContent==='Empfangen').click()`);
let got = false;
for (let i = 0; i < 200 && !got; i++) { await sleep(150); got = await F(`WD.project.name==='Handy-Idee'&&WD.project.tracks.length===3`); }
check('Song kommt am PC als Projekt an', got, await F(`(document.querySelector('.sync-status')||{}).textContent||WD.project.name`));
await sleep(600);
const dst = await F(`(()=>{const t=WD.project.tracks[0],b=WD.audioStore.get(t.regions[0].bufId),d=b.getChannelData(0);let s=0;for(let i=0;i<d.length;i+=97)s+=d[i];return{len:b.length,sum:s,tr:WD.project.tracks.length}})()`);
check('Audio ist bitgenau angekommen', dst.len === src.len && Math.abs(dst.sum - src.sum) < 1e-6 && dst.tr === src.tr, JSON.stringify({ src, dst }));
check('Angekommener Song ist gespeichert', await F(`WD.db.all('projects').then(l=>l.length)`) === before + 1);
await sleep(400);
check('Handy meldet die Ankunft und schließt den Dialog', await E(`!document.querySelector('.sync-code')`));

await E(`WD.sync.receiveDialog()`); await sleep(100);
await E(`document.querySelector('.sync-input').value='000000'`);
await E(`[...document.querySelectorAll('.modal button')].find(b=>b.textContent==='Empfangen').click()`);
let msg = '';
for (let i = 0; i < 200 && !/Code/.test(msg); i++) { await sleep(150); msg = await E(`document.querySelector('.sync-status').textContent`); }
check('Falscher Code gibt eine klare Meldung', /kein Gerät/.test(msg), msg);
await E(`[...document.querySelectorAll('.modal button')].find(b=>b.textContent==='Abbrechen').click()`);

check('Keine JavaScript-Fehler am Handy', P.errors.length === 0, P.errors.join(' | '));
check('Keine JavaScript-Fehler am PC', Q.errors.length === 0, Q.errors.join(' | '));
await a.close(); await b.close();
process.exit(summary().failed ? 1 : 0);
