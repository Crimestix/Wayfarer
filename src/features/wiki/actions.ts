/** Befehle des Bereichs „Wiki“. */
import type { CampaignDb } from '../../data/db';
import {
  createEntity,
  nowIso,
  type Article,
  type CampaignData,
  type Entity,
  type EntityKind,
} from '../../domain/schema';
import type { ImportSections } from '../import/v157';
import { adoptFamilies, type FamilyAdoption } from '../welt/actions';
import type { LkImportPlan } from './apply';

export interface AppliedLkImport {
  at: string;
  fileName: string;
  sections: ImportSections;
  /** Der Stand vor der Übernahme – zum Zurücknehmen. */
  before: CampaignData;
  /** Der Stand direkt danach. Solange er unverändert ist, lässt sich die Übernahme zurücknehmen. */
  after: CampaignData;
}

// Bewusst nur im Arbeitsspeicher: gilt, bis Wayfarer geschlossen wird.
let last: AppliedLkImport | null = null;

export const lastLkImport = (): AppliedLkImport | null => last;

/**
 * Schreibt eine geplante Übernahme in den Spielstand und legt Familien aus gemeinsamen Nachnamen
 * an. Wirft, wenn der Stand nicht geschrieben werden darf.
 */
export function applyLkImport(
  db: CampaignDb,
  plan: LkImportPlan,
  fileName: string,
): FamilyAdoption | null {
  const before = db.getSnapshot();
  db.replaceAll(plan.data);
  // Bei so vielen neuen Personen entsteht eine Familie erst ab zwei Trägern des Nachnamens.
  const families = plan.personIds.length ? adoptFamilies(db, undefined, 2) : null;
  last = { at: nowIso(), fileName, sections: plan.sections, before, after: db.getSnapshot() };
  return families;
}

/** Lässt sich die letzte Übernahme noch zurücknehmen? Nur, solange seither nichts geändert wurde. */
export const canUndoLkImport = (db: CampaignDb): boolean =>
  last !== null && db.getSnapshot() === last.after;

/** Stellt den Stand vor der letzten Übernahme wieder her. */
export function undoLkImport(db: CampaignDb): boolean {
  if (!last || !canUndoLkImport(db)) return false;
  db.replaceAll(last.before);
  last = null;
  return true;
}

/** Nimmt einen Artikel von Hand als Eintrag in die Welt auf. */
export function adoptArticle(db: CampaignDb, article: Article, kind: EntityKind): Entity {
  return db.put(
    'entities',
    createEntity({
      kind,
      name: article.title,
      aliases: article.aliases,
      lk: { resourceId: article.id, title: article.title },
    }),
  );
}
