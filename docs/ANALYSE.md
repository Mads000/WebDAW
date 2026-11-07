# Bestandsaufnahme der ursprünglichen DAW (Phase 1)

Untersucht wurde `WebDAW.html` (3.254 Zeilen), zusätzlich im echten Chrome (headless, mit Fake-Mikrofon).
Screenshots: [screenshots/original/](screenshots/original/). Tests: `tests/baseline-original.mjs`, `tests/baseline-probes.mjs`.

**Beleg-Stufen:** ✅ im Browser nachgewiesen · 📖 aus dem Code eindeutig ableitbar, aber nicht einzeln gemessen.

## 1. Die drei HTML-Dateien

| Datei | Stand | Bewertung |
|---|---|---|
| `WebDAW.html` | 03.10.2026 12:17, neueste Version | Enthält alle IDs und Funktionen der anderen beiden. **Arbeitsgrundlage.** |
| `index.html` | ältere Version | Hat zusätzlich nichts; es fehlen 90s-Master und Rockin'-Demo |
| `index copy.html` | ältere Version | Hat zusätzlich nichts |

Alle drei liegen schreibgeschützt in `_backup_original/`.

## 2. Architektur

Eine einzige HTML-Datei: 720 Zeilen CSS, dazu eine IIFE mit rund 2.380 Zeilen JavaScript. Keine Abhängigkeiten.

- **Zustand:** globale Variablen (`state.tracks`, `state.markers`, `selTrack`, `selRegion`, `playing`, `startBar` …). Das Tempo liegt **nur im DOM** (`$('bpm').value`) und wird auch im Audio-Pfad von dort gelesen.
- **Audio-Graph:** Spur = Gain → EQ (3 Biquads) → Kompressor → Panner → Master; Reverb- und Delay-Sends hinter dem Panner. Master = Gain → Sättigung (immer aktiv) → Kompressor → Ausgang.
- **Scheduler:** `setInterval` alle 25 ms mit 150 ms Vorlauf. Instrumente werden als Web-Audio-Knoten pro Note neu erzeugt.
- **Rendering:** `renderTracks()` baut bei jeder Änderung das gesamte Spur-DOM und alle Canvas neu auf.
- **Speichern:** JSON mit Base64-Audio (Download), Autosave als JSON in `localStorage`.
- **Aufnahme:** `MediaRecorder` (verlustbehaftet komprimiert), danach `decodeAudioData`.

## 3. Funktionsübersicht

| Bereich | Vorhanden | Tatsächlicher Zustand |
|---|---|---|
| Transport | Play, Stop, Cycle, Metronom, Count-In | Funktioniert; Cycle ungenau; **kein Pause, kein „Zum Anfang“** |
| Taktart | Anzeige „4/4“ | **Nur optisch**, fest 4/4 |
| Tonart | Grundton, Dur/Moll, Key-Snap, Akkorde 1–7 | Funktioniert, wird aber nicht gespeichert |
| Spuren | Drum, Instrument, Audio; M/S/Automation/Löschen/Lautstärke, Umbenennen | Funktioniert; **kein Pan im Spurkopf, kein Record-Arm, kein Monitoring, kein Verschieben, kein Duplizieren** |
| Instrumente | 37 Synth-Sounds, 5 Drum-Kits, 10 Loops | Funktionieren (reine Klangsynthese) |
| Effekte | EQ, Kompressor, Reverb, Echo, Doubler, 90s-Master | Wirken real; Doubler nur auf Audio; **kein Chorus, Distortion, Overdrive, Gate, Limiter** als Spur-Effekte |
| Arrangement | Marker, Song-Template | Teilweise: verschiebbar, aber **nicht löschbar oder in der Länge änderbar**, ohne Undo |
| Regionen | Verschieben, Trimmen, Teilen, Duplizieren, Löschen | Funktioniert mit Fehlern (siehe unten); **keine Mehrfachauswahl, kein Kopieren/Einfügen, keine Taste Entf** |
| Piano Roll | Setzen, Ziehen, Länge, Velocity, Vorhören, Humanize, Streichersatz | Funktioniert; **kein Zoom, kein wählbares Raster, keine Quantisierung, keine Mehrfachauswahl** |
| Drum-Editor | Step-Raster, Velocity per Rechtsklick | Funktioniert, zeigt höchstens 8 Takte |
| Automation | Lautstärke-Kurve je Spur | Funktioniert; live nur stufig, im Bounce sauber |
| Audio-Editor | Varispeed, Pitch→MIDI | Funktioniert |
| Export | WAV-Bounce, Stems | Funktioniert, bei dichten Projekten sehr langsam |
| Mixer | – | **Nicht vorhanden** |
| Kontextmenüs, Tooltips | – | **Keine Kontextmenüs**, nur vereinzelte `title` |
| Light Mode | – | **Nicht vorhanden** |
| Drag & Drop | – | **Nicht vorhanden** |

