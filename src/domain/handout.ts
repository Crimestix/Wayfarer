/**
 * Handouts: was auf ein Blatt kommt – Absätze, Unterschrift, Siegel –, woher ein Wortlaut stammen
 * kann (Schriftstücke der Chronik, Artikel) und Hinweiskarten aus dem Blatt des Abends. Reine
 * Funktionen; geschrieben wird über `features/handouts/actions.ts`.
 */
import { openSecrets, prepView } from './prep';
import type { CampaignData, Handout, HandoutKind } from './schema';

export const HANDOUT_KIND_LABEL: Record<HandoutKind, string> = {
  letter: 'Brief',
  note: 'Notiz',
  decree: 'Erlass',
  card: 'Hinweiskarte',
};

export const HANDOUT_KIND_HINT: Record<HandoutKind, string> = {
  letter: 'Ein Brief auf Pergament, mit Anrede, Unterschrift und auf Wunsch einem Siegel.',
  note: 'Ein kurzer Zettel – eine Botschaft, eine Kritzelei, ein abgerissenes Stück.',
  decree: 'Ein Erlass oder Aushang: Überschrift in Versalien, Siegel darunter.',
  card: 'Eine kleine Karte – acht passen auf ein Blatt.',
};

/** Absätze aus dem Wortlaut: Leerzeilen trennen, einfache Zeilenwechsel bleiben. */
export function paragraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((part) => part.replace(/^\n+|\n+$/g, ''))
    .filter((part) => part.trim());
}

/** Ein Siegel hat höchstens zwei Zeichen. */
export const sealMark = (seal: string) => seal.trim().slice(0, 2).toUpperCase();

export interface HandoutSource {
  /** `chronicle:<id>` oder `article:<id>`. */
  id: string;
  title: string;
  text: string;
  /** „Schriftstück, 5. Tauwind“ oder „Artikel“. */
  from: string;
}

/**
 * Woher ein Wortlaut kommen kann: die Schriftstücke der Chronik (die neuesten zuerst) und die
 * Artikel im Ordner „Schriftstücke“.
 */
export function handoutSources(data: CampaignData): HandoutSource[] {
  const out: HandoutSource[] = [];
  for (const entry of Object.values(data.chronicle).sort((a, b) => b.at - a.at)) {
    if (entry.kind !== 'writing' || !entry.text.trim()) continue;
    out.push({
      id: `chronicle:${entry.id}`,
      title: entry.writing?.title?.trim() || entry.text.trim().split('\n')[0]!.slice(0, 60),
      text: entry.text.trim(),
      from: 'Schriftstück aus der Chronik',
    });
  }
  const folder = Object.values(data.articles).find(
    (article) => article.title.trim().toLowerCase() === 'schriftstücke',
  );
  if (folder)
    for (const article of Object.values(data.articles)) {
      if (article.parentId !== folder.id) continue;
      const text = article.docs
        .map((doc) => doc.text)
        .join('\n\n')
        .trim();
      if (text)
        out.push({ id: `article:${article.id}`, title: article.title, text, from: 'Artikel' });
    }
  return out;
}

export interface HintCard {
  key: string;
  text: string;
  /** Die Geschichte, zu der das Geheimnis gehört. */
  story: string;
}

/** Hinweiskarten aus den offenen Geheimnissen des Abend-Blatts. */
export function prepHintCards(data: CampaignData): HintCard[] {
  return openSecrets(prepView(data).content).map((secret) => ({
    key: `secret:${secret.id}`,
    text: secret.text.trim(),
    story: secret.storyId ? (data.stories[secret.storyId]?.title ?? '') : '',
  }));
}

/** Handouts nach Art und Titel; Übergebene unten. */
export function handoutList(data: Pick<CampaignData, 'handouts'>): Handout[] {
  return Object.values(data.handouts).sort(
    (a, b) =>
      Number(a.givenAt !== null) - Number(b.givenAt !== null) ||
      (a.title || '').localeCompare(b.title || '', 'de'),
  );
}
