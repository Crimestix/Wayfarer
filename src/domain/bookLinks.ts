/**
 * Worauf ein Buch zeigt – für Löschen und „wird noch verwendet“ (`detailLinks` in `derive.ts`).
 * Eigene Datei, damit `derive.ts` nicht von `book.ts` abhängt, das selbst aus `derive.ts` liest.
 */
import type { Book } from './schema';

/**
 * Alle Einträge, auf die ein Buch zeigt: Verfasser, Gegenden (auch die seiner Themen), einzeln
 * dazu und weg genommene.
 */
export function bookLinks(book: Book | null): { field: string; id: string }[] {
  if (!book) return [];
  return [
    ...(book.authorId ? [{ field: 'book.authorId', id: book.authorId }] : []),
    ...book.selection.regionIds.map((id) => ({ field: 'book.regionIds', id })),
    ...book.selection.rules.flatMap((rule) =>
      rule.regionId ? [{ field: 'book.rules', id: rule.regionId }] : [],
    ),
    ...book.selection.include.map((id) => ({ field: 'book.include', id })),
    ...book.selection.exclude.map((id) => ({ field: 'book.exclude', id })),
  ];
}

/**
 * Das Buch ohne Verweise auf einen gelöschten Eintrag. Der Verfasser bleibt mit seinem Namen
 * stehen; eine überschriebene Seite zu dem Eintrag fällt weg. War die gelöschte Gegend die
 * einzige, bleibt sie als „gelöscht“ stehen – sonst stünde plötzlich alles einer Art aus der
 * ganzen Welt im Buch (eine Gegend, die es nicht gibt, lässt nichts übrig: `bookEntries`). Ein
 * Thema mit der gelöschten Gegend fällt weg.
 */
export function bookWithout(book: Book, entityId: string, name = ''): Book {
  const { selection } = book;
  const drop = (ids: string[]) => ids.filter((id) => id !== entityId);
  const pages = { ...book.pages };
  delete pages[entityId];
  const regionIds = drop(selection.regionIds);
  return {
    ...book,
    authorId: book.authorId === entityId ? null : book.authorId,
    authorText: book.authorId === entityId ? name.trim() || book.authorText : book.authorText,
    selection: {
      ...selection,
      regionIds: regionIds.length ? regionIds : selection.regionIds,
      rules: selection.rules.filter((rule) => rule.regionId !== entityId),
      include: drop(selection.include),
      exclude: drop(selection.exclude),
    },
    pages,
  };
}
