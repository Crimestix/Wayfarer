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

Nichts hier zeigt je etwas aus der Welt des Spielleiters.
