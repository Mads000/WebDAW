// Offline-Nutzung und Installation als App (nur über http/https, nicht per Doppelklick auf die Datei).
'use strict';
(() => {
    const web = location.protocol === 'https:' || location.protocol === 'http:';
    const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    let promptEvent = null;
    let offlineReady = false;

    // Das Manifest erst hier einbinden: per Doppelklick (file://) würde Chrome es blockieren und einen Fehler melden
    if (web) document.head.appendChild(WD.el('link', { rel: 'manifest', href: 'manifest.webmanifest' }));

    if (web && 'serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => {
            offlineReady = true;
        }).catch(err => console.warn('Offline-Modus nicht verfügbar:', err));
    }

    // Chrome und Edge bieten die Installation über dieses Ereignis an
    addEventListener('beforeinstallprompt', e => { e.preventDefault(); promptEvent = e; });
    addEventListener('appinstalled', () => {
        promptEvent = null;
        WD.ui.toast('WebDAW ist installiert und startet jetzt auch ohne Internet.', { type: 'ok', ms: 6000 });
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
    });

    WD.install = {
        get offlineReady() { return offlineReady; },
        menuItem() {
            if (standalone()) return { label: 'Als App installiert', disabled: true, action: () => { } };
            return { label: 'App installieren (offline nutzen) …', action: () => WD.install.run() };
        },
        async run() {
            if (!web) {
                WD.ui.alert('App installieren',
                    'Installieren geht nur über die Online-Adresse https://mads000.github.io/WebDAW/. ' +
                    'Diese Version hier (aus einer Datei gestartet) läuft ohnehin schon ohne Internet.');
                return;
            }
            if (promptEvent) {
                const e = promptEvent; promptEvent = null;
                await e.prompt();
                return;
            }
            WD.ui.alert('App installieren',
                'Klicke in Chrome oder Edge rechts in der Adressleiste auf das Installieren-Symbol ' +
                '(Bildschirm mit Pfeil) oder im Browsermenü auf „Installieren“ bzw. „Als App installieren“. ' +
                (offlineReady ? 'Die DAW ist in diesem Browser bereits für die Offline-Nutzung gespeichert.'
                    : 'Die Offline-Dateien werden gerade gespeichert.'));
        },
    };
})();
