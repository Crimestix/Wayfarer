/**
 * Das Spielerbuch als Zeilen und als reiner Text zum Kopieren. Was im Buch steht, sammelt
 * `playerBook()` in `domain/playerBook.ts`; hier wird es nur in Worte gefasst – für die Spieler
 * ohne den Stand von Gerüchten und Vermutungen.
 */
import { GUESS_TRUTH_LABEL, playerBook, type PlayerBook } from '../../domain/playerBook';
import type { CampaignData, ChronicleEntry, Guess } from '../../domain/schema';
import { formatDate } from '../../domain/time/calendar';
import { entryPlainText, type SummaryAudience } from '../chronik/model';

/** Für wen das Buch gerade gezeigt wird: „Für dich“ oder „Für die Spieler“. */
export type BookAudience = SummaryAudience;

/** Eine Zeile der Chronik in Worten – für die Spieler ohne den Stand eines Gerüchts. */
export const bookLine = (data: CampaignData, entry: ChronicleEntry, audience: BookAudience) =>
  entryPlainText(data, entry, audience);

/** Eine Vermutung in einer Zeile; für die Spielleitung mit Stand und Bemerkung. */
export function guessLine(guess: Guess, audience: BookAudience): string {
  const text = `Vermutung: ${guess.text}`;
  if (audience === 'players') return text;
  const note = guess.note.trim();
  return `${text} (${GUESS_TRUTH_LABEL[guess.truth]}${note ? ` – ${note}` : ''})`;
}

/** Ein Text, der mehrere Zeilen haben kann, als Punkt einer Liste. */
const bullet = (text: string) =>
  text
    .split('\n')
    .map((line, i) => (i === 0 ? `- ${line}` : `  ${line}`))
    .join('\n');

/**
 * Das Spielerbuch als reiner Text für die Zwischenablage – zum Einfügen im Gruppenchat. In der
 * Fassung für die Spieler steht nichts, was nur die Spielleitung weiß.
 */
export function playerBookText(
  data: CampaignData,
  audience: BookAudience = 'players',
  book: PlayerBook = playerBook(data),
): string {
  const cal = data.campaign.calendar;
  const out: string[] = [`Spielerbuch – Stand ${formatDate(cal, data.state.now)}`];
  for (const section of book.sections) {
    const block: string[] = [section.label.toUpperCase()];
    switch (section.sort) {
      case 'things':
        for (const thing of section.things) {
          block.push(thing.name);
          for (const entry of thing.lines) block.push(bullet(bookLine(data, entry, audience)));
          for (const guess of thing.guesses) block.push(bullet(guessLine(guess, audience)));
        }
        break;
      case 'lines':
        for (const entry of section.entries) block.push(bullet(bookLine(data, entry, audience)));
        break;
      case 'handouts':
        for (const handout of section.handouts) {
          const title = handout.title.trim() || 'Ohne Titel';
          const text = handout.text.trim();
          block.push(bullet(text ? `${title}\n${text}` : title));
        }
        break;
      case 'guesses':
        for (const guess of section.guesses) block.push(bullet(guessLine(guess, audience)));
        break;
    }
    out.push(block.join('\n'));
  }
  if (book.sections.length === 0) out.push('Noch steht nichts darin.');
  return out.join('\n\n');
}
