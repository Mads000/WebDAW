// Prüft die Funktionen der Überarbeitung im echten Chrome: Comping, Samples, Export, Hall/Echo, Automation, Bedienung.
// Aufruf: node tests/features.mjs
import { launch, makeRunner, sleep } from './lib/cdp.mjs';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dl = join(process.env.TEMP || '.', 'webdaw-features-dl');
rmSync(dl, { recursive: true, force: true }); mkdirSync(dl, { recursive: true });
const url = pathToFileURL(join(root, 'index.html')).href;
const { check, summary } = makeRunner();
const { page, close } = await launch({ downloadDir: dl });
const E = expr => page.eval(expr);
const waitExport = async () => { await sleep(200); for (const end = Date.now() + 60000; Date.now() < end && await E(`WD.exporter.busy`); await sleep(150)); await sleep(500); };
const files = suffix => readdirSync(dl).filter(f => f.endsWith(suffix));
const clear = () => readdirSync(dl).forEach(f => rmSync(join(dl, f)));
const pointer = async (type, x, y, buttons = 1) => page.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: 1 });

await page.goto(url, { settle: 700 });
await pointer('mousePressed', 700, 12); await pointer('mouseReleased', 700, 12, 0);
await E(`WD.engine.ensure()`);

// Hilfsfunktionen im Browser
await E(`window.h = {
  tone(sec, f, amp=.5){ const c=WD.engine.ctx,b=new AudioBuffer({length:Math.round(c.sampleRate*sec),numberOfChannels:1,sampleRate:c.sampleRate}),d=b.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=amp*Math.sin(i/c.sampleRate*6.283185*f); return WD.audioStore.put(b); },
  band(b,a,z,ch=0){ const d=b.getChannelData(ch),i0=Math.floor(a*b.sampleRate),i1=Math.floor(z*b.sampleRate); let s=0; for(let i=i0;i<i1;i++)s+=d[i]*d[i]; return Math.sqrt(s/Math.max(1,i1-i0)); },
  // Grundfrequenz über Nulldurchgänge
  freq(b,a,z){ const d=b.getChannelData(0),i0=Math.floor(a*b.sampleRate),i1=Math.floor(z*b.sampleRate); let n=0; for(let i=i0+1;i<i1;i++) if(d[i-1]<0&&d[i]>=0)n++; return n/(z-a); },
  pitch(b,at,lo,hi){ const d=b.getChannelData(0),sr=b.sampleRate,i0=Math.floor(at*sr),N=8192; let best=0,lag=0; const a0=Math.floor(sr/hi),a1=Math.ceil(sr/lo); for(let l=a0;l<=a1;l++){let c=0;for(let i=0;i<N;i++)c+=d[i0+i]*d[i0+i+l];if(c>best){best=c;lag=l;}} return sr/lag; },
  fresh(){ WD.storage.activate(WD.newProject()); WD.project.bpm=120; },
  addAudio(extra){ return WD.model.addTrack('audio','A',{regions:[WD.model.normalizeRegion(extra)]}); },
};0`);

