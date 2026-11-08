// Echte Maus- und Tastaturereignisse für die Gesten der Zeitleiste und des Editors. Aufruf: node tests/e2e-mouse.mjs
import { launch, makeRunner, sleep } from './lib/cdp.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { check, summary } = makeRunner();
const { page, close } = await launch();
const E = x => page.eval(x);
const near = (a, b, t) => Math.abs(a - b) <= t;
await page.goto(pathToFileURL(join(root, 'index.html')).href, { settle: 600 });
await page.mouseClick(700, 14); await E(`WD.engine.ensure()`);

// Aufbau: 3 Instrumentspuren, eine Audio-Spur mit Inhalt
await E(`(()=>{const c=WD.engine.ctx,b=c.createBuffer(2,c.sampleRate*8,c.sampleRate);
WD.history.run('x',()=>{
 const A=WD.model.addTrack('inst','Eins',{inst:'Organ'}),B=WD.model.addTrack('inst','Zwei',{inst:'Organ'}),C=WD.model.addTrack('inst','Drei',{inst:'Organ'}),D=WD.model.addTrack('audio','Vier',{});
 A.regions.push(WD.model.normalizeRegion({startBar:1,lengthBars:1,notes:[{t:0,n:60,d:.25}],name:'R1'}));
 B.regions.push(WD.model.normalizeRegion({startBar:3,lengthBars:1,notes:[{t:0,n:62,d:.25}],name:'R2'}));
 D.regions.push(WD.model.normalizeRegion({startBar:0,lengthBars:2,bufId:WD.audioStore.put(b),offset:0,notes:[],name:'Audio'}));
 WD.project.markers=[{name:'Intro',startBar:0,lengthBars:2},{name:'Verse',startBar:2,lengthBars:2},{name:'Chorus',startBar:4,lengthBars:2}];
});WD.view.selTrackId=WD.project.tracks[0].id;WD.bus.emit('project',{soft:true})})()`);
await sleep(200);
const ppb = await E(`WD.view.ppb`);
const ruler = await page.rect('#ruler');
const row = async i => page.rect(`.trow:nth-child(${i + 1}) .tlane`);
const regionRect = n => E(`(()=>{const f=WD.project.tracks.flatMap(t=>t.regions).find(r=>r.name===${JSON.stringify(n)});const b=WD.lanes.nodeOf(f.id).getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height,id:f.id}})()`);
const reg = n => E(`WD.project.tracks.flatMap(t=>t.regions).find(r=>r.name===${JSON.stringify(n)})`);

// Lineal
await page.mouseClick(ruler.x + 2.5 * ppb, ruler.y + 20); await sleep(80);
check('Lineal-Klick setzt die Position (am Raster)', near(await E(`WD.transport.current()`), 2.5, .001));
await page.drag(ruler.x + ppb, ruler.y + 20, ruler.x + 3 * ppb, ruler.y + 20); await sleep(80);
let cyc = await E(`WD.project.cycle`);
check('Lineal ziehen legt Cycle an', cyc.on && near(cyc.a, 1, .001) && near(cyc.b, 3, .001), JSON.stringify(cyc));
await page.drag(ruler.x + 2 * ppb, ruler.y + 4, ruler.x + 3 * ppb, ruler.y + 4); await sleep(80);
cyc = await E(`WD.project.cycle`);
check('Cycle-Balken verschiebbar', near(cyc.a, 2, .001) && near(cyc.b, 4, .001), JSON.stringify(cyc));
await page.drag(ruler.x + 4 * ppb, ruler.y + 4, ruler.x + 6 * ppb, ruler.y + 4); await sleep(80);
cyc = await E(`WD.project.cycle`);
check('Cycle-Ende ziehbar', near(cyc.a, 2, .001) && near(cyc.b, 6, .001), JSON.stringify(cyc));
await page.mouseClick(ruler.x + 3 * ppb, ruler.y + 4); await sleep(80);
check('Klick auf Cycle-Balken schaltet um', !(await E(`WD.project.cycle.on`)));

