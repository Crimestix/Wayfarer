/** Darstellung von Chronik-Einträgen – überall gleich: am Spieltisch, in der Chronik, im Dossier. */
import type { ReactNode } from 'react';
import { Link as RouteLink } from 'wouter';
import {
  ArrowRight,
  Bandage,
  BookOpen,
  Brain,
  Briefcase,
  CalendarRange,
  PawPrint,
  ScrollText,
  Wand2,
  Check,
  Compass,
  Ear,
  Eye,
  Feather,
  Flag,
  Footprints,
  Gavel,
  Handshake,
  Hourglass,
  Link,
  MapPin,
  Pencil,
  Quote,
  SearchCheck,
  Skull,
  Sparkles,
  Swords,
  Tent,
  Trophy,
  Users,
  Waypoints,
  X,
} from 'lucide-react';
import { setPromiseOutcome } from '../data/actions';
import { endCondition, setRumorTruth } from '../data/record';
import {
  FATE_LABEL,
  FIGHT_OUTCOME_LABEL,
  KIND_LABEL,
  RUMOR_TRUTH_LABEL,
  daysLabel,
  entryKindLabel,
  isApproximate,
  isJob,
  recordHeadline,
} from '../domain/chronicleKinds';
import { PROMISE_OUTCOME_LABEL, promiseOutcome } from '../domain/derive';
import { activeConditions, conditionEnding } from '../domain/history';
import { relationLabel } from '../domain/relations';
import { useData, useDb } from '../data/hooks';
import {
  RUMOR_TRUTHS,
  type CampaignData,
  type ChronicleEntry,
  type ChronicleKind,
} from '../domain/schema';
import {
  formatClock,
  formatDate,
  formatDayMonth,
  formatRelative,
  fromTime,
} from '../domain/time/calendar';
import { Button, IconButton, cx, toast } from './components';
import { AttitudeBadge, EntityLink, EntityLinks } from './entity';
import './chronicle.css';

/** Name der Art am Eintrag (`KIND_LABEL` aus `domain/chronicleKinds.ts`). */
export const CHRONICLE_KIND_LABEL: Record<ChronicleKind, string> = {
  ...KIND_LABEL,
  event: 'Termin eingetreten',
};

export const CHRONICLE_KIND_ICON: Record<ChronicleKind, typeof Feather> = {
  note: Feather,
  travel: Footprints,
  attitude: Waypoints,
  event: Hourglass,
  promise: Handshake,
  change: Sparkles,
  meeting: Users,
  decision: Gavel,
  fight: Swords,
  rest: Tent,
  quote: Quote,
  fate: Skull,
  whereabouts: MapPin,
  discovery: Compass,
  rumor: Ear,
  lore: BookOpen,
  bond: Link,
  condition: Bandage,
  milestone: Trophy,
  wish: Flag,
  clue: SearchCheck,
  reveal: Eye,
  knowledge: Brain,
  writing: ScrollText,
  downtime: CalendarRange,
  transformation: Wand2,
  companion: PawPrint,
};

/** Das Zeichen eines Eintrags – ein Auftrag hat ein eigenes. */
export const chronicleEntryIcon = (entry: ChronicleEntry): typeof Feather =>
  isJob(entry) ? Briefcase : CHRONICLE_KIND_ICON[entry.kind];

/** Name der Art an einem Eintrag: „Auftrag“ bei einem Auftrag, „Termin eingetreten“ beim Termin. */
export const chronicleEntryLabel = (entry: ChronicleEntry): string =>
  entry.kind === 'event' ? CHRONICLE_KIND_LABEL.event : entryKindLabel(entry);

/**
 * Farbe der Marke je Art, nach Bedeutung: Wege und Orte grünspanfarben, Leute und Geheimnisse
 * arkan, Gefahr und Veränderung blutrot, Abmachungen hell, Termine glutrot, alles andere Messing.
 */
export const CHRONICLE_KIND_TONE: Record<ChronicleKind, string> = {
  note: 'var(--gold)',
  meeting: 'var(--arcane)',
  decision: 'var(--gold)',
  fight: 'var(--blood-bright)',
  rest: 'var(--gold)',
  quote: 'var(--gold)',
  change: 'var(--blood-bright)',
  fate: 'var(--blood-bright)',
  whereabouts: 'var(--verdigris)',
  discovery: 'var(--verdigris)',
  rumor: 'var(--arcane)',
  lore: 'var(--gold)',
  promise: 'var(--gold-bright)',
  attitude: 'var(--arcane)',
  bond: 'var(--arcane)',
  travel: 'var(--verdigris)',
  condition: 'var(--gold)',
  milestone: 'var(--gold)',
  wish: 'var(--gold)',
  clue: 'var(--arcane)',
  reveal: 'var(--arcane)',
  knowledge: 'var(--arcane)',
  writing: 'var(--gold)',
  downtime: 'var(--gold)',
  transformation: 'var(--arcane)',
  companion: 'var(--verdigris)',
  event: 'var(--ember)',
};

