/**
 * Vorhaben: was eine Fraktion, Familie oder Person verfolgt. Ein Vorhaben ist kein eigenes Ding,
 * sondern eine Geschichte, die sie antreibt (`story.ownerId`) – mit der Uhr der Geschichte
 * (`domain/clock.ts`). Uhren gehören zu Geschichten; ein zweites Uhrenwerk gibt es nicht.
 *
 * Hier wird nur gelesen: was als Nächstes eintritt, was zuletzt geschah, ob die Uhr ruht oder
 * steht – und was jemand in einer Zeitspanne getan hat (eingetretene Schritte und Veränderungen,
 * die ihn nennen). Nichts wird formuliert, nichts gefragt. Reine Funktionen.
 */
import { WORLD_CHRONICLE_KINDS, recordHeadline } from './chronicleKinds';
import { clockView, type ClockView } from './clock';
import { attitudeLabel } from './relations';
import { PARTY_ID, type CampaignData, type ChronicleEntry, type Clock, type Story } from './schema';
import type { StoryPace } from './story';

/** Ein Schritt, wie er im Vorhaben steht: was, wann – und ob die Gruppe ihn verhindert hat. */
export interface SchemeStep {
  text: string;
  at: number;
  prevented: boolean;
}

export interface Scheme {
  /** `story:<id>` – oder `clock:<id>` für eine Uhr aus früheren Ständen ohne Geschichte. */
  key: string;
  story: Story | null;
  clock: Clock | null;
  title: string;
  pace: StoryPace;
  view: ClockView | null;
  /** Der Schritt, der als Nächstes eintritt; null ohne Uhr oder wenn alles geschehen ist. */
  next: SchemeStep | null;
  /** Was zuletzt eingetreten ist oder verhindert wurde. */
  last: SchemeStep | null;
  /** Schritte hinter der Uhr / alle Schritte. */
  behind: number;
  total: number;
  /** Warum die Uhr steht – leer, wenn sie nicht blockiert ist. */
  blocked: string;
  /** Die Geschichte ist zu Ende erzählt. */
  closed: boolean;
}

type SchemeData = Pick<CampaignData, 'stories' | 'clocks' | 'state'>;

/** Wer eine Geschichte antreibt: ihr eigener Antreiber, sonst der Betreiber ihrer Uhr. */
export function driverOf(data: Pick<CampaignData, 'clocks'>, story: Story): string | null {
  if (story.ownerId) return story.ownerId;
  const clock = story.clockId ? data.clocks[story.clockId] : undefined;
  return clock?.ownerId ?? null;
}

const PACE_ORDER: Record<StoryPace, number> = {
  running: 0,
  blocked: 1,
  paused: 2,
  none: 3,
  done: 4,
};

function schemeOf(data: SchemeData, story: Story | null, clock: Clock | null): Scheme {
  const view = clock ? clockView(clock, data.state.now) : null;
  const pace: StoryPace = !view
    ? 'none'
    : view.done
      ? 'done'
      : view.blocked
        ? 'blocked'
        : view.paused
          ? 'paused'
          : 'running';
  const happened = (view?.steps ?? []).filter(
    (step) => step.state === 'done' || step.state === 'prevented',
  );
  const last = happened.reduce<(typeof happened)[number] | null>(
    (latest, step) => (latest === null || step.at >= latest.at ? step : latest),
    null,
  );
  return {
    key: story ? `story:${story.id}` : `clock:${clock!.id}`,
    story,
    clock,
    title: story?.title ?? clock?.title ?? '',
    pace,
    view,
    next: view?.next ? { text: view.next.step.text, at: view.next.at, prevented: false } : null,
    last: last
      ? { text: last.step.text, at: last.at, prevented: last.state === 'prevented' }
      : null,
    behind: happened.length,
    total: clock?.steps.length ?? 0,
    blocked: view?.blocked ?? '',
    closed: story?.closed ?? false,
  };
}

/**
 * Die Vorhaben von jemandem: die Geschichten, die er antreibt, mit ihrer Uhr – dazu Uhren aus
 * früheren Ständen, die er betreibt und die noch zu keiner Geschichte gehören. Was läuft, steht
 * vorn (das Nächste zuerst), dann was steht oder ruht, dann was keine Uhr hat, dann Abgelaufenes.
 * Zu Ende Erzähltes nur mit `withClosed`.
 */
export function schemesOf(
  data: SchemeData,
  ownerId: string,
  options: { withClosed?: boolean } = {},
): Scheme[] {
  const out: Scheme[] = [];
  const owned = new Set<string>();
  for (const story of Object.values(data.stories)) {
    if (story.clockId) owned.add(story.clockId);
    if (driverOf(data, story) !== ownerId) continue;
    if (story.closed && !options.withClosed) continue;
    const clock = story.clockId ? (data.clocks[story.clockId] ?? null) : null;
    out.push(schemeOf(data, story, clock));
  }
  for (const clock of Object.values(data.clocks))
    if (clock.ownerId === ownerId && !owned.has(clock.id)) out.push(schemeOf(data, null, clock));
  return out.sort(
    (a, b) =>
      Number(a.closed) - Number(b.closed) ||
      PACE_ORDER[a.pace] - PACE_ORDER[b.pace] ||
      (a.next?.at ?? Infinity) - (b.next?.at ?? Infinity) ||
      a.title.localeCompare(b.title, 'de') ||
      a.key.localeCompare(b.key),
  );
}

