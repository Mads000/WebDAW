// Lautstärke-Automation einer Spur. Punkte setzen/ziehen, Doppelklick entfernt.
'use strict';
(() => {
    const { el } = WD;

    function create(tr, laneWidth, height) {
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
            const pts = (tr.auto || []).slice().sort((a, b) => a.bar - b.bar);
            const ppb = WD.view.ppb * sx;
            g.strokeStyle = col; g.lineWidth = 2; g.beginPath();
            if (!pts.length) { g.moveTo(0, yOf(1)); g.lineTo(cv.width, yOf(1)); }
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
        const hit = p => (tr.auto || []).find(q => Math.abs(q.bar - p.bar) * WD.view.ppb < 8);

        cv.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            e.stopPropagation(); e.preventDefault();
            cv.setPointerCapture(e.pointerId);
            const tx = WD.history.begin('Automation');
            if (!tr.auto) tr.auto = [];
            const p = toPt(e);
            let pt = hit(p);
            if (!pt) { pt = { bar: p.bar, val: p.val }; tr.auto.push(pt); }
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
                WD.history.run('Automation', () => { tr.auto = tr.auto.filter(q => q !== pt); });
                draw();
                WD.bus.emit('mix');
            }
        });
        return cv;
    }

    WD.automation = { create };
})();
