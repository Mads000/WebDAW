// Phase 1: Black-Box-Bestandsaufnahme der unveränderten Original-DAW (nur UI, kein Zugriff auf Interna).
// Aufruf: node tests/baseline-original.mjs
import { launch, makeRunner, analyzeWav, sleep } from './lib/cdp.mjs';
import { mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const label = process.env.BASE_LABEL || 'original';
const shots = join(root, 'docs', 'screenshots', label);
const dl = join(process.env.TEMP || '.', 'webdaw-baseline-dl');
rmSync(dl, { recursive: true, force: true });
mkdirSync(shots, { recursive: true }); mkdirSync(dl, { recursive: true });
const url = pathToFileURL(join(root, process.env.BASE_TARGET || '_backup_original/WebDAW.html')).href;

// Stereo-Testdatei: links 440 Hz, rechts Stille -> deckt Mono-Verlust beim Speichern auf
const wavPath = join(dl, 'stereo-test.wav');
{
    const sr = 44100, n = sr * 2, b = Buffer.alloc(44 + n * 4);
    b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 4, 28);
    b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
    for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / sr * 6.283 * 440) * 20000), 44 + i * 4);
    writeFileSync(wavPath, b);
}

const { check, summary } = makeRunner();
const { page, close } = await launch({ downloadDir: dl });
const shot = n => page.screenshot(join(shots, n + '.png'));
const count = s => page.eval(`document.querySelectorAll(${JSON.stringify(s)}).length`);
const openMenu = async i => page.click(`.menu:nth-of-type(${i}) .menuBtn`);
const menuClick = async id => { await page.eval(`document.getElementById('${id}').closest('.menu').querySelector('.menuBtn').click()`); await page.click('#' + id); };
const waitDownload = async (pred, ms = 15000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) {
        const f = readdirSync(dl).filter(x => pred(x) && !x.endsWith('.crdownload') && !x.endsWith('.tmp'));
        if (f.length) { await sleep(150); return join(dl, f[0]); }
    }
    return null;
};
const saveProject = async () => {
    readdirSync(dl).filter(f => f.endsWith('.json')).forEach(f => rmSync(join(dl, f)));
    await menuClick('btnSave');
    const f = await waitDownload(x => x.endsWith('.json'));
    return f ? JSON.parse(readFileSync(f, 'utf8')) : null;
};

await page.goto(url);
await shot('01-start-leer');
check('Seite lädt ohne JS-Fehler', page.errors.length === 0, page.errors.join(' | '));

// --- Menüs ---
for (const [i, n] of [['btnAddDrum', 'spur'], ['btnSave', 'projekt'], ['btnDemo', 'demos']]) {
    await page.eval(`document.getElementById('${i}').closest('.menu').querySelector('.menuBtn').click()`);
    await sleep(60); await shot('02-menu-' + n);
    await page.eval(`document.getElementById('${i}').closest('.menu').querySelector('.menuBtn').click()`);
}

// --- Spuren ---
await menuClick('btnAddDrum'); await menuClick('btnAddInst'); await menuClick('btnAddAudio');
check('Spuren hinzufügen (Drum/Inst/Audio)', await count('.trow') === 3);
await shot('03-drei-spuren');
page.dialogAnswers.push({ accept: true, text: '<img src=x onerror="window.__xss=1">Hack' });
await page.dblclick('.trow:nth-child(1) .tname');
await sleep(150);
check('Spurname ohne HTML-Injection', !(await page.eval('window.__xss===1')), 'Name wird per innerHTML eingesetzt');
await page.eval(`window.__xss=0`);

// --- Drum-Editor + Piano-Roll ---
await page.dblclick('.trow:nth-child(1) .tlane', { x: 130, y: 30 });
await sleep(120);
check('Doppelklick auf Drum-Spur legt Region an', await count('.trow:nth-child(1) .region') === 1);
await shot('04-drum-editor');
await page.click('.gridrow:nth-child(1) .gcell:nth-child(2)');
await page.click('#edClose');
await page.dblclick('.trow:nth-child(2) .tlane', { x: 130, y: 30 });
await sleep(150);
await shot('05-piano-roll');
const cvw = await page.eval(`(()=>{const c=document.querySelectorAll('#edBody canvas')[1];const w=c.parentElement.parentElement.getBoundingClientRect();const r=c.getBoundingClientRect();return {x:r.x,y:w.y+60}})()`);
await page.drag(cvw.x + 60, cvw.y, cvw.x + 170, cvw.y);
await sleep(60);
let proj = await saveProject();
check('Piano Roll: Note per Ziehen gesetzt', proj && proj.tracks[1].regions[0].notes.length === 1, JSON.stringify(proj?.tracks[1].regions[0].notes));
await page.click('#edClose');

