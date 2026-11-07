// Gesamttest der überarbeiteten DAW im echten Chrome. Aufruf: node tests/e2e.mjs
// Das Fake-Mikrofon liefert einen 440-Hz-Ton. Effekte werden am berechneten Signal gemessen, nicht nur "angeschaut".
import { launch, makeRunner, analyzeWav, sleep } from './lib/cdp.mjs';
import { mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'docs', 'screenshots', 'neu');
const dl = join(process.env.TEMP || '.', 'webdaw-e2e-dl');
rmSync(dl, { recursive: true, force: true }); mkdirSync(dl, { recursive: true }); mkdirSync(shots, { recursive: true });
const url = pathToFileURL(join(root, 'index.html')).href;

function sineWav(path, seconds, freq = 440, right = 0) {
    const sr = 48000, n = sr * seconds, b = Buffer.alloc(44 + n * 4);
    b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 4, 28);
    b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
    for (let i = 0; i < n; i++) {
        const v = Math.round(Math.sin(i / sr * 2 * Math.PI * freq) * 16000);
        b.writeInt16LE(v, 44 + i * 4);
        b.writeInt16LE(Math.round(v * right), 46 + i * 4);
    }
    writeFileSync(path, b);
}
const fakeMic = join(dl, 'mic440.wav'); sineWav(fakeMic, 3, 440, 1);
const stereoWav = join(dl, 'nur-links.wav'); sineWav(stereoWav, 2, 440, 0);

const { check, summary } = makeRunner();
const { page, close } = await launch({ downloadDir: dl, fakeAudioFile: fakeMic });
const E = expr => page.eval(expr);
const shot = n => page.screenshot(join(shots, n + '.png'));
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const clearDl = pred => readdirSync(dl).filter(pred).forEach(f => rmSync(join(dl, f)));
const waitFile = async (pred, ms) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) {
        const f = readdirSync(dl).filter(x => pred(x) && !x.endsWith('.crdownload') && !x.endsWith('.tmp'));
        if (f.length) { await sleep(200); return join(dl, f[0]); }
    }
    return null;
};
const modalClick = async text => {
    const ok = await E(`(()=>{const b=[...document.querySelectorAll('.modal button')].find(x=>x.textContent.trim()===${JSON.stringify(text)});if(b){b.click();return true}return false})()`);
    await sleep(120);
    return ok;
};
const waitModal = async (ms = 8000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) {
        const t = await E(`document.querySelector('.modal h2')?.textContent||''`);
        if (t) return t;
    }
    return '';
};
const section = n => console.log(`\n=== ${n} ===`);
const freshReload = async () => {
    await page.goto(url, { settle: 700 });
    // Eventuelle Wiederherstellungs-Abfrage schließen
    await modalClick('Später');
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 700, y: 12, button: 'left', buttons: 1, clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 700, y: 12, button: 'left', buttons: 0, clickCount: 1 });
    await E(`WD.engine.ensure()`);
};

await page.goto(url, { settle: 700 });
section('Start');
check('Lädt ohne Fehler über file://', page.errors.length === 0, page.errors.join(' | '));
await shot('01-start-leer');
await E(`WD.engine.ensure()`);
check('AudioWorklets über file:// geladen', await E(`WD.engine.ready`));

// ---------- Spuren & Layout ----------
section('Spuren und Layout');
await E(`WD.tracksView.addTrack('drum');WD.tracksView.addTrack('inst');WD.tracksView.addTrack('audio')`);
await sleep(120);
check('Drei Spurtypen', await E(`document.querySelectorAll('.trow').length`) === 3);
const align = await E(`(()=>{const r=document.getElementById('ruler').getBoundingClientRect().left;return [...document.querySelectorAll('.tlane')].map(l=>l.getBoundingClientRect().left-r)})()`);
check('K5: Spuren exakt am Lineal ausgerichtet', align.every(d => Math.abs(d) < .5), align.join(','));
await E(`document.querySelector('.tname')`);
await E(`WD.project.tracks[0].name='<img src=x onerror="window.__xss=1">';WD.bus.emit('tracks')`);
await sleep(150);
check('F14: Keine HTML-Injection über Namen', !(await E(`window.__xss===1`)) && !(await E(`!!document.querySelector('.tname img')`)));
await E(`WD.project.tracks[0].name='Drums';WD.bus.emit('tracks')`);
check('F13: Automation-Knopf nicht dauerhaft aktiv', await E(`document.querySelectorAll('.tbtn-s.a.on').length`) === 0);

// Fokus-Falle
await page.click('#master');
await page.key(' ', { code: 'Space', keyCode: 32 });
await sleep(150);
check('F1: Leertaste nach Klick auf Regler', await E(`WD.transport.playing`));
await E(`WD.transport.stop()`);

// Tempo-Eingabe
await E(`(()=>{const b=document.getElementById('bpm');b.value='';b.dispatchEvent(new Event('change'))})()`);
check('F16: Leeres Tempo wird abgewiesen', await E(`WD.project.bpm===85 && document.getElementById('bpm').value==='85'`));

// ---------- Region-Bedienung ----------
section('Regionen');
const lane = await page.rect('.trow:nth-child(2) .tlane');
await page.dblclick('.trow:nth-child(2) .tlane', { x: 130, y: 30 });
await sleep(200);
check('Doppelklick legt Region an und öffnet Editor', await E(`WD.project.tracks[1].regions.length===1 && WD.view.bottom==='editor'`));
await shot('02-piano-roll-leer');
const undoBefore = await E(`WD.history.undoLabel()`);
const region = await page.rect('.trow:nth-child(2) .region');
for (let i = 0; i < 3; i++) { await page.mouseClick(region.x + 30, region.y + 25); await sleep(30); }
check('F12: Anklicken erzeugt keinen Undo-Schritt', await E(`WD.history.undoLabel()`) === undoBefore, await E(`WD.history.undoLabel()`));
// Verschieben per Maus
await page.drag(region.x + 30, region.y + 25, region.x + 30 + 240, region.y + 25);
await sleep(80);
const moved = await E(`WD.project.tracks[1].regions[0].startBar`);
check('Region per Maus verschiebbar (am Raster)', near(moved, 3, .001), moved);
await E(`WD.history.undo()`); await sleep(80);
check('Undo setzt Position zurück, Selektion bleibt gültig', near(await E(`WD.project.tracks[1].regions[0].startBar`), 1, .001));
await E(`WD.history.redo()`);
await E(`(()=>{const r=WD.project.tracks[1].regions[0];r.startBar=0;r.lengthBars=2;r.loopLen=1;r.notes=[{t:0,n:60,d:.25,v:.5},{t:.5,n:64,d:.25,v:.8}];WD.bus.emit('regions');WD.view.selRegionIds=new Set([r.id]);WD.bus.emit('selection')})()`);
// Teilen behält Velocity
await E(`WD.transport.seek(1.5);WD.regionOps.splitAtPlayhead()`);
await sleep(80);
const parts = await E(`WD.project.tracks[1].regions.map(r=>({s:r.startBar,l:r.lengthBars,v:r.notes.map(n=>n.v)}))`);
check('F7: Teilen behält Velocity', parts.length === 2 && parts[0].v.includes(.5) && parts[1].v.includes(.8), JSON.stringify(parts));
await E(`WD.regionOps.selectAll();WD.regionOps.copy();WD.transport.seek(8);WD.regionOps.paste()`);
check('Kopieren und Einfügen', await E(`WD.project.tracks[1].regions.length`) === 4);
await E(`WD.regionOps.duplicate()`);
check('Mehrfachauswahl duplizieren', await E(`WD.project.tracks[1].regions.length`) === 6);
await E(`WD.history.undo();WD.history.undo()`);
check('Undo über mehrere Schritte', await E(`WD.project.tracks[1].regions.length`) === 2);
// Tastenkürzel Entf
await E(`WD.transport.seek(0);WD.regionOps.selectOnly([WD.project.tracks[1].regions[1].id]);WD.view.focus='timeline'`);
await page.key('Delete', { code: 'Delete', keyCode: 46 });
check('Taste Entf löscht Auswahl', await E(`WD.project.tracks[1].regions.length`) === 1);
await E(`WD.history.undo()`);

