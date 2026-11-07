# WebDAW

Eine Musik-DAW im Browser, ohne Installation und ohne Server: Audio- und Instrument-Spuren, Aufnahme echter Instrumente, Piano Roll, Mixer, Effekte, Export.

## Starten

- **Online:** https://mads000.github.io/WebDAW/ (Chrome oder Edge)
- **Als App installieren:** Online-Adresse öffnen, dann Ablage → „App installieren (offline nutzen)“ oder das Installieren-Symbol in der Adressleiste. Danach startet die DAW wie ein Programm, auch ohne Internet. Ist Internet da, lädt sie automatisch die neueste Version.
- **Herunterladen:** Auf GitHub „Code → Download ZIP“, entpacken, dann:
- **Windows:** `start-webdaw.bat` doppelklicken. Die Datei öffnet die DAW in Chrome oder Edge als eigenes Fenster.
- **Sonst:** `index.html` in Chrome oder Edge öffnen.

Projekte werden im Browser gespeichert (IndexedDB). Wichtige Songs bitte zusätzlich über Ablage → „Als Datei exportieren“ sichern.

## Dokumentation

- [PROGRESS.md](PROGRESS.md): Stand und nächste Schritte
- [docs/BERICHT.md](docs/BERICHT.md): Funktionen, Einschränkungen, Testergebnisse
- [docs/ANALYSE.md](docs/ANALYSE.md): Analyse der ursprünglichen Version
- [docs/MUSIK.md](docs/MUSIK.md): musikalische Ausrichtung und Quellen

## Tests

`node tests/e2e.mjs`, `node tests/e2e-mouse.mjs` und `node tests/offline.mjs` (Node 22 und Chrome; keine weiteren Abhängigkeiten).