**Nur optisch oder tot:** Taktart-Anzeige; `heldNotes`/`keyup`-Logik (nie befüllt); zweiter Streichersatz-Block im Drum-Editor (unerreichbar); `stopBounce()` (leer); `mediaDest` (angeschlossen, nie benutzt); doppeltes `<header><header>`.

## 4. Priorisierte Bugliste

### 4.1 Kritisch: Datenverlust oder Kernfunktion kaputt

| # | Problem | Beleg |
|---|---|---|
| K1 | **MIDI-Aufnahme nimmt keine Noten auf.** Der Aufzeichnungscode für Einzelnoten ist auskommentiert; nur Akkorde (Tasten 1–7) landen in der Region. | ✅ 3 Tasten gespielt, 0 Noten |
| K2 | **Kaputte Projektdatei löscht das offene Projekt.** `loadProj` leert den Zustand vor der Prüfung. Die Anzeige zeigt weiter 7 Spuren, intern sind es 0; das nächste Speichern schreibt ein leeres Projekt. | ✅ |
| K3 | **Autosave verliert Audio stillschweigend.** `localStorage` ist zu klein; beim Überlauf wird ohne Audio und ohne Meldung gespeichert. | ✅ 3-min-Datei → 288 Zeichen, kein Audio |
| K4 | **Speichern macht aus Stereo Mono.** Nur Kanal 0 wird geschrieben. | ✅ |
| K5 | **Regionen und Raster sitzen neben dem Lineal.** Spurköpfe wachsen durch ihren Inhalt auf etwa 207–209 px statt 190 px; der Versatz ist je Spur verschieden. Gezeigte Position und gehörte Position stimmen nicht überein. | ✅ Screenshot |
| K6 | **Demos überschreiben das Projekt ohne Rückfrage**; die Oasis-Demo legt nicht einmal einen Undo-Schritt an. | ✅ |
| K7 | **Autosave-Angebot ablehnen vernichtet das Autosave**, sobald der nächste Lauf etwas speichert. | 📖 |
| K8 | **Die Timeline endet bei Takt 32.** Die Rockin'-Demo reicht bis Takt 40; Regionen ragen 978 px über das Lineal hinaus. | ✅ |

### 4.2 Funktionale Fehler

