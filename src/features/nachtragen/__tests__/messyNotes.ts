/**
 * Erfundene, unordentliche Notizdateien eines Spielleiters – nur für Tests. Alles erfunden:
 * Hohenfurt, Mira Tannhaus, Lando Furtner, Krummzahn, die Salzgrotte.
 */
import { makeDocx, para, run, stylesXml } from './zip';

const utf8 = (text: string) => new TextEncoder().encode(text);

const CP1252: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  '„': 0x84,
  '…': 0x85,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
};

/** Text als Windows-1252 – wie alte Editoren unter Windows speichern. */
export function cp1252(text: string): Uint8Array {
  return Uint8Array.from(
    [...text].map((ch) => {
      const code = ch.codePointAt(0)!;
      if (CP1252[ch] !== undefined) return CP1252[ch]!;
      if (code < 256) return code;
      throw new Error(`Kein Windows-1252: ${ch}`);
    }),
  );
}

/** Text als UTF-16LE mit BOM – „Unicode“ im alten Windows-Editor. */
export function utf16le(text: string): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out[2 + i * 2] = code & 0xff;
    out[3 + i * 2] = code >> 8;
  }
  return out;
}

const crlf = (text: string) => text.replace(/\n/g, '\r\n');

export interface MessyFile {
  name: string;
  bytes: () => Promise<Uint8Array> | Uint8Array;
}

/** 1 · Alte Windows-Datei, Umlaute in Windows-1252, Tippfehler, Geburtstag im Text. */
export const kladde: MessyFile = {
  name: 'Kladde Elaris.txt',
  bytes: () =>
    cp1252(
      crlf(`Elaris – Kampagnenkladde
Spieler: Jana (Mira), Tobi (Lando), Kai (Bruder Wenzel)

Session 1 - Ankunft in Hohenfurt
12.04.2026

- Gruppe kommt am 3. Tauwind in Hohenfurt an, Regen
- Mira Tannhaus trifft ihre alte Lehrerin
- Lando Furtner verkauft Salz an den Zöllner
- Kai hat am 14.03.1990 Geburtstag, Kuchen mitgebracht!!

Sesion 2 – Der Zoll der Aalfischer (26.4.26)
- Streit am Anleger, Krummzahn taucht kurz auf
- Notizen zu Session 5 von Mira: sie will zurück zur Grotte
- am 5. Tauwind weiter Richtung Salzgrotte

Sitzung 3
gespielt am 10.05.2026
Die Tiefe Pforte. Wenzel öffnet das Tor mit dem Schlüssel.
Krummzahns Bruder starb laut Inschrift am 3. Frostfall 650 AD.
`),
    ),
};

/** 2 · Markdown mit ##-Überschriften, Unterüberschriften, Aufzählungen, ein Abend ohne Nummer. */
export const herbst: MessyFile = {
  name: 'Notizen Herbst.md',
  bytes: () =>
    utf8(`# Notizen Herbst

## Session 9 – Salzgrotte, zweiter Versuch
*13.09.2026*

### Kampf
- Krummzahn flieht durch den Seitengang
- Lando verliert seinen Hut

### Nachher
Mira Tannhaus heilt alle. Am 20. Hochbrand Rast im Lager.

## Session 10
Sa, 27. September 2026

Kurze Runde, nur Reden in Hohenfurt.

## 11.10.2026
Ohne Kai gespielt. Gruppe bleibt in Hohenfurt bis zum 25. Hochbrand.
`),
};

/** 3 · Zwei Abende in einem Abschnitt. */
export const doppelabend: MessyFile = {
  name: 'doppelabend.txt',
  bytes: () =>
    utf8(`Session 3+4 – Die Tiefe Pforte
Zwei Abende am Stück, Wochenende bei Tobi.
Salzgrotte erkundet, Krummzahn entkommt.

Session 5-6: Krummzahns Bau
Der Bau unter der Mühle.
`),
};

/** 4 · Ein einziger Block ohne Überschriften. */
export const block: MessyFile = {
  name: 'alte notizen.txt',
  bytes: () =>
    utf8(`gruppe in hohenfurt, mira redet mit dem zöllner. lando klaut salz.
krummzahn ist ein goblin mit einem goldzahn, wohnt angeblich in der salzgrotte.
nächstes mal: grotte.
`),
};

/** 5 · Eine Datei je Session, Nummer nur im Dateinamen. */
export const einzeln: MessyFile = {
  name: 'session-09.txt',
  bytes: () => utf8('Krummzahn wieder gesehen.\nMira will ihm folgen.\n'),
};

/** 6 · Word mit Überschriften-Vorlagen (deutsche Kennungen). */
export const wordMitVorlagen: MessyFile = {
  name: 'Elaris Notizen 2026.docx',
  bytes: () =>
    makeDocx(
      para(run('Elaris Notizen 2026'), 'Titel') +
        para(run('Sitzung 6'), 'berschrift1') +
        para(run('21.06.2026')) +
        para(run('Ohne Titel, nur Gerede. Lando Furtner schuldet Mira 20 Gold.')) +
        para(run('Kampf'), 'berschrift2') +
        para(run('Drei Goblins am Anleger.')) +
        para(run('Sitzung 7 – Der Salzkahn'), 'berschrift1') +
        para(run('05.07.2026')) +
        para(run('Der Salzkahn sinkt am 2. Grünbruch.')) +
        para(run('Sitzung 8'), 'berschrift1') +
        para(run('Kurz, Kai krank.')),
      {
        deflate: true,
        styles: stylesXml([
          { id: 'Titel', name: 'Title' },
          { id: 'berschrift1', name: 'heading 1' },
          { id: 'berschrift2', name: 'heading 2' },
        ]),
      },
    ),
};