/** Wer überhaupt etwas antreibt: alle Antreiber von Geschichten und Betreiber von Uhren. */
export function schemeDrivers(data: Pick<CampaignData, 'stories' | 'clocks'>): Set<string> {
  const ids = new Set<string>();
  for (const story of Object.values(data.stories)) {
    const driver = driverOf(data, story);
    if (driver) ids.add(driver);
  }
  for (const clock of Object.values(data.clocks)) if (clock.ownerId) ids.add(clock.ownerId);
  return ids;
}

// ── Was jemand getan hat ───────────────────────────────────────────────────

/**
 * `step` = ein Schritt eines Vorhabens ist eingetreten, `prevented` = die Gruppe hat ihn
 * verhindert, `attitude` = die Haltung hat sich geändert, sonst eine Veränderung oder ein
 * Ereignis der Chronik, das ihn nennt.
 */
export type DeedKind = 'step' | 'prevented' | 'attitude' | 'change' | 'event';

export interface Deed {
  key: string;
  kind: DeedKind;
  at: number;
  text: string;
  /** Das Vorhaben, zu dem ein Schritt gehört. */
  scheme: string | null;
  storyId: string | null;
  /** Der Eintrag der Chronik, aus dem es stammt. */
  entryId: string | null;
  /** Die Gruppe weiß nichts davon. */
  secret: boolean;
}

/** „Haltung zur Gruppe: Misstrauisch → Feindselig“ – aus dem Eintrag gelesen, nicht formuliert. */
function attitudeText(data: CampaignData, entry: ChronicleEntry): string {
  const change = entry.attitude!;
  const toward =
    change.toId === PARTY_ID ? 'zur Gruppe' : `zu ${data.entities[change.toId]?.name ?? '?'}`;
  const line = `Haltung ${toward}: ${attitudeLabel(change.before)} → ${attitudeLabel(change.after)}`;
  return entry.text.trim() ? `${line} – ${entry.text.trim()}` : line;
}

/**
 * Was jemand zwischen `since` (ausgeschlossen) und `until` (eingeschlossen, sonst jetzt) getan hat:
 * die eingetretenen und verhinderten Schritte seiner Vorhaben, seine Haltungsänderungen und die
 * Veränderungen und Ereignisse der Chronik, die ihn nennen. Das Neueste zuerst.
 */
export function deedsOf(
  data: CampaignData,
  ownerId: string,
  since: number,
  until: number = data.state.now,
): Deed[] {
  const deeds: Deed[] = [];
  const mine = new Set<string>();
  for (const scheme of schemesOf(data, ownerId, { withClosed: true })) {
    if (!scheme.clock) continue;
    mine.add(scheme.clock.id);
    for (const step of scheme.clock.steps) {
      if (step.at === null || step.at <= since || step.at > until) continue;
      deeds.push({
        key: `step:${scheme.clock.id}:${step.id}`,
        kind: step.skipped ? 'prevented' : 'step',
        at: step.at,
        text: step.text,
        scheme: scheme.title,
        storyId: scheme.story?.id ?? null,
        entryId: null,
        secret: scheme.clock.secret,
      });
    }
  }
  for (const entry of Object.values(data.chronicle)) {
    if (entry.at <= since || entry.at > until) continue;
    // Die Schritte der eigenen Vorhaben stehen schon oben – nicht zweimal.
    if (entry.clockId && mine.has(entry.clockId)) continue;
    if (entry.kind === 'attitude') {
      if (entry.attitude?.fromId !== ownerId) continue;
      deeds.push({
        key: `chronicle:${entry.id}`,
        kind: 'attitude',
        at: entry.at,
        text: attitudeText(data, entry),
        scheme: null,
        storyId: null,
        entryId: entry.id,
        secret: entry.secret,
      });
      continue;
    }
    if (!WORLD_CHRONICLE_KINDS.includes(entry.kind)) continue;
    if (!entry.refs.includes(ownerId) && entry.placeId !== ownerId) continue;
    const headline =
      entry.kind === 'change' || entry.kind === 'event' ? '' : recordHeadline(data, entry);
    const text = [headline, entry.text.trim()].filter(Boolean).join(' – ');
    deeds.push({
      key: `chronicle:${entry.id}`,
      kind: entry.kind === 'event' ? 'event' : 'change',
      at: entry.at,
      text: text || (entry.kind === 'event' ? 'Ereignis' : 'Veränderung'),
      scheme: null,
      storyId: entry.storyId ?? null,
      entryId: entry.id,
      secret: entry.secret,
    });
  }
  return deeds.sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));
}
