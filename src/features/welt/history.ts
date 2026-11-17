/**
 * Die Geschichte der Welt als Ort in der Welt (Wunsch des Spielleiters, 17. 11. 2026: „Orte, die
 * mal waren, Personen, die seit langer Zeit tot sind etc. brauchen einen Platz“). Hier steht, was
 * der Vergangenheit angehört – Tote, Untergegangenes, Aufgelöstes, Ereignisse –, geordnet nach
 * den Zeitaltern des Spielleiters und darin nach der Zeit. Dazu, was einen Beginn in der fernen
 * Vergangenheit hat (eine Stadt, die vor 800 Jahren gegründet wurde), auf Wunsch.
 *
 * Und ein Weg, Vergangenes gleich als solches anzulegen (`createHistoric`): Name, Kategorie,
 * wann es endete – „vor 300 Jahren“, „Jahr 412“ –, ohne die Seite zu verlassen. Reine Rechnung
 * bis auf den Befehl.
 */
import type { CampaignDb } from '../../data/db';
import { agesSorted, type AgeSpan } from '../../domain/ages';
import { isPast, pastLine, readDatePoint } from '../../domain/lifespan';
import type { CampaignData, DatePoint, EntityKind } from '../../domain/schema';
import { isWorldEntity, type WorldEntity } from './model';
import { addFromWriting } from './writing';

export interface HistoryRow {
  entity: WorldEntity;
  /** Wann es seinen Platz in der Geschichte hat: das Ende, sonst der Beginn; null = unbekannt. */
  at: number | null;
  /** In wenigen Worten: „gestorben vor 300 Jahren“, „gegründet 412“. */
  line: string;
  /** Gehört der Vergangenheit an (tot, untergegangen, vorbei) – sonst nur alt. */
  past: boolean;
}

export interface HistorySection {
  /** Das Zeitalter – null für „ohne Zeitalter“ bzw. „ohne Datum“. */
  age: AgeSpan | null;
  title: string;
  rows: HistoryRow[];
}

export interface HistoryFilter {
  /** Nur diese Kategorie; null = alle. */
  kind: EntityKind | null;
  /** Auch, was noch besteht, aber lange vor jetzt begann. */
  old: boolean;
  query: string;
}

/** So weit zurück zählt ein Beginn als „alt“ – in Jahren. */
const OLD_YEARS = 100;

/** Wann ein Eintrag seinen Platz in der Geschichte hat. */
function anchorOf(entity: WorldEntity, past: boolean): DatePoint | null {
  if (past) return entity.ended ?? entity.born ?? null;
  return entity.born ?? null;
}

/** Was in die Geschichte gehört – mit Zeitpunkt und Satz. */
export function historyRows(data: CampaignData, filter: HistoryFilter): HistoryRow[] {
  const cal = data.campaign.calendar;
  const yearMinutes = cal.months.reduce((sum, month) => sum + month.days, 0) * 1440;
  const oldBefore = data.state.now - OLD_YEARS * yearMinutes;
  const query = filter.query.trim().toLocaleLowerCase('de');
  const rows: HistoryRow[] = [];
  for (const entity of Object.values(data.entities)) {
    if (!isWorldEntity(entity)) continue;
    if (filter.kind && entity.kind !== filter.kind) continue;
    if (query && !entity.name.toLocaleLowerCase('de').includes(query)) continue;
    const past = isPast(data, entity) || (entity.kind === 'happening' && !!entity.born);
    const old = !past && filter.old && !!entity.born && entity.born.at < oldBefore;
    if (!past && !old) continue;
    const point = anchorOf(entity, past);
    rows.push({
      entity,
      at: point?.at ?? null,
      line: past ? pastLine(data, entity) || (entity.kind === 'happening' ? '' : 'vergangen') : '',
      past,
    });
  }
  return rows.sort(
    (a, b) =>
      (a.at ?? Number.POSITIVE_INFINITY) - (b.at ?? Number.POSITIVE_INFINITY) ||
      a.entity.name.localeCompare(b.entity.name, 'de'),
  );
}