/** 7 · Word ohne Vorlagen: fett geschrieben, sonst nichts. */
export const wordOhneVorlagen: MessyFile = {
  name: 'Notizen Sommer.docx',
  bytes: () =>
    makeDocx(
      para('<w:r><w:rPr><w:b/></w:rPr><w:t>Spielabend 11 (19.07.2026)</w:t></w:r>') +
        para(run('Hohenfurt brennt. Mira Tannhaus rettet den Zöllner.')) +
        para('') +
        para('<w:r><w:rPr><w:b/></w:rPr><w:t>Spielabend 12</w:t></w:r>') +
        para(run('Krummzahn ist tot.')),
    ),
};

/** 8 · Markdown ohne Nummern und Daten – nur Überschriften. */
export const ohneNummern: MessyFile = {
  name: 'Kapitel.md',
  bytes: () =>
    utf8(`## Ankunft
Hohenfurt im Regen.

## Die Grotte
Salzgrotte, feucht.

## Rückweg
Lando trägt Krummzahns Zahn.
`),
};

/** 9 · Daten als Überschriften in vielen Schreibweisen. */
export const datumszeilen: MessyFile = {
  name: 'Termine.txt',
  bytes: () =>
    utf8(`Samstag, 21. Juni 2026
Hohenfurt, Markt.

So 6.7.26
Grotte.

Spieltermin: 20.07.2026
Der Zöllner lügt.

2026-08-02:
Lando geht allein.
`),
};

/** 10 · Text, der wie eine Grenze aussieht, aber keine ist. */
export const fallen: MessyFile = {
  name: 'Fallen.txt',
  bytes: () =>
    utf8(`Session 1
Abend 3 Goblins greifen an, am Abend war Ruhe.
Folge 2 Spuren nach Westen – Lando findet sie.
Session 2 war super, wir haben viel gelacht.
S2 hat Mira gefehlt.
14.03.1990 Geburtstag von Kai
nächster Termin: 26.04.2026
Session 2
Krummzahn.
`),
};

/** 11 · UTF-16 (Windows-Editor „Unicode“), Tabulatoren, Großschreibung, Session 0. */
export const unicode: MessyFile = {
  name: 'unicode.txt',
  bytes: () =>
    utf16le(
      crlf(`SESSION 0\t\t(05.04.2026)
Charaktererschaffung, Mira Tannhaus und Lando Furtner.

Session Nr 1 – Ankunft
Hohenfurt.
`),
    ),
};

/** 12 · Datum ohne Jahr in der Überschrift, „Teil 2“ einer Session. */
export const ohneJahr: MessyFile = {
  name: 'ohne jahr.txt',
  bytes: () =>
    utf8(`Session 4 (24.05.)
Salzgrotte.

Session 4 Teil 2
Weiter in der Grotte, am 7. Tauwind.
`),
};

/** 13 · Doppelpunkt zwischen Stichwort und Nummer, „Sitzung #“. */
export const doppelpunkt: MessyFile = {
  name: 'doppelpunkt.txt',
  bytes: () =>
    utf8(`Session: 13
Mira kauft ein Boot.

Sitzung #14 - Flussaufwärts
Lando wird seekrank.
`),
};

/** 14 · Markdown mit Vorspann (Gruppe, Hausregeln) und setext-Überschriften. */
export const vorspann: MessyFile = {
  name: 'Kampagne.md',
  bytes: () =>
    utf8(`Hausregeln
==========

- Heiltrank als Bonusaktion
- Kritisch: maximaler Schaden + Wurf

Session 15
----------
Krummzahns Schwester taucht auf.

Session 16
----------
Hohenfurt feiert.
`),
};

/** 15 · RTF aus WordPad mit Umlauten. */
export const wordpad: MessyFile = {
  name: 'wordpad.rtf',
  bytes: () =>
    utf8(
      String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Calibri;}}\pard Sitzung 17 \endash  Gr\'fcne H\'f6hle\par 09.08.2026\par Lando Furtner sch\'e4tzt den Schatz.\par\par Sitzung 18\par Mira Tannhaus verl\'e4sst die Gruppe.\par}`,
    ),
};

/** 16 · Trennlinien statt Überschriften, Datum vorn mit Titel, Geburtstag in der ersten Zeile. */
export const trennlinien: MessyFile = {
  name: 'Trennlinien.txt',
  bytes: () =>
    utf8(`=====================
Session 19 - Der Zöllner
=====================
Lando hat am 03.05.1987 Geburtstag – Runde ging aufs Haus.
Zöllner verhaftet.

---------------------

Session 20
Mira kommt zurück.
`),
};

export const MESSY: MessyFile[] = [
  kladde,
  herbst,
  doppelabend,
  block,
  einzeln,
  wordMitVorlagen,
  wordOhneVorlagen,
  ohneNummern,
  datumszeilen,
  fallen,
  unicode,
  ohneJahr,
  doppelpunkt,
  vorspann,
  wordpad,
  trennlinien,
];