export interface ChronicleItemProps {
  entry: ChronicleEntry;
  /** Datum zusätzlich zur Uhrzeit zeigen (wenn die Liste nicht nach Tagen gruppiert ist). */
  showDate?: boolean;
  /** Verweise, die nicht wiederholt werden sollen – z. B. der Eintrag, auf dessen Seite man ist. */
  hideRefs?: string[];
  /** Zeigt einen Stift zum Bearbeiten. */
  onEdit?: (entry: ChronicleEntry) => void;
}

/** Verweise ohne den Ort des Geschehens, nur solche, die es noch gibt. */
const named = (data: CampaignData, entry: ChronicleEntry) =>
  entry.refs.filter((id) => id !== entry.placeId && data.entities[id]);

/**
 * Kopfzeile eines Eintrags mit Verweisen und die Dinge, die sie nennt – die stehen dann nicht
 * noch einmal unter den Verweisen. Der Wortlaut folgt `recordHeadline` (domain/chronicleKinds.ts).
 */
function headlineOf(
  data: CampaignData,
  entry: ChronicleEntry,
): { node: ReactNode; ids: (string | null | undefined)[] } {
  const link = (id: string | null | undefined) => <EntityLink id={id} icon={false} />;
  switch (entry.kind) {
    case 'travel': {
      if (!entry.travel) break;
      const { fromId, toId } = entry.travel;
      const node = toId ? (
        <>
          Ankunft: {link(toId)}
          {fromId && <span className="wf-mute"> · von {link(fromId)}</span>}
        </>
      ) : (
        <>Aufbruch aus {link(fromId)}</>
      );
      return { node, ids: [fromId, toId] };
    }
    case 'attitude': {
      if (!entry.attitude) break;
      const { fromId, toId, before, after } = entry.attitude;
      return {
        node: (
          <span className="wf-row-wrap" style={{ gap: 8 }}>
            {link(fromId)}
            <span className="wf-mute">gegenüber</span>
            {link(toId)}
            <AttitudeBadge value={before} />
            <ArrowRight width={14} height={14} className="wf-mute" />
            <AttitudeBadge value={after} />
          </span>
        ),
        ids: [fromId, toId],
      };
    }
    case 'event':
      return { node: <span className="wf-chron__event">{entry.text}</span>, ids: [] };
    case 'meeting': {
      const ids = named(data, entry);
      if (!ids.length) break;
      return {
        node: (
          <>
            Begegnung mit <EntityLinks ids={ids} />
          </>
        ),
        ids,
      };
    }
    case 'fight': {
      const ids = named(data, entry);
      const outcome = entry.fight?.outcome ?? 'open';
      return {
        node: (
          <>
            {ids.length ? (
              <>
                Kampf gegen <EntityLinks ids={ids} />
              </>
            ) : (
              'Kampf'
            )}
            {outcome !== 'open' && (
              <span className={cx('wf-chron__state', `wf-chron__state--${outcome}`)}>
                {' '}
                · {FIGHT_OUTCOME_LABEL[outcome]}
              </span>
            )}
          </>
        ),
        ids,
      };
    }
    case 'quote':
    case 'wish':
    case 'knowledge': {
      const who = named(data, entry)[0];
      if (!who) break;
      const verb = entry.kind === 'quote' ? 'sagte' : 'erfährt';
      return {
        node:
          entry.kind === 'wish' ? (
            <>
              Wunsch von {link(who)}
              {entry.wish?.setGoal && <span className="wf-mute"> · als Ziel übernommen</span>}
            </>
          ) : (
            <>
              {link(who)} <span className="wf-mute">{verb}</span>
            </>
          ),
        ids: [who],
      };
    }
    case 'fate': {
      if (!entry.fate) break;
      const { entityId, status } = entry.fate;
      return {
        node: (
          <>
            {link(entityId)}:{' '}
            <span className={cx('wf-chron__state', `wf-chron__state--${status}`)}>
              {FATE_LABEL[status]}
            </span>
          </>
        ),
        ids: [entityId],
      };
    }
    case 'whereabouts': {
      if (!entry.whereabouts) break;
      const { entityId, placeId } = entry.whereabouts;
      const character = data.entities[entityId]?.kind === 'character';
      return {
        node: (
          <span className="wf-row-wrap" style={{ gap: 8 }}>
            {link(entityId)}
            <ArrowRight width={14} height={14} className="wf-mute" />
            {placeId ? (
              link(placeId)
            ) : (
              <span className="wf-mute">{character ? 'wieder bei der Gruppe' : 'unbekannt'}</span>
            )}
          </span>
        ),
        ids: [entityId, placeId],
      };
    }
    case 'discovery':
      if (!entry.placeId || !data.entities[entry.placeId]) break;
      return { node: <>Entdeckt: {link(entry.placeId)}</>, ids: [entry.placeId] };
    case 'rumor': {
      const source = entry.rumor?.sourceId;
      if (!source) return { node: null, ids: [] };
      return { node: <>Gerücht von {link(source)}</>, ids: [source] };
    }
    case 'bond': {
      if (!entry.bond) break;
      const { fromId, toId, ended } = entry.bond;
      return {
        node: (
          <>
            {ended && <span className="wf-mute">Beziehung beendet: </span>}
            {link(fromId)} <span className="wf-mute">{relationLabel(entry.bond, 'from')}</span>{' '}
            {link(toId)}
          </>
        ),
        ids: [fromId, toId],
      };
    }
    case 'condition': {
      if (!entry.condition) break;
      const { entityId, ended } = entry.condition;
      return {
        node: ended ? (
          <>
            Zustand von {link(entityId)} <span className="wf-mute">aufgehoben</span>
          </>
        ) : (
          <>Zustand von {link(entityId)}</>
        ),
        ids: [entityId],
      };
    }
    case 'promise': {
      if (!isJob(entry)) break;
      const client = named(data, entry)[0];
      return {
        node: client ? <>Auftrag von {link(client)}</> : 'Auftrag',
        ids: client ? [client] : [],
      };
    }
    case 'writing': {
      const title = entry.writing?.title.trim();
      const article = entry.writing?.articleId ? data.articles[entry.writing.articleId] : undefined;
      if (!title && !article) break;
      return {
        node: article ? (
          <>
            Schriftstück:{' '}
            <RouteLink href={`/wiki/${article.id}`} title="Als Artikel im Wiki abgelegt">
              {title || article.title}
            </RouteLink>
          </>
        ) : (
          <>Schriftstück: {title}</>
        ),
        ids: [],
      };
    }
    case 'downtime':
      return {
        node: entry.downtime?.days
          ? `Zwischenzeit: ${daysLabel(entry.downtime.days)}`
          : 'Zwischenzeit',
        ids: (entry.downtime?.activities ?? []).map((a) => a.characterId),
      };
    case 'transformation': {
      if (!entry.transformation) break;
      const id = entry.transformation.characterId;
      return { node: <>Wandlung: {link(id)}</>, ids: [id] };
    }
    case 'companion': {
      if (!entry.companion) break;
      const { entityId, ownerId, joined } = entry.companion;
      return {
        node: (
          <>
            {link(entityId)} <span className="wf-mute">{joined ? 'begleitet' : 'verlässt'}</span>{' '}
            {ownerId ? link(ownerId) : 'die Gruppe'}
          </>
        ),
        ids: [entityId, ownerId],
      };
    }
    case 'milestone': {
      if (!entry.milestone) break;
      const { characterId, level } = entry.milestone;
      return {
        node:
          level !== null ? (
            <>
              {link(characterId)} erreicht Stufe <span className="wf-num">{level}</span>
            </>
          ) : (
            <>Meilenstein für {link(characterId)}</>
          ),
        ids: [characterId],
      };
    }
    default:
      break;
  }
  return { node: recordHeadline(data, entry) || null, ids: [] };
}