// Region verschieben, Griffe
let r1 = await regionRect('R1');
await page.drag(r1.x + 30, r1.y + 30, r1.x + 30 + ppb, r1.y + 30); await sleep(80);
check('Region ziehen', near((await reg('R1')).startBar, 2, .001));
await E(`WD.history.undo()`); await sleep(80);
r1 = await regionRect('R1');
await page.drag(r1.x + r1.w - 2, r1.y + 30, r1.x + r1.w - 2 + ppb, r1.y + 30); await sleep(80);
let rr = await reg('R1');
check('Rechter Griff verlängert als Loop', near(rr.lengthBars, 2, .02) && rr.loopLen === 1, `${rr.lengthBars} / ${rr.loopLen}`);
const au = await regionRect('Audio');
await page.drag(au.x + 2, au.y + 30, au.x + 2 + ppb / 2, au.y + 30); await sleep(80);
rr = await reg('Audio');
const spb = await E(`WD.model.secPerBar()`);
check('Linker Griff trimmt Audio ohne Datenverlust', near(rr.startBar, .5, .02) && near(rr.offset, .5 * spb, .05) && near(rr.lengthBars, 1.5, .02), JSON.stringify({ s: rr.startBar, o: rr.offset, l: rr.lengthBars }));
const au2 = await regionRect('Audio');
await page.drag(au2.x + au2.w - 2, au2.y + 30, au2.x + au2.w + 3000, au2.y + 30); await sleep(80);
rr = await reg('Audio');
const maxLen = (8 - rr.offset) / spb;
check('Rechter Griff stoppt am Ende der Aufnahme', rr.lengthBars <= maxLen + .001, `${rr.lengthBars} ≤ ${maxLen}`);

// Region auf andere Spur ziehen
let r2 = await regionRect('R2');
const row2 = await row(2);
await page.drag(r2.x + 30, r2.y + 30, r2.x + 30, row2.y + 30); await sleep(80);
check('Region wandert auf andere Spur gleichen Typs', await E(`WD.project.tracks[2].regions.some(r=>r.name==='R2')`));
r2 = await regionRect('R2');
const row3 = await row(3);
await page.drag(r2.x + 30, r2.y + 30, r2.x + 30, row3.y + 30); await sleep(80);
check('Region wechselt nicht auf falschen Spurtyp', await E(`WD.project.tracks[3].regions.every(r=>r.name!=='R2')`));
// Alt-Ziehen kopiert
r2 = await regionRect('R2');
await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r2.x + 30, y: r2.y + 30 });
await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r2.x + 30, y: r2.y + 30, button: 'left', buttons: 1, clickCount: 1, modifiers: 1 });
for (let i = 1; i <= 4; i++) { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r2.x + 30 + i * ppb / 2, y: r2.y + 30, button: 'left', buttons: 1, modifiers: 1 }); await sleep(16); }
await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r2.x + 30 + 2 * ppb, y: r2.y + 30, button: 'left', buttons: 0, clickCount: 1, modifiers: 1 });
await sleep(80);
check('Alt+Ziehen kopiert', await E(`WD.project.tracks.flatMap(t=>t.regions).filter(r=>r.name==='R2').length`) === 2);