/**
 * Nach Zeitaltern geordnet: das früheste zuerst, darin nach der Zeit. Was in kein Zeitalter fällt,
 * steht unter „Ohne Zeitalter“, was kein Datum hat, ganz unten unter „Ohne Datum“.
 */
export function historySections(data: CampaignData, rows: readonly HistoryRow[]): HistorySection[] {
  const ages = agesSorted(data);
  const sections: HistorySection[] = ages.map((age) => ({ age, title: age.age.name, rows: [] }));
  const loose: HistoryRow[] = [];
  const undated: HistoryRow[] = [];
  for (const row of rows) {
    if (row.at === null) {
      undated.push(row);
      continue;
    }
    const at = row.at;
    // Das erste passende Zeitalter – überschneiden sie sich, das frühere.
    const index = ages.findIndex((span) => span.from <= at && (span.to === null || at < span.to));
    if (index < 0) loose.push(row);
    else sections[index]!.rows.push(row);
  }
  const out = sections.filter((section) => section.rows.length);
  if (loose.length)
    out.push({ age: null, title: ages.length ? 'Ohne Zeitalter' : 'Mit Datum', rows: loose });
  if (undated.length) out.push({ age: null, title: 'Ohne Datum', rows: undated });
  return out;
}

export interface HistoricInput {
  name: string;
  kind: EntityKind;
  /** Wann es endete – „vor 300 Jahren“, „Jahr 412“, „3. Tauwind 401“. Leer = unbekannt. */
  ended: string;
  /** Wann es begann – freiwillig. */
  born: string;
  /** Ein Satz dazu – freiwillig. */
  line: string;
}

/**
 * Legt etwas Vergangenes an: einen Platzhalter mit Ende (und Beginn), eine Person als tot. Gibt es
 * den Namen schon, bekommt der vorhandene Eintrag das Ende nur, wenn er noch keins hat. Gibt den
 * Eintrag und `undo` zurück – oder `problem`, wenn ein Datum nicht zu lesen ist.
 */
export function createHistoric(
  db: CampaignDb,
  input: HistoricInput,
): { id: string; created: boolean; undo: () => void } | { problem: string } {
  const data = db.getSnapshot();
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const ended = input.ended.trim() ? readDatePoint(cal, input.ended, now) : null;
  if (input.ended.trim() && !ended)
    return { problem: `„${input.ended.trim()}“ lässt sich nicht als Zeitpunkt lesen.` };
  const born = input.born.trim() ? readDatePoint(cal, input.born, now) : null;
  if (input.born.trim() && !born)
    return { problem: `„${input.born.trim()}“ lässt sich nicht als Zeitpunkt lesen.` };
  if (ended && ended.at > now) return { problem: 'Das Ende liegt in der Zukunft.' };
  if (born && ended && born.at > ended.at) return { problem: 'Der Beginn liegt nach dem Ende.' };
  const made = addFromWriting(db, { name: input.name, kind: input.kind, line: input.line });
  if (!made) return { problem: 'Gib einen Namen an.' };
  const before = db.getSnapshot().entities[made.entity.id]!;
  const change: Record<string, unknown> = {};
  if (ended && !before.ended) change.ended = ended;
  if (born && !before.born) change.born = born;
  let next = { ...before, ...change } as typeof before;
  // Eine Person, die hier neu entsteht, ist tot – eine vorhandene bleibt, wie sie ist.
  if (made.created && next.kind === 'person' && next.person.status === 'alive')
    next = { ...next, person: { ...next.person, status: 'dead' } };
  db.put('entities', next);
  return {
    id: before.id,
    created: made.created,
    undo: () =>
      db.batch(() => {
        if (made.created) made.undo();
        else if (db.getSnapshot().entities[before.id]) db.put('entities', before);
      }),
  };
}
