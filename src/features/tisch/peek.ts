/**
 * Kurzblick am Spieltisch: eine Person (oder ein anderer Eintrag) auf einen Blick, ohne den
 * Spieltisch zu verlassen – mit ↑ ↓ zur nächsten in der Liste. Dazu „Im Blick“ (`state.inView`):
 * wen der Spielleiter gerade braucht, steht über „Wer hier ist“. Und an großen Orten ordnet
 * `castSections` die Liste nach den Orten darin; das Suchfeld grenzt nur die Ansicht ein.
 * Reine Rechnung; der offene Kurzblick lebt nur im Arbeitsspeicher.
 */
import { useSyncExternalStore } from 'react';
import { articleParts, type ArticleFact } from '../../domain/articleText';
import {
  attitudeToParty,
  chronicleFor,
  mateAttitudeText,
  mateAttitudes,
  openPromises,
  relationPairs,
} from '../../domain/derive';
import { memoryOf, type MemoryFact } from '../../domain/memory';
import { relationLabel, showsAttitude } from '../../domain/relations';
import { PARTY_ID, type CampaignData, type ChronicleEntry, type Entity } from '../../domain/schema';
import type { CastRow } from './model';
import { articleOf } from './wiki';

// ── Was der Kurzblick zeigt ───────────────────────────────────────────────

/** Höchstens so viele Beziehungen, Steckbrief-Zeilen und Einträge; mehr steht auf der Seite. */
const PEEK_TIES = 6;
const PEEK_FACTS = 8;
const PEEK_ENTRIES = 4;

export interface PeekView {
  entity: Entity;
  /** Das Wichtigste in Kürze (wie unter der Mitschrift): Schicksal, Haltung, wo, zuletzt … */
  memory: MemoryFact[];
  attitude: number | null;
  /** Abweichende Haltungen zu einzelnen Gefährten, knapp: „Tomlin +5 · Neil −3“; sonst leer. */
  mates: string;
  /** Lässt sich eine Haltung zur Gruppe festlegen? */
  hasAttitude: boolean;
  promises: ChronicleEntry[];
  /** Zeilen aus dem Steckbrief des Artikels. */
  facts: ArticleFact[];
  /** „Mitglied von Haus Duskryn“ – je Gegenüber eine Zeile, die Gruppe ausgenommen. */
  ties: { otherId: string; text: string }[];
  notes: string;
  secret: string;
  /** Die letzten Einträge der Chronik, die den Eintrag nennen. */
  recent: ChronicleEntry[];
}

export function peekView(data: CampaignData, id: string): PeekView | null {
  const entity = data.entities[id];
  if (!entity) return null;
  const article = articleOf(data, entity);
  const text = article?.docs[0]?.text ?? '';
  const ties = relationPairs(data, id)
    .filter((pair) => pair.otherId !== PARTY_ID && data.entities[pair.otherId])
    .slice(0, PEEK_TIES)
    .map((pair) => {
      const name = data.entities[pair.otherId]!.name;
      const relation = pair.outgoing ?? pair.incoming!;
      const label = relationLabel(relation, pair.outgoing ? 'from' : 'to');
      return { otherId: pair.otherId, text: `${label} ${name}` };
    });
  const recent = chronicleFor(data, id).slice(-PEEK_ENTRIES).reverse();
  const attitude = attitudeToParty(data, id);
  const hasAttitude = showsAttitude(entity.kind, attitude);
  return {
    entity,
    // Kurzbeschreibung und Haltung stehen schon unter dem Namen.
    memory: memoryOf(data, id).filter(
      (fact) => fact.kind !== 'tagline' && !(fact.kind === 'attitude' && hasAttitude),
    ),
    attitude,
    mates: hasAttitude ? mateAttitudeText(mateAttitudes(data, id)) : '',
    hasAttitude,
    promises: openPromises(data, id),
    facts: text ? articleParts(text).facts.slice(0, PEEK_FACTS) : [],
    ties,
    notes: entity.notes.trim(),
    secret: entity.secret.trim(),
    recent,
  };
}

// ── Im Blick ───────────────────────────────────────────────────────────────

/** Wer „Im Blick“ steht und den es noch gibt – in der Reihenfolge, in der er dazukam. */
export function inViewIds(data: CampaignData): string[] {
  return data.state.inView.filter((id) => !!data.entities[id]);
}

// ── Große Orte ─────────────────────────────────────────────────────────────

/** Ab so vielen Personen bekommt „Wer hier ist“ ein Suchfeld und Abschnitte nach Orten. */
export const CAST_SEARCH_FROM = 12;

const fold = (text: string) =>
  text
    .toLocaleLowerCase('de')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/** Passt eine Zeile zum Suchwort? Name, Rolle, Kurzbeschreibung und Ort zählen. */
export function castMatches(row: CastRow, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  return [row.entity.name, row.role, row.tagline, row.where ?? '', row.entity.aliases.join(' ')]
    .map(fold)
    .some((text) => text.includes(q));
}

/**
 * „Wer hier ist“ an einem großen Ort, nach den Orten darin: wer unmittelbar hier ist zuerst
 * (ohne Überschrift), dann je Ort darunter. Die Reihenfolge der Zeilen bleibt.
 */
export function castSections(rows: CastRow[]): { title: string | null; rows: CastRow[] }[] {
  const sections = new Map<string | null, CastRow[]>();
  for (const row of rows) {
    const list = sections.get(row.where);
    if (list) list.push(row);
    else sections.set(row.where, [row]);
  }
  return [...sections].map(([title, list]) => ({ title, rows: list }));
}

/** Die nächste (step 1) oder vorige (−1) Kennung einer Liste, ringsum. */
export function stepIn(ids: readonly string[], current: string, step: 1 | -1): string | null {
  if (!ids.length) return null;
  const at = ids.indexOf(current);
  if (at < 0) return ids[0]!;
  return ids[(at + step + ids.length) % ids.length]!;
}

// ── Offener Kurzblick (nur im Arbeitsspeicher) ────────────────────────────

interface PeekState {
  id: string | null;
  /** Die Liste, aus der er geöffnet wurde – ↑ ↓ blättert darin. */
  list: string[];
}

let peek: PeekState = { id: null, list: [] };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function openPeek(id: string, list: string[] = []): void {
  peek = { id, list: list.length ? list : [id] };
  emit();
}

export function closePeek(): void {
  if (peek.id === null) return;
  peek = { id: null, list: [] };
  emit();
}

/** Zur nächsten oder vorigen Person der Liste. */
export function stepPeek(step: 1 | -1): void {
  if (!peek.id) return;
  const next = stepIn(peek.list, peek.id, step);
  if (next && next !== peek.id) {
    peek = { ...peek, id: next };
    emit();
  }
}

export function usePeek(): PeekState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => peek,
  );
}