// Rahmenauswahl auf leerer Fläche
const a = await row(0), c = await row(2);
await page.drag(a.x + 7 * ppb, a.y + 10, a.x + 7 * ppb, a.y + 12); // leerer Klick: Auswahl weg
const tt = await E(`document.querySelectorAll('.region.sel').length`);
check('Klick auf leere Fläche hebt Auswahl auf', tt === 0, tt);
await page.drag(a.x + .9 * ppb, a.y + 4, a.x + 6.5 * ppb, c.y + 40); await sleep(80);
check('Rahmen wählt mehrere Regionen', await E(`WD.view.selRegionIds.size`) >= 3, await E(`WD.view.selRegionIds.size`));
// Mehrere zusammen verschieben
const before = await E(`WD.model.selRegions().map(s=>s.region.startBar)`);
const anyR = await E(`(()=>{const b=WD.lanes.nodeOf([...WD.view.selRegionIds][0]).getBoundingClientRect();return {x:b.x+20,y:b.y+30}})()`);
await page.drag(anyR.x, anyR.y, anyR.x + ppb, anyR.y); await sleep(80);
const after = await E(`WD.model.selRegions().map(s=>s.region.startBar)`);
check('Mehrfachauswahl gemeinsam verschieben', after.length === before.length && after.every((v, i) => near(v - before[i], 1, .001)), JSON.stringify([before, after]));
// Tastenkürzel
await page.key('z', { code: 'KeyZ', keyCode: 90, modifiers: 2 }); await sleep(80);
check('Strg+Z', near((await E(`WD.model.selRegions().map(s=>s.region.startBar)`))[0], before[0], .001));
await page.key('y', { code: 'KeyY', keyCode: 89, modifiers: 2 }); await sleep(80);
await page.key('z', { code: 'KeyZ', keyCode: 90, modifiers: 2 }); await sleep(80);

// Kontextmenü auf Region
await E(`WD.regionOps.clearSelection()`);
r1 = await regionRect('R1');
await page.mouseClick(r1.x + 20, r1.y + 30, { button: 'right' }); await sleep(100);
check('Rechtsklick öffnet Kontextmenü', await E(`!!document.querySelector('.ctx-menu')`));
await E(`[...document.querySelectorAll('.ctx-item')].find(n=>n.textContent.includes('Duplizieren')).click()`); await sleep(100);
check('Kontextmenü: Duplizieren', await E(`WD.project.tracks[0].regions.length`) === 2);
await E(`WD.history.undo()`);

// Spur per Griff umsortieren
const tile = await page.rect('.trow:nth-child(1) .ttile');
const target = await page.rect('.trow:nth-child(3) .thead');
await page.drag(tile.x + 15, tile.y + 15, tile.x + 15, target.y + target.h - 5); await sleep(120);
check('Spur per Maus verschieben', await E(`WD.project.tracks.map(t=>t.name).join()`) === 'Zwei,Drei,Eins,Vier', await E(`WD.project.tracks.map(t=>t.name).join()`));
await E(`WD.history.undo()`); await sleep(100);

// Umbenennen über eigenen Dialog
await page.dblclick('.trow:nth-child(1) .tname'); await sleep(150);
check('Doppelklick öffnet Umbenennen-Dialog', await E(`!!document.querySelector('.modal input[type=text]')`));
await E(`(()=>{const i=document.querySelector('.modal input[type=text]');i.value='<b>Neu</b>';document.querySelector('.modal .primary').click()})()`); await sleep(120);
check('Name wird als Text übernommen', await E(`document.querySelector('.tname').textContent`) === '<b>Neu</b>');
await E(`WD.history.undo()`); await sleep(100);

// Pan-Knopf und Lautstärke im Spurkopf
const pan = await page.rect('.trow:nth-child(1) .tpan svg');
await page.drag(pan.x + 10, pan.y + 10, pan.x + 10, pan.y - 25); await sleep(80);
check('Pan-Knopf im Spurkopf', await E(`WD.project.tracks[0].pan`) > .1, await E(`WD.project.tracks[0].pan`));
const vol = await page.rect('.trow:nth-child(1) .tvol');
await page.mouseClick(vol.x + vol.w * .25, vol.y + vol.h / 2); await sleep(80);
check('Lautstärke im Spurkopf', await E(`WD.project.tracks[0].vol`) < .5, await E(`WD.project.tracks[0].vol`));
await page.click('.trow:nth-child(1) .tbtn-s.m'); await sleep(80);
check('Mute-Knopf', await E(`WD.project.tracks[0].mute`) === true);
await page.key(' ', { code: 'Space', keyCode: 32 }); await sleep(120);
check('Leertaste direkt nach Bedienung im Spurkopf', await E(`WD.transport.playing`));
await page.key(' ', { code: 'Space', keyCode: 32 }); await sleep(80);
await page.click('.trow:nth-child(1) .tbtn-s.m'); await sleep(80);