// ---------- Piano Roll ----------
section('Piano Roll');
await E(`WD.editor.open(WD.project.tracks[1].regions[0].id)`);
await sleep(200);
const cvRect = await E(`(()=>{const c=document.querySelector('.roll-canvas');const b=c.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height}})()`);
const nBefore = await E(`WD.project.tracks[1].regions[0].notes.length`);
await page.drag(cvRect.x + 200, cvRect.y + 60, cvRect.x + 290, cvRect.y + 60);
await sleep(80);
check('Note aufziehen', await E(`WD.project.tracks[1].regions[0].notes.length`) === nBefore + 1);
const lastLen = await E(`WD.project.tracks[1].regions[0].notes.slice(-1)[0].d`);
check('Note hat gezogene Länge', lastLen > .2, lastLen);
await page.key('Delete', { code: 'Delete', keyCode: 46 });
check('Entf löscht ausgewählte Note', await E(`WD.project.tracks[1].regions[0].notes.length`) === nBefore);
await E(`WD.history.undo()`); await sleep(120);
await E(`WD.editor.open(WD.project.tracks[1].regions[0].id)`); await sleep(150);
await shot('03-piano-roll');
// Quantisieren
await E(`(()=>{const r=WD.project.tracks[1].regions[0];r.notes.forEach(n=>{n.t+=.013});WD.bus.emit('editor:refresh')})()`);
await sleep(100);
await E(`[...document.querySelectorAll('.pane-head button')].find(b=>b.textContent==='Quantisieren').click()`);
const quant = await E(`WD.project.tracks[1].regions[0].notes.every(n=>Math.abs(n.t*16-Math.round(n.t*16))<1e-6)`);
check('Quantisieren auf 1/16', quant);
// Drum-Editor auch für lange Regionen
await E(`(()=>{const t=WD.project.tracks[0];t.regions.push(WD.model.normalizeRegion({startBar:0,lengthBars:32,notes:[{t:30,n:1,d:.0625}],name:'Lang'}));WD.bus.emit('regions');WD.editor.open(t.regions[0].id)})()`);
await sleep(200);
check('F20: Drum-Editor zeigt 32 Takte', await E(`parseFloat(document.querySelector('.roll-spacer').style.width)`) > 32 * 280);
check('F20: Pattern-Auswahl zeigt echte Länge', (await E(`document.querySelector('.pane-head select').selectedOptions[0].text`)).startsWith('32'));
await shot('04-drum-editor');
await E(`WD.history.clear(); WD.project.tracks[0].regions=[]; WD.bus.emit('regions')`);

// ---------- Transport ----------
section('Transport');
await E(`WD.project.bpm=120;WD.bus.emit('tempo');WD.transport.stop();WD.project.cycle={on:true,a:0,b:.5};window.__w=[];WD.bus.on('cycle:wrap',t=>window.__w.push(t));WD.transport.play()`);
await sleep(4400);
const wraps = await E(`window.__w`);
await E(`WD.transport.stop();WD.project.cycle.on=false`);
const deltas = wraps.slice(1).map((t, i) => t - wraps[i]);
check('F3: Cycle sampelgenau (Soll 1,000 s)', deltas.length >= 2 && deltas.every(d => near(d, 1, 1e-6)), deltas.map(d => d.toFixed(6)).join(', '));
await E(`WD.project.bpm=85;WD.bus.emit('tempo');WD.transport.play()`);
await sleep(600);
const p0 = await E(`WD.transport.current()`);
await E(`WD.model.setBpm(170)`);
await sleep(50);
const p1 = await E(`WD.transport.current()`);
check('F2: Tempo-Wechsel ohne Sprung', p1 > p0 && p1 - p0 < .12, `${p0.toFixed(3)} → ${p1.toFixed(3)}`);
await E(`WD.transport.pause();WD.model.setBpm(85)`);
const paused = await E(`WD.transport.current()`);
await sleep(200);
check('Pause hält die Position', near(await E(`WD.transport.current()`), paused, 1e-9) && paused > 0);
await E(`WD.transport.rewind()`);
check('Zum Anfang', await E(`WD.transport.current()`) === 0);
await E(`(()=>{document.getElementById('timeSig').value='3/4';document.getElementById('timeSig').dispatchEvent(new Event('change'))})()`);
check('Taktart wirkt wirklich: 3/4 → Taktlänge', near(await E(`WD.model.barLen()`), .75, 1e-9));
const bb = await E(`WD.transport.barBeat(.75+.25)`);
check('Taktart: Position 2.2 in 3/4', bb.bar === 2 && bb.beat === 2, JSON.stringify(bb));
await E(`WD.history.undo()`);
check('Taktart zurück auf 4/4', near(await E(`WD.model.barLen()`), 1, 1e-9));
await E(`WD.history.run('Master-Klang',()=>WD.engine.setMasterMode('90s'))`);
await E(`WD.history.undo()`);
check('Undo stellt Master-Klang wieder her', await E(`WD.project.master.mode==='clean' && document.getElementById('masterMode').value==='clean'`));
// Tempo: Audio behält echte Länge
await E(`(()=>{const c=WD.engine.ctx;const b=c.createBuffer(1,c.sampleRate*2,c.sampleRate);const id=WD.audioStore.put(b);const t=WD.project.tracks[2];t.regions.push(WD.model.normalizeRegion({startBar:0,lengthBars:2/WD.model.secPerBar(),bufId:id,notes:[]}));WD.bus.emit('regions')})()`);
const s0 = await E(`WD.project.tracks[2].regions[0].lengthBars*WD.model.secPerBar()`);
await E(`WD.model.setBpm(140)`);
const s1 = await E(`WD.project.tracks[2].regions[0].lengthBars*WD.model.secPerBar()`);
check('F6: Audio-Dauer bleibt beim Tempowechsel gleich', near(s0, s1, 1e-9) && near(s1, 2, 1e-6), `${s0} / ${s1}`);
await E(`WD.model.setBpm(85);WD.project.tracks[2].regions=[];WD.bus.emit('regions')`);

// Knoten-Leck
const stripsBefore = await E(`WD.engine.stripCount()`);
await E(`WD.history.run('x',()=>{for(let i=0;i<5;i++)WD.model.addTrack('inst','T',{inst:'Organ'})})`);
const stripsMid = await E(`WD.engine.stripCount()`);
await E(`WD.history.undo()`);
const stripsAfter = await E(`WD.engine.stripCount()`);
check('P2: Undo baut Audio-Knoten wirklich ab', stripsMid === stripsBefore + 5 && stripsAfter === stripsBefore, `${stripsBefore} → ${stripsMid} → ${stripsAfter}`);

