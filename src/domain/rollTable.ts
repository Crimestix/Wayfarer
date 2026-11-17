/**
 * Tabellen als Listen (Wunsch des Spielleiters, 17. 11.: „Man trägt in der Tabelle einfach die
 * Dinge ein, die man dort möglich sieht. Dann würfelt Wayfarers Generator … Dabei muss man aber
 * nicht 2W6 oder so machen. Auch 37 Einträge sind fine. Das Simple der Tabellen möchte ich nur
 * adaptieren.“).
 *
 * Eine Tabelle ist Text, eine Zeile je Möglichkeit; jede Zeile ist gleich wahrscheinlich. Wer
 * etwas häufiger will, schreibt „3× …“ davor. Eingefügte Würfeltabellen („1–3: …“) gehen auch –
 * der Bereich zählt dann als Häufigkeit. Gespeichert wird wie jede Würfeltabelle (`RollTable`:
 * Zeilen mit Bereichen hintereinander), gewählt mit dem Zufall, den der Aufrufer gibt.
 */

export interface TableRow {
  min: number;
  max: number;
  text: string;
}

export interface TextTable {
  name: string;
  /** Summe der Häufigkeiten – die Zahl, bis zu der gewählt wird. */
  die: number;
  rows: TableRow[];
}

/** Wählt eine Zahl von `min` bis `max` (beide eingeschlossen). */
export type Dice = (min: number, max: number) => number;

const RANGE = /^\s*(\d{1,3})\s*(?:[–—-]\s*(\d{1,3}))?\s*[:.)]\s*(.+)$/;
const TIMES = /^\s*(\d{1,2})\s*[×x]\s+(.+)$/i;

/** Liest eine Tabelle aus Text: eine Zeile je Eintrag, „3× …“ macht ihn häufiger. */
export function readTable(name: string, text: string): TextTable {
  const rows: TableRow[] = [];
  let next = 1;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const range = RANGE.exec(line);
    const times = TIMES.exec(line);
    const weight = range
      ? Math.abs(Number(range[2] ?? range[1]) - Number(range[1])) + 1
      : times
        ? Math.max(1, Number(times[1]))
        : 1;
    const body = (range ? range[3]! : times ? times[2]! : line).trim();
    rows.push({ min: next, max: next + weight - 1, text: body });
    next += weight;
  }
  return { name, die: Math.max(1, next - 1), rows };
}

/** Eine Tabelle als Text, wie sie geschrieben wird: eine Zeile je Eintrag. */
export function tableToText(rows: readonly TableRow[]): string {
  return rows
    .map((row) => (row.max > row.min ? `${row.max - row.min + 1}× ${row.text}` : row.text))
    .join('\n');
}

/** Wählt einen Eintrag. Leer, wenn die Tabelle leer ist. */
export function pickFrom(table: TextTable, dice: Dice): string {
  if (!table.rows.length) return '';
  const value = dice(1, table.die);
  return table.rows.find((row) => value >= row.min && value <= row.max)?.text ?? '';
}

/** Schlüssel für den Namen einer Tabelle: ohne Groß/Klein und doppelte Leerzeichen. */
export const tableKey = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, ' ');

export interface EntryParts {
  /** Was die Gruppe vorfindet. */
  here: string;
  /** „(von fern: …)“ oder „(von nebenan: …)“. */
  afar: string;
  /** „(verborgen: …)“. */
  hidden: string;
}

const PART = /\(\s*(von fern|von nebenan|verborgen)\s*:\s*([^)]*)\)/gi;

/**
 * Ein Eintrag kann sagen, was man von fern sieht und was verborgen liegt:
 * „Ein Köhlerlager (von fern: eine Rauchsäule) (verborgen: ein Beutel Silber)“. Ein Eintrag „–“
 * oder „nichts“ heißt: hier nichts.
 */
export function entryParts(text: string): EntryParts {
  let afar = '';
  let hidden = '';
  const here = text
    .replace(PART, (_whole, kind: string, value: string) => {
      if (kind.toLowerCase() === 'verborgen') hidden = value.trim();
      else afar = value.trim();
      return '';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
  const nothing = /^([-–—]|nichts)$/i.test(here);
  const cap = (part: string) => (part ? part[0]!.toUpperCase() + part.slice(1) : '');
  return { here: nothing ? '' : cap(here), afar: cap(afar), hidden: cap(hidden) };
}
