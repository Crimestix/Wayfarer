/**
 * Freie Zeit: Tage, in denen die Gefährten nicht unterwegs sind und eigenen Vorhaben nachgehen –
 * herstellen, lernen und üben, nachforschen, arbeiten, sich erholen. Ein Vorhaben ist eine
 * Fortschrittsleiste (`tracks/`, `domain/track.ts`), die Arbeitstage zählt; beim Herstellen zeigt
 * sie auf den Gegenstand, dessen Rezept die Dauer nach den Regeln vorgibt (`domain/crafting.ts`).
 *
 * Mehrere Gefährten an einem Vorhaben teilen sich die Arbeit: Je Tag zählt jeder Helfer einen
 * Arbeitstag. Reine Funktionen; geschrieben wird über `features/gruppe/downtime.ts`.
 */
import { craftPlan } from './crafting';
import type { CampaignData, DowntimeActivity, Item, Track } from './schema';
import { trackMax } from './track';

export const DOWNTIME_LABEL: Record<DowntimeActivity, string> = {
  craft: 'Herstellen',
  train: 'Lernen und Üben',
  research: 'Nachforschen',
  work: 'Arbeiten',
  recover: 'Erholen',
  custom: 'Eigenes',
};

/** Woran ein Vorhaben dieser Art hängt – für das Feld unter der Wahl. */
export const DOWNTIME_HINT: Record<DowntimeActivity, string> = {
  craft: 'Ein Gegenstand mit Rezept – die Dauer folgt den Regeln.',
  train: 'Was gelernt wird: eine Sprache, ein Werkzeug …',
  research: 'Wonach geforscht wird.',
  work: 'Wofür gearbeitet wird; ohne Ziel zählt nur die Zeit.',
  recover: 'Wovon sich erholt wird; ohne Ziel zählt nur die Zeit.',
  custom: 'Was getan wird.',
};

/** Die Leisten der freien Zeit: alle mit einem Vorhaben, offene zuerst. */
export function downtimeTracks(data: Pick<CampaignData, 'tracks'>): Track[] {
  return Object.values(data.tracks)
    .filter((track) => track.downtime)
    .sort((a, b) => Number(a.done) - Number(b.done) || a.name.localeCompare(b.name, 'de'));
}

/** Der Name eines neuen Vorhabens: „Langschwert herstellen“, „Nachforschen: Salzgrotte“. */
export function projectName(
  activity: DowntimeActivity,
  subject: string,
  item: Pick<Item, 'name'> | null = null,
): string {
  const what = subject.replace(/\s+/g, ' ').trim();
  if (activity === 'craft' && item) return `${item.name} herstellen`;
  if (activity === 'custom') return what || DOWNTIME_LABEL.custom;
  return what ? `${DOWNTIME_LABEL[activity]}: ${what}` : DOWNTIME_LABEL[activity];
}

/** Arbeitstage, die ein neues Herstellen nach dem Rezept braucht; null = lässt sich nicht rechnen. */
export function craftDays(item: Item | null | undefined): number | null {
  return item?.item.recipe ? craftPlan(item.item.recipe).days : null;
}

/** Ein Vorhaben, das erst mit der freien Zeit entsteht. */
export interface NewProject {
  /** Eine Kennung für die Dauer der Planung („neu:<Gefährte>“). */
  key: string;
  ownerId: string;
  activity: DowntimeActivity;
  /** Was getan wird, in Worten (nicht beim Herstellen). */
  subject: string;
  itemId: string | null;
  /** Ziel in Arbeitstagen; null = ohne Ziel, es zählt nur die Zeit. */
  target: number | null;
}

export interface DowntimeInput {
  /** Ganze Tage freier Zeit. */
  days: number;
  projects: readonly NewProject[];
  /** Wer woran arbeitet: die Kennung einer Leiste oder eines neuen Vorhabens. */
  work: readonly { characterId: string; projectKey: string }[];
  /** Fertige Gegenstände gehören dem, dem das Vorhaben gehört (je Vorhaben, Vorgabe: ja). */
  keep?: Readonly<Record<string, boolean>>;
}

export interface ProjectProgress {
  /** Die Kennung der Leiste oder des neuen Vorhabens. */
  key: string;
  /** Die Leiste, wenn es sie schon gibt. */
  trackId: string | null;
  name: string;
  ownerId: string | null;
  activity: DowntimeActivity;
  itemId: string | null;
  /** Wer daran arbeitet, in der Reihenfolge der Wahl. */
  helpers: string[];
  before: number;
  after: number;
  /** Ziel in Arbeitstagen; 0 = ohne Ziel. */
  target: number;
  finished: boolean;
  /** Nach wie vielen Tagen der freien Zeit es fertig ist; null = nicht fertig. */
  doneAfter: number | null;
  /** Der fertige Gegenstand geht an den Besitzer des Vorhabens. */
  keep: boolean;
}

