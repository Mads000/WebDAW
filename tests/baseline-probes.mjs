// Phase 1: gezielte Messungen am Original (Bounce-Dauer, Autosave-Grenze, Tempo-Wechsel, Cycle-Lücke).
import { launch, analyzeWav, sleep } from './lib/cdp.mjs';
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dl = join(process.env.TEMP || '.', 'webdaw-probe-dl');
rmSync(dl, { recursive: true, force: true }); mkdirSync(dl, { recursive: true });
const url = pathToFileURL(join(root, '_backup_original', 'WebDAW.html')).href;

const mkWav = (path, seconds) => {
    const sr = 44100, n = sr * seconds, b = Buffer.alloc(44 + n * 4);
    b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 4, 28);
    b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
    for (let i = 0; i < n; i++) { const v = Math.round(Math.sin(i / sr * 6.283 * 220) * 15000); b.writeInt16LE(v, 44 + i * 4); b.writeInt16LE(v, 46 + i * 4); }
    writeFileSync(path, b);
};
const { page, close } = await launch({ downloadDir: dl });
const menuClick = async id => { await page.eval(`document.getElementById('${id}').closest('.menu').querySelector('.menuBtn').click()`); await page.click('#' + id); };
const waitFile = async (name, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (readdirSync(dl).includes(name)) { await sleep(300); return (Date.now() - t) / 1000; } await sleep(200); } return null; };

await page.goto(url);
// 1) Bounce: Oasis-Demo (16 Takte @85)
await menuClick('btnDemo'); await sleep(300); await page.click('#btnStop');
await menuClick('btnBounce');
let sec = await waitFile('song.wav', 200000);
console.log('Bounce Oasis-Demo (16 Takte):', sec === null ? 'nicht fertig nach 200 s' : sec.toFixed(1) + ' s');
if (sec !== null) { console.log('  ', JSON.stringify(analyzeWav(join(dl, 'song.wav')))); rmSync(join(dl, 'song.wav')); }

// 2) Autosave: 3-Minuten-Datei
await page.goto(url);
const big = join(dl, 'lang.wav'); mkWav(big, 180);
await menuClick('btnAddAudio');
await page.setFile('#fileAudio', big); await sleep(2500);
const peakBefore = await page.eval(`document.querySelectorAll('.region').length`);
await sleep(21000);
const info = await page.eval(`(()=>{const s=localStorage.getItem('webdaw_autosave');return s?{len:s.length,audio:s.includes('"b64"')}:null})()`);
console.log('Autosave mit 3-min-Audio (Regionen', peakBefore, '):', JSON.stringify(info));

// 3) Tempo-Wechsel bei laufender Wiedergabe: springt die Position?
await page.goto(url);
await menuClick('btnDemo'); await sleep(2500);
const readPos = () => page.eval(`parseFloat(document.getElementById('playhead').style.left)`);
const a = await readPos();
await page.eval(`document.getElementById('bpm').value=170`);
await sleep(50);
const b = await readPos();
console.log(`Tempo 85→170 bei Wiedergabe: Playhead ${a.toFixed(0)} px → ${b.toFixed(0)} px in 50 ms (erwartet: wenige px)`);
await page.click('#btnStop');

// 4) Cycle: Schedulergenauigkeit — Zeit zwischen Loop-Neustarts (Soll: 1 Takt)
await page.goto(url);
await menuClick('btnDemo'); await sleep(200); await page.click('#btnStop');
await page.eval(`document.getElementById('bpm').value=120`);
const rr = await page.rect('#ruler');
await page.drag(rr.x + 2, rr.y + 10, rr.x + 120, rr.y + 10);
await page.eval(`(()=>{window.__jumps=[];let last=0,lastT=0;const el=document.getElementById('playhead');(function f(){const v=parseFloat(el.style.left);if(v<last-5){const t=performance.now();window.__jumps.push(Math.round(t-lastT));lastT=t}last=v;requestAnimationFrame(f)})()})()`);
await page.click('#btnPlay'); await sleep(9000); await page.click('#btnStop');
const j = await page.eval('window.__jumps');
console.log('Cycle 1 Takt @120 BPM (Soll 2000 ms) – gemessene Abstände:', j.slice(1).join(', '));

await close();
rmSync(dl, { recursive: true, force: true });
