# Samples

Erzeugt mit `node tools/build-samples.mjs [set …]` nach `js/audio/samples/`. Jedes Set wird erst geladen, wenn eine Spur es benutzt.

| Klang | Set | Quelle | Lizenz |
| --- | --- | --- | --- |
| Flügel | `piano` | Salamander Grand Piano V3 (Alexander Holm), sfzinstruments/SalamanderGrandPiano; alle 3 Halbtöne, 2 Anschlagstufen | CC BY 3.0 |
| E-Bass | `bass` | FluidR3 GM (Frank Wen), gleitz/midi-js-soundfonts | CC BY 3.0 |
| E-Piano | `epiano` | FluidR3 GM, electric_piano_1 | CC BY 3.0 |
| Celesta | `celesta` | FluidR3 GM, celesta | CC BY 3.0 |
| Spieluhr | `musicbox` | FluidR3 GM, music_box | CC BY 3.0 |
| Streicher | `strings` | VSCO 2 Community Edition, Cello-, Bratschen- und Geigen-Sektion (sustain, geloopt) | CC0 1.0 |
| Pizzicato | `pizz` | VSCO 2 Community Edition, Violin Section; 2 Anschlagstufen, Round-Robin | CC0 1.0 |
| Glockenspiel | `glock` | VSCO 2 Community Edition | CC0 1.0 |
| Akustik-Kit | `drums` | Virtuosity Drums (sfzinstruments/virtuosity_drums); 2 Anschlagstufen, Round-Robin; Clap synthetisch | CC0 1.0 |
| Trockenes Pop-Kit | `drumspop` | Swirly Drums (Karoryfer Samples, sfzinstruments/karoryfer.swirly-drums), trockene Mikrofone; 2 Anschlagstufen, 3 Varianten; Clap und Tamburin synthetisch | CC0 1.0 |

**808:** Für echte TR-808-Samples wurde keine Quelle mit eindeutig freier Lizenz gefunden (808TK: GPL-3.0; fluid-music/tr-808: Weitergaberechte ungeklärt). 808-Kit und 808-Sub bleiben deshalb synthetisch. Eigene Kicks lassen sich über „Auf der Tastatur spielen (Sampler)“ verwenden.

Der MP3-Export nutzt lamejs (`js/vendor/lame.min.js`, LGPL, basiert auf LAME, https://lame.sourceforge.net).
Der Geräte-Sync nutzt PeerJS (`js/vendor/peerjs.min.js`, MIT).