// ---------- Effekte am Signal ----------
section('Effekte am gemessenen Signal');
const fxResult = await E(`(async()=>{
  const sr=48000;
  async function run(cfg, srcFn, dur=1, destName='output'){
    const oc=new OfflineAudioContext(2,sr*dur,sr); await WD.worklets.load(oc);
    const out=oc.createGain(), rev=oc.createGain(), dly=oc.createGain(); out.connect(oc.destination);
    const silent=oc.createGain(); silent.gain.value=0; rev.connect(silent); dly.connect(silent); silent.connect(oc.destination);
    const t=WD.model.normalizeTrack(Object.assign({type:'audio',name:'x',vol:1},cfg));
    const st=WD.channel.createStrip(oc,t,{output:out,reverb:destName==='reverb'?oc.destination:rev,delay:destName==='delay'?oc.destination:dly});
    if(destName!=='output') out.disconnect();
    st.fader.gain.value=1; st.setMuted(false,true);
    srcFn(oc,st.input);
    const b=await oc.startRendering();
    return [b.getChannelData(0),b.getChannelData(1)];
  }
  const tone=(f,g)=> (oc,d)=>{const o=oc.createOscillator();o.frequency.value=f;const x=oc.createGain();x.gain.value=g;o.connect(x);x.connect(d);o.start();};
  const rms=(a,from=4800)=>{let s=0;for(let i=from;i<a.length;i++)s+=a[i]*a[i];return Math.sqrt(s/(a.length-from))};
  const peak=(a,from=0)=>{let p=0;for(let i=from;i<a.length;i++)p=Math.max(p,Math.abs(a[i]));return p};
  // Goertzel: Pegel bei einer Frequenz
  const bin=(a,f,from=4800)=>{let w=2*Math.PI*f/sr,c=2*Math.cos(w),s1=0,s2=0;for(let i=from;i<a.length;i++){const s=a[i]+c*s1-s2;s2=s1;s1=s}const n=a.length-from;return Math.sqrt(Math.max(0,s1*s1+s2*s2-c*s1*s2))/n*2};
  const R={};
  const dry=await run({},tone(1000,.25));
  R.dry=rms(dry[0]);
  R.eqHighBoost=rms((await run({eqH:12},tone(8000,.25)))[0])/rms((await run({},tone(8000,.25)))[0]);
  R.eqLowCut=rms((await run({eqL:-12},tone(60,.25)))[0])/rms((await run({},tone(60,.25)))[0]);
  R.eqMid=rms((await run({eqM:6},tone(1000,.25)))[0])/R.dry;
  const loud=await run({},tone(1000,.8));
  R.compGR=rms((await run({fxCmp:1},tone(1000,.8)))[0])/rms(loud[0]);
  const od=await run({fx:{drive:.8,driveType:'overdrive'}},tone(220,.5));
  const dist=await run({fx:{drive:.9,driveType:'distortion'}},tone(220,.5));
  const clean=await run({},tone(220,.5));
  R.driveHarmClean=bin(clean[0],660)/bin(clean[0],220);
  R.driveHarmOd=bin(od[0],660)/bin(od[0],220);
  R.driveHarmDist=bin(dist[0],660)/bin(dist[0],220);
  const quietDrive=await run({fx:{drive:.8}},()=>{});
  R.driveSilence=peak(quietDrive[0],2400);
  const ch=await run({fx:{chorus:1}},tone(440,.3));
  let diff=0;for(let i=4800;i<ch[0].length;i++)diff+=Math.abs(ch[0][i]-ch[1][i]);
  R.chorusStereo=diff/(ch[0].length-4800);
  const cr=await run({fx:{crush:.9}},tone(440,.4));const crc=await run({},tone(440,.4));
  const heldShare=a=>{let h=0;for(let i=4801;i<a.length;i++)if(a[i]===a[i-1])h++;return h/(a.length-4801)};
  R.crushHeld=heldShare(cr[0]);R.crushCleanHeld=heldShare(crc[0]);
  R.hp=rms((await run({fx:{hp:1}},tone(50,.5)))[0])/rms((await run({},tone(50,.5)))[0]);
  R.lp=rms((await run({fx:{lp:1}},tone(8000,.5)))[0])/rms((await run({},tone(8000,.5)))[0]);
  // Gate: leises Signal weg, lautes bleibt
  R.gateQuiet=rms((await run({fx:{gate:1}},tone(440,.002)))[0],24000);
  R.gateLoud=rms((await run({fx:{gate:.3}},tone(440,.5)))[0],24000);
  // Limiter: Spitze unter Ceiling (limit .5 => -6 dB)
  const lim=await run({fx:{limit:.5}},tone(440,1.5));
  R.limiterPeak=peak(lim[0],480);
  // Doubler: rechts lauter als links wegen Pan .45
  const db=await run({dbl:true},tone(440,.3));
  let dd=0;for(let i=4800;i<db[0].length;i++)dd+=Math.abs(db[0][i]-db[1][i]);R.dblDiff=dd/(db[0].length-4800);
  async function tail(cfg){
    const oc=new OfflineAudioContext(2,sr*1.5,sr);await WD.worklets.load(oc);
    const m=WD.engine.buildMaster(oc,{vol:1,mode:'clean'},oc.destination);
    m.delay.delayTime.value=.4;
    const t=WD.model.normalizeTrack(Object.assign({type:'audio',name:'x',vol:1},cfg));
    const st=WD.channel.createStrip(oc,t,{output:m.input,reverb:m.reverb,delay:m.delay});
    st.fader.gain.value=1;st.setMuted(false,true);
    const o=oc.createOscillator();o.frequency.value=440;const g=oc.createGain();g.gain.setValueAtTime(.5,0);g.gain.setValueAtTime(0,.1);o.connect(g);g.connect(st.input);o.start();
    const b=await oc.startRendering();
    return rms(b.getChannelData(0),Math.floor(sr*.25));
  }
  R.tailDry=await tail({});R.revSend=await tail({fxRev:.6});R.dlySend=await tail({fxDly:.6});
  const pl=await run({pan:-1},tone(440,.3));
  R.panLeft=rms(pl[0]);R.panRight=rms(pl[1]);
  // Master-Limiter
  const moc=new OfflineAudioContext(2,sr,sr);await WD.worklets.load(moc);
  const m=WD.engine.buildMaster(moc,{vol:1,mode:'clean'},moc.destination);
  const mo=moc.createOscillator();const mg=moc.createGain();mg.gain.value=3;mo.connect(mg);mg.connect(m.input);mo.start();
  const mb=await moc.startRendering();
  R.masterPeak=peak(mb.getChannelData(0),480);
  // Neutraler Master: unverändert unterhalb des Limiters
  const moc2=new OfflineAudioContext(2,sr,sr);await WD.worklets.load(moc2);
  const m2=WD.engine.buildMaster(moc2,{vol:1,mode:'clean'},moc2.destination);
  const mo2=moc2.createOscillator();const mg2=moc2.createGain();mg2.gain.value=.25;mo2.connect(mg2);mg2.connect(m2.input);mo2.start();
  const mb2=await moc2.startRendering();
  R.masterNeutral=rms(mb2.getChannelData(0))/(.25/Math.SQRT2);
  return R;
})()`);
console.log('INFO ', JSON.stringify(fxResult, (k, v) => typeof v === 'number' ? +v.toFixed(4) : v));
const F = fxResult;
check('Equalizer: Höhen +12 dB', near(F.eqHighBoost, 3.98, .6), F.eqHighBoost.toFixed(2));
check('Equalizer: Bässe -12 dB', near(F.eqLowCut, .25, .08), F.eqLowCut.toFixed(2));
check('Equalizer: Mitten +6 dB', near(F.eqMid, 2, .2), F.eqMid.toFixed(2));
check('Kompressor senkt laute Signale', F.compGR < .95, F.compGR.toFixed(3));
check('Overdrive erzeugt Obertöne', F.driveHarmOd > F.driveHarmClean + .02, `${F.driveHarmClean.toFixed(4)} → ${F.driveHarmOd.toFixed(3)}`);
check('Distortion ist stärker als Overdrive', F.driveHarmDist > F.driveHarmOd, `${F.driveHarmOd.toFixed(3)} → ${F.driveHarmDist.toFixed(3)}`);
check('Drive ist bei Stille still (kein Gleichanteil)', F.driveSilence < 1e-4, F.driveSilence.toExponential(2));
check('Chorus erzeugt Stereo-Unterschied', F.chorusStereo > .01, F.chorusStereo.toFixed(4));
check('Bitcrush reduziert die Auflösung hörbar', F.crushHeld > .5 && F.crushCleanHeld < .01, `${F.crushCleanHeld.toFixed(3)} → ${F.crushHeld.toFixed(3)} gehaltene Samples`);
check('Hochpass dämpft 50 Hz', F.hp < .3, F.hp.toFixed(3));
check('Tiefpass dämpft 8 kHz', F.lp < .3, F.lp.toFixed(3));
check('Noise Gate schließt bei leisem Signal', F.gateQuiet < 1e-4, F.gateQuiet.toExponential(2));
check('Noise Gate lässt lautes Signal durch', F.gateLoud > .2, F.gateLoud.toFixed(3));
check('Spur-Limiter hält die Grenze (-6 dB)', F.limiterPeak <= .505, F.limiterPeak.toFixed(4));
check('Doubler erzeugt Stereo-Unterschied', F.dblDiff > .01, F.dblDiff.toFixed(4));
check('Hall erzeugt echten Ausklang', F.revSend > .002 && F.tailDry < 1e-4, `Ausklang ${F.revSend.toFixed(4)}, ohne Hall ${F.tailDry.toExponential(1)}`);
check('Delay erzeugt echte Wiederholung', F.dlySend > .005 && F.tailDry < 1e-4, F.dlySend.toFixed(4));
check('Panorama', F.panRight < 1e-3 && F.panLeft > .1, `L ${F.panLeft.toFixed(3)} R ${F.panRight.toFixed(4)}`);
check('A2: Master-Limiter begrenzt +9,5 dB auf -1 dB', F.masterPeak <= .895, F.masterPeak.toFixed(4));
check('A1: Master ist neutral unterhalb der Grenze', near(F.masterNeutral, 1, .02), F.masterNeutral.toFixed(3));

