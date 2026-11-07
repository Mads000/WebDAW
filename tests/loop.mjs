// Loop-Test für Audio- und MIDI-Regionen. Aufruf: node tests/loop.mjs
// Geprüft wird am berechneten Signal: Ein kurzer Ton am Anfang der Aufnahme muss in jedem Durchgang erklingen.
import { launch, makeRunner, sleep } from './lib/cdp.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.WEBDAW_URL || pathToFileURL(join(root, 'index.html')).href;
const { check, summary } = makeRunner();
const { page, close } = await launch();
const E = x => page.eval(x);
await page.goto(url, { settle: 800 });
await page.click('#btnPlay'); await page.click('#btnStop'); // Audio per Geste starten
await E(`WD.engine.ensure()`);

// 120 BPM: 1 Takt = 2 s. Aufnahme 2 s lang, Ton 0,1–0,3 s, danach Stille.
await E(`(()=>{
    WD.project.bpm = 120; WD.bus.emit('tempo');
    const sr = WD.engine.ctx.sampleRate, buf = new AudioBuffer({ length: sr * 2, numberOfChannels: 1, sampleRate: sr });
    const d = buf.getChannelData(0);
    for (let i = Math.round(sr * .1); i < sr * .3; i++) d[i] = Math.sin(i / sr * 2 * Math.PI * 440) * .5;
    const t = WD.tracksView.addTrack('audio');
    const r = WD.model.normalizeRegion({ startBar: 0, lengthBars: 1, bufId: WD.audioStore.put(buf), name: 'Gitarre', notes: [] });
    t.regions.push(r); WD.bus.emit('regions');
    window.__tid = t.id; window.__rid = r.id;
    window.R = () => WD.model.findRegion(__rid).region; window.T = () => WD.model.track(__tid);
    WD.regionOps.selectOnly([r.id]);
})()`);

// Energie je Durchgang: Ton-Fenster und Stille-Fenster
const measure = async (n) => JSON.parse(await E(`WD.render.render(WD.project.tracks, { useMaster: false, tail: .2 }).then(b => {
    const sr = b.sampleRate, d = b.getChannelData(0);
    const rms = (a, z) => { let s = 0; const i0 = Math.round(a * sr), i1 = Math.round(z * sr); for (let i = i0; i < i1; i++) s += d[i] * d[i]; return Math.sqrt(s / (i1 - i0)); };
    return JSON.stringify(Array.from({ length: ${n} }, (_, k) => ({ ton: +rms(k * 2 + .13, k * 2 + .27).toFixed(3), still: +rms(k * 2 + .6, k * 2 + 1.9).toFixed(4) })));
})`));
const allLoud = m => m.every(x => x.ton > 0.1 && x.still < 0.01);

await page.key('l'); await sleep(150);
let r = JSON.parse(await E(`JSON.stringify({ len: R().lengthBars, loop: R().loopLen, label: document.querySelector('.region[data-id="' + __rid + '"] .rhead').textContent })`));
check('Taste L loopt die Aufnahme (am Songende: 4 Durchgänge)', r.len === 4 && r.loop === 1 && /↻ 4×/.test(r.label), JSON.stringify(r));
let m = await measure(4);
check('Export: Ton erklingt in jedem der 4 Durchgänge, dazwischen Stille', allLoud(m), JSON.stringify(m));

// Live-Wiedergabe mitten im dritten Durchgang starten
await E(`WD.transport.seek(2.5); WD.transport.play()`); await sleep(1200);
check('Wiedergabe mitten im Loop läuft ohne Fehler', await E(`WD.transport.playing`) && page.errors.length === 0, page.errors.join(' | '));
await E(`WD.transport.stop()`);

// Undo und L zum Entfernen
await page.key('z', { modifiers: 2 }); await sleep(100);
check('Rückgängig nimmt den Loop zurück', await E(`R().lengthBars === 1 && !WD.model.isLooped(R())`));
await page.key('l'); await sleep(100); await page.key('l'); await sleep(100);
check('L auf geloopter Region entfernt den Loop', await E(`R().lengthBars === 1 && R().loopLen === 0`), await E(`JSON.stringify({l:R().lengthBars,lp:R().loopLen})`));

