// Automation einer Spur (Lautstärke, Panorama, Hall, Filter). Punkte setzen/ziehen, Doppelklick entfernt.
'use strict';
(() => {
    const { el } = WD;
    const M = WD.model;

    function create(tr, laneWidth, height) {
        const key = M.AUTO[tr.autoParam] ? tr.autoParam : 'vol';
        const points = () => M.autoList(tr, key);
        const ensure = () => {
            if (key === 'vol') { if (!tr.auto) tr.auto = []; return tr.auto; }
            if (!tr.autos) tr.autos = {};
            if (!tr.autos[key]) tr.autos[key] = [];
            return tr.autos[key];
        };
        const dpr = 1;
        const w = Math.min(8192, Math.ceil(laneWidth));
        const sx = w / laneWidth;
        const cv = el('canvas', { class: 'autoCv', width: w * dpr, height: height * dpr });
        const yOf = v => (height - 6) - v * (height - 12);
        const col = '#a97fff';

        function draw() {
            const g = cv.getContext('2d');
            g.clearRect(0, 0, cv.width, cv.height);
            g.fillStyle = 'rgba(122,79,212,.14)'; g.fillRect(0, 0, cv.width, cv.height);
            const pts = points().slice().sort((a, b) => a.bar - b.bar);
            const ppb = WD.view.ppb * sx;
            g.strokeStyle = col; g.lineWidth = 2; g.beginPath();
            if (!pts.length) { const y = yOf(M.AUTO[key].def(tr)); g.moveTo(0, y); g.lineTo(cv.width, y); }
            else {
                g.moveTo(0, yOf(pts[0].val));
                pts.forEach(p => g.lineTo(p.bar * ppb, yOf(p.val)));
                g.lineTo(cv.width, yOf(pts[pts.length - 1].val));
            }
            g.stroke();
            g.fillStyle = '#d4bfff';
            pts.forEach(p => { g.beginPath(); g.arc(p.bar * ppb, yOf(p.val), 4, 0, 7); g.fill(); });
        }
        draw();

        const toPt = e => {
            const rc = cv.getBoundingClientRect();
            const step = WD.view.snap && !(e.ctrlKey || e.metaKey) ? 8 : 128;
            return {
                bar: Math.max(0, Math.round((e.clientX - rc.left) / WD.view.ppb * step) / step),
                val: Math.max(0, Math.min(1, ((height - 6) - (e.clientY - rc.top)) / (height - 12))),
            };
        };
        const hit = p => points().find(q => Math.abs(q.bar - p.bar) * WD.view.ppb < 8);

        cv.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            e.stopPropagation(); e.preventDefault();
            cv.setPointerCapture(e.pointerId);
            const tx = WD.history.begin('Automation');
            const list = ensure();
            const p = toPt(e);
            let pt = hit(p);
            if (!pt) { pt = { bar: p.bar, val: p.val }; list.push(pt); }
            pt.val = p.val; draw();
            const move = ev => { const q = toPt(ev); pt.bar = q.bar; pt.val = q.val; draw(); };
            const up = () => {
                cv.removeEventListener('pointermove', move);
                cv.removeEventListener('pointerup', up);
                tx.end();
                WD.bus.emit('mix');
            };
            cv.addEventListener('pointermove', move);
            cv.addEventListener('pointerup', up);
        });
        cv.addEventListener('dblclick', e => {
            e.stopPropagation();
            const pt = hit(toPt(e));
            if (pt) {
                WD.history.run('Automation', () => { const l = ensure(); l.splice(l.indexOf(pt), 1); });
                draw();
                WD.bus.emit('mix');
            }
        });
        return cv;
    }

    WD.automation = { create };
})();
