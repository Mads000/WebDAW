# WebDAW

Eine Musik-DAW im Browser, ohne Installation und ohne Server: Audio- und Instrument-Spuren, Aufnahme echter Instrumente, Piano Roll, Mixer, Effekte, Export.

## Starten

- **Windows:** `start-webdaw.bat` doppelklicken. Die Datei öffnet die DAW in Chrome oder Edge als eigenes Fenster.
- **Sonst:** `index.html` in Chrome oder Edge öffnen.

Projekte werden im Browser gespeichert (IndexedDB). Wichtige Songs bitte zusätzlich über Ablage → „Als Datei exportieren“ sichern.

## Dokumentation

- [PROGRESS.md](PROGRESS.md): Stand und nächste Schritte
- [docs/BERICHT.md](docs/BERICHT.md): Funktionen, Einschränkungen, Testergebnisse
- [docs/ANALYSE.md](docs/ANALYSE.md): Analyse der ursprünglichen Version
- [docs/MUSIK.md](docs/MUSIK.md): musikalische Ausrichtung und Quellen

## Tests

`node tests/e2e.mjs` und `node tests/e2e-mouse.mjs` (Node 22 und Chrome; keine weiteren Abhängigkeiten).
