# WebDAW – Fortschritt

Wird nach jeder Phase aktualisiert.

## Aktueller Projektzustand

- **Phase:** alle 9 Phasen abgeschlossen
- **Starten:** `start-webdaw.bat` oder `index.html` doppelklicken (Chrome oder Edge); online unter https://mads000.github.io/WebDAW/, dort als App installierbar und offline nutzbar
- **Tests:** `tests/e2e.mjs`, `tests/e2e-mouse.mjs`, `tests/features.mjs`, `tests/offline.mjs`, `tests/loop.mjs`
- **Noch nicht geprüft:** echte Instrumente, echtes Interface, echtes MIDI-Keyboard und Hören (siehe „Als Nächstes“)
- **Sicherung:** `_backup_original/` (alle drei Original-HTML-Dateien, schreibgeschützt)
- **Bericht:** [docs/BERICHT.md](docs/BERICHT.md) · Analyse: [docs/ANALYSE.md](docs/ANALYSE.md) · Musik: [docs/MUSIK.md](docs/MUSIK.md)

## Erledigt

### Phase 1 – Bestandsaufnahme ✅
Gesamten Code gelesen, 32 Prüfungen im Browser am unveränderten Original (16 bestanden), Screenshots, priorisierte Bugliste.

### Phase 2 – Aufteilung ✅
Per Skript in 4 CSS- und 22 JS-Dateien geteilt, ohne Code umzuschreiben. 32 von 32 Testergebnissen identisch, 18 von 21 Screenshots pixelgleich, die übrigen 3 zeigen Live-Inhalte. Diese Zwischenstruktur wurde in Phase 3–7 weiterentwickelt.

### Phase 3 – Design und Bedienung ✅
Neues Hauptfenster, Transport, Spurköpfe, Timeline, Songabschnitte mit Inhalt, Piano Roll und Drums in einem Editor, Mixer, Smart Controls. Abweichung vom Phasenplan: Datenmodell und Engine-Kern wurden vorgezogen, weil die Oberfläche darauf aufbaut.

### Phase 4 – Musik ✅
Recherche, neue Skizzen-Sounds, Kits, Loops, Klang-Presets, 5 Vorlagen. Auf deinen Hinweis hin sind Gitarren und Ukulele in den Vorlagen Audio-Spuren zum Einspielen; dazu kamen Stimmgerät und Latenzmessung. EP „and uh“ in den Quellen nicht auffindbar (siehe docs/MUSIK.md).

### Phase 5 – Audio-Engine ✅
Sampelgenauer Scheduler im Worker, gleicher Kanalzug live und im Bounce, neutraler Master mit Limiter, 12 Effekte in fester Reihenfolge, Aufnahme per AudioWorklet (unkomprimiert), Takes, Punch, Mehrspur, Monitoring, Latenzausgleich. Alle Effekte am Signal gemessen.

### Phase 6 – Workflow ✅
Kontextmenüs, Tastaturkürzel, Tooltips, Undo mit genau einem Schritt je Geste, Mehrfachauswahl, Kopieren und Einfügen, Drag & Drop, eigene Dialoge, verständliche Fehlermeldungen, Dark und Light Mode.

### Phase 7 – Speicherung ✅
IndexedDB, sofortige Sicherung von Audio, Autosave, Wiederherstellung, Sicherungen, Rettung abgebrochener Aufnahmen, verlustfreies `.webdaw`-Format, Übernahme alter Projekte und des alten Autosaves ohne Löschen.

### Phase 8 – Qualitätskontrolle ✅
Tests unter echten Doppelklick-Bedingungen. Gefundene und behobene Fehler der neuen Version: AudioWorklets über `file://` blockiert, Spuren ohne Effekte stumm, Tempo-Sprung, Latenz-Schwankung von 40 ms, Gleichanteil im Drive, langsamer Bounce (jetzt 7,6 s statt über 120 s), Pegelanzeige, Layout bei kleinen Fenstern.

### Phase 9 – Bericht ✅
[docs/BERICHT.md](docs/BERICHT.md)

### Danach – Veröffentlichung ✅
Startdatei `start-webdaw.bat`, GitHub-Repository Mads000/WebDAW, GitHub Pages, installierbare App mit Offline-Start (Service Worker `sw.js`, `manifest.webmanifest`, `icons/`).

### Loops für alle Regionen ✅
Audio-Aufnahmen und MIDI-/Drum-Regionen lassen sich loopen: Loop-Griff oben rechts, Taste L, Kontext- und Bearbeiten-Menü. Wiedergabe, Export, Wellenform, Teilen, Auflösen, Rückgängig und Tempowechsel berücksichtigen den Loop.

### Überarbeitung nach Testbericht ✅
Letztes Projekt öffnet automatisch, Klick neben Dialoge schließt nichts mehr. Takes aufklappbar mit Comping, gesampelter Flügel, E-Bass und Drumkit (docs/SAMPLES.md). Export einzelner Spuren, Stem-Auswahl als ZIP, MP3. Einfügen überlagert nichts mehr. Raumgröße beim Hall, Notenlänge beim Echo, Automation für Panorama, Hall und Filter, MIDI-Keyboard. Piano Roll mit allen Notennamen und höher, Bibliothek nach Spurtyp gefiltert, „Erste Schritte“, deutsche Klangnamen, beschriftete Werkzeugleiste.

## Offene Fehler

- **„Demos lassen sich nicht laden“ (gemeldet am 08.11.2026):** In Chrome und Opera GX (frisches Profil) per Maus und Touch nicht nachstellbar; Menü Song → Demo lädt, auch mit Speichern-Rückfrage. Rückmeldung zu Ort (online, App, `.bat`) und Verhalten steht aus.

- **„Seite hat sich aufgehangen“ (online, gemeldet am 07.11.2026):** In Tests nicht nachstellbar (Hauptthread höchstens 0,13 s belegt, Demos, Wiedergabe und Neuladen ohne Fehler). Details zu Gerät, Browser und letzter Aktion fehlen noch.

Sonst keine bekannten, in den Tests sichtbaren Fehler. Bekannte Einschränkungen und fehlende Funktionen stehen im Bericht, Abschnitte 6 und 7.

## Als Nächstes (braucht dich)

1. `index.html` öffnen, Mikrofon erlauben, Vorlage „Schnelle Idee“ wählen.
2. Stimmgerät (Strg+U) mit Gitarre oder Ukulele ausprobieren.
3. „Audio-Eingang → Messen“ ausführen, dann zwei Spuren übereinander einspielen und prüfen, ob sie im Takt liegen.
4. Klang-Presets anhören und mir sagen, was nicht passt.

## Entscheidungen

- Arbeitsgrundlage war `WebDAW.html`; sie enthielt alle Funktionen der anderen beiden Dateien.
- Klassische `<script>`-Dateien statt ES-Module, damit der Doppelklick weiter funktioniert.
- Neue Projekte klingen neutral; der alte Master-Klang bleibt als „Warm“ wählbar und gilt für alte Projekte.
- Echte Instrumente haben Vorrang vor Synth-Sounds.