// Loop-Griff mit der Maus ziehen: zwei Takte nach rechts
await E(`WD.view.ppb = 60; WD.bus.emit('zoom'); WD.regionOps.selectOnly([__rid])`); await sleep(100);
const h = await page.rect(`.region[data-id="${await E('__rid')}"] .rloop`);
await page.drag(h.x + h.w / 2, h.y + h.h / 2, h.x + h.w / 2 + 2 * 60 * 1, h.y + h.h / 2, { steps: 8 });
r = JSON.parse(await E(`JSON.stringify({ len: R().lengthBars, loop: R().loopLen })`));
check('Loop-Griff: Ziehen um 2 Takte ergibt 3 Durchgänge', Math.abs(r.len - 3) < 1e-6 && r.loop === 1, JSON.stringify(r));
check('Export nach Griff: 3 Durchgänge hörbar', allLoud(await measure(3)));

// Längen-Griff ungeloopter Aufnahmen endet weiter am Aufnahme-Ende
await E(`(()=>{ const t = WD.tracksView.addTrack('audio'); const r = WD.model.normalizeRegion({ startBar: 8, lengthBars: 1, bufId: R().bufId, notes: [] }); t.regions.push(r); WD.bus.emit('regions'); window.__r2 = r; })()`); await sleep(100);
const g = await page.rect(`.region[data-id="${await E('__r2.id')}"] .rsz`);
await page.drag(g.x + g.w / 2, g.y + g.h / 2, g.x + g.w / 2 + 180, g.y + g.h / 2, { steps: 8 });
check('Längen-Griff ohne Loop: nicht länger als die Aufnahme', await E(`Math.abs(__r2.lengthBars - 1) < 1e-6 && !__r2.loopLen`), await E(`__r2.lengthBars`));
await E(`WD.project.tracks = WD.project.tracks.filter(t => !t.regions.includes(__r2)); WD.bus.emit('tracks')`);

// Teilen mitten im Loop
await E(`WD.transport.seek(2.5); WD.regionOps.selectOnly([__rid]); WD.regionOps.splitAtPlayhead()`); await sleep(100);
const parts = JSON.parse(await E(`JSON.stringify(T().regions.map(x => [x.startBar, +x.lengthBars.toFixed(3), x.loopLen]).sort((a, b) => a[0] - b[0]))`));
check('Teilen im Loop: Durchgänge werden einzelne Regionen', parts.length === 4 && parts.every(p => !p[2]) && parts[2][0] === 2 && parts[3][0] === 2.5, JSON.stringify(parts));
check('Export nach Teilen klingt gleich', allLoud(await measure(3)));
await page.key('z', { modifiers: 2 }); await sleep(100);

// Loop auflösen per Menü-Funktion
await E(`WD.regionOps.unloop(T(), T().regions[0])`);
check('Loop auflösen: 3 einzelne Regionen', await E(`T().regions.length === 3 && T().regions.every(x => !WD.model.isLooped(x))`));
check('Export nach Auflösen klingt gleich', allLoud(await measure(3)));
await page.key('z', { modifiers: 2 }); await sleep(100);

// Tempo: Audio behält seine Dauer in Sekunden; bei halbem Tempo belegt es halb so viele Takte, der Loop ebenso
await E(`WD.model.setBpm(60)`);
r = JSON.parse(await E(`JSON.stringify({ len: T().regions[0].lengthBars, loop: T().regions[0].loopLen })`));
check('Tempo halbiert: Loop bleibt 3 Durchgänge à 2 s', Math.abs(r.len - 1.5) < 1e-6 && Math.abs(r.loop - 0.5) < 1e-6, JSON.stringify(r));
check('Export bei 60 BPM: Ton weiter alle 2 s', allLoud(await measure(3)));
await E(`WD.model.setBpm(120)`);

// MIDI-Region mit L loopen
await E(`(()=>{ const t = WD.tracksView.addTrack('inst'); const r = WD.model.normalizeRegion({ startBar: 0, lengthBars: 1, notes: [{ t: 0, n: 60, d: .25, v: .8 }] }); t.regions.push(r); WD.bus.emit('regions'); window.__m = r; WD.regionOps.selectOnly([r.id]); })()`);
await page.key('l'); await sleep(100);
check('Taste L loopt auch MIDI-Regionen', await E(`WD.model.isLooped(__m) && __m.loopLen === 1 && __m.lengthBars > 1`), await E(`JSON.stringify({l:__m.lengthBars,lp:__m.loopLen})`));

check('Keine JavaScript-Fehler', page.errors.length === 0, page.errors.join(' | '));
await close();
const s = summary();
process.exitCode = s.failed ? 1 : 0;