export interface DowntimePlan {
  days: number;
  progress: ProjectProgress[];
  /** Der Eintrag der Chronik – nur aus den gewählten Tätigkeiten zusammengesetzt. */
  text: string;
  /** Wer und was darin vorkommt: die Gefährten und die Gegenstände. */
  refs: string[];
}

const number = (n: number) => n.toLocaleString('de-DE');
const dayWord = (n: number) => (n === 1 ? '1 Tag' : `${number(n)} Tage`);

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`;
}

/** Wie das Vorhaben in der Chronik steht: „Langschwert herstellen (5 von 8 Tagen)“. */
export function progressLine(progress: ProjectProgress): string {
  const amount =
    progress.target > 0
      ? `${number(progress.after)} von ${dayWord(progress.target).replace(/Tage$/, 'Tagen')}${progress.finished ? ', fertig' : ''}`
      : dayWord(progress.after);
  return `${progress.name} (${amount})`;
}

/**
 * Was die freie Zeit bringt: je Vorhaben der Stand vorher und nachher, ob es fertig wird, und der
 * eine Satz für die Chronik. Ein Gefährte, für den nichts gewählt ist, kommt nicht vor.
 */
export function planDowntime(
  data: Pick<CampaignData, 'tracks' | 'entities'>,
  input: DowntimeInput,
): DowntimePlan {
  const days = Math.max(0, Math.floor(input.days));
  const helpersOf = new Map<string, string[]>();
  for (const { characterId, projectKey } of input.work) {
    if (!data.entities[characterId]) continue;
    const list = helpersOf.get(projectKey) ?? [];
    if (!list.includes(characterId)) list.push(characterId);
    helpersOf.set(projectKey, list);
  }
  const nameOf = (id: string) => data.entities[id]?.name ?? '';
  const progress: ProjectProgress[] = [];
  for (const [key, helpers] of helpersOf) {
    const track = data.tracks[key];
    const project = track ? null : input.projects.find((p) => p.key === key);
    if (!track && !project) continue;
    const itemId = track ? (track.downtime?.itemId ?? null) : project!.itemId;
    const item = itemId ? data.entities[itemId] : undefined;
    const activity = track ? (track.downtime?.activity ?? 'custom') : project!.activity;
    const target = track ? trackMax(track) : Math.max(0, Math.round(project!.target ?? 0));
    const before = track ? track.value : 0;
    const raw = before + days * helpers.length;
    const after = target > 0 ? Math.min(raw, target) : raw;
    const finished = target > 0 && after >= target;
    progress.push({
      key,
      trackId: track ? track.id : null,
      name: track
        ? track.name
        : projectName(activity, project!.subject, item?.kind === 'item' ? item : null),
      ownerId: track ? track.ownerId : project!.ownerId,
      activity,
      itemId: item ? item.id : null,
      helpers,
      before,
      after,
      target,
      finished,
      doneAfter: finished ? Math.max(0, Math.ceil((target - before) / helpers.length)) : null,
      keep: input.keep?.[key] ?? true,
    });
  }
  const parts = progress.map(
    (p) => `${joinNames(p.helpers.map(nameOf).filter(Boolean))}: ${progressLine(p)}`,
  );
  const text = parts.length
    ? `Freie Zeit, ${dayWord(days)}: ${parts.join('; ')}.`
    : `Freie Zeit, ${dayWord(days)}.`;
  const refs = [
    ...new Set([
      ...progress.flatMap((p) => p.helpers),
      ...progress.flatMap((p) => (p.itemId ? [p.itemId] : [])),
    ]),
  ];
  return { days, progress, text, refs };
}

/** Fertige Vorhaben, deren Gegenstand jetzt jemandem gehören soll: Gegenstand und neuer Besitzer. */
export function itemsToHand(
  data: Pick<CampaignData, 'entities'>,
  plan: DowntimePlan,
): { itemId: string; holderId: string }[] {
  return plan.progress.flatMap((p) => {
    if (!p.finished || !p.keep || p.activity !== 'craft' || !p.itemId || !p.ownerId) return [];
    const item = data.entities[p.itemId];
    const owner = data.entities[p.ownerId];
    if (item?.kind !== 'item' || !owner || item.item.holderId === p.ownerId) return [];
    return [{ itemId: item.id, holderId: owner.id }];
  });
}