// Abschnitt per Maus ziehen: mit Inhalt, und mit Umschalt nur die Markierung
await E(`WD.project.tracks.forEach(t=>{t.regions=t.regions.filter(r=>r.name!=='Audio')});WD.bus.emit('regions')`);
const before2 = await E(`WD.project.tracks.flatMap(t=>t.regions.map(r=>r.startBar)).sort((a,b)=>a-b)`);
const mk = await E(`(()=>{const n=[...document.querySelectorAll('.marker')].find(x=>x.textContent==='Intro').getBoundingClientRect();return {x:n.x,y:n.y,h:n.height}})()`);
await page.drag(mk.x + 20, mk.y + 8, mk.x + 20 + 4 * ppb, mk.y + 8); await sleep(150);
const names = await E(`WD.project.markers.map(m=>m.name+':'+m.startBar).join()`);
check('Abschnitt per Maus samt Inhalt verschieben', names === 'Verse:0,Chorus:2,Intro:4' || names === 'Verse:0,Intro:2,Chorus:4', names);
void before2;
await E(`WD.history.undo()`); await sleep(120);
const mk2 = await E(`(()=>{const n=[...document.querySelectorAll('.marker')].find(x=>x.textContent==='Verse').getBoundingClientRect();return {x:n.x,y:n.y,w:n.width}})()`);
await page.drag(mk2.x + mk2.w - 2, mk2.y + 8, mk2.x + mk2.w - 2 + ppb, mk2.y + 8); await sleep(100);
check('Abschnitt-Länge ziehbar', near(await E(`WD.project.markers.find(m=>m.name==='Verse').lengthBars`), 3, .001));

// Editor
await E(`WD.project.tracks[0].regions=[WD.model.normalizeRegion({startBar:0,lengthBars:2,notes:[{t:.25,n:60,d:.25,v:.8},{t:.75,n:64,d:.25,v:.8}],name:'E'})];WD.bus.emit('regions')`);
await sleep(60);
const er = await regionRect('E');
await page.dblclick('.trow:nth-child(1) .region', { x: 30, y: 30 }); await sleep(250);
check('Doppelklick auf Region öffnet Editor', await E(`WD.view.bottom==='editor'`));
void er;
const geo = await E(`(()=>{const c=document.querySelector('.roll-canvas').getBoundingClientRect();const s=document.querySelector('.roll-scroll');const y=n=>20+(108-n)*18-s.scrollTop;return {x:c.x,y:c.y,w:c.width,h:c.height,y60:y(60),y64:y(64),key:58,ppb:300}})()`);
const xAt = t => geo.x + geo.key + t * geo.ppb;
const yFor = n => geo.y + (n === 60 ? geo.y60 : geo.y64) + 8;
await page.drag(xAt(.3), yFor(60), xAt(.8), yFor(60)); await sleep(100);
const n0 = await E(`WD.project.tracks[0].regions[0].notes[0]`);
check('Note ziehen verschiebt am Raster', near(n0.t, .75, .001), JSON.stringify(n0));
await E(`WD.history.undo()`); await sleep(250);
await page.drag(xAt(.495), yFor(60), xAt(.75), yFor(60)); await sleep(100);
const n1 = await E(`WD.project.tracks[0].regions[0].notes[0]`);
check('Rechte Notenkante ändert die Länge', near(n1.d, .5, .03), JSON.stringify(n1));
await E(`WD.history.undo()`); await sleep(250);
await page.mouseClick(xAt(.3), yFor(60), { button: 'right' }); await sleep(120);
check('Rechtsklick löscht Note', await E(`WD.project.tracks[0].regions[0].notes.length`) === 1);
await E(`WD.history.undo()`); await sleep(250);
// Rahmen mit Umschalt
await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: xAt(.1), y: yFor(64) - 20 });
await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: xAt(.1), y: yFor(64) - 20, button: 'left', buttons: 1, clickCount: 1, modifiers: 8 });
for (let i = 1; i <= 4; i++) { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: xAt(.1 + i * .25), y: yFor(60) + 20, button: 'left', buttons: 1, modifiers: 8 }); await sleep(16); }
await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: xAt(1.1), y: yFor(60) + 20, button: 'left', buttons: 0, clickCount: 1, modifiers: 8 });
await sleep(60);
await page.key('ArrowUp', { code: 'ArrowUp', keyCode: 38 }); await sleep(100);
const pitches = await E(`WD.project.tracks[0].regions[0].notes.map(n=>n.n)`);
check('Umschalt-Rahmen und Pfeil transponiert beide Noten', pitches.join() === '61,65', pitches.join());
// Velocity-Spur
const velY = geo.y + geo.h - 62;
await page.mouseClick(xAt(.25) + 1, velY + 45); await sleep(100);
check('Klick in Velocity-Spur setzt Stärke', await E(`WD.project.tracks[0].regions[0].notes.some(n=>n.v<.5)`), await E(`JSON.stringify(WD.project.tracks[0].regions[0].notes.map(n=>n.v))`));
// Tasten spielen ohne Fehler
await page.mouseClick(geo.x + 20, geo.y + 100); await sleep(80);