console.log('\n=== Comping ===');
const comp = await E(`(async()=>{ h.fresh(); const spb=WD.model.secPerBar();
  const a=h.tone(4,220), b=h.tone(4,880);
  const t=h.addAudio({startBar:0,lengthBars:4/spb,bufId:a,offset:0,notes:[],name:'R',takes:[{bufId:a,offset:0,startSec:0},{bufId:b,offset:0,startSec:0}],takeIdx:0});
  const r=t.regions[0]; WD.bus.emit('tracks');
  WD.comping.selectRange(r,1,1,3);
  const pieces=WD.model.audioPieces(r).map(p=>({b:p.bufId===b,start:+(p.startBar*spb).toFixed(3),len:+(p.lengthBars*spb).toFixed(3)}));
  const buf=await WD.render.render([t],{useMaster:false,tail:0});
  const res={n:r.comp.length,pieces,f1:h.freq(buf,.2,.8),f2:h.freq(buf,1.2,2.8),f3:h.freq(buf,3.2,3.8)};
  // Nach Trimmen links bleibt der Comp an der Stelle
  WD.history.run('t',()=>{ r.startBar+=.5/spb; r.lengthBars-=.5/spb; r.offset=.5; });
  const buf2=await WD.render.render([t],{useMaster:false,tail:0});
  res.trim=h.freq(buf2,1.2,2.8);
  WD.history.undo();
  const r2=WD.model.findRegion(r.id).region; const before=WD.history.canUndo();
  // Ganzer Take löst den Comp auf
  WD.comping.selectTake(r2,1);
  res.whole={comp:r2.comp,idx:r2.takeIdx,isB:r2.bufId===b};
  WD.history.undo(); res.undoComp=!!WD.model.findRegion(r.id).region.comp; res.before=before;
  return res; })()`);
check('Comp aus drei Abschnitten', comp.n === 3 && comp.pieces.length === 3 && comp.pieces[1].b, JSON.stringify(comp.pieces));
check('Comp klingt: Take 1, dann Take 2, dann Take 1', Math.abs(comp.f1 - 220) < 5 && Math.abs(comp.f2 - 880) < 5 && Math.abs(comp.f3 - 220) < 5, `${comp.f1} ${comp.f2} ${comp.f3}`);
check('Comp bleibt nach Trimmen an der Stelle', Math.abs(comp.trim - 880) < 5, comp.trim);
check('Ganzer Take löst Comp auf, Undo stellt ihn wieder her', comp.whole.comp === null && comp.whole.idx === 1 && comp.whole.isB && comp.undoComp, JSON.stringify(comp.whole));

const ui = await E(`(async()=>{ h.fresh(); WD.view.ppb=200; const spb=WD.model.secPerBar();
  const a=h.tone(4,220), b=h.tone(4,880);
  const t=h.addAudio({startBar:0,lengthBars:4/spb,bufId:a,offset:0,notes:[],name:'R',takes:[{bufId:a,offset:0,startSec:0},{bufId:b,offset:0,startSec:0}],takeIdx:0});
  WD.bus.emit('tracks'); await new Promise(r=>setTimeout(r,80));
  const q=document.querySelector('.rtake').getBoundingClientRect();
  return {x:q.x+q.width/2,y:q.y+q.height/2,w:q.width,h:q.height,id:t.regions[0].id}; })()`);
await pointer('mousePressed', ui.x, ui.y); await pointer('mouseReleased', ui.x, ui.y, 0); await sleep(120);
const pnl = await E(`(()=>{const rows=[...document.querySelectorAll('.take-row')];if(rows.length<2)return null;const b=rows[1].getBoundingClientRect();const lane=document.querySelector('.tlane').getBoundingClientRect();const row=document.querySelector('.trow').getBoundingClientRect();const reg=document.querySelector('.region').getBoundingClientRect();return {x:b.x,y:b.y+b.height/2,w:b.width,rowH:row.height,regH:reg.height,n:rows.length}})()`);
check('Klick auf das Take-Symbol klappt die Takes auf', pnl && pnl.n === 2, JSON.stringify(pnl));
check('Region behält ihre Höhe, die Zeile wächst', pnl && pnl.rowH > 120 && pnl.regH < 70, JSON.stringify(pnl));
await page.screenshot(join(root, 'docs/screenshots/neu/23-comping.png'));
await pointer('mouseMoved', pnl.x + 200, pnl.y, 0);
await pointer('mousePressed', pnl.x + 200, pnl.y);
await pointer('mouseMoved', pnl.x + 300, pnl.y);
await pointer('mouseReleased', pnl.x + 300, pnl.y, 0); await sleep(150);
const dragged = await E(`(()=>{const r=WD.model.findRegion(${JSON.stringify(ui.id)}).region;return r.comp&&r.comp.map(s=>[+s.t0.toFixed(2),+s.t1.toFixed(2),s.take])})()`);
check('Ziehen über Take 2 schneidet genau diesen Bereich ein', dragged && dragged.length === 3 && dragged[1][2] === 1 && Math.abs(dragged[1][0] - 2) < .05 && Math.abs(dragged[1][1] - 3) < .05, JSON.stringify(dragged));
check('Region zeigt „Comp“', /Comp/.test(await E(`document.querySelector('.rtake').textContent`)));
await page.screenshot(join(root, 'docs/screenshots/neu/24-comp-fertig.png'));