// --- Smart Controls ---
await page.click('.trow:nth-child(2) .thead', { x: 20, y: 40 });
await page.click('#btnSmart'); await sleep(100);
await shot('06-smart-controls');
await page.click('#btnSmart');

// --- Fokus-Bug: nach Anfassen eines Reglers Tastatur tot? ---
await page.click('#master');
await page.key(' ', { code: 'Space', keyCode: 32 });
await sleep(120);
const spaceWorks = await page.eval(`document.getElementById('btnPlay').classList.contains('active')`);
check('Leertaste funktioniert nach Klick auf Master-Regler', spaceWorks, 'Fokus bleibt im <input>');
if (spaceWorks) await page.click('#btnStop');
await page.eval('document.activeElement.blur()');

// --- MIDI-Aufnahme per Tastatur ---
await page.click('.trow:nth-child(2) .thead', { x: 20, y: 40 });
await page.click('#btnRec');
await sleep(200);
for (const k of ['a', 's', 'd']) { await page.holdKey(k, 150); await sleep(120); }
await page.click('#btnRec'); await sleep(80); await page.click('#btnStop');
proj = await saveProject();
const midiReg = proj.tracks[1].regions.find(r => r.name === 'Aufnahme');
check('MIDI-Aufnahme: Tastatur-Noten werden aufgezeichnet', midiReg && midiReg.notes.length === 3, `Noten in Region: ${midiReg?.notes.length}`);

// --- Audio-Aufnahme (Fake-Mikro) ---
await page.click('.trow:nth-child(3) .thead', { x: 20, y: 40 });
await page.click('#btnRec');
await sleep(1600);
await shot('07-aufnahme-laeuft');
await page.click('#btnRec'); await sleep(900); await page.click('#btnStop'); await sleep(300);
check('Audio-Aufnahme erzeugt Region', await count('.trow:nth-child(3) .region') === 1, page.errors.join('|'));
await shot('08-nach-audio-aufnahme');
// Undo nach Aufnahme: Take darf nicht verloren gehen bzw. muss eigener Schritt sein
const before = await count('.trow:nth-child(3) .region');
await page.click('#btnUndo'); await sleep(150);
const after = await count('.trow:nth-child(3) .region');
check('Undo direkt nach Aufnahme entfernt nur die Aufnahme', before === 1 && after === 0, `vorher ${before}, nachher ${after}; Spuren ${await count('.trow')}`);
await page.click('#btnRedo'); await sleep(150);
check('Redo bringt Aufnahme zurück', await count('.region') >= 1);

// --- Undo-Spam: Klick auf Region erzeugt Undo-Schritt ---
await page.eval(`location.reload()`); await sleep(800);
page.dialogAnswers.length = 0;
await menuClick('btnAddInst');
await page.dblclick('.trow:nth-child(1) .tlane', { x: 130, y: 30 }); await sleep(100); await page.click('#edClose');
for (let i = 0; i < 3; i++) await page.click('.region', { x: 30, y: 20 });
await page.click('#btnUndo'); await sleep(100);
check('Reines Anklicken einer Region erzeugt keinen Undo-Schritt', await count('.region') === 0, `Regionen nach 1×Undo: ${await count('.region')}`);

// --- Demos ---
for (const [id, name, tracks] of [['btnDemo', 'oasis', 6], ['btnBallad', 'ballade', 8], ['btnShadow', 'moll', 9], ['btnAcoustic', 'akustik', 7], ['btnRockin', 'rockin', 6]]) {
    page.errors.length = 0;
    await menuClick(id); await sleep(500);
    check(`Demo "${name}" lädt fehlerfrei`, await count('.trow') >= tracks - 1 && page.errors.length === 0, `${await count('.trow')} Spuren ${page.errors.join('|')}`);
    await shot('09-demo-' + name);
    await page.click('#btnStop');
}
// Region jenseits der Timeline (Rockin geht bis Takt 40, Timeline nur 32)
const overflow = await page.eval(`(()=>{const l=document.querySelector('#ruler').getBoundingClientRect().right;return Math.max(...[...document.querySelectorAll('.region')].map(r=>r.getBoundingClientRect().right+document.getElementById('arrange').scrollLeft))-l})()`);
check('Rockin-Demo passt in die Timeline', overflow <= 1, `Regionen ragen ${Math.round(overflow)} px über das Lineal hinaus`);