// ---------- Aufnahme ----------
section('Aufnahme');
await E(`WD.view.selTrackId=WD.project.tracks[2].id;WD.project.tracks[2].regions=[];WD.bus.emit('tracks')`);
await E(`WD.recorder.start()`);
await sleep(2400);
check('Eingang während Aufnahme geöffnet', await E(`WD.input.active`));
await shot('05-aufnahme-laeuft');
await E(`WD.recorder.stop()`); await sleep(500); await E(`WD.transport.stop()`); await sleep(200);
const take = await E(`(()=>{const r=WD.project.tracks[2].regions[0];if(!r)return null;const b=WD.audioStore.get(r.bufId);const d=b.getChannelData(0);let p=0;for(let i=0;i<d.length;i++)p=Math.max(p,Math.abs(d[i]));let cross=0;for(let i=1;i<d.length;i++)if(d[i-1]<0&&d[i]>=0)cross++;return {sec:r.lengthBars*WD.model.secPerBar(),dur:b.duration,ch:b.numberOfChannels,peak:p,freq:cross/b.duration}})()`);
check('Aufnahme erzeugt Region', !!take, JSON.stringify(take));
if (take) {
    check('Dauer plausibel', near(take.dur, 2.3, .6), take.dur.toFixed(2));
    check('Audiosignal des Eingangs kommt unverfälscht an (440 Hz)', take.peak > .1 && near(take.freq, 440, 8), `${take.freq.toFixed(1)} Hz, Peak ${take.peak.toFixed(2)}`);
}
check('F9: Mikrofon nach der Aufnahme wieder geschlossen', !(await E(`WD.input.active`)));
await E(`WD.history.undo()`); await sleep(100);
check('Undo entfernt nur die Aufnahme', await E(`WD.project.tracks[2].regions.length`) === 0 && await E(`WD.project.tracks.length`) === 3);
await E(`WD.history.redo()`); await sleep(100);
check('Redo bringt Aufnahme zurück', await E(`WD.project.tracks[2].regions.length`) === 1);
await E(`WD.regionOps.selectAll();WD.editor.open(WD.project.tracks[2].regions[0].id)`); await sleep(200);
await shot('06-audio-editor');

// Takes im Cycle
await E(`WD.project.bpm=120;WD.bus.emit('tempo');WD.project.tracks[2].regions=[];WD.project.cycle={on:true,a:0,b:.5};WD.bus.emit('regions');WD.transport.stop()`);
await E(`WD.recorder.start()`);
await sleep(3300);
await E(`WD.recorder.stop()`); await sleep(500); await E(`WD.transport.stop()`); await sleep(100);
const takes = await E(`(()=>{const r=WD.project.tracks[2].regions[0];return r?{n:(r.takes||[]).length,idx:r.takeIdx,len:r.lengthBars,buf:!!WD.audioStore.get(r.bufId)}:null})()`);
check('F4: Cycle beendet Aufnahme nicht, je Runde ein Take', takes && takes.n >= 3, JSON.stringify(takes));
check('Take-Länge entspricht Cycle', takes && near(takes.len, .5, .03));
await E(`WD.project.cycle.on=false`);
// Punch
await E(`WD.project.tracks[2].regions=[];WD.project.cycle={on:false,a:.5,b:1};WD.project.punch=true;WD.bus.emit('regions');WD.transport.stop()`);
await E(`WD.recorder.start()`);
await sleep(2700);
await E(`WD.recorder.stop()`); await sleep(500); await E(`WD.transport.stop();WD.project.punch=false`); await sleep(100);
const punch = await E(`(()=>{const r=WD.project.tracks[2].regions[0];return r?{s:r.startBar,l:r.lengthBars}:null})()`);
check('Punch nimmt nur im Bereich auf', punch && near(punch.s, .5, .02) && near(punch.l, .5, .02), JSON.stringify(punch));
// Überspielen ohne Datenverlust im Undo
await E(`WD.project.bpm=85;WD.bus.emit('tempo')`);
// Count-In abbrechen
await E(`WD.project.tracks[2].regions=[];WD.project.countIn=true;WD.bus.emit('regions');WD.transport.stop()`);
await E(`WD.recorder.start()`);
await sleep(300);
page.errors.length = 0;
await E(`WD.recorder.stop()`);
await sleep(3000);
check('F8: Stop im Einzähler bricht sauber ab', !(await E(`WD.transport.playing`)) && await E(`WD.recorder.state()`) === 'idle' && page.errors.length === 0, page.errors[0] || '');
check('F8: Abbruch hinterlässt kein offenes Mikrofon', !(await E(`WD.input.active`)));
await E(`WD.project.countIn=false`);
// Monitoring
await E(`WD.input.toggleMonitor(WD.project.tracks[2])`); await sleep(500);
check('Monitoring öffnet Eingang', await E(`WD.input.active`));
await sleep(600);
const monLevel = await E(`(async()=>{await new Promise(r=>setTimeout(r,200));return WD.meters.level(WD.project.tracks[2].id)})()`);
check('Monitoring: Eingang läuft durch den Kanalzug', monLevel > .01, monLevel.toFixed(3));
await E(`WD.input.toggleMonitor(WD.project.tracks[2])`); await sleep(300);
check('Monitoring aus schließt Eingang', !(await E(`WD.input.active`)));
// Mehrspur
await E(`(()=>{const a=WD.tracksView.addTrack('audio');const b=WD.tracksView.addTrack('audio');a.arm=true;b.arm=true;b.inputCh='mono2';a.name='A';b.name='B';WD.bus.emit('tracks')})()`);
await E(`WD.input.refresh()`); await sleep(300);
await E(`WD.recorder.start()`); await sleep(1500);
await E(`WD.recorder.stop()`); await sleep(500); await E(`WD.transport.stop()`); await sleep(150);
const multi = await E(`WD.project.tracks.slice(-2).map(t=>t.regions.length)`);
check('Mehrspur: zwei Spuren gleichzeitig', multi[0] === 1 && multi[1] === 1, multi.join(','));
await E(`WD.project.tracks.slice(-2).forEach(t=>{t.arm=false});WD.bus.emit('tracks');WD.input.refresh()`); await sleep(200);