console.log('\n=== Samples ===');
const smp = await E(`(async()=>{ h.fresh(); const out={piano:WD.samples.count('piano'),bass:WD.samples.count('bass'),drums:WD.samples.count('drums')};
  const render=async(tr)=>WD.render.render([tr],{useMaster:false,tail:.5});
  const pt=WD.model.addTrack('inst','P',{inst:'Sampled Grand',regions:[WD.model.normalizeRegion({startBar:0,lengthBars:1,notes:[{t:0,n:69,d:.5,v:1}]})]});
  const b=await render(pt); out.pianoRms=h.band(b,.05,.5); out.pianoF=h.pitch(b,.1,300,1000); out.pianoPeak=Math.max(...b.getChannelData(0).subarray(0,20000).map(Math.abs));
  // Anschlag ohne Verzögerung
  let on=0; const d=b.getChannelData(0); const lim=out.pianoPeak*.1; while(on<d.length&&Math.abs(d[on])<lim)on++; out.onsetMs=on/b.sampleRate*1000;
  const dt=WD.model.addTrack('drum','D',{kit:'Sampled Kit',regions:[WD.model.normalizeRegion({startBar:0,lengthBars:1,notes:[0,1,2,3,4,5,6,7].map((n,i)=>({t:i/8,n,d:.1,v:1}))})]});
  const b2=await render(dt); const spb=WD.model.secPerBar(); out.drumRms=[...Array(8).keys()].map(i=>h.band(b2,i/8*spb+.002,i/8*spb+.1));
  const bt=WD.model.addTrack('inst','B',{inst:'Sampled Bass',regions:[WD.model.normalizeRegion({startBar:0,lengthBars:1,notes:[{t:0,n:40,d:1,v:1}]})]});
  const b3=await render(bt); out.bassRms=h.band(b3,.05,.8);
  return out; })()`);
check('Alle Sample-Sets geladen', smp.piano === 15 && smp.bass === 7 && smp.drums === 7, JSON.stringify([smp.piano, smp.bass, smp.drums]));
check('Flügel klingt auf der richtigen Tonhöhe', smp.pianoRms > .03 && Math.abs(smp.pianoF - 440) < 8, `${smp.pianoRms.toFixed(3)} / ${smp.pianoF} Hz`);
check('Flügel setzt ohne Verzögerung ein', smp.onsetMs < 8, smp.onsetMs.toFixed(1) + ' ms');
check('Flügel übersteuert nicht', smp.pianoPeak < 1, smp.pianoPeak.toFixed(2));
check('Alle 8 Drum-Spuren klingen', smp.drumRms.every(v => v > .004), smp.drumRms.map(v => v.toFixed(3)).join(' '));
check('E-Bass klingt', smp.bassRms > .02, smp.bassRms.toFixed(3));
const compat = await E(`(()=>{const n=Object.values(WD.project.tracks);return WD.instruments.label('Clean Guitar')+'|'+WD.instruments.label('Grand Piano')+'|'+('Grand Piano' in WD.instruments.INSTR)})()`);
check('Deutsche Anzeige, alte Namen bleiben lauffähig', compat === 'Clean-Gitarre|Flügel (Synth)|true', compat);