// Demos überschreiben ohne Rückfrage
await page.eval(`window.__n=document.querySelectorAll('.trow').length`);
page.dialogs.length = 0;
await menuClick('btnDemo'); await sleep(250); await page.click('#btnStop');
check('Demo fragt vor Überschreiben des Projekts nach', page.dialogs.some(d => d.type === 'confirm'), 'kein Dialog erschienen');
await page.click('#btnUndo'); await sleep(200);
check('Oasis-Demo per Undo rückgängig', (await count('.trow')) === (await page.eval('window.__n')), `Spuren jetzt ${await count('.trow')}, vorher ${await page.eval('window.__n')}`);

// --- Zoom: Rasterlinien müssen mitskalieren ---
await menuClick('btnRockin'); await sleep(200);
for (let i = 0; i < 3; i++) await page.click('#btnZoomIn');
await sleep(150); await shot('10-zoom-rein');
const grid = await page.eval(`getComputedStyle(document.querySelector('.tlane')).backgroundImage`);
const ppb = await page.eval(`document.querySelectorAll('.bartick')[1].getBoundingClientRect().x-document.querySelectorAll('.bartick')[0].getBoundingClientRect().x`);
check('Raster skaliert mit Zoom', grid.includes(ppb + 'px'), `Takt = ${ppb}px, Raster fest bei 120px`);
for (let i = 0; i < 5; i++) await page.click('#btnZoomOut');
await sleep(150); await shot('11-zoom-raus');

// --- Fenstergrößen ---
for (const [w, h] of [[1920, 1080], [1280, 720], [1024, 700], [800, 600]]) {
    await page.setViewport(w, h); await sleep(150);
    await shot(`12-fenster-${w}x${h}`);
    const hdr = await page.eval(`document.querySelector('header').getBoundingClientRect().height`);
    console.log(`INFO  Kopfzeile bei ${w}×${h}: ${Math.round(hdr)} px hoch`);
}
await page.setViewport(1440, 900);

// --- Bounce ---
readdirSync(dl).filter(f => f.endsWith('.wav') && f !== 'stereo-test.wav').forEach(f => rmSync(join(dl, f)));
await page.click('#btnStop');
const tB = Date.now();
await menuClick('btnBounce');
const wav = await waitDownload(x => x === 'song.wav', 120000);
check('Bounce erzeugt WAV', !!wav, `${((Date.now() - tB) / 1000).toFixed(1)} s, Bounce-Button aktiv: ${await page.eval(`document.getElementById('btnBounce').classList.contains('active')`)}, Fehler: ${page.errors[0] || '-'}`);
if (wav) {
    const a = analyzeWav(wav);
    console.log('INFO  Bounce:', JSON.stringify(a));
    check('Bounce ohne Clipping', a.clipped === 0, `${a.clipped} Samples an der Grenze, Peak ${a.peak.toFixed(3)}`);
}

// --- Audio-Import + Stereo-Erhalt beim Speichern ---
await page.setFile('#fileAudio', wavPath); await sleep(400);
proj = await saveProject();
const au = proj.tracks.flatMap(t => t.regions).find(r => r.audio);
check('Audio-Import erzeugt Region', !!au);
if (au) {
    const samples = Buffer.from(au.audio.b64, 'base64').length / 2;
    check('Speichern erhält Stereo', au.audio.channels === 2 || samples > 44100 * 2 * 1.5, `nur ${samples} Samples (= 1 Kanal) gespeichert`);
}
check('Projekt speichert Mute/Solo', 'mute' in proj.tracks[0] && 'solo' in proj.tracks[0], 'Felder fehlen');
check('Projekt speichert Tonart', 'key' in proj || 'keyRoot' in proj, 'Felder fehlen');
check('Projekt speichert Cycle-Bereich', 'cycle' in proj || 'cycleA' in proj, 'Felder fehlen');