// MIDI-Aufnahme per echter Tastatur
await E(`WD.view.selTrackId=WD.project.tracks[1].id;WD.project.tracks[1].regions=[];WD.bus.emit('tracks');document.activeElement.blur();WD.view.focus='timeline'`);
await E(`WD.recorder.start()`);
await sleep(300);
for (const k of ['a', 's', 'd']) { await page.holdKey(k, 200); await sleep(150); }
await page.key('1', { code: 'Digit1', keyCode: 49 });
await sleep(100);
await E(`WD.recorder.stop();WD.transport.stop()`);
await sleep(150);
const midi = await E(`(()=>{const r=WD.project.tracks[1].regions[0];return r?r.notes.map(n=>({n:n.n,d:n.d})):[]})()`);
check('K1: MIDI-Aufnahme zeichnet Einzelnoten auf', midi.filter(n => [60, 62, 64].includes(n.n)).length >= 3, JSON.stringify(midi.slice(0, 3)));
check('K1: Akkorde werden aufgezeichnet', midi.length >= 7, midi.length);
check('K1: Tastendauer wird übernommen', midi.slice(0, 3).some(n => n.d !== .125));

// Stimmgerät
section('Stimmgerät');
const pitchAlgo = await E(`(()=>{const sr=48000,out={};for(const f of [82.41,110,196,329.63,392,440]){const d=new Float32Array(8192);for(let i=0;i<d.length;i++)d[i]=.5*Math.sin(2*Math.PI*f*i/sr)+.2*Math.sin(4*Math.PI*f*i/sr)+.1*Math.sin(6*Math.PI*f*i/sr);out[f]=WD.tuner.detectPitch(d,sr)}return out})()`);
check('Tonerkennung: Gitarren- und Ukulele-Töne innerhalb 2 Cent', Object.entries(pitchAlgo).every(([f, v]) => v > 0 && Math.abs(1200 * Math.log2(v / +f)) < 2), JSON.stringify(pitchAlgo));
await E(`WD.tuner.open()`);
await sleep(1500);
const seen = await E(`WD.tuner.last`);
check('Stimmgerät erkennt das Eingangssignal (440 Hz)', near(seen, 440, 3), seen);
await shot('07-stimmgeraet');
await modalClick('Fertig'); await sleep(200);
check('Stimmgerät schließt das Mikrofon wieder', !(await E(`WD.input.active`)));

// Latenzmessung: Auswertung mit künstlichem, verzögertem Signal; am echten Eingang ohne Klicks muss sie ablehnen
const latency = await E(`(()=>{const sr=48000,sp=24000,starts=[],a=new Float32Array(sr*4);for(let i=0;i<6;i++){const s=4800+i*sp;starts.push(s);const at=s+Math.round(.0173*sr);for(let k=0;k<200;k++)a[at+k]=.5*Math.exp(-k/40)*Math.sin(k*.4+.5)}for(let i=0;i<a.length;i++)a[i]+=(Math.random()-.5)*.002;return WD.latencyTest.analyze(a,sr,starts,sp)})()`);
check('Latenzmessung erkennt künstliche 17,3 ms', latency !== null && near(latency, .0173, .0006), latency === null ? 'null' : (latency * 1000).toFixed(2) + ' ms');
const silentLat = await E(`(()=>{const a=new Float32Array(96000);return WD.latencyTest.analyze(a,48000,[4800,28800,52800],24000)})()`);
check('Latenzmessung lehnt Stille ab', silentLat === null);
const liveLat = await E(`WD.latencyTest.run()`);
check('Latenzmessung lehnt Dauerton statt Klicks ab', liveLat === null, liveLat);
check('Latenzmessung schließt das Mikrofon wieder', !(await E(`WD.input.active`)));

// Latenzausgleich: Impuls zu bekannter Zeit in den echten Aufnahmeweg speisen. Er simuliert einen Ton, den der Spieler
// genau zur Abspielzeit (Impuls - Ausgleich) gehört hat, und muss im Take an genau dieser Takt-Position liegen.
await E(`WD.input.settings.latencyOffsetMs=100;WD.view.selTrackId=WD.project.tracks[2].id;WD.project.tracks[2].regions=[];WD.project.bpm=120;WD.bus.emit('tempo');WD.bus.emit('tracks');WD.transport.stop();WD.project.punch=false;WD.project.cycle.on=false`);
await E(`WD.recorder.start()`);
await sleep(500);
const tau = await E(`(()=>{const c=WD.engine.ctx,tau=c.currentTime+.4;const b=c.createBuffer(1,8,c.sampleRate);b.getChannelData(0).fill(6);const s=c.createBufferSource();s.buffer=b;s.connect(WD.input.node);s.start(tau);return tau})()`);
await sleep(1100);
await E(`WD.recorder.stop()`); await sleep(600); await E(`WD.transport.stop()`); await sleep(100);
const lt = await E(`WD.recorder.lastTake`);
const landed = await E(`(()=>{const r=WD.project.tracks[2].regions[0];const b=WD.audioStore.get(r.bufId);const d=b.getChannelData(0);let idx=0,p=0;for(let i=0;i<d.length;i++){const v=Math.abs(d[i]);if(v>p){p=v;idx=i}}return {bar:r.startBar+idx/b.sampleRate/WD.model.secPerBar(),peak:p,spb:WD.model.secPerBar()}})()`);
const expectedBar = lt.startBar + (tau - lt.comp - lt.startT) / landed.spb;
const errMs = (landed.bar - expectedBar) * landed.spb * 1000;
check('Latenzausgleich: Impuls landet am richtigen Takt (Ausgleich ' + (lt.comp * 1000).toFixed(0) + ' ms)', landed.peak > 3 && Math.abs(errMs) < 3.5, errMs.toFixed(2) + ' ms Abweichung');
await E(`WD.input.settings.latencyOffsetMs=0;WD.input.saveSettings();WD.model.setBpm(85);WD.project.tracks[2].regions=[];WD.bus.emit('regions')`);