| # | Problem | Beleg |
|---|---|---|
| F1 | Nach Klick auf einen Regler sind Tastatur und Leertaste tot (Fokus bleibt im `<input>`); bei `<select>` ändert Tippen sogar dessen Wert. | ✅ |
| F2 | Tempo-Wechsel bei laufender Wiedergabe lässt die Position springen. | ✅ 118 px in 50 ms |
| F3 | Cycle-Loop ungenau: Stop und Neustart per Timer, pro Durchgang 30–51 ms zu lang. Scheduler plant bis 150 ms über das Loop-Ende hinaus. | ✅ |
| F4 | Cycle-Sprung beendet eine laufende Aufnahme (`stop()` stoppt den Recorder). | 📖 |
| F5 | Grafische Fehler bei Audio: Wellenform ignoriert Offset, Länge und Rate; nach dem Teilen zeigen beide Hälften die ganze Datei. | 📖 |
| F6 | Audio-Regionen laufen nach einem Tempo-Wechsel auseinander (Länge in Takten, Audio in Sekunden). | 📖 |
| F7 | Teilen von MIDI-Regionen verliert die Velocity aller Noten. | 📖 |
| F8 | Stop während des Count-In: Timer läuft weiter und startet dennoch. Beim Aufnahme-Abbruch wirft `recorder.stop()` einen Fehler. | 📖 |
| F9 | Mikrofon bleibt offen: Der erste `getUserMedia`-Stream wird nie geschlossen. | 📖 |
| F10 | Keine Latenzkompensation bei der Aufnahme; Takes liegen zu spät. Kein Monitoring, Pegel nur während der Aufnahme. | 📖 |
| F11 | Aufnahme ist verlustbehaftet (`MediaRecorder`/Opus) und bei einem Absturz komplett weg, da erst am Ende verfügbar. | 📖 |
| F12 | Undo: Anklicken einer Region erzeugt Undo-Schritte, Marker-Änderungen und Sound-Wechsel gar keine. Undo stoppt die Wiedergabe und verliert die Auswahl. | ✅ teilweise |
| F13 | „A“-Button leuchtet immer (`classList.toggle('active', undefined)`). | ✅ Screenshot |
| F14 | HTML-Injection: Spur- und Regionsnamen gehen per `innerHTML` ins DOM, auch aus Projektdateien. | ✅ `<img onerror>` ausgeführt |
| F15 | Raster skaliert nicht mit dem Zoom (fest 120 px). | ✅ |
| F16 | Leeres Tempofeld: Play wirkt aktiv, Playhead steht und es ist nichts zu hören; keine Meldung. | ✅ |
| F17 | Fehlerhafte Datei: nur Konsolenfehler, keine Meldung für Nutzer. Gleiches gilt für den Audio-Import. | ✅ / 📖 |
| F18 | Projekt speichert weder Mute/Solo noch Tonart, Cycle-Bereich oder 90s-Modus. | ✅ |
| F19 | Sound-Wechsel überschreibt einen selbst vergebenen Spurnamen. | 📖 |
| F20 | Drum-Editor zeigt höchstens 8 Takte; Pattern-Auswahl zeigt bei längeren Regionen „1 Takt“. | 📖 |
| F21 | Stop lässt Instrumente ausklingen: Bereits geplante Noten werden nicht abgebrochen. | 📖 |
| F22 | Streichersatz rechnet immer in Dur; Abbruch im Dialog hinterlässt einen leeren Undo-Schritt. | 📖 |

### 4.3 Performance und Speicher

| # | Problem | Beleg |
|---|---|---|
| P1 | Bounce sehr langsam: 12,4 s für 16 Takte, Rockin' (40 Takte) nach 120 s nicht fertig. Ursache wird in Phase 5 gemessen. | ✅ |
| P2 | Audio-Knoten-Leck: Undo und Demos werfen Spuren weg, ihre Knoten (inkl. Kompressoren) bleiben aber am Master. CPU-Last wächst mit jedem Undo. | 📖 |
| P3 | Autosave serialisiert alle 20 s das gesamte Projekt inkl. Audio auf dem Haupt-Thread. | 📖 |
| P4 | `renderTracks()` baut alles neu und rechnet jede Wellenform neu, auch bei Klick auf Mute. | 📖 |
| P5 | Drei dauerhafte `requestAnimationFrame`-Schleifen, auch im Leerlauf; Allokationen pro Frame. | 📖 |
| P6 | `setInterval`-Scheduler wird in Hintergrund-Tabs auf bis zu 1 s gedrosselt; 150 ms Vorlauf reichen dann nicht (Aussetzer). | 📖 |
| P7 | Objekt-URLs beim Speichern werden nicht freigegeben. | 📖 |

