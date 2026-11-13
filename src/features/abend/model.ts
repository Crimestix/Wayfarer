/**
 * Was „Abend vorbereiten“ zum Anzeigen braucht und nicht in `domain/prep.ts` stehen kann, weil es
 * die Kurzfassungen der Chronik nutzt (`chronik/model.ts`). Reine Funktionen.
 */
import type { LastSessionLines } from '../../domain/prep';
import { hasLine } from '../../domain/prep';
import type { CampaignData, ChronicleEntry } from '../../domain/schema';
import { KIND_SHORT, entryHeadline, sessionLabel } from '../chronik/model';

/**
 * Ein Eintrag der Chronik als Zeile für den Einstieg – so, wie er dort steht: Geschriebenes
 * wörtlich, bei Ortswechsel und Haltung die Kurzfassung der Chronik (und was dazu notiert ist).
 */
export function startLineOf(data: CampaignData, entry: ChronicleEntry): string {
  const text = entry.text.trim();
  if (entry.kind === 'travel' || entry.kind === 'attitude') {
    const headline = entryHeadline(data, entry);
    return text ? `${headline}. ${text}` : headline;
  }
  if (entry.kind === 'event') return text || entryHeadline(data, entry);
  return text;
}

export interface LastLine {
  id: string;
  /** Welche Art Eintrag – „Notiz“, „Ortswechsel“ … */
  kind: string;
  line: string;
  /** Steht die Zeile schon im Einstieg? */
  taken: boolean;
}

export interface LastLinesView {
  title: string;
  lines: LastLine[];
  /** Leer, wenn es Zeilen gibt – sonst ein Satz, warum hier nichts steht. */
  empty: string;
}

/** Die Auswahl „Wo es zuletzt aufhörte“ unter dem Einstieg. */
export function lastLinesView(
  data: CampaignData,
  last: LastSessionLines | null,
  start: string,
): LastLinesView {
  if (!last)
    return {
      title: 'Wo es zuletzt aufhörte',
      lines: [],
      empty:
        'Sobald ein Abend gespielt ist, stehen hier seine letzten Einträge aus der Chronik zum Übernehmen.',
    };
  const label = sessionLabel(last.session);
  const lines = last.entries
    .map((entry) => ({
      id: entry.id,
      kind: KIND_SHORT[entry.kind],
      line: startLineOf(data, entry),
    }))
    .filter((entry) => entry.line)
    .map((entry) => ({ ...entry, taken: hasLine(start, entry.line) }));
  return {
    title: `Wo es zuletzt aufhörte – ${label}${last.running ? ' (läuft noch)' : ''}`,
    lines,
    empty: lines.length ? '' : `Zu ${label} steht nichts in der Chronik.`,
  };
}