/** Stand eines Gerüchts – ungeprüft, stimmt, falsch – zum Umschalten, wie bei einer Abmachung. */
function RumorTruthSwitch({ entry }: { entry: ChronicleEntry }) {
  const db = useDb();
  const truth = entry.rumor?.truth ?? 'unchecked';
  return (
    <div className="wf-chron__truth" role="group" aria-label="Stand des Gerüchts">
      {RUMOR_TRUTHS.map((value) => (
        <button
          key={value}
          type="button"
          className={cx('wf-chron__truth-btn', `wf-chron__truth-btn--${value}`)}
          aria-pressed={truth === value}
          onClick={() => truth !== value && setRumorTruth(db, entry.id, value)}
        >
          {RUMOR_TRUTH_LABEL[value]}
        </button>
      ))}
    </div>
  );
}

/** Ein Zustand: wann er aufgehoben wurde – oder ein Knopf, der ihn jetzt aufhebt. */
function ConditionState({ entry }: { entry: ChronicleEntry }) {
  const db = useDb();
  const data = useData();
  const ending = conditionEnding(data, entry.id);
  if (ending)
    return (
      <div className="wf-chron__promise wf-mute">
        Aufgehoben am {formatDayMonth(data.campaign.calendar, ending.at)}
      </div>
    );
  const end = () => {
    const result = endCondition(db, entry.id);
    if ('problem' in result) {
      toast({ title: 'Nicht aufgehoben', body: result.problem, tone: 'danger' });
      return;
    }
    toast({
      title: 'Zustand aufgehoben',
      body: entry.text.slice(0, 120),
      action: { label: 'Rückgängig', run: result.undo },
    });
  };
  return (
    <div className="wf-chron__promise">
      <span className="wf-mute">Besteht noch</span>
      <Button
        size="sm"
        variant="ghost"
        onClick={end}
        title="Hält jetzt fest, dass er vorbei ist"
        aria-label={`Zustand „${entry.text}“ aufheben`}
      >
        Aufheben
      </Button>
    </div>
  );
}

