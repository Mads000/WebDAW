// Songs direkt von Gerät zu Gerät schicken (WebRTC). Der Sender zeigt einen Code, der Empfänger tippt ihn ein.
// Über den PeerJS-Vermittler läuft nur der Verbindungsaufbau, der Song geht verschlüsselt direkt ans andere Gerät.
// Absichtlich ohne TURN-Server: Kommt keine direkte Verbindung zustande, gibt es eine klare Meldung statt eines Umwegs.
'use strict';
(() => {
    const { el } = WD;
    const PREFIX = 'webdaw-sync-v1-';
    const CHUNK = 16 * 1024, READ = 1 << 20, HIGH_WATER = 1 << 22;
    const CODE_TTL = 5 * 60e3, CONNECT_MS = 25e3;
    const MAX_SIZE = 4 * 1024 ** 3;
    const PEER_OPTS = { debug: 0, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] } };

    const NO_ROUTE = 'Es kam keine direkte Verbindung zustande. Verbinde beide Geräte mit demselben WLAN und versuche es noch einmal.';
    const NO_BROKER = 'Der Vermittlungsdienst ist nicht erreichbar. Prüfe die Internetverbindung beider Geräte.';

    let lib = null;
    const loadLib = () => lib || (lib = new Promise((res, rej) => {
        if (window.Peer) { res(); return; }
        const s = document.createElement('script');
        s.src = 'js/vendor/peerjs.min.js';
        s.onload = () => res();
        s.onerror = () => { lib = null; rej(new Error(NO_BROKER)); };
        document.head.append(s);
    }));

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const newCode = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1e6).padStart(6, '0');
    const isCode = s => /^\d{6}$/.test(s);
    const peerError = err => {
        if (err && err.type === 'peer-unavailable') return 'Unter diesem Code wartet gerade kein Gerät. Prüfe den Code; er gilt 5 Minuten und nur einmal.';
        if (err && ['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) return NO_BROKER;
        if (err && err.type === 'browser-incompatible') return 'Dieser Browser unterstützt keine direkten Verbindungen.';
        return NO_ROUTE;
    };

    function openPeer(id) {
        return new Promise((res, rej) => {
            const p = new window.Peer(id, PEER_OPTS);
            p.once('open', () => res(p));
            p.once('error', err => { p.destroy(); rej(err); });
        });
    }

    async function hostPeer() {
        for (let i = 0; i < 6; i++) {
            const code = newCode();
            try { return { code, peer: await openPeer(PREFIX + code) }; }
            catch (err) { if (err.type !== 'unavailable-id') throw new Error(peerError(err)); }
        }
        throw new Error(NO_BROKER);
    }

    // Sender: liefert den Code; done erfüllt sich, wenn das andere Gerät alles bestätigt hat.
    async function offer(blob, name, { onConnect, onProgress } = {}) {
        await loadLib();
        const { code, peer } = await hostPeer();
        let cancelled = false, finish, fail;
        const done = new Promise((res, rej) => { finish = res; fail = rej; });
        done.catch(() => { }).finally(() => { clearTimeout(ttl); setTimeout(() => peer.destroy(), 400); });
        const ttl = setTimeout(() => fail(new Error('Der Code ist abgelaufen. Starte das Senden noch einmal.')), CODE_TTL);
        let taken = false;
        peer.on('error', err => fail(new Error(peerError(err))));
        peer.on('connection', conn => {
            if (taken) { conn.on('open', () => conn.close()); return; }
            taken = true;
            clearTimeout(ttl);
            const dead = setTimeout(() => fail(new Error(NO_ROUTE)), CONNECT_MS);
            let complete = false;
            conn.on('iceStateChanged', s => { if (s === 'failed' && !complete) fail(new Error(NO_ROUTE)); });
            conn.on('error', () => { if (!complete) fail(new Error(NO_ROUTE)); });
            conn.on('close', () => { if (!complete) fail(new Error('Die Verbindung wurde getrennt.')); });
            conn.on('open', () => {
                clearTimeout(dead);
                if (onConnect) onConnect();
                conn.send(JSON.stringify({ t: 'head', name, size: blob.size }));
            });
            const pump = async () => {
                let sent = 0;
                while (sent < blob.size && !cancelled) {
                    const part = await blob.slice(sent, sent + READ).arrayBuffer();
                    for (let i = 0; i < part.byteLength && !cancelled; i += CHUNK) {
                        while (conn.dataChannel && conn.dataChannel.bufferedAmount > HIGH_WATER && !cancelled) await sleep(10);
                        if (!conn.open) return;
                        conn.send(part.slice(i, i + CHUNK));
                        if (onProgress) onProgress(Math.min(1, (sent + i + CHUNK) / blob.size));
                    }
                    sent += part.byteLength;
                }
            };
            conn.on('data', d => {
                let m; try { m = JSON.parse(d); } catch { return; }
                if (m.t === 'ready') pump().catch(err => fail(err));
                else if (m.t === 'done') { complete = true; finish(); }
                else if (m.t === 'refused') { complete = true; fail(new Error('Das andere Gerät hat die Übertragung abgelehnt.')); }
            });
        });
        return { code, done, cancel: () => { cancelled = true; fail(new Error('abgebrochen')); } };
    }

    // Empfänger: verbindet sich mit dem Code und gibt die vollständige Datei zurück
    async function receive(code, { onProgress } = {}) {
        await loadLib();
        const peer = await new Promise((res, rej) => {
            const p = new window.Peer(PEER_OPTS);
            p.once('open', () => res(p));
            p.once('error', err => { p.destroy(); rej(new Error(peerError(err))); });
        });
        let fail, finish;
        const done = new Promise((res, rej) => { finish = res; fail = rej; });
        done.catch(() => { }).finally(() => setTimeout(() => peer.destroy(), 400));
        peer.on('error', err => fail(new Error(peerError(err))));
        const conn = peer.connect(PREFIX + code, { serialization: 'raw', reliable: true });
        const dead = setTimeout(() => fail(new Error(NO_ROUTE)), CONNECT_MS);
        let head = null, got = 0, chunks = [], complete = false;
        conn.on('iceStateChanged', s => { if (s === 'failed' && !complete) fail(new Error(NO_ROUTE)); });
        conn.on('error', () => { if (!complete) fail(new Error(NO_ROUTE)); });
        conn.on('close', () => { if (!complete) fail(new Error('Die Verbindung wurde getrennt, bevor alles angekommen ist.')); });
        conn.on('open', () => clearTimeout(dead));
        conn.on('data', d => {
            if (typeof d === 'string') {
                const m = JSON.parse(d);
                if (m.t !== 'head') return;
                if (!(m.size > 0 && m.size <= MAX_SIZE)) { complete = true; conn.send(JSON.stringify({ t: 'refused' })); fail(new Error('Die angekündigte Datei hat eine unzulässige Größe.')); return; }
                head = m;
                conn.send(JSON.stringify({ t: 'ready' }));
                return;
            }
            if (!head) return;
            chunks.push(d);
            got += d.byteLength;
            if (onProgress) onProgress(got / head.size);
            if (got >= head.size) {
                complete = true;
                const safe = String(head.name || 'Projekt.webdaw').replace(/[\\/:*?"<>|]/g, '_');
                const file = new File(chunks, /\.webdaw$/i.test(safe) ? safe : safe + '.webdaw');
                chunks = [];
                conn.send(JSON.stringify({ t: 'done' }));
                finish(file);
            }
        });
        return { done, cancel: () => { complete = true; fail(new Error('abgebrochen')); } };
    }

    // Bildschirm während der Übertragung wach halten; iOS trennt die Verbindung sonst beim Sperren
    async function stayAwake() {
        try { return navigator.wakeLock ? await navigator.wakeLock.request('screen') : null; } catch { return null; }
    }

    const progressBar = () => { const fill = el('div'); return { node: el('div', { class: 'sync-bar' }, fill), set: v => { fill.style.width = (v * 100).toFixed(1) + '%'; } }; };
    const mb = n => (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';

    async function sendDialog() {
        const p = WD.project;
        if (!p.tracks.length) { WD.ui.alert('Nichts zu senden', 'Dieses Projekt hat noch keine Spuren.'); return; }
        if (!await WD.storage.save()) return;
        const blob = WD.fileFormat.write(p);
        let job = null, lock = await stayAwake();
        const release = () => { if (lock) { lock.release().catch(() => { }); lock = null; } };
        WD.ui.modal(async (box, close) => {
            const codeEl = el('div', { class: 'sync-code', 'aria-live': 'polite' }, '······');
            const status = el('p', { class: 'sync-status' }, 'Code wird vorbereitet …');
            const bar = progressBar(); bar.node.hidden = true;
            const btn = el('button', { onclick: () => { if (job) job.cancel(); close(); release(); } }, 'Abbrechen');
            box.append(el('h2', {}, 'An anderes Gerät senden'),
                el('p', {}, `„${p.name}“ (${mb(blob.size)}). Am anderen Gerät WebDAW öffnen und unter Ablage „Von anderem Gerät empfangen“ diesen Code eingeben:`),
                codeEl, status, bar.node, el('div', { class: 'modal-btns' }, btn));
            try {
                job = await offer(blob, p.name, {
                    onConnect: () => { status.textContent = 'Verbunden, Song wird übertragen …'; bar.node.hidden = false; },
                    onProgress: bar.set,
                });
                codeEl.textContent = job.code.slice(0, 3) + ' ' + job.code.slice(3);
                status.textContent = 'Warte auf das andere Gerät. Beide im selben WLAN, diese Seite offen lassen.';
                await job.done;
                release();
                close();
                WD.ui.toast('Song ist auf dem anderen Gerät angekommen.', { type: 'ok', ms: 6000 });
            } catch (err) {
                release();
                if (err.message === 'abgebrochen') return;
                status.textContent = err.message; status.classList.add('err');
                bar.node.hidden = true; codeEl.textContent = '–';
                btn.textContent = 'Schließen';
                btn.onclick = close;
            }
        }, { onEscape: () => { if (job) job.cancel(); release(); } });
    }

    function receiveDialog() {
        let job = null;
        WD.ui.modal((box, close) => {
            const input = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '7', class: 'sync-input', placeholder: '123 456', 'aria-label': 'Code' });
            const status = el('p', { class: 'sync-status' });
            const bar = progressBar(); bar.node.hidden = true;
            const go = el('button', { class: 'primary' }, 'Empfangen');
            const start = async () => {
                const code = input.value.replace(/\D/g, '');
                if (!isCode(code)) { status.textContent = 'Der Code hat 6 Ziffern.'; status.classList.add('err'); return; }
                status.classList.remove('err');
                status.textContent = 'Verbinde …'; go.disabled = true; input.disabled = true; bar.node.hidden = false;
                const stopAwake = await stayAwake();
                try {
                    job = await receive(code, { onProgress: v => { bar.set(v); status.textContent = 'Song wird übertragen …'; } });
                    const file = await job.done;
                    close();
                    // Wird immer als neues Projekt geöffnet; vorhandene Projekte bleiben unberührt
                    if (await WD.storage.importFile(file)) WD.ui.toast('Song empfangen und gespeichert.', { type: 'ok', ms: 6000 });
                } catch (err) {
                    if (err.message === 'abgebrochen') return;
                    status.textContent = err.message; status.classList.add('err');
                    go.disabled = false; input.disabled = false; bar.node.hidden = true;
                } finally { if (stopAwake) stopAwake.release().catch(() => { }); }
            };
            go.onclick = start;
            input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); start(); } };
            box.append(el('h2', {}, 'Von anderem Gerät empfangen'),
                el('p', {}, 'Am anderen Gerät „An anderes Gerät senden“ wählen und den angezeigten Code hier eingeben. Der Song wird als neues Projekt gespeichert.'),
                input, status, bar.node,
                el('div', { class: 'modal-btns' }, el('button', { onclick: () => { if (job) job.cancel(); close(); } }, 'Abbrechen'), go));
        }, { onEscape: () => { if (job) job.cancel(); } });
    }

    WD.sync = { offer, receive, sendDialog, receiveDialog };
})();
