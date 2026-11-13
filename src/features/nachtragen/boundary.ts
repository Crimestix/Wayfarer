/**
 * Grenzen von Hand verschieben: zwei Entwürfe zusammenlegen oder einen an einer Stelle teilen.
 * Rein und ohne Kalender – die Tage des Kalenders wandern mit ihrem Text.
 */
import {
  markDuplicates,
  RANGE_NOTE_END,
  readBoundary,
  type DraftDate,
  type SessionDraft,
} from './split';

/** Texte mit Leerzeile dazwischen verbinden; liefert, wo jedes Stück im Ergebnis beginnt. */
function joinParts(parts: string[]): { text: string; starts: number[] } {
  let text = '';
  const starts: number[] = [];
  for (const part of parts) {
    if (!part) {
      starts.push(text.length);
      continue;
    }
    if (text) text += '\n\n';
    starts.push(text.length);
    text += part;
  }
  return { text, starts };
}

const shift = (dates: DraftDate[], by: number, where: DraftDate['where']): DraftDate[] =>
  dates.map((d) => ({ ...d, from: d.from + by, to: d.to + by, where }));

const textDates = (d: SessionDraft) => d.worldDates.filter((w) => w.where === 'text');
const headingDates = (d: SessionDraft) => d.worldDates.filter((w) => w.where === 'heading');

/**
 * Entwurf `i` mit dem nächsten zusammenlegen. Hat `i` keine Überschrift (Vorspann), wird der
 * nächste zur Session und der Text davor kommt nach vorn; sonst bleibt `i`, und Überschrift und
 * Text des nächsten werden Teil seines Textes – es geht nichts verloren.
 */
export function mergeWithNext(drafts: readonly SessionDraft[], i: number): SessionDraft[] {
  const a = drafts[i];
  const b = drafts[i + 1];
  if (!a || !b) return drafts.slice();
  const sameFile = a.source.fileIndex === b.source.fileIndex;
  const otherFile = sameFile ? [] : [`Enthält auch Notizen aus „${b.source.file}“.`];
  let merged: SessionDraft;
  if (!a.heading) {
    const { text, starts } = joinParts([a.text, b.text]);
    merged = {
      ...b,
      key: a.key,
      text,
      worldDates: [
        ...headingDates(b),
        ...shift(textDates(a), starts[0]!, 'text'),
        ...shift(textDates(b), starts[1]!, 'text'),
      ],
      source: sameFile
        ? {
            ...b.source,
            from: Math.min(a.source.from, b.source.from),
            to: Math.max(a.source.to, b.source.to),
            textFrom: a.source.textFrom,
            line: a.source.line,
          }
        : b.source,
      notes: [...b.notes, 'Mit dem Text davor zusammengelegt.', ...otherFile],
      vorspann: false,
    };
  } else {
    // Die Überschrift des nächsten steht als eigene Zeile über seinem Text.
    const block = b.heading && b.text ? `${b.heading}\n${b.text}` : b.heading || b.text;
    const { text, starts } = joinParts([a.text, block]);
    const headingAt = starts[1]!;
    const bodyAt = b.heading ? headingAt + b.heading.length + 1 : headingAt;
    const into =
      a.number !== null && b.number !== null && a.number !== b.number
        ? `Session ${b.number} ist hier hineingelegt.`
        : 'Mit dem nächsten Abschnitt zusammengelegt.';
    // „Session 5“ und „Session 6“ zusammengelegt: der Abschnitt umfasst beide Abende.
    const follows = a.number !== null && b.number === (a.lastNumber ?? a.number) + 1;
    merged = {
      ...a,
      number: a.number ?? b.number,
      lastNumber: follows
        ? (b.lastNumber ?? b.number)
        : a.number !== null
          ? a.lastNumber
          : b.lastNumber,
      title: a.title || b.title,
      realDate: a.realDate || b.realDate,
      text,
      worldDates: [
        ...a.worldDates,
        ...shift(headingDates(b), headingAt, 'text'),
        ...shift(textDates(b), bodyAt, 'text'),
      ],
      source: sameFile ? { ...a.source, to: Math.max(a.source.to, b.source.to) } : a.source,
      notes: [...a.notes, into, ...otherFile],
      vorspann: false,
    };
  }
  return markDuplicates([...drafts.slice(0, i), merged, ...drafts.slice(i + 2)]);
}