export function ChronicleItem({ entry, showDate, hideRefs = [], onEdit }: ChronicleItemProps) {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const Icon = chronicleEntryIcon(entry);
  const { node: headline, ids: headlineIds } = headlineOf(data, entry);
  const refs = entry.refs.filter(
    (id) => !hideRefs.includes(id) && id !== entry.placeId && !headlineIds.includes(id),
  );
  const showPlace =
    entry.placeId &&
    !hideRefs.includes(entry.placeId) &&
    entry.kind !== 'travel' &&
    !headlineIds.includes(entry.placeId);

  const story = entry.storyId ? data.stories[entry.storyId] : undefined;
  const promise = entry.kind === 'promise' ? entry.promise : null;
  const outcome = promiseOutcome(promise);
  const overdue = promise && !promise.done && promise.due !== null && promise.due < data.state.now;
  const conditionStart = entry.kind === 'condition' && !!entry.condition && !entry.condition.ended;

  return (
    <article
      className={cx(
        'wf-chron',
        `wf-chron--${entry.kind}`,
        promise?.done && 'wf-chron--done',
        outcome === 'failed' && 'wf-chron--failed',
        entry.kind === 'rumor' && entry.rumor?.truth === 'false' && 'wf-chron--disproved',
      )}
    >
      <div className="wf-chron__mark" title={chronicleEntryLabel(entry)}>
        <Icon />
      </div>
      <div className="wf-chron__body">
        <div className="wf-chron__meta">
          {showDate && <span>{formatDate(cal, entry.at)}</span>}
          <span className="wf-num">{formatClock(entry.at)}</span>
          {entry.kind !== 'note' && <span>{chronicleEntryLabel(entry)}</span>}
          {isApproximate(entry) && (
            <span title="Der Zeitpunkt ist nur ungefähr bekannt">ungefähr</span>
          )}
          {story && (
            <span className="wf-chron__story" title="Zu dieser Geschichte notiert">
              {story.title}
            </span>
          )}
          {showPlace && (
            <span>
              <EntityLink id={entry.placeId} icon={false} />
            </span>
          )}
        </div>
        {headline && <div className="wf-chron__headline">{headline}</div>}
        {entry.text && entry.kind !== 'event' && (
          <div className="wf-chron__text wf-prose">
            {entry.kind === 'quote' ? `„${entry.text}“` : entry.text}
          </div>
        )}
        {entry.kind === 'downtime' && !!entry.downtime?.activities.length && (
          <ul className="wf-chron__activities" aria-label="Tätigkeiten">
            {entry.downtime.activities.map((activity, i) => (
              <li key={i}>
                <EntityLink id={activity.characterId} icon={false} />
                <span className="wf-mute">: </span>
                {activity.text}
              </li>
            ))}
          </ul>
        )}
        {entry.kind === 'rumor' && <RumorTruthSwitch entry={entry} />}
        {conditionStart && <ConditionState entry={entry} />}
        {promise && (
          <div className="wf-chron__promise">
            {outcome !== 'failed' && (
              <button
                type="button"
                className="wf-chron__check"
                aria-pressed={outcome === 'kept'}
                title={
                  outcome === 'kept' ? 'Wieder öffnen' : 'Erledigt – die Abmachung wurde eingelöst'
                }
                aria-label={outcome === 'kept' ? 'Wieder öffnen' : 'Als erledigt abhaken'}
                onClick={() =>
                  setPromiseOutcome(db, entry.id, outcome === 'kept' ? 'open' : 'kept')
                }
              >
                {outcome === 'kept' && <Check />}
              </button>
            )}
            {outcome !== 'kept' && (
              <button
                type="button"
                className="wf-chron__check wf-chron__check--fail"
                aria-pressed={outcome === 'failed'}
                title={
                  outcome === 'failed'
                    ? 'Wieder öffnen'
                    : 'Gescheitert – gebrochen, geplatzt oder nicht mehr einzulösen'
                }
                aria-label={outcome === 'failed' ? 'Wieder öffnen' : 'Als gescheitert abhaken'}
                onClick={() =>
                  setPromiseOutcome(db, entry.id, outcome === 'failed' ? 'open' : 'failed')
                }
              >
                <X />
              </button>
            )}
            <span
              className={
                overdue
                  ? 'wf-chron__overdue'
                  : outcome === 'failed'
                    ? 'wf-chron__failed'
                    : 'wf-mute'
              }
            >
              {promise.done
                ? PROMISE_OUTCOME_LABEL[outcome]
                : promise.due === null
                  ? 'Offen, ohne Frist'
                  : `Frist: ${formatDayMonth(cal, promise.due)} (${formatRelative(data.state.now, promise.due)})`}
            </span>
          </div>
        )}
        {refs.length > 0 && (
          <div className="wf-chron__refs">
            {refs.map((id) => (
              <EntityLink key={id} id={id} />
            ))}
          </div>
        )}
      </div>
      {onEdit && (
        <IconButton
          label="Eintrag bearbeiten"
          size="sm"
          variant="ghost"
          className="wf-chron__edit"
          onClick={() => onEdit(entry)}
        >
          <Pencil />
        </IconButton>
      )}
    </article>
  );
}