**Gegenbefund:** Beim Abspielen der Rockin'-Demo traten in den ersten 8 Sekunden keine Long Tasks über 50 ms auf. Die Karplus-Strong-Berechnung auf dem Haupt-Thread ist dort also kein Live-Problem. Das Intro ist allerdings die dünnste Stelle des Songs.

### 4.4 Audio-Qualität

| # | Problem | Beleg |
|---|---|---|
| A1 | Master ist nie neutral: Sättigung hebt leise Signale um rund +4,9 dB an (Kurve tanh(1,6x)/tanh(1,6)), danach Kompressor 12:1. Jeder Mix klingt dadurch gefärbt und das Gain-Staging lässt sich kaum beurteilen. | 📖 berechnet |
| A2 | Kein echter Limiter. Clipping im Bounce wird nur durch harte Begrenzung beim WAV-Schreiben verhindert. | 📖 |
| A3 | Solo, Mute und Automation schreiben `gain.value` direkt, daher Knackser. | 📖 |
| A4 | Gitarren-Synthese: Delay-Länge wird auf ganze Samples gerundet, daher werden hohe Töne unsauber und feine Verstimmungen (`m ± 0,06`) wirkungslos. Länge der Note wird ignoriert. | 📖 |
| A5 | Delay fest bei 375 ms, nicht zum Tempo synchron. | 📖 |
| A6 | Playhead-Korrektur mit festem `-0,2 s` geraten, nicht aus der echten Latenz abgeleitet. | 📖 |

## 5. Designbewertung (ehrlich)

Die Screenshots zeigen eine brauchbare Basis, die aber eher nach Bastelprojekt als nach etablierter Musiksoftware aussieht.

**Was schon gut ist:** dunkle Grundstimmung, die LCD-Idee, farbige Spurtypen, die Library links, verständliche Grundanordnung.

**Größte Probleme:**
1. **Kopfzeile:** eine ungeordnete Reihe von rund 25 gleich gewichteten Knöpfen, ohne Gruppierung und ohne Mitte. Bricht schon bei 1440 px um (2 Zeilen), bei 800 px sind es 159 px Höhe (3 Zeilen).
2. **Emoji als Icons:** je nach System unterschiedlich und bunt. Das zerstört den hochwertigen Eindruck am stärksten.
3. **Versatz Lineal/Spuren** (K5): auf den ersten Blick sichtbar und wirkt unzuverlässig.
4. **Regionen:** Beschriftung liegt unleserlich direkt auf den Noten, das Notenbild ist ein grober dunkler Balken-Teppich, Farbe ist nur nach Typ wählbar.
5. **Permanenter Hilfetext in der Library** kostet Platz und wirkt provisorisch. Bei offenem Editor bleibt für die Library nur noch ein Eintrag sichtbar.
6. **Piano Roll:** füllt die Breite nicht, rechts bleibt die Hälfte leer. Bei offenem Editor sind nur noch 2,5 Spuren sichtbar, ohne Größenregler.
7. **Smart Controls:** identische Regler für jedes Instrument, also nicht kontextabhängig. Die Hälfte der Fläche ist ein Spektrum ohne praktischen Nutzen.
8. **Trennung:** Schließen-Knopf im Editor steht mitten in der Zeile, Beschriftungen in 9 px sind schlecht lesbar, kein Mixer.
9. **Bedienung über `prompt()`, `alert()`, `confirm()`** wirkt wie eine Webseite der 2000er und blockiert das Audio-Timing nicht, aber den Bedienfluss.

## 6. Technische Rahmenbedingung für die Aufteilung

Die Original-Datei lässt sich per Doppelklick öffnen (`file://`). **ES-Module (`type="module"`) funktionieren über `file://` in Chrome nicht** (CORS). Außerdem wäre unter `http://localhost` das vorhandene Autosave aus `localStorage` nicht mehr erreichbar, da es an die Herkunft gebunden ist.

**Entscheidung:** klassische `<script>`-Dateien. Doppelklick funktioniert weiter, und es wird weder Server noch Build-Schritt benötigt.
