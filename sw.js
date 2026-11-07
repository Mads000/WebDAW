// Service Worker: macht die DAW nach dem ersten Besuch offline nutzbar.
// Online wird immer die neueste Version geladen (und gespeichert), offline die zuletzt gespeicherte.
// Projekte liegen nicht hier, sondern in IndexedDB; sie sind davon unberührt.
'use strict';
const CACHE = 'webdaw-app';
const FIXED = ['./', './index.html', './manifest.webmanifest',
    './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'];
const NET_TIMEOUT = 4000;

// Alle Dateien, die index.html einbindet, werden gleich beim ersten Besuch gespeichert,
// damit nichts fehlt, falls die Verbindung danach weg ist. Die Liste pflegt sich so selbst.
async function precache() {
    const html = await (await fetch('./index.html', { cache: 'no-cache' })).text();
    const urls = new Set(FIXED);
    for (const m of html.matchAll(/(?:src|href)="([^"#:?]+)"/g)) urls.add('./' + m[1]);
    const cache = await caches.open(CACHE);
    await cache.addAll([...urls].map(u => new Request(u, { cache: 'no-cache' })));
}

self.addEventListener('install', e => {
    e.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
    e.waitUntil((async () => {
        for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
        await self.clients.claim();
    })());
});

async function handle(req) {
    const cache = await caches.open(CACHE);
    const net = fetch(req, { cache: 'no-cache' }).then(res => {
        if (res.ok) cache.put(req, res.clone());
        return res;
    });
    net.catch(() => { }); // offline: wird unten behandelt
    const fromCache = async () => (await cache.match(req, { ignoreSearch: true }))
        || (req.mode === 'navigate' ? cache.match('./index.html') : undefined);
    try {
        // Langsames Netz: nach kurzer Wartezeit die gespeicherte Fassung nehmen, falls vorhanden
        const timeout = new Promise(res => setTimeout(() => res('timeout'), NET_TIMEOUT));
        const first = await Promise.race([net, timeout]);
        if (first !== 'timeout') return first;
        return (await fromCache()) || await net;
    } catch {
        return (await fromCache()) || Response.error();
    }
}

self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
    e.respondWith(handle(req));
});