/**
 * Entwurf `i` an der Stelle `offset` seines Textes teilen – am Anfang der Zeile, in der die
 * Stelle liegt. Ist diese Zeile eine Grenze („Session 6 …“, ein Datum), wird sie die
 * Überschrift des neuen Entwurfs. Ohne Wirkung, wenn eine Seite leer bliebe.
 */
export function splitAt(
  drafts: readonly SessionDraft[],
  i: number,
  offset: number,
): SessionDraft[] {
  const draft = drafts[i];
  if (!draft) return drafts.slice();
  const text = draft.text;
  const at = Math.max(0, Math.min(text.length, Math.floor(offset)));
  const cut = at === 0 ? 0 : text.lastIndexOf('\n', at - 1) + 1;
  const head = text.slice(0, cut).trimEnd();
  const rest = text.slice(cut);
  if (!head || !rest.trim()) return drafts.slice();

  const lineEnd = rest.indexOf('\n');
  const firstLine = lineEnd < 0 ? rest : rest.slice(0, lineEnd);
  const mark = readBoundary(firstLine);
  const headingLead = firstLine.length - firstLine.trimStart().length;
  const heading = mark ? firstLine.trim() : '';
  const bodyStart = cut + (mark ? (lineEnd < 0 ? rest.length : lineEnd + 1) : 0);
  const bodyRaw = text.slice(bodyStart);
  const bodyAt = bodyStart + (bodyRaw.length - bodyRaw.trimStart().length);
  const body = bodyRaw.trim();

  // „Session 3+4“ geteilt: vorn bleibt 3, hinten ist 4 (oder was die Zeile sagt).
  const notes = ['Von Hand getrennt.'];
  let number = mark?.number ?? null;
  let lastNumber = mark?.lastNumber ?? null;
  let firstLast = draft.lastNumber;
  if (draft.number !== null && draft.lastNumber !== null) {
    if (number === null) {
      number = draft.number + 1;
      lastNumber = draft.lastNumber > number ? draft.lastNumber : null;
      notes.push(`Als Session ${number} angenommen.`);
    }
    if (number > draft.number && number <= draft.lastNumber) {
      firstLast = number - 1 > draft.number ? number - 1 : null;
      if (lastNumber === null && draft.lastNumber > number) lastNumber = draft.lastNumber;
    }
  }
  const first: SessionDraft = {
    ...draft,
    lastNumber: firstLast,
    text: head,
    worldDates: draft.worldDates.filter((d) => d.where === 'heading' || d.to <= head.length),
    source: { ...draft.source, to: draft.source.textFrom + cut },
    notes:
      firstLast === draft.lastNumber
        ? draft.notes
        : draft.notes.filter((note) => !note.endsWith(RANGE_NOTE_END)),
  };
  const inHeading = (d: DraftDate) =>
    mark !== null && d.from >= cut + headingLead && d.to <= cut + headingLead + heading.length;
  const second: SessionDraft = {
    key: `${draft.source.fileIndex}:${draft.source.textFrom + cut}`,
    number,
    lastNumber,
    title: mark?.title ?? '',
    realDate: mark?.realDate ?? '',
    heading,
    text: body,
    source: {
      ...draft.source,
      from: draft.source.textFrom + cut,
      textFrom: draft.source.textFrom + bodyAt,
      line:
        draft.source.line +
        (draft.heading ? draft.heading.split('\n').length : 0) +
        text.slice(0, cut).split('\n').length -
        1,
    },
    worldDates: [
      ...shift(textDates(draft).filter(inHeading), -(cut + headingLead), 'heading'),
      ...shift(
        textDates(draft).filter((d) => !inHeading(d) && d.from >= bodyAt),
        -bodyAt,
        'text',
      ),
    ],
    notes,
    vorspann: false,
  };
  return markDuplicates([...drafts.slice(0, i), first, second, ...drafts.slice(i + 1)]);
}