console.log('\n=== Hall und Echo ===');
const fx = await E(`(async()=>{ h.fresh(); const spb=WD.model.secPerBar();
  const c=WD.engine.ctx,b=new AudioBuffer({length:c.sampleRate*.02,numberOfChannels:1,sampleRate:c.sampleRate}); b.getChannelData(0).fill(.8);
  const id=WD.audioStore.put(b);
  const mk=extra=>WD.model.normalizeTrack(Object.assign({type:'audio',name:'x',vol:1,regions:[WD.model.normalizeRegion({startBar:0,lengthBars:.02/spb,bufId:id,notes:[]})]},extra));
  const tailAt=async(extra,a,z)=>h.band(await WD.render.render([mk(extra)],{useMaster:false,tail:6}),a,z);
  const out={};
  out.small=await tailAt({fxRev:1,fxRevSize:0},1.5,2);
  out.mid=await tailAt({fxRev:1,fxRevSize:.5},1.5,2);
  out.large=await tailAt({fxRev:1,fxRevSize:1},1.5,2);
  const echoAt=async div=>{ const r=await WD.render.render([mk({fxDly:.8,fxDlyDiv:div})],{useMaster:false,tail:2}); const d=r.getChannelData(0),sr=r.sampleRate; let m=0,at=0; for(let i=Math.floor(.05*sr);i<sr*1.6;i++) if(Math.abs(d[i])>m){m=Math.abs(d[i]);at=i/sr;} return at; };
  out.q=await echoAt('1/4'); out.e=await echoAt('1/8'); out.d=await echoAt('1/8.');
  return out; })()`);
check('Raumgröße verlängert den Hall', fx.small < fx.mid / 5 && fx.large > fx.mid * 1.5, `${fx.small.toExponential(2)} ${fx.mid.toExponential(2)} ${fx.large.toExponential(2)}`);
check('Echo-Zeit folgt der Notenlänge (120 BPM)', Math.abs(fx.q - .5) < .02 && Math.abs(fx.e - .25) < .02 && Math.abs(fx.d - .375) < .02, `${fx.q} ${fx.e} ${fx.d}`);

console.log('\n=== Automation ===');
const au = await E(`(async()=>{ h.fresh(); const spb=WD.model.secPerBar();
  const id=h.tone(4,1000,.4); const reg=()=>[WD.model.normalizeRegion({startBar:0,lengthBars:4/spb,bufId:id,notes:[]})];
  const out={};
  let t=WD.model.addTrack('audio','P',{vol:1,regions:reg(),autos:{pan:[{bar:0,val:0},{bar:4/spb,val:1}]}});
  let b=await WD.render.render([t],{useMaster:false,tail:0});
  out.panStartL=h.band(b,.05,.3,0); out.panStartR=h.band(b,.05,.3,1); out.panEndL=h.band(b,3.6,3.9,0); out.panEndR=h.band(b,3.6,3.9,1);
  t=WD.model.addTrack('audio','F',{vol:1,regions:reg(),autos:{lp:[{bar:0,val:1},{bar:4/spb,val:0}]}});
  b=await WD.render.render([t],{useMaster:false,tail:0}); out.lpOpen=h.band(b,.05,.3); out.lpClosed=h.band(b,3.7,3.95);
  const id2=WD.audioStore.put((()=>{const c=WD.engine.ctx,a=new AudioBuffer({length:c.sampleRate*.02,numberOfChannels:1,sampleRate:c.sampleRate});a.getChannelData(0).fill(.8);return a;})());
  const hit=(start)=>WD.model.normalizeRegion({startBar:start,lengthBars:.02/spb,bufId:id2,notes:[]});
  t=WD.model.addTrack('audio','H',{vol:1,fxRev:0,regions:[hit(0),hit(2/spb)],autos:{rev:[{bar:0,val:0},{bar:1.9/spb,val:0},{bar:2/spb,val:1}]}});
  b=await WD.render.render([t],{useMaster:false,tail:1}); out.revOff=h.band(b,.3,.8); out.revOn=h.band(b,2.3,2.8);
  // Speichern und Laden erhält die Automation
  const clean=WD.fileFormat.sanitize(JSON.parse(JSON.stringify(WD.project)));
  out.saved=clean.tracks[0].autos.pan.length;
  return out; })()`);
