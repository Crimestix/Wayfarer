/**
 * Was „Abend vorbereiten“ zum Anzeigen braucht und nicht in `domain/prep.ts` stehen kann, weil es
 * die Kurzfassungen der Chronik nutzt (`chronik/model.ts`) – auch „Letztes Mal“, das ebenso am
 * Spieltisch steht. Reine Funktionen.
 */
import { placePath } from '../../domain/derive';
import { LOOSE_REASON_SHORT } from '../../domain/looseEnds';
import type { LastSessionLines } from '../../domain/prep';
import { hasLine } from '../../domain/prep';
import type { Recap } from '../../domain/recap';
import type { CampaignData, ChronicleEntry } from '../../domain/schema';
import { KIND_SHORT, entryHeadline, sessionLabel } from '../chronik/model';
import { whenLabel } from '../tisch/model';

/**
 * Ein Eintrag der Chronik als Zeile für den Einstieg – so, wie er dort steht: Geschriebenes
 * wörtlich, bei Ortswechsel und Haltung die Kurzfassung der Chronik (und was dazu notiert ist).
 */
export function startLineOf(data: CampaignData, entry: ChronicleEntry): string {
  const text = entry.text.trim();
  if (entry.kind === 'event') return text || entryHeadline(data, entry);
  // Ortswechsel, Haltung und die übrigen Arten mit Angaben: die Kurzfassung der Chronik.
  const headline = entryHeadline(data, entry);
  if (!headline) return text;
  return text ? `${headline}. ${text}` : headline;
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

// ── Letztes Mal ────────────────────────────────────────────────────────────

export interface RecapLine {
  id: string;
  /** Welche Art Eintrag – „Entscheidung“, „Ortswechsel“ … */
  kind: string;
  line: string;
  /** Nur für die Spielleitung. */
  secret: boolean;
}

export interface RecapAheadLine {
  key: string;
  /** „morgen“, „in 3 Tagen“. */
  when: string;
  title: string;
  /** „Termin“ oder die Uhr, zu der der Schritt gehört. */
  sub: string;
  /** Die Geschichte des Schrittes, wenn es eine gibt. */
  storyId: string | null;
}

export interface RecapView {
  /** „Letztes Mal – Session 12 – Das leere Boot“. */
  title: string;
  /** Der Rückblick, den der Spielleiter zu diesem Abend geschrieben hat – wörtlich. */
  told: string;
  lines: RecapLine[];
  /** „3 weitere Einträge stehen in der Chronik“ – leer, wenn alles dasteht. */
  more: string;
  /** Leer, wenn es etwas zu zeigen gibt – sonst ein Satz, warum hier nichts steht. */
  empty: string;
  /** Wo die Gruppe jetzt steht. */
  where: { id: string; name: string; path: string } | null;
  /** „5 offen: 2× Abmachung · 3× Gerücht“ – leer, wenn nichts offen ist. */
  open: string;
  ahead: RecapAheadLine[];
}

/**
 * „Letztes Mal“ in Zeilen – am Spieltisch und auf „Abend vorbereiten“ gleich. Die Einträge stehen
 * so da, wie sie in der Chronik stehen (`startLineOf`); Wayfarer formuliert nichts.
 */
export function recapView(data: CampaignData, recap: Recap): RecapView {
  const label = sessionLabel(recap.session);
  const lines = recap.entries
    .map((entry) => ({
      id: entry.id,
      kind: KIND_SHORT[entry.kind],
      line: startLineOf(data, entry),
      secret: entry.secret,
    }))
    .filter((entry) => entry.line);
  const place = recap.placeId ? data.entities[recap.placeId] : undefined;
  const now = data.state.now;
  return {
    title: `Letztes Mal – ${label}${recap.running ? ' (läuft noch)' : ''}`,
    told: recap.told,
    lines,
    more:
      recap.more > 0
        ? recap.more === 1
          ? 'Ein weiterer Eintrag steht in der Chronik.'
          : `${recap.more} weitere Einträge stehen in der Chronik.`
        : '',
    empty: lines.length || recap.told ? '' : `Zu ${label} steht nichts in der Chronik.`,
    where: place ? { id: place.id, name: place.name, path: placePath(data, place.id) } : null,
    open: recap.open.total
      ? `${recap.open.total} offen: ${recap.open.groups
          .map((group) => `${group.count}× ${LOOSE_REASON_SHORT[group.reason]}`)
          .join(' · ')}`
      : '',
    ahead: recap.ahead.map((item) => {
      const event = item.eventId ? data.events[item.eventId] : undefined;
      return {
        key: item.key,
        when: whenLabel(now, item.at, item.kind === 'clock' || !!event?.timed),
        title: item.title,
        sub: item.kind === 'clock' ? (item.clockTitle ?? 'Uhr') : 'Termin',
        storyId: item.storyId ?? null,
      };
    }),
  };
}
