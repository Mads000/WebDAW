// Undo/Redo über JSON-Schnappschüsse des Projekts. Audiodaten sind nur per ID referenziert, also billig.
// Ein Schritt entsteht nur, wenn sich das Projekt wirklich geändert hat (Klick ohne Änderung erzeugt keinen).
'use strict';
(() => {
    const { bus } = WD;
    const LIMIT = 80;
    let undoStack = [], redoStack = [];

    const snap = () => JSON.stringify(WD.project);

    function push(before, label) {
        undoStack.push({ json: before, label });
        if (undoStack.length > LIMIT) undoStack.shift();
        redoStack = [];
        bus.emit('history');
        bus.emit('dirty');
    }

    function apply(json) {
        const next = JSON.parse(json);
        if (next.bpm !== WD.project.bpm) bus.emit('tempo:before');
        WD.project = next;
        const v = WD.view;
        const known = new Set();
        WD.project.tracks.forEach(t => t.regions.forEach(r => known.add(r.id)));
        v.selRegionIds = new Set([...v.selRegionIds].filter(id => known.has(id)));
        if (!WD.model.track(v.selTrackId)) v.selTrackId = WD.project.tracks.length ? WD.project.tracks[0].id : null;
        if (v.editRegionId && !known.has(v.editRegionId)) v.editRegionId = null;
        bus.emit('project', { soft: true });
        bus.emit('history');
        bus.emit('dirty');
    }

    WD.history = {
        // Für längere Gesten (Ziehen): erst begin(), am Ende end()
        begin(label) {
            const before = snap();
            return { end: () => { if (snap() !== before) push(before, label); else bus.emit('history'); }, before };
        },
        // Für einzelne Aktionen
        run(label, fn) {
            const before = snap();
            const res = fn();
            if (snap() !== before) push(before, label);
            return res;
        },
        undo() {
            if (!undoStack.length) return false;
            const { json, label } = undoStack.pop();
            redoStack.push({ json: snap(), label });
            apply(json);
            return true;
        },
        redo() {
            if (!redoStack.length) return false;
            const { json, label } = redoStack.pop();
            undoStack.push({ json: snap(), label });
            apply(json);
            return true;
        },
        clear() { undoStack = []; redoStack = []; bus.emit('history'); },
        canUndo: () => undoStack.length > 0,
        canRedo: () => redoStack.length > 0,
        undoLabel: () => undoStack.length ? undoStack[undoStack.length - 1].label : '',
        redoLabel: () => redoStack.length ? redoStack[redoStack.length - 1].label : '',
    };
})();