check('Panorama-Automation wandert von links nach rechts', au.panStartL > au.panStartR * 5 && au.panEndR > au.panEndL * 5, JSON.stringify(au));
check('Filter-Automation schließt den Klang', au.lpClosed < au.lpOpen * .6, `${au.lpOpen.toFixed(3)} → ${au.lpClosed.toFixed(3)}`);
check('Hall-Automation setzt ein', au.revOn > au.revOff * 20, `${au.revOff.toExponential(2)} → ${au.revOn.toExponential(2)}`);
check('Automation überlebt Speichern', au.saved === 2, au.saved);
await E(`(()=>{h.fresh();WD.history.run('x',()=>WD.model.addTrack('audio','A',{showAuto:true,autoParam:'pan'}));WD.bus.emit('tracks')})()`);
await sleep(80);
check('Parameterwahl im Spurkopf', await E(`document.querySelector('.tauto')?.value`) === 'pan');

console.log('\n=== Export ===');
const setup = `(()=>{h.fresh();const spb=WD.model.secPerBar();const a=h.tone(8,440,.3);
  WD.model.addTrack('audio','Gitarre',{vol:1,fxRev:.8,regions:[WD.model.normalizeRegion({startBar:0,lengthBars:8/spb,bufId:a,notes:[]})]});
  WD.model.addTrack('audio','Stimme',{vol:1,regions:[WD.model.normalizeRegion({startBar:0,lengthBars:8/spb,bufId:a,notes:[]})]});
  WD.model.addTrack('inst','Leer',{inst:'Organ'});
  WD.project.cycle={on:false,a:.5,b:1};return 0})()`;
await E(setup);
const tr = await E(`(async()=>{const t=WD.project.tracks[0];const wet=await WD.exporter.track(t,{format:'wav16',dry:false,master:false,cycle:false});const dry=await WD.exporter.track(t,{format:'wav16',dry:true,master:false,cycle:false});const cy=await WD.exporter.track(t,{format:'wav16',dry:true,master:false,cycle:true});return{wet:h.band(wet,8.2,9),dry:h.band(dry,8.2,9),dur:cy.duration,inCycle:h.band(cy,.1,.9)}})()`);
await sleep(600);
check('Spur-Export: mit Effekten hallt nach, trocken nicht', tr.wet > .001 && tr.dry < 1e-5, `${tr.wet.toExponential(2)} ${tr.dry.toExponential(2)}`);
check('Spur-Export: nur Cycle-Bereich', Math.abs(tr.dur - 1) < .01 && tr.inCycle > .1, `${tr.dur} s`);
check('Spur-Export legt WAV-Datei ab', files('.wav').some(f => f.includes('Gitarre')), files('.wav').join(', '));
clear();
await E(`void WD.exporter.stems([WD.project.tracks[1]],{format:'wav16'})`);
await waitExport();
const zip = files('.zip');
let names = [];
if (zip.length) { const z = readFileSync(join(dl, zip[0])); for (let o = 0; z.readUInt32LE(o) === 0x04034b50;) { const s = z.readUInt32LE(o + 18), n = z.readUInt16LE(o + 26); names.push(z.toString('utf8', o + 30, o + 30 + n)); o += 30 + n + s; } }
check('Stem-Auswahl: nur die gewählte Spur im ZIP', zip.length === 1 && names.length === 1 && names[0].includes('Stimme'), names.join(', '));
clear();
await E(`void WD.exporter.bounce('mp3192')`);
await waitExport();
const mp3 = files('.mp3');
const mp3Info = mp3.length ? await E(`(async()=>{const s=${JSON.stringify(readFileSync(join(dl, mp3[0])).toString('base64'))};const u=Uint8Array.from(atob(s),c=>c.charCodeAt(0));const b=await WD.engine.ctx.decodeAudioData(u.buffer);return{d:b.duration,f:h.freq(b,1,3),rms:h.band(b,1,3),size:u.length}})()`) : null;
check('MP3-Export ist abspielbar und klingt richtig', mp3Info && mp3Info.d > 8 && Math.abs(mp3Info.f - 440) < 6 && mp3Info.rms > .05, JSON.stringify(mp3Info));
await E(`WD.exporter.stemsDialog()`); await sleep(100);
check('Stem-Dialog listet nur Spuren mit Inhalt', await E(`document.querySelectorAll('.check-list input').length`) === 2);
await page.screenshot(join(root, 'docs/screenshots/neu/25-stem-export.png'));
await E(`[...document.querySelectorAll('.modal button')].find(b=>b.textContent==='Abbrechen').click()`);
await E(`(()=>{document.querySelector('.tmore').click()})()`); await sleep(80);
check('Spur-Menü: Eintrag „Diese Spur exportieren“', /Diese Spur exportieren/.test(await E(`document.querySelector('.ctx-menu').textContent`)));
await E(`WD.ui.closeMenu()`);