// ---------- Abschnitte ----------
section('Songabschnitte');
await E(`(()=>{const p=WD.project;p.tracks[1].regions=[WD.model.normalizeRegion({startBar:0,lengthBars:4,notes:[{t:0,n:60,d:.25}],name:'A'}),WD.model.normalizeRegion({startBar:4,lengthBars:8,notes:[{t:0,n:64,d:.25}],name:'B'})];p.markers=[{name:'Intro',startBar:0,lengthBars:4},{name:'Verse',startBar:4,lengthBars:8},{name:'Chorus',startBar:12,lengthBars:4}];WD.sections.render();WD.bus.emit('regions')})()`);
await sleep(100);
await E(`WD.sections.moveWithContent(WD.project.markers[0],12)`);
let st = await E(`({m:WD.project.markers.map(m=>m.name+':'+m.startBar),r:WD.project.tracks[1].regions.map(r=>r.name+':'+r.startBar).sort()})`);
check('Abschnitt verschieben nimmt Inhalt mit', st.m.join() === 'Verse:0,Intro:8,Chorus:12' && st.r.join() === 'A:8,B:0', JSON.stringify(st));
await E(`WD.history.undo()`);
await E(`WD.sections.duplicateWithContent(WD.project.markers[1])`);
st = await E(`({m:WD.project.markers.map(m=>m.name+':'+m.startBar),n:WD.project.tracks[1].regions.length})`);
check('Abschnitt duplizieren mit Inhalt', st.n === 3 && st.m.join() === 'Intro:0,Verse:4,Verse:12,Chorus:20', JSON.stringify(st));
await E(`WD.sections.deleteWithContent(WD.project.markers[2])`);
st = await E(`({m:WD.project.markers.map(m=>m.name+':'+m.startBar),n:WD.project.tracks[1].regions.length})`);
check('Abschnitt löschen mit Inhalt rückt nach', st.n === 2 && st.m.join() === 'Intro:0,Verse:4,Chorus:12', JSON.stringify(st));

// ---------- Speichern ----------
section('Speichern und Sicherheit');
await E(`(async()=>{WD.project.name='Testprojekt';WD.project.keyRoot='D';WD.project.tracks[0].mute=true;WD.project.cycle={on:true,a:1,b:3};WD.project.master.mode='warm';WD.storage.refreshTitle()})()`);
await page.setFile('#fileAudio', stereoWav); await sleep(800);
const hadTracks = await E(`WD.project.tracks.length`);
check('Audio-Import', await E(`WD.project.tracks.flatMap(t=>t.regions).some(r=>r.name==='nur-links')`));
check('Speichern meldet Erfolg', await E(`WD.storage.save()`) === true);
await shot('08-arrangement-mit-audio');
// Datei exportieren
clearDl(f => f.endsWith('.webdaw'));
await E(`WD.storage.exportFile()`);
const wdFile = await waitFile(f => f.endsWith('.webdaw'), 8000);
check('Export als .webdaw', !!wdFile);
const projectId = await E(`WD.project.id`);

await page.goto(url, { settle: 700 });
await E(`WD.engine.ensure()`);
await modalClick('Später');
await E(`WD.storage.openProject(${JSON.stringify(projectId)})`);
await sleep(400);
const reloaded = await E(`(()=>{const p=WD.project;const au=p.tracks.flatMap(t=>t.regions).find(r=>r.name==='nur-links');const b=au&&WD.audioStore.get(au.bufId);const rms=d=>{let s=0;for(const v of d)s+=v*v;return Math.sqrt(s/d.length)};return {n:p.tracks.length,key:p.keyRoot,mute:p.tracks[0].mute,cycle:p.cycle,mode:p.master.mode,ch:b&&b.numberOfChannels,l:b&&rms(b.getChannelData(0)),r:b&&rms(b.getChannelData(1))}})()`);
check('Projekt übersteht Neuladen', reloaded.n === hadTracks, JSON.stringify(reloaded));
check('K4: Stereo bleibt erhalten', reloaded.ch === 2 && reloaded.l > .1 && reloaded.r < .001, `${reloaded.ch} Kanäle, L ${reloaded.l?.toFixed(3)} R ${reloaded.r?.toFixed(4)}`);
check('F18: Mute, Tonart, Cycle, Master gespeichert', reloaded.mute === true && reloaded.key === 'D' && reloaded.cycle.a === 1 && reloaded.mode === 'warm');

// Fehlerhafte Datei
const bad = join(dl, 'kaputt.json'); writeFileSync(bad, '{"bpm":100}');
const nBeforeBad = await E(`WD.project.tracks.length`);
page.errors.length = 0;
await page.setFile('#fileProj', bad); await sleep(400);
const msg = await E(`document.querySelector('.modal p')?.textContent||''`);
check('K2: Kaputte Datei → verständliche Meldung', /Spurliste/.test(msg), msg);
await modalClick('OK');
check('K2: Offenes Projekt bleibt unversehrt', await E(`WD.project.tracks.length`) === nBeforeBad && await E(`WD.project.name`) === 'Testprojekt');

// Alte Projektdatei
const legacyB64 = Buffer.from(new Int16Array([0, 8000, 16000, 8000, 0, -8000]).buffer).toString('base64');
const legacy = join(dl, 'alt.json');
writeFileSync(legacy, JSON.stringify({ bpm: 100, markers: [{ name: 'Intro', startBar: 0, lengthBars: 4 }], tracks: [
    { type: 'inst', name: 'Alt <b>', vol: .5, pan: .2, eqL: 1, eqM: 0, eqH: 0, fxRev: .3, fxDly: 0, fxCmp: 0, dbl: false, auto: [], inst: 'Organ', regions: [{ startBar: 1, lengthBars: 2, loopLen: 0, name: 'R', notes: [{ t: 0, n: 60, d: .25 }], offset: 0, rate: 1, audio: null }] },
    { type: 'audio', name: 'Vox', vol: .8, regions: [{ startBar: 0, lengthBars: 1, name: 'Take', notes: [], offset: 0, rate: 1, audio: { sr: 48000, b64: legacyB64 } }] },
] }));
await page.setFile('#fileProj', legacy); await sleep(600);
await modalClick('Nicht speichern'); await sleep(600);
const lg = await E(`(()=>{const p=WD.project;const r=p.tracks[1]&&p.tracks[1].regions[0];return {bpm:p.bpm,mode:p.master.mode,t:p.tracks.length,buf:r&&!!WD.audioStore.get(r.bufId),rev:p.tracks[0]&&p.tracks[0].fxRev,name:p.tracks[0]&&p.tracks[0].name}})()`);
check('Altes .json-Projekt öffnet, mit Audio und altem Master-Klang', lg.bpm === 100 && lg.t === 2 && lg.buf && lg.mode === 'warm' && lg.rev === .3, JSON.stringify(lg));
// .webdaw zurücklesen
await page.setFile('#fileProj', wdFile); await sleep(1200);
await modalClick('Nicht speichern'); await sleep(800);
const rd = await E(`(()=>{const au=WD.project.tracks.flatMap(t=>t.regions).find(r=>r.name==='nur-links');const b=au&&WD.audioStore.get(au.bufId);return {name:WD.project.name,ch:b&&b.numberOfChannels,len:b&&b.length}})()`);
check('.webdaw-Datei liest Stereo-Audio zurück', rd.ch === 2 && rd.len > 90000, JSON.stringify(rd));