/** Mehrere Einträge untereinander. `newestFirst` dreht die Reihenfolge um. */
export function ChronicleList({
  entries,
  newestFirst,
  empty,
  ...item
}: {
  entries: ChronicleEntry[];
  newestFirst?: boolean;
  /** Was erscheint, wenn es keine Einträge gibt. */
  empty?: ReactNode;
} & Omit<ChronicleItemProps, 'entry'>) {
  if (!entries.length) return <>{empty ?? null}</>;
  const list = newestFirst ? [...entries].reverse() : entries;
  return (
    <div className="wf-chron-list">
      {list.map((entry) => (
        <ChronicleItem key={entry.id} entry={entry} {...item} />
      ))}
    </div>
  );
}

/**
 * Offene Zustände einer Person oder eines Gefährten („Pfeil im Bein“, „verflucht“) mit dem Tag,
 * seit dem sie bestehen, und einem Knopf zum Aufheben. Nichts, wenn keiner offen ist.
 */
export function OpenConditions({ entityId }: { entityId: string }) {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const open = activeConditions(data, entityId);
  if (!open.length) return null;
  const since = (at: number) =>
    fromTime(cal, at).year === fromTime(cal, data.state.now).year
      ? formatDayMonth(cal, at)
      : formatDate(cal, at);
  const end = (entry: ChronicleEntry) => {
    const result = endCondition(db, entry.id);
    if ('problem' in result) {
      toast({ title: 'Nicht aufgehoben', body: result.problem, tone: 'danger' });
      return;
    }
    toast({
      title: 'Zustand aufgehoben',
      body: entry.text.slice(0, 120),
      action: { label: 'Rückgängig', run: result.undo },
    });
  };
  return (
    <ul className="wf-chron-conditions" aria-label="Offene Zustände">
      {open.map(({ entry, since: at }) => (
        <li key={entry.id}>
          <Bandage aria-hidden />
          <span className="wf-chron-conditions__text">{entry.text}</span>
          <span className="wf-mute">seit {since(at)}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => end(entry)}
            aria-label={`Zustand „${entry.text}“ aufheben`}
          >
            Aufheben
          </Button>
        </li>
      ))}
    </ul>
  );
}