console.log('\n=== Einfügen ===');
const pasted = await E(`(()=>{h.fresh();const t=WD.model.addTrack('inst','I',{inst:'Organ',regions:[WD.model.normalizeRegion({startBar:0,lengthBars:2,notes:[]}),WD.model.normalizeRegion({startBar:2,lengthBars:1,notes:[]})]});
  WD.view.selTrackId=t.id; WD.regionOps.selectOnly([t.regions[0].id]); WD.regionOps.copy(); WD.transport.seek(.5); WD.regionOps.paste();
  const r=t.regions.slice().sort((a,b)=>a.startBar-b.startBar);let overlap=false;for(let i=1;i<r.length;i++)if(r[i].startBar<r[i-1].startBar+r[i-1].lengthBars-1e-6)overlap=true;
  return{n:r.length,last:r[r.length-1].startBar,overlap}})()`);
check('Einfügen überlagert nichts und rückt hinter die Region', pasted.n === 3 && !pasted.overlap && pasted.last === 3, JSON.stringify(pasted));

console.log('\n=== Bedienung ===');
await E(`h.fresh()`);
await E(`WD.projectDialogs.inputSettings()`); await sleep(250);
check('Audio-Eingang: kein „null“ im Dialog', !/null/.test(await E(`document.querySelector('.modal').textContent`)));
await E(`[...document.querySelectorAll('.modal button')].find(b=>b.textContent==='Fertig').click()`);
await E(`void WD.ui.confirm('Test','x');0`); await sleep(100);
await pointer('mousePressed', 20, 500); await pointer('mouseReleased', 20, 500, 0); await sleep(100);
check('Klick neben einen Dialog schließt nichts', await E(`!!document.querySelector('.modal')`));
await E(`[...document.querySelectorAll('.modal button')].find(b=>b.textContent==='OK').click()`);
const lib = t => E(`(()=>{h.fresh();WD.tracksView.addTrack('${t}');WD.libraryPanel.render();return document.getElementById('libList').textContent})()`);
const libDrum = await lib('drum'), libAudio = await lib('audio'), libInst = await lib('inst');
check('Drum-Spur zeigt keine Gitarren- oder Gesangs-Presets', !/Klang: Gitarre|Klang: Gesang|Crunch|Lead-Gesang/.test(libDrum) && /Akustik-Kit/.test(libDrum) && /Hyperpop-Drums/.test(libDrum));
check('Audio-Spur zeigt Gitarre und Gesang, keine Drums', /Klang: Gitarre/.test(libAudio) && /Klang: Gesang/.test(libAudio) && !/Klang: Drums/.test(libAudio));
check('Instrument: deutsche Namen, Samples zuerst', /Echte Samples/.test(libInst.slice(0, 40)) && /Clean-Gitarre/.test(libInst) && !/Clean Guitar/.test(libInst));
const label = await E(`(()=>{h.fresh();WD.tracksView.addTrack('audio');WD.bottom.show('smart');return 1})()`);
await sleep(150);
const clipped = await E(`[...document.querySelectorAll('.knob .k-label')].filter(n=>n.scrollWidth>n.clientWidth).map(n=>n.textContent)`);
check('Keine abgeschnittenen Regler-Beschriftungen', clipped.length === 0, clipped.join(', ')); void label;
check('Hall hat Raumgröße, Echo hat Zeit', await E(`/Raum/.test(document.querySelector('.fx-chain').textContent)&&!!document.querySelector('[aria-label="Echo-Zeit"]')`));
await page.screenshot(join(root, 'docs/screenshots/neu/26-smart-controls.png'));
await E(`(()=>{h.fresh();const t=WD.model.addTrack('inst','I',{inst:'Organ',regions:[WD.model.normalizeRegion({startBar:0,lengthBars:1,notes:[{t:0,n:60,d:.25,v:.9}]})]});WD.bus.emit('tracks');WD.editor.open(t.regions[0].id)})()`);
await sleep(300);
const bh = await E(`document.getElementById('bottom').getBoundingClientRect().height`);
check('Editor ist standardmäßig höher', bh > 440, bh);
await page.screenshot(join(root, 'docs/screenshots/neu/27-piano-roll-namen.png'));
await E(`WD.bottom.hide()`);
await E(`WD.projectDialogs.firstStepsDialog()`); await sleep(80);
check('Hilfe: Erste Schritte vorhanden', /Vorlage wählen/.test(await E(`document.querySelector('.modal').textContent`)) && /Eingang messen/.test(await E(`document.querySelector('.modal').textContent`)));
await page.screenshot(join(root, 'docs/screenshots/neu/28-erste-schritte.png'));
await E(`[...document.querySelectorAll('.modal button')].find(b=>b.textContent==='Schließen').click()`);
check('Werkzeugleiste beschriftet', await E(`getComputedStyle(document.getElementById('btnLibrary'),'::after').content`) === '"Klänge"');