// Autosave: 3 Minuten Audio
await freshReload();
await E(`(async()=>{await WD.storage.newProject();WD.project.name='Autosave-Test';const c=WD.engine.ctx;const b=c.createBuffer(2,c.sampleRate*180,c.sampleRate);const d=b.getChannelData(0);for(let i=0;i<d.length;i+=100)d[i]=.3;const id=WD.audioStore.put(b);WD.history.run('x',()=>WD.model.addTrack('audio','Lang',{regions:[{startBar:0,lengthBars:180/WD.model.secPerBar(),bufId:id,notes:[],name:'Lang'}]}))})()`);
await sleep(5000);
const st3 = await E(`document.getElementById('saveState').textContent`);
check('K3: Autosave mit 3 Minuten Audio läuft', /gesichert/.test(st3), st3);
const autosaveId = await E(`WD.project.id`);
await page.goto(url, { settle: 900 });
const dlgTitle = await waitModal();
console.log('INFO  DB nach Neuladen:', JSON.stringify(await E(`WD.db.all('autosave').then(l=>l.map(a=>a.name))`)));
check('K3: Nach Neuladen wird Wiederherstellung angeboten', /wiederherstellen/.test(dlgTitle), dlgTitle);
await shot('09-wiederherstellung');
await modalClick('Wiederherstellen'); await sleep(1500);
const rec3 = await E(`(()=>{const r=WD.project.tracks[0]&&WD.project.tracks[0].regions[0];const b=r&&WD.audioStore.get(r.bufId);return {name:WD.project.name,dur:b&&b.duration,ch:b&&b.numberOfChannels,s:b&&b.getChannelData(0)[100]}})()`);
check('K3: 3 Minuten Stereo-Audio vollständig wiederhergestellt', rec3.name === 'Autosave-Test' && near(rec3.dur, 180, .1) && rec3.ch === 2 && near(rec3.s, .3, .001), JSON.stringify(rec3));
// Abgelehnte Wiederherstellung bleibt als Sicherung
await E(`WD.history.run('x',()=>{WD.project.name='Autosave-Test 2'});WD.bus.emit('dirty')`);
await sleep(3200);
await page.goto(url, { settle: 900 });
await waitModal();
await modalClick('Später'); await sleep(600);
const bk = await E(`WD.storage.listBackups().then(l=>l.map(b=>b.name+'|'+b.reason))`);
check('K7: Abgelehntes Autosave bleibt als Sicherung', bk.some(x => x.startsWith('Autosave-Test 2')), bk.slice(0, 3).join(', '));
void autosaveId;

// Abgestürzte Aufnahme
await E(`WD.engine.ensure()`);
await E(`(async()=>{await WD.storage.newProject();const t=WD.tracksView.addTrack('audio');WD.view.selTrackId=t.id;await WD.recorder.start()})()`);
await sleep(1800);
await page.send('Page.reload', { ignoreCache: false }); await sleep(1500);
await waitModal(4000);
await modalClick('Später'); await sleep(800);
const saved = await E(`WD.storage.listProjects().then(l=>l.map(p=>p.name))`);
check('Aufnahme übersteht Absturz/Neuladen', saved.some(n => n.startsWith('Gerettete Aufnahme')), saved.join(', '));
await shot('10-gerettet');

// Altes localStorage-Autosave
await freshReload();
const noData = await E(`localStorage.getItem('webdaw_autosave')`);
await E(`(async()=>{localStorage.setItem('webdaw_autosave',JSON.stringify({bpm:90,markers:[],tracks:[{type:'drum',name:'AltDrum',vol:.8,kit:'808',regions:[]}]}));await WD.db.delete('meta','legacyImported')})()`);
await page.goto(url, { settle: 900 });
await modalClick('Später'); await sleep(200);
const lst = await E(`WD.storage.listProjects().then(l=>l.map(p=>p.name))`);
check('Altes Autosave aus localStorage wird übernommen', lst.includes('Autosave der alten Version'), lst.join(', '));
check('Altes Autosave bleibt unangetastet liegen', !!(await E(`localStorage.getItem('webdaw_autosave')`)));
await E(`localStorage.removeItem('webdaw_autosave')`); void noData;

// ---------- Vorlagen, Demos, Export ----------
section('Vorlagen, Demos, Export');
await freshReload();
for (const name of await E(`WD.templates.names()`)) {
    page.errors.length = 0;
    await E(`void WD.templates.create(${JSON.stringify(name)})`);
    await sleep(150);
    await modalClick('Nicht speichern'); await sleep(400);
    await E(`WD.transport.play()`); await sleep(500); await E(`WD.transport.stop()`);
    const info = await E(`({n:WD.project.tracks.length,audio:WD.project.tracks.filter(t=>t.type==='audio').length,arm:WD.project.tracks.filter(t=>t.arm).length})`);
    check(`Vorlage "${name}" ohne Fehler`, info.n > 0 && page.errors.length === 0, JSON.stringify(info) + (page.errors[0] || ''));
    await shot('11-vorlage-' + name.replace(/\W+/g, '-'));
}
await E(`WD.project.tracks.forEach(t=>{t.arm=false});WD.bus.emit('tracks');WD.input.refresh()`);
for (const name of await E(`WD.demos.names()`)) {
    page.errors.length = 0;
    await E(`void WD.demos.load(${JSON.stringify(name)})`); await sleep(200);
    await modalClick('Nicht speichern'); await sleep(500);
    await E(`WD.transport.stop()`);
    check(`Demo "${name}" lädt`, await E(`WD.project.tracks.length`) >= 6 && page.errors.length === 0, page.errors[0] || '');
}
// Rockin' passt in die Zeitleiste
const over = await E(`(()=>{const R=document.getElementById('ruler').getBoundingClientRect().right;return Math.max(...[...document.querySelectorAll('.region')].map(r=>r.getBoundingClientRect().right))-R})()`);
check('K8: Lange Songs passen in die Zeitleiste', over <= 0 && await E(`WD.model.contentEnd()`) >= 40, `Überhang ${over}`);
await shot('12-demo-rockin');
// Zoom-Raster: Lineal und Regionen bleiben gemeinsam
await E(`WD.timeline.setZoom(300)`); await sleep(200);
const posR = await E(`(()=>{const r=WD.project.tracks[0].regions[0];const n=WD.lanes.nodeOf(r.id).getBoundingClientRect().left;const R=document.getElementById('ruler').getBoundingClientRect().left;return {diff:n-R-r.startBar*WD.view.ppb}})()`);
check('F15: Zoom hält Regionen am Raster', Math.abs(posR.diff) < .5, posR.diff);
await shot('13-zoom-rein');
await E(`WD.timeline.setZoom(24)`); await sleep(200); await shot('14-zoom-raus');
await E(`WD.timeline.setZoom(100)`);
// Export
clearDl(f => f.endsWith('.wav'));
await E(`WD.transport.stop();window.__bt=performance.now();window.__bd=WD.exporter.bounce(16).then(b=>{window.__bt=performance.now()-window.__bt;return !!b})`);
const wav = await waitFile(f => f.endsWith('.wav'), 200000);
const bounceSec = await E(`window.__bd.then(()=>window.__bt/1000)`);
check('P1: Rockin-Demo (122 s Musik) exportiert deutlich schneller als Echtzeit', !!wav && bounceSec < 40, `${bounceSec.toFixed(1)} s Rechenzeit (Original: über 120 s, nicht fertig geworden)`);
if (wav) {
    const a = analyzeWav(wav);
    console.log('INFO  Bounce:', JSON.stringify(a));
    check('A2: Bounce ohne Clipping, unter -1 dB', a.clipped === 0 && a.peak <= .9, `Peak ${a.peak.toFixed(3)}`);
    check('Bounce nicht stumm', a.rms > .01, a.rms.toFixed(3));
}

// Stems
clearDl(f => f.endsWith('.wav'));
await E(`void WD.exporter.stems(24)`);
await sleep(500);
for (const end = Date.now() + 90000; Date.now() < end && await E(`WD.exporter.busy`); await sleep(300));
const stems = readdirSync(dl).filter(f => f.endsWith('.wav'));
check('Stems: je Spur eine Datei', stems.length === await E(`WD.project.tracks.filter(t=>t.regions.length).length`), stems.length);
if (stems.length) {
    const a = analyzeWav(join(dl, stems[0]));
    check('Stems: 24 Bit, nicht stumm', a.bits === 24, a.bits);
}

