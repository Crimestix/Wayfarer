# Böden der Hexkarte

Gemalte Bodenkacheln für Geländearten unter der Erde: Wo ein Pilzwald (`fungus`), Kristalle
(`crystal`), Tropfsteine (`stalagmites`), Geröll (`rubble`), Versunkene Ruinen (`deep-ruins`)
oder ein Bergwerk (`mine`) sind, ist der Höhlenboden selbst anders gemalt – kein Zeichen auf dem
Feld (Rückmeldung des Spielleiters, 20. 11. 2026: „es sollte das Gelände verändert werden, also
eine andere Textur“). Der Dateiname ist der Schlüssel der Geländeart (`domain/hexKinds.ts`);
geladen in `features/erkundung/HexLayers.tsx` (`CAVE_GROUND`).

Erzeugt mit Higgsfield (GPT Image 2.6) als ein Blatt mit sechs Flächen, in Kacheln geschnitten,
nahtlos gemacht (Ränder mit der Gegenseite überblendet) und auf 384 Pixel verkleinert. Die
Felsfläche der Karte (`../dungeon/hexrock.webp`) ist aus der Poly-Haven-Textur `rock_ground` (CC0)
umgerechnet.

## `oben/` – Böden der Oberwelt

22 Kacheln für alles, was flach liegt: Gras, Wiese, Ackerland, Heide, Steppe, Sumpf, Marsch, Moor,
Wüste, Dünen, Ödland, Schlucht, Salz, Lava, Fels, Eis, Tundra, Gletscher, Meer, See, Küste, Riff.
Geladen in `features/erkundung/HexGround.tsx` (`LAND_GROUND`); Arten, die aufragen (Wälder,
Höhen, Siedlungen), nutzen eine dieser Kacheln mit der Farbe ihrer Art darüber. Erzeugt mit
Higgsfield (GPT Image 2.6) als Blätter mit je sechs Flächen, geschnitten, nahtlos gemacht und auf
320 Pixel verkleinert.

## `bild/` – gemalte Zeichen der Oberwelt

60 freigestellte Gruppen, die auf dem Boden stehen: Baumgruppen (Laub, Nadel, dicht, licht,
Dschungel, tot, Mangroven, Savanne), Berge, Hochgebirge, Felsen, Hügel, Vulkan, Krater, Dünen,
Tafelberge, Oase, Eiszacken, Sumpf, Schilf, Städtchen, Weiler, Ruinen. Der Dateiname ist
`<Geländeart>-<Nummer>.webp`; `features/erkundung/HexSymbols.tsx` lädt alle Dateien des Ordners
von selbst (`LAND_SYMBOLS`) und wählt je Feld eine. Alle aus derselben Hand: schräg von oben
gesehen, Licht von oben links, dünner dunkler Umriss – deshalb nie spiegeln. Erzeugt mit
Higgsfield (GPT Image 2.6) als fünf Blätter mit je zwölf Stücken auf durchsichtigem Grund,
nach dem Raster geschnitten und auf 300 Pixel verkleinert.

Nichts hier zeigt je etwas aus der Welt des Spielleiters.
