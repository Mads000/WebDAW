// IndexedDB-Zugriff. LocalStorage fasst nur ca. 5 MB; Aufnahmen brauchen ein Vielfaches davon.
'use strict';
(() => {
    const NAME = 'webdaw', VERSION = 1;
    let dbPromise = null;

    function open() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            if (!window.indexedDB) { reject(new Error('Dieser Browser bietet keine Datenbank (IndexedDB) an.')); return; }
            const req = indexedDB.open(NAME, VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                db.createObjectStore('projects', { keyPath: 'id' });   // gespeicherte Projekte
                db.createObjectStore('autosave', { keyPath: 'id' });   // je Projekt der jüngste Stand
                db.createObjectStore('buffers', { keyPath: 'id' });    // Audiodaten
                const b = db.createObjectStore('backups', { keyPath: 'key', autoIncrement: true });
                b.createIndex('projectId', 'projectId');
                const r = db.createObjectStore('recchunks', { keyPath: 'key', autoIncrement: true });
                r.createIndex('session', 'session');
                db.createObjectStore('meta', { keyPath: 'id' });
            };
            req.onsuccess = () => {
                const db = req.result;
                db.onversionchange = () => db.close();
                resolve(db);
            };
            req.onerror = () => reject(req.error);
            req.onblocked = () => reject(new Error('Die Datenbank ist in einem anderen Tab blockiert.'));
        });
        return dbPromise;
    }

    const wrap = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
    const txDone = tx => new Promise((res, rej) => {
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
        tx.onabort = () => rej(tx.error || new Error('Speichern abgebrochen'));
    });

    WD.db = {
        open,
        async get(store, key) {
            const db = await open();
            return wrap(db.transaction(store).objectStore(store).get(key));
        },
        async all(store) {
            const db = await open();
            return wrap(db.transaction(store).objectStore(store).getAll());
        },
        async allKeys(store) {
            const db = await open();
            return wrap(db.transaction(store).objectStore(store).getAllKeys());
        },
        async byIndex(store, index, value) {
            const db = await open();
            return wrap(db.transaction(store).objectStore(store).index(index).getAll(value));
        },
        // Erfolg wird erst gemeldet, wenn die Transaktion wirklich abgeschlossen ist
        async put(store, value) {
            const db = await open();
            const tx = db.transaction(store, 'readwrite');
            tx.objectStore(store).put(value);
            return txDone(tx);
        },
        async delete(store, key) {
            const db = await open();
            const tx = db.transaction(store, 'readwrite');
            tx.objectStore(store).delete(key);
            return txDone(tx);
        },
        async deleteByIndex(store, index, value) {
            const db = await open();
            const tx = db.transaction(store, 'readwrite');
            const os = tx.objectStore(store);
            const keys = await wrap(os.index(index).getAllKeys(value));
            keys.forEach(k => os.delete(k));
            return txDone(tx);
        },
        async estimate() {
            if (!navigator.storage || !navigator.storage.estimate) return null;
            return navigator.storage.estimate();
        },
    };
})();