console.log('\n=== Playhead präzise ===');
const near = (a, b, eps = 1e-4) => Math.abs(a - b) < eps;
const cur = () => E(`WD.transport.current()`);
await E(`(()=>{h.fresh();WD.view.ppb=160;WD.view.snap=true;WD.view.grid='0.25';WD.timeline.layout();WD.bus.emit('zoom');document.getElementById('arrange').scrollLeft=0;WD.project.cycle.on=false;WD.transport.seek(.25)})()`);
await sleep(150);
const rul = await E(`(()=>{const r=document.getElementById('ruler').getBoundingClientRect();return{left:r.left,y:r.top+20}})()`);
const cyc0 = await E(`JSON.stringify(WD.project.cycle)`);
await page.drag(rul.left + 40, rul.y, rul.left + 122, rul.y);
await sleep(80);
check('Playhead im Lineal ziehen rastet ein', near(await cur(), .75), await cur());
check('Ziehen am Playhead legt keinen Cycle an', cyc0 === await E(`JSON.stringify(WD.project.cycle)`));
await page.key('ArrowRight', { modifiers: 8 });
check('Umschalt+Pfeil: eine Rasterlinie', near(await cur(), 1), await cur());
await page.key('ArrowRight');
check('Pfeil: ein Takt', near(await cur(), 2), await cur());
const spb = await E(`WD.model.secPerBar()`);
await page.key('ArrowRight', { modifiers: 2 });
check('Strg+Pfeil: 10 ms', near(await cur(), 2 + .01 / spb), await cur());
await sleep(120);
check('Feine Position steht in der Anzeige', /^3\.1\.1\.\d\d$/.test(await E(`document.getElementById('pos').textContent`)), await E(`document.getElementById('pos').textContent`));
await page.key('ArrowLeft', { modifiers: 8 });
check('Umschalt+Pfeil von zwischen den Linien: nächste Linie', near(await cur(), 2), await cur());
await page.dblclick('#lcdPos');
await sleep(350);
check('Doppelklick öffnet die Eingabe, Anzeige bleibt im Taktmodus', await E(`!!document.querySelector('.lcd-pos-edit')&&document.getElementById('posLabel').textContent.startsWith('TAKT')`));
await E(`document.querySelector('.lcd-pos-edit').value='9.9'`);
await page.key('Enter');
check('Ungültige Eingabe bleibt offen und wird markiert', await E(`document.querySelector('.lcd-pos-edit').classList.contains('bad')`));
await E(`document.querySelector('.lcd-pos-edit').value='4.2.3'`);
await page.key('Enter');
await sleep(100);
check('Position 4.2.3 wird exakt übernommen', near(await cur(), 3 + .25 + .125), await cur());
check('Eingabe ist wieder zu', await E(`!document.querySelector('.lcd-pos-edit')&&!document.getElementById('pos').hidden`));
check('Zeit-Eingabe 0:02.5', near(await E(`WD.timeline.parsePosition('0:02,5','bars')`), 2.5 / spb));
await E(`WD.transport.seek(.5)`); await sleep(80);
await E(`WD.transport.play()`); await sleep(250);
const px = await E(`WD.transport.audible()*WD.view.ppb`);
await page.drag(rul.left + px, rul.y, rul.left + 480, rul.y);
await sleep(120);
const afterPlay = await E(`({p:WD.transport.playing,c:WD.transport.current(),d:WD.timeline.dragPos})`);
check('Ziehen während der Wiedergabe springt beim Loslassen', afterPlay.p && afterPlay.c >= 3 && afterPlay.c < 3.3 && afterPlay.d === null, JSON.stringify(afterPlay));
await E(`WD.transport.stop()`);