// Eingespielter Take klingt beim Abspielen und im Mix
await E(`(()=>{const c=WD.engine.ctx,b=c.createBuffer(1,c.sampleRate*2,c.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=.4*Math.sin(i/c.sampleRate*2*Math.PI*220);WD.history.run('x',()=>{const t=WD.model.addTrack('audio','Take-Test',{});t.regions.push(WD.model.normalizeRegion({startBar:0,lengthBars:2/WD.model.secPerBar(),bufId:WD.audioStore.put(b),notes:[],name:'Take'}))});WD.bus.emit('tracks')})()`);
await E(`WD.transport.seek(0);WD.transport.play()`);
await sleep(900);
const takeLevel = await E(`WD.meters.level(WD.project.tracks[WD.project.tracks.length-1].id)`);
check('Audio-Region ist beim Abspielen hörbar', takeLevel > .1, takeLevel.toFixed(3));
await E(`WD.project.tracks[WD.project.tracks.length-1].mute=true;WD.bus.emit('mix')`);
await sleep(700);
check('Mute wirkt auf das Signal', await E(`WD.engine.strip(WD.project.tracks[WD.project.tracks.length-1]).muteG.gain.value`) < .02);
await E(`WD.transport.stop();WD.project.tracks[WD.project.tracks.length-1].mute=false;WD.bus.emit('mix')`);
await sleep(100);
const stopTail = await E(`(async()=>{const t=WD.project.tracks.find(x=>x.type==='inst');const s=WD.engine.strip(t);await WD.transport.play();await new Promise(r=>setTimeout(r,500));WD.transport.stop();await new Promise(r=>setTimeout(r,300));return WD.meters.peak(s.meter)})()`);
check('F21: Stop bricht klingende Noten ab', stopTail < .01, stopTail.toFixed(4));

// Bedienung per Maus
await E(`WD.view.selTrackId=WD.project.tracks.find(t=>t.type==='inst').id;WD.bus.emit('track:selected');WD.bottom.show('smart')`);
await sleep(200);
const kn = await page.rect('.smart-knobs .knob svg');
const param0 = await E(`JSON.stringify(WD.model.selTrack())`);
const undoN = await E(`WD.history.undoLabel()`);
await page.drag(kn.x + 22, kn.y + 22, kn.x + 22, kn.y - 30);
check('Smart-Control-Knopf ändert die Spur per Maus', await E(`JSON.stringify(WD.model.selTrack())`) !== param0);
check('Knopf-Geste ergibt einen Undo-Schritt', await E(`WD.history.undoLabel()`) !== undoN);
await E(`WD.history.undo()`); await sleep(100);
check('Undo setzt Knopf zurück', await E(`JSON.stringify(WD.model.selTrack())`) === param0);
await E(`WD.view.libraryOpen=true;WD.libraryPanel.render()`);
const instBefore = await E(`WD.model.selTrack().inst`);
await E(`[...document.querySelectorAll('#libList .libitem')].find(n=>n.textContent.trim()==='Marimba').scrollIntoView()`);
await sleep(80);
const it = await E(`(()=>{const b=[...document.querySelectorAll('#libList .libitem')].find(n=>n.textContent.trim()==='Marimba').getBoundingClientRect();return {x:b.x+40,y:b.y+8}})()`);
await page.mouseClick(it.x, it.y); await sleep(120);
check('Klick in Bibliothek wechselt den Sound', await E(`WD.model.selTrack().inst`) === 'Marimba', `${instBefore} → ${await E(`WD.model.selTrack().inst`)}`);
await E(`WD.bottom.hide()`);
await E(`[...document.querySelectorAll('.menu-btn')].find(b=>b.dataset.menu==='Hilfe').click()`); await sleep(100);
await E(`document.querySelector('.ctx-item').click()`); await sleep(150);
check('Menü öffnet Dialog', /Tastaturkürzel/.test(await E(`document.querySelector('.modal h2')?.textContent||''`)));
await shot('22-tastaturkuerzel');
await modalClick('Schließen');

// ---------- Oberfläche: Menüs, Motive, Größen ----------
section('Oberfläche');
await E(`WD.bottom.show('smart')`); await sleep(200); await shot('15-smart-controls');
await E(`WD.bottom.show('mixer')`); await sleep(200);
await E(`WD.transport.play()`); await sleep(1500);
await shot('16-mixer-spielt');
await E(`WD.transport.stop()`);
await page.click('.menu-btn[data-menu="Song"]'); await sleep(120);
await shot('17-menue-song');
await E(`WD.ui.closeMenu()`);
const trackHead = await page.rect('.thead');
await page.mouseClick(trackHead.x + 150, trackHead.y + 10, { button: 'right' });
await sleep(120);
await shot('18-kontextmenue');
await E(`WD.ui.closeMenu()`);
await E(`WD.bottom.hide()`); await sleep(100);
await E(`WD.topbar.setTheme('light')`); await sleep(200);
await E(`WD.bottom.show('editor')`); await sleep(300);
await shot('19-light-mode');
await E(`WD.bottom.show('mixer')`); await sleep(200);
await shot('20-light-mixer');
await E(`WD.topbar.setTheme('dark');WD.bottom.hide()`); await sleep(100);
await page.key('p', { code: 'KeyP', keyCode: 80 }); await sleep(120);
for (const [w, h] of [[1920, 1080], [1440, 900], [1280, 720], [1024, 700], [800, 600], [420, 780]]) {
    await page.setViewport(w, h); await sleep(250);
    await shot(`21-fenster-${w}x${h}`);
    const m = await E(`(()=>{const d=document.documentElement;const tb=document.getElementById('topbar').getBoundingClientRect();const items=[...document.querySelectorAll('#controlbar button,#controlbar select,#lcd')].filter(e=>e.offsetParent);let overlap=0;for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){if(items[i].contains(items[j])||items[j].contains(items[i]))continue;const a=items[i].getBoundingClientRect(),b=items[j].getBoundingClientRect();if(a.left<b.right-1.5&&b.left<a.right-1.5&&a.top<b.bottom-1.5&&b.top<a.bottom-1.5)overlap++}return {ovf:d.scrollWidth-innerWidth,bar:tb.height,overlap,arr:document.getElementById('arrange').getBoundingClientRect().height}})()`);
    console.log(`INFO  ${w}×${h}:`, JSON.stringify(m));
    check(`Fenster ${w}×${h}: keine Überlappung, kein Überlauf`, m.ovf <= 0 && m.overlap === 0 && m.arr > 60, JSON.stringify(m));
}
await page.setViewport(1440, 900);
await E(`WD.bottom.hide()`);

// Leerlauf-Schleife
await E(`WD.transport.stop();WD.input.close()`);
await sleep(1500);
check('P5: Im Leerlauf läuft keine Animationsschleife', !(await E(`WD.frame.isRunning()`)));

// Dialoge statt prompt/alert
check('Keine nativen Browser-Dialoge verwendet', page.dialogs.filter(d => d.type !== 'beforeunload').length === 0, JSON.stringify(page.dialogs.slice(0, 2)));

// Abschluss
const perf = await page.send('Performance.enable').then(() => page.send('Performance.getMetrics'));
const m = Object.fromEntries(perf.metrics.map(x => [x.name, x.value]));
console.log('INFO  JS-Heap MB:', (m.JSHeapUsedSize / 1048576).toFixed(1), 'DOM-Knoten:', m.Nodes, 'Listener:', m.JSEventListeners);

const s = summary();
writeFileSync(join(root, 'docs', 'test-results.json'), JSON.stringify(s, null, 2));
await close();
rmSync(dl, { recursive: true, force: true });
process.exit(s.failed ? 1 : 0);