// --- Fehlerhafte Datei darf aktuelles Projekt nicht zerstören ---
const nBefore = await count('.trow');
const bad = join(dl, 'kaputt.json'); writeFileSync(bad, '{"bpm":100}');
page.errors.length = 0; page.dialogs.length = 0;
await page.setFile('#fileProj', bad); await sleep(300);
check('Kaputte Projektdatei lässt Projekt unversehrt', await count('.trow') === nBefore, `Spuren vorher ${nBefore}, nachher ${await count('.trow')}`);
{ const after = await saveProject(); check('Kaputte Projektdatei: interner Zustand bleibt erhalten', after && after.tracks.length === nBefore, `Anzeige ${nBefore} Spuren, gespeicherter Zustand ${after?.tracks.length} Spuren`); }
check('Kaputte Projektdatei → verständliche Meldung', page.dialogs.length > 0, `Fehler nur in Konsole: ${page.errors[0]?.slice(0, 70)}`);

// --- Ungültiges Tempo ---
await page.eval(`(()=>{const b=document.getElementById('bpm');b.value='';b.dispatchEvent(new Event('input'))})()`);
page.errors.length = 0;
await page.click('#btnPlay'); await sleep(300);
const pos = await page.eval(`document.getElementById('pos').textContent`);
await sleep(500);
const pos2 = await page.eval(`document.getElementById('pos').textContent`);
const ph = await page.eval(`document.getElementById('playhead').style.left`);
console.log('INFO  Tempo leer: Play aktiv, Position', pos, '->', pos2, 'Playhead', ph);
check('Leeres Tempofeld bricht Transport nicht', /^\d+\.\d$/.test(pos) && page.errors.length === 0, `Position "${pos}" Fehler: ${page.errors[0]?.slice(0, 80) || '-'}`);
await page.click('#btnStop');
await page.eval(`document.getElementById('bpm').value=85`);

// --- Haupt-Thread-Last beim Abspielen ---
await menuClick('btnRockin'); await sleep(300);
await page.eval(`window.__lt=[];new PerformanceObserver(l=>l.getEntries().forEach(e=>window.__lt.push(Math.round(e.duration)))).observe({entryTypes:['longtask']})`);
await page.click('#btnPlay'); await sleep(8000);
const lt = await page.eval('window.__lt');
console.log('INFO  Long Tasks (>50ms) in 8 s Wiedergabe:', lt.length, 'max', Math.max(0, ...lt), 'ms, Summe', lt.reduce((a, b) => a + b, 0), 'ms');
await page.click('#btnStop');

// --- Autosave ---
await sleep(21000);
const as = await page.eval(`(()=>{const s=localStorage.getItem('webdaw_autosave');return s?s.length:0})()`);
console.log('INFO  Autosave-Größe (Zeichen):', as);
check('Autosave schreibt in localStorage', as > 0);
const hasAudio = await page.eval(`(()=>{const s=localStorage.getItem('webdaw_autosave');return !!s&&s.includes('"b64"')})()`);
check('Autosave enthält Audio', hasAudio);

// --- Kein Hänger im Leerlauf: rAF-Schleifen zählen ---
const perf = await page.send('Performance.enable').then(() => page.send('Performance.getMetrics'));
const m = Object.fromEntries(perf.metrics.map(x => [x.name, x.value]));
console.log('INFO  JS-Heap MB:', (m.JSHeapUsedSize / 1048576).toFixed(1), 'DOM-Knoten:', m.Nodes, 'Listener:', m.JSEventListeners);

// --- AudioContext-Infos ---
const ctxInfo = await page.eval(`(async()=>{const c=new AudioContext();const o={sr:c.sampleRate,base:c.baseLatency,out:c.outputLatency,state:c.state};await c.close();return o})()`);
console.log('INFO  AudioContext:', JSON.stringify(ctxInfo));

console.log('INFO  Konsolenfehler gesamt:', page.errors.length);
const s = summary();
writeFileSync(join(root, 'docs', label === 'original' ? 'baseline-results.json' : `baseline-results-${label}.json`), JSON.stringify(s, null, 2));
await close();
rmSync(dl, { recursive: true, force: true });
void statSync; void openMenu;