console.log('\n=== MIDI ===');
const midi = await E(`(async()=>{h.fresh();const t=WD.model.addTrack('inst','I',{inst:'Sampled Grand'});WD.view.selTrackId=t.id;
  await WD.recorder.start(); await new Promise(r=>setTimeout(r,200));
  WD.midi.handle([0x90,62,64]); await new Promise(r=>setTimeout(r,250)); WD.midi.handle([0x80,62,0]); await new Promise(r=>setTimeout(r,100));
  WD.recorder.stop(); WD.transport.stop();
  const n=t.regions[0]&&t.regions[0].notes[0];
  const d=WD.model.addTrack('drum','D',{kit:'Sampled Kit'});WD.view.selTrackId=d.id;
  await WD.recorder.start(); await new Promise(r=>setTimeout(r,150)); WD.midi.handle([0x99,36,127]); await new Promise(r=>setTimeout(r,120)); WD.recorder.stop(); WD.transport.stop();
  const k=d.regions[0]&&d.regions[0].notes[0];
  return{n:n&&n.n,v:n&&n.v,d:n&&n.d,kick:k&&k.n,supported:WD.midi.supported}})()`);
check('MIDI-Note wird mit Anschlagstärke aufgenommen', midi.n === 62 && Math.abs(midi.v - 64 / 127) < .01 && midi.d > 0, JSON.stringify(midi));
check('MIDI: GM-Kick trifft die Kick-Spur', midi.kick === 0, midi.kick);

check('Keine JavaScript-Fehler', page.errors.length === 0, page.errors.join(' | '));
await close();
process.exit(summary().failed ? 1 : 0);
