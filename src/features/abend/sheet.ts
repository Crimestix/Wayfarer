/**
 * Das Blatt, an dem gerade geschrieben wird – für die Fächer von „Abend vorbereiten“: welches es
 * ist (dieser oder der nächste Abend), was darauf steht und wie man darauf schreibt.
 */
import { createContext, useContext, useMemo } from 'react';
import { useData, useDb } from '../../data/hooks';
import type { PrepContent, PrepSection, PrepView, PrepWhich } from '../../domain/prep';
import type { MentionOptions } from '../../ui';
import { attachToSheet, patchPrep, type PrepChange } from './actions';

export interface SheetContext {
  which: PrepWhich;
  view: PrepView;
  content: PrepContent;
  /** Die Nummer des Abends, dem das Blatt gilt. */
  number: number;
  /** Springt zu einem Fach und klappt es auf. */
  jump: (section: PrepSection) => void;
}

export const SheetCtx = createContext<SheetContext | null>(null);

export function useSheet(): SheetContext & { patch: (change: PrepChange) => void } {
  const ctx = useContext(SheetCtx);
  if (!ctx) throw new Error('Kein Blatt geöffnet.');
  const db = useDb();
  return { ...ctx, patch: (change) => patchPrep(db, change, ctx.which) };
}

/**
 * „@“ in den Textfeldern des Blatts: Wer so erwähnt wird, liegt danach bei den Orten oder
 * Personen des Abends; was es noch nicht gibt, entsteht als Platzhalter. Ohne Suchwort stehen
 * zuerst die da, die schon auf dem Blatt liegen.
 */
export function useSheetMention(): MentionOptions {
  const db = useDb();
  const data = useData();
  const { which, content } = useSheet();
  const near = useMemo(
    () => [...content.personIds, ...content.placeIds].filter((id) => data.entities[id]),
    [content.personIds, content.placeIds, data.entities],
  );
  return useMemo(
    () => ({ near, onMention: (entityId: string) => attachToSheet(db, entityId, which) }),
    [db, near, which],
  );
}