// Unterer Bereich
const handle = await page.rect('#bottomResize');
const h0 = await E(`document.getElementById('bottom').getBoundingClientRect().height`);
await page.drag(handle.x + 300, handle.y + 3, handle.x + 300, handle.y + 60); await sleep(80);
const h1 = await E(`document.getElementById('bottom').getBoundingClientRect().height`);
check('Unterer Bereich in der Höhe ziehbar', h1 < h0 - 30, `${h0} → ${h1}`);

// Bibliothek folgt der Spur
await E(`WD.view.libraryOpen=true;WD.libraryPanel.render();WD.tracksView.addTrack('drum')`); await sleep(80);
check('Neue Drum-Spur: Bibliothek zeigt Kits', /drum-kits/i.test(await E(`document.getElementById('libList').textContent`)));
await E(`WD.tracksView.addTrack('audio')`); await sleep(80);
check('Neue Audio-Spur: Bibliothek zeigt keine Kits', !/drum-kits/i.test(await E(`document.getElementById('libList').textContent`)) && /Akustikgitarre/.test(await E(`document.getElementById('libList').textContent`)));
await E(`WD.tracksView.addTrack('inst')`); await sleep(80);
check('Neue Instrument-Spur: Bibliothek zeigt Instrumente', /Clean-Gitarre/.test(await E(`document.getElementById('libList').textContent`)));

// Knopf-Reihe Kopfleiste
await page.click('#btnPlay'); await sleep(250);
check('Play-Knopf', await E(`WD.transport.playing`));
await page.click('#btnPlay'); await sleep(100);
const pausedAt = await E(`WD.transport.current()`);
check('Play-Knopf pausiert beim zweiten Klick', !(await E(`WD.transport.playing`)) && pausedAt >= 0);
await page.click('#btnStop'); await sleep(60);
check('Stop-Knopf', await E(`WD.transport.current()`) === 0);
await page.click('#btnMetro'); await sleep(40);
check('Metronom-Knopf', await E(`WD.project.metronome`));
await page.click('.menu-btn[data-menu="Spur"]'); await sleep(100);
await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: (await page.rect('.menu-btn[data-menu="Ansicht"]')).x + 10, y: 14 }); await sleep(120);
check('Menüleiste: Überfahren wechselt das Menü', await E(`document.querySelector('.menu-btn[data-menu="Ansicht"]').classList.contains('open')`));
await page.key('Escape', { code: 'Escape', keyCode: 27 }); await sleep(80);
check('Escape schließt Menü', !(await E(`!!document.querySelector('.ctx-menu')`)));

check('Keine JavaScript-Fehler in der ganzen Sitzung', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
const s = summary();
await close();
process.exit(s.failed ? 1 : 0);
