/**
 * Bausteine der Seite eines Dings (`Dossier.tsx`): was jetzt gilt (wo die Gruppe ist, wer hier
 * ist, wo eine Person ist, Haltung), was darin oder dazu gehört (Orte darin, Mitglieder, Besitz),
 * Beziehungen knapp, „Zuletzt“ aus der Chronik und die Zeile „Hinzufügen: …“. Welcher Baustein
 * wo steht, sagt `pagePlan` (`page.ts`).
 */
import { Children, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'wouter';
import {
  ArrowRight,
  EyeOff,
  Feather,
  Footprints,
  Home,
  Plus,
  Skull,
  Sparkles,
  Store,
  Users,
} from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { fateSinceLabel } from '../../domain/chronicleKinds';
import {
  attitudeHistory,
  attitudeToParty,
  entityName,
  mateAttitudes,
  openPromises,
  personPlace,
  placeCast,
  placeChildren,
  placePath,
  placeStatus,
  signedAttitude,
} from '../../domain/derive';
import { whereaboutsSince } from '../../domain/history';
import { hasStance } from '../../domain/known';
import { creatureOfAnimal } from '../../domain/nature';
import { RULES_ATTITUDE_LABEL, attitudeLevel, shownAttitude } from '../../domain/relations';
import {
  PARTY_ID,
  PERSON_STATUS,
  createEntity,
  type Animal,
  type CampaignData,
  type Entity,
  type Faction,
  type Family,
  type Item,
  type Language,
  type Person,
  type PersonStatus,
  type Place,
  type Shop,
  type Ability,
  type Profession,
  type Script,
  type Species,
} from '../../domain/schema';
import { shopTitle, shopsOf } from '../../domain/shop';
import { formatClock, formatRelative } from '../../domain/time/calendar';
import { tracksOf } from '../../domain/track';
import { openAttitude, openQuickLog } from '../../shell/commands';
import {
  AttitudeBadge,
  Badge,
  Button,
  Checkbox,
  ChronicleList,
  EntityLink,
  Field,
  IconButton,
  OpenConditions,
  Select,
  toast,
} from '../../ui';
import { TrackCard } from '../fortschritt/TrackCard';
import { movePartyTo, patchDetails } from './actions';
import { openEntityDialog } from './editor';
import { houseMembers } from './house';
import {
  CAST_PREVIEW,
  PERSON_STATUS_LABEL,
  castSubline,
  describeVisit,
  formatShortDate,
  itemsHeldBy,
  languagesInScript,
  linkedFrom,
  linkedSubline,
  memberGroups,
  partyAttitudes,
  recentChronicle,
  relationRows,
  speciesMembers,
  upcomingFor,
  workersAt,
  type Member,
} from './model';
import { ADD_LABEL, type AddKey } from './page';
import { shopToOwnPlace } from './pageActions';
import { AttitudePips, EntryRow, Hint, Picker, Section, UpcomingList, attitudeVar } from './parts';
import { RelationQuick } from './RelationQuick';

/** Reiter der Seite – nur noch für Seltenes. */
export type PageTab = 'page' | 'relations' | 'tree' | 'chronicle';
/** Was der Reiter „Beziehungen“ beim Öffnen gleich anbietet. */
export type RelationIntent = 'relation' | 'member';
export type ShowTab = (tab: PageTab, intent?: RelationIntent) => void;

const createPlaceNamed = (db: ReturnType<typeof useDb>) => (name: string) =>
  db.put('entities', createEntity({ kind: 'place', name })).id;

// ── Ort ────────────────────────────────────────────────────────────────────

/** Wer an diesem Ort eine Rolle spielt: anwesend, zu Hause, tot, Fraktionen, Arbeit, verbunden. */
export function CastSection({ place }: { place: Place }) {
  const data = useData();
  const cast = placeCast(data, place.id);
  const attitudes = partyAttitudes(data);
  const attitude = (id: string) => attitudes.get(id) ?? null;
  const shown = new Set([...cast.present, ...cast.away, ...cast.lost].map((p) => p.id));
  // Wer hier arbeitet, aber weder hier ist noch hier wohnt.
  const workers = workersAt(data, place.id).filter((p) => !shown.has(p.id));
  const workerIds = new Set(workers.map((p) => p.id));
  const linked = cast.linked.filter((link) => !workerIds.has(link.entity.id));
  const castCount =
    cast.present.length +
    cast.away.length +
    cast.lost.length +
    workers.length +
    cast.factions.length +
    linked.length +
    cast.characters.length;
  const createPerson = () =>
    openEntityDialog({
      mode: 'create',
      kind: 'person',
      preset: { placeId: place.id, homeId: place.id },
    });

  return (
    <Section
      title="Wer hier ist"
      count={castCount || undefined}
      action={
        castCount > 0 && (
          <Button size="sm" variant="ghost" icon={<Plus />} onClick={createPerson}>
            Person
          </Button>
        )
      }
    >
      {castCount === 0 ? (
        <Hint
          action={
            <Button size="sm" icon={<Plus />} onClick={createPerson}>
              Person hier anlegen
            </Button>
          }
        >
          Noch niemand. Hier steht, wer sich hier aufhält, hier zu Hause ist oder seinen Sitz hat.
        </Hint>
      ) : (
        <div className="wf-welt-cast">
          {cast.present.length > 0 && (
            <CastGroup label="Anwesend" count={cast.present.length}>
              {cast.present.map((p) => (
                <EntryRow
                  key={p.id}
                  entity={p}
                  sub={castSubline(data, p, place.id)}
                  attitude={attitude(p.id)}
                />
              ))}
            </CastGroup>
          )}
          {cast.characters.length > 0 && (
            <CastGroup label="Gefährten, abseits der Gruppe" count={cast.characters.length}>
              {cast.characters.map((c) => (
                <EntryRow key={c.id} entity={c} />
              ))}
            </CastGroup>
          )}
          {cast.away.length > 0 && (
            <CastGroup label="Hier zu Hause, aber fort" count={cast.away.length}>
              {cast.away.map((p) => (
                <EntryRow
                  key={p.id}
                  entity={p}
                  sub={castSubline(data, p, place.id, true)}
                  attitude={attitude(p.id)}
                />
              ))}
            </CastGroup>
          )}
          {cast.lost.length > 0 && (
            <CastGroup label="Tot oder verschollen" count={cast.lost.length}>
              {cast.lost.map((p) => (
                <EntryRow
                  key={p.id}
                  entity={p}
                  sub={castSubline(data, p, place.id)}
                  attitude={attitude(p.id)}
                />
              ))}
            </CastGroup>
          )}
          {cast.factions.length > 0 && (
            <CastGroup label="Fraktionen mit Sitz hier" count={cast.factions.length}>
              {cast.factions.map((f) => (
                <EntryRow
                  key={f.id}
                  entity={f}
                  sub={[
                    f.faction.category,
                    f.faction.seatId !== place.id && entityName(data, f.faction.seatId),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  attitude={attitude(f.id)}
                />
              ))}
            </CastGroup>
          )}
          {workers.length > 0 && (
            <CastGroup label="Arbeiten hier" count={workers.length}>
              {workers.map((p) => (
                <EntryRow
                  key={p.id}
                  entity={p}
                  sub={castSubline(data, p, place.id, true)}
                  attitude={attitude(p.id)}
                />
              ))}
            </CastGroup>
          )}
          {linked.length > 0 && (
            <CastGroup label="Verbunden" count={linked.length}>
              {linked.map((link) => (
                <EntryRow
                  key={link.relation.id}
                  entity={link.entity}
                  sub={linkedSubline(data, place.id, link)}
                  attitude={shownAttitude(link.entity.kind, attitude(link.entity.id))}
                />
              ))}
            </CastGroup>
          )}
        </div>
      )}
    </Section>
  );
}

function CastGroup({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: ReactNode;
}) {
  // In einer großen Stadt stehen Dutzende Leute – der Rest der Seite soll erreichbar bleiben.
  const [showAll, setShowAll] = useState(false);
  const rows = Children.toArray(children);
  const shown = showAll || rows.length <= CAST_PREVIEW + 2 ? rows : rows.slice(0, CAST_PREVIEW);
  return (
    <div className="wf-welt-cast__group">
      <div className="wf-welt-cast__label">
        {label} <span>{count}</span>
      </div>
      <div className="wf-welt-rows">{shown}</div>
      {rows.length > shown.length && (
        <Button
          size="sm"
          variant="ghost"
          className="wf-welt-cast__more"
          onClick={() => setShowAll(true)}
        >
          Weitere {rows.length - shown.length} anzeigen
        </Button>
      )}
    </div>
  );
}

/** Gegenstände an diesem Ort und den Orten darin – nur, wenn es welche gibt. */
export function PlaceItems({ place }: { place: Place }) {
  const data = useData();
  const items = itemsHeldBy(data, place.id);
  if (!items.length) return null;
  return (
    <Section title="Gegenstände hier" count={items.length}>
      <div className="wf-welt-rows">
        {items.map((item) => (
          <EntryRow
            key={item.id}
            entity={item}
            sub={[
              item.item.category,
              item.item.holderId !== place.id && entityName(data, item.item.holderId),
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        ))}
      </div>
    </Section>
  );
}

export function PartyAtPlace({ place, onShowTab }: { place: Place; onShowTab: ShowTab }) {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const status = placeStatus(data, place.id);
  const partyPlaceId = data.state.placeId;
  const exactlyHere = partyPlaceId === place.id;
  const visits = [...status.visits].reverse().map((stay) => describeVisit(cal, now, stay));
  const current = visits.find((v) => v.ongoing);
  const last = visits.find((v) => !v.ongoing);
  const earlier = visits.filter((v) => !v.ongoing);
  const shown = earlier.slice(0, 3);
  const changes = status.changesSince.length;

  const move = () => {
    const result = movePartyTo(db, place.id);
    if (!result) return;
    toast({
      title: 'Die Gruppe ist jetzt hier',
      body: `${placePath(db.getSnapshot(), place.id)} – der Ortswechsel steht in der Chronik.`,
      action: { label: 'Rückgängig', run: result.undo },
    });
  };

  return (
    <Section title="Die Gruppe">
      <div className="wf-welt-party" data-here={status.here}>
        <Footprints />
        <div className="wf-grow">
          {current ? (
            <>
              <div className="wf-welt-party__state">Ist gerade hier</div>
              <div className="wf-welt-party__sub">
                seit {current.from}, {formatClock(current.stay.from)}
                {current.stay.from < now && ` · ${current.duration}`}
                {!exactlyHere && partyPlaceId && ` · in ${entityName(data, partyPlaceId)}`}
              </div>
            </>
          ) : last ? (
            <>
              <div className="wf-welt-party__state">Zuletzt hier {last.ago}</div>
              <div className="wf-welt-party__sub">
                {visits.length === 1 ? 'Ein Besuch bisher' : `${visits.length} Besuche bisher`}
              </div>
              {changes > 0 && (
                <button
                  type="button"
                  className="wf-welt-party__changes"
                  onClick={() =>
                    document
                      .querySelector('.wf-welt-sec--changes')
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }
                >
                  <Sparkles />
                  {changes === 1 ? 'Seitdem eine Veränderung' : `Seitdem ${changes} Veränderungen`}
                </button>
              )}
            </>
          ) : (
            <>
              <div className="wf-welt-party__state">Noch nie hier gewesen</div>
            </>
          )}
        </div>
      </div>
      {!exactlyHere && (
        <Button size="sm" icon={<ArrowRight />} onClick={move} className="wf-welt-party__move">
          Gruppe hierher
        </Button>
      )}
      {shown.length > 0 && (
        <ul className="wf-welt-visits">
          {shown.map((visit) => (
            <li key={visit.stay.from}>
              <span className="wf-welt-visits__when">
                {visit.from}
                {visit.to && ` – ${visit.to}`}
              </span>
              <span className="wf-welt-visits__dur">{visit.duration}</span>
            </li>
          ))}
          {earlier.length > shown.length && (
            <li>
              <button
                type="button"
                className="wf-welt-linkish"
                onClick={() => onShowTab('chronicle')}
              >
                und {earlier.length - shown.length} frühere – im Verlauf
              </button>
            </li>
          )}
        </ul>
      )}
    </Section>
  );
}

/** Seit dem letzten Besuch der Gruppe – nur, wenn sie schon einmal hier war und fort ist. */
export function ChangesSince({ place }: { place: Place }) {
  const data = useData();
  const status = placeStatus(data, place.id);
  if (status.lastLeft === null || (status.here && !status.changesSince.length)) return null;
  const cal = data.campaign.calendar;
  const left = formatShortDate(cal, data.state.now, status.lastLeft);
  const logChange = () => openQuickLog({ kind: 'change', refs: [place.id] });
  return (
    <Section
      className="wf-welt-sec--changes"
      title="Seitdem verändert"
      count={status.changesSince.length || undefined}
      action={
        <IconButton label="Veränderung festhalten" size="sm" variant="ghost" onClick={logChange}>
          <Plus />
        </IconButton>
      }
    >
      <p className="wf-welt-lead">
        {status.here
          ? `Was geschah, während die Gruppe fort war – vom Aufbruch am ${left} bis zur Rückkehr.`
          : `Seit dem Aufbruch am ${left}:`}
      </p>
      <ChronicleList
        entries={status.changesSince}
        showDate
        hideRefs={[place.id]}
        empty={<p className="wf-welt-quiet">Seither ist hier nichts festgehalten.</p>}
      />
    </Section>
  );
}

/** Orte darin – mit dem Zeichen „Laden“, wo einer steht. Räume stehen unter „Räume“. */
export function PlacesBelow({ place }: { place: Place }) {
  const data = useData();
  const children = placeChildren(data, place.id).filter((child) => !child.place.room);
  const create = () =>
    openEntityDialog({ mode: 'create', kind: 'place', preset: { parentId: place.id } });
  return (
    <Section
      title="Darin"
      count={children.length || undefined}
      action={
        <Button size="sm" variant="ghost" icon={<Plus />} onClick={create}>
          Ort
        </Button>
      }
    >
      {children.length ? (
        <div className="wf-welt-rows wf-welt-rows--grid">
          {children.map((child) => {
            const shops = shopsOf(data, child.id).filter((shop) => shop.placeId === child.id);
            return (
              <EntryRow
                key={child.id}
                entity={child}
                aside={
                  child.id === data.state.placeId ? (
                    <Badge tone="gold" icon={<Footprints />}>
                      Gruppe
                    </Badge>
                  ) : shops.length ? (
                    <Badge icon={<Store />} title={shops.map((s) => shopTitle(data, s)).join(', ')}>
                      {shops.some((s) => s.market) ? 'Handelsplatz' : 'Laden'}
                    </Badge>
                  ) : undefined
                }
              />
            );
          })}
        </div>
      ) : (
        <p className="wf-welt-quiet">Noch keine Orte darin.</p>
      )}
    </Section>
  );
}

/**
 * Läden, die direkt an diesem Ort stehen, obwohl er eine Gegend ist (eine Stadt, ein Viertel):
 * knapp genannt, mit dem Vorschlag, dem Laden einen eigenen Ort zu geben – nur auf Klick.
 */
export function ShopsHere({ shops }: { shops: Shop[] }) {
  const db = useDb();
  const data = useData();
  const own = (shop: Shop) => {
    const result = shopToOwnPlace(db, shop.id);
    if (!result) {
      toast({
        title: 'Nicht angelegt',
        body: `„${shopTitle(data, shop)}“ ist schon der Name eines Eintrags anderer Art.`,
      });
      return;
    }
    toast({
      title: result.created
        ? `„${shopTitle(data, shop)}“ ist jetzt ein Ort hier`
        : `Der Laden steht jetzt in „${entityName(db.getSnapshot(), result.placeId)}“`,
      body: 'Auf seiner Seite ist der Laden das Erste, was man sieht.',
      action: { label: 'Rückgängig', run: result.undo },
    });
  };
  return (
    <Section title={shops.some((s) => s.market) ? 'Läden und Handelsplätze' : 'Läden'}>
      <ul className="wf-welt-shophere">
        {shops.map((shop) => (
          <li key={shop.id}>
            <Store aria-hidden />
            <span className="wf-grow">
              {shopTitle(data, shop)}
              <span className="wf-welt-shophere__sub">
                {shop.stock.length === 1 ? 'eine Ware' : `${shop.stock.length} Waren`}
              </span>
            </span>
            <button type="button" className="wf-welt-linkish" onClick={() => own(shop)}>
              als eigenen Ort anlegen
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ── Gemeinsame Abschnitte ──────────────────────────────────────────────────

/** Kommende Termine – nur, wenn es welche gibt. */
export function Upcoming({ entity }: { entity: Entity }) {
  const data = useData();
  const upcoming = upcomingFor(data, entity.id);
  if (!upcoming.length) return null;
  return (
    <Section title="Kommende Termine" count={upcoming.length}>
      <UpcomingList occurrences={upcoming} />
    </Section>
  );
}

/**
 * Haltung zur Gruppe und, wo sie abweicht, zu einzelnen Gefährten – mit dem Verlauf auf Klick.
 * Das Erste, was man am Tisch über eine Person wissen will.
 */
export function AttitudeNow({ entity }: { entity: Entity }) {
  const data = useData();
  const [trail, setTrail] = useState(false);
  const value = attitudeToParty(data, entity.id);
  const level = attitudeLevel(value);
  const history = [...attitudeHistory(data, entity.id, PARTY_ID)].reverse();
  const last = history[0];
  const mates = mateAttitudes(data, entity.id);
  const cal = data.campaign.calendar;
  return (
    <Section
      title="Haltung"
      action={
        <Button size="sm" variant="ghost" onClick={() => openAttitude({ fromId: entity.id })}>
          {level ? 'Ändern' : 'Festlegen'}
        </Button>
      }
    >
      <div
        className="wf-welt-attnow"
        style={{ '--att-color': attitudeVar(value) } as CSSProperties}
      >
        <div className="wf-welt-attnow__line">
          <span className="wf-welt-attnow__to">zur Gruppe</span>
          <AttitudeBadge value={value} />
          <AttitudePips value={value} />
        </div>
        {mates.length > 0 && (
          <div className="wf-welt-attnow__mates">
            {mates.map((mate) => (
              <span key={mate.id}>
                zu {mate.name} <strong>{signedAttitude(mate.value)}</strong>
              </span>
            ))}
          </div>
        )}
        <div className="wf-welt-attnow__note">
          {level ? (
            <>
              Nach Regelwerk: {RULES_ATTITUDE_LABEL[level.rules].toLowerCase()}
              {last && ` · geändert ${formatRelative(data.state.now, last.at)}`}
            </>
          ) : (
            'Noch nicht festgelegt.'
          )}
        </div>
        {history.length > 0 && (
          <button
            type="button"
            className="wf-welt-linkish"
            aria-expanded={trail}
            onClick={() => setTrail((open) => !open)}
          >
            {trail ? 'Verlauf zuklappen' : `Verlauf (${history.length})`}
          </button>
        )}
        {trail && (
          <ol className="wf-welt-trail">
            {history.map((entry) => (
              <li key={entry.id}>
                <span className="wf-welt-trail__when">
                  {formatShortDate(cal, data.state.now, entry.at)}
                </span>
                <span className="wf-welt-trail__change">
                  <AttitudeBadge value={entry.attitude?.before ?? null} />
                  <ArrowRight width={14} height={14} />
                  <AttitudeBadge value={entry.attitude?.after ?? null} />
                </span>
                <span className="wf-welt-trail__why">
                  {entry.text || 'ohne Grund festgehalten'}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Section>
  );
}

/** Fortschrittsleisten dieses Eintrags – nur, wenn es welche gibt. */
export function Tracks({ entity }: { entity: Entity }) {
  const data = useData();
  const tracks = tracksOf(data, entity.id);
  if (!tracks.length) return null;
  return (
    <Section title="Fortschritt" count={tracks.length}>
      <div className="wf-welt-tracks">
        {tracks.map((track) => (
          <TrackCard key={track.id} track={track} />
        ))}
      </div>
    </Section>
  );
}

export function Promises({ entity }: { entity: Entity }) {
  const data = useData();
  const promises = openPromises(data, entity.id);
  const add = () => openQuickLog({ kind: 'promise', refs: [entity.id] });
  if (!promises.length) return null;
  return (
    <Section
      title="Offene Abmachungen"
      count={promises.length}
      action={
        <Button size="sm" variant="ghost" icon={<Plus />} onClick={add}>
          Abmachung
        </Button>
      }
    >
      <ChronicleList entries={promises} showDate hideRefs={[entity.id]} />
    </Section>
  );
}

/** „Zuletzt“: die jüngsten Einträge der Chronik, der ganze Verlauf auf Klick. */
export function RecentChronicle({ entity, onShowTab }: { entity: Entity; onShowTab: ShowTab }) {
  const data = useData();
  const { entries, total } = recentChronicle(data, entity.id);
  return (
    <Section
      title="Zuletzt"
      action={
        total > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onShowTab('chronicle')}>
            Verlauf ansehen
          </Button>
        )
      }
    >
      <ChronicleList
        entries={entries}
        newestFirst
        showDate
        hideRefs={[entity.id]}
        empty={
          <p className="wf-welt-quiet">
            {total > 0
              ? 'Sonst nichts – das Übrige steht schon oben.'
              : 'Noch nichts festgehalten.'}
          </p>
        }
      />
    </Section>
  );
}

/**
 * Beziehungen knapp: „führt Haus Duskryn“ – „+ Beziehung“ öffnet den schlanken Dialog
 * (`RelationQuick`), alle und zum Ändern stehen im Reiter „Beziehungen“.
 */
export function Connections({
  entity,
  onShowTab,
  title = 'Beziehungen',
  skip = [],
}: {
  entity: Entity;
  onShowTab: ShowTab;
  title?: string;
  /** Gegenüber, die die Seite schon an anderer Stelle zeigt. */
  skip?: string[];
}) {
  const data = useData();
  const [adding, setAdding] = useState(false);
  const rows = relationRows(data, entity.id).filter(
    (r) => r.otherId !== PARTY_ID && !r.ended && r.entity && !skip.includes(r.otherId),
  );
  const shown = rows.slice(0, 8);
  return (
    <Section
      title={title}
      count={rows.length || undefined}
      action={
        <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setAdding(true)}>
          Beziehung
        </Button>
      }
    >
      {adding && <RelationQuick self={entity} onClose={() => setAdding(false)} />}
      {shown.length ? (
        <ul className="wf-welt-ties">
          {shown.map((row) => (
            <li key={row.otherId}>
              <span className="wf-welt-ties__label">{row.label}</span>
              <EntityLink id={row.otherId} />
              {row.secret && <EyeOff className="wf-welt-entry__secret" aria-label="Geheim" />}
            </li>
          ))}
          {rows.length > shown.length && (
            <li>
              <button
                type="button"
                className="wf-welt-linkish"
                onClick={() => onShowTab('relations')}
              >
                und {rows.length - shown.length} weitere
              </button>
            </li>
          )}
        </ul>
      ) : (
        <p className="wf-welt-quiet">Noch keine.</p>
      )}
    </Section>
  );
}

export function Belongings({ entity, title }: { entity: Entity; title: string }) {
  const data = useData();
  const items = itemsHeldBy(data, entity.id);
  if (!items.length) return null;
  return (
    <Section title={title} count={items.length}>
      <div className="wf-welt-rows">
        {items.map((item) => (
          <EntryRow key={item.id} entity={item} sub={item.item.category || item.tagline} />
        ))}
      </div>
    </Section>
  );
}

// ── Person ─────────────────────────────────────────────────────────────────

/** Wo eine Person ist und wie es ihr geht. Das Zuhause nur, wenn es nicht im Steckbrief steht. */
export function Whereabouts({ person, homeInBox }: { person: Person; homeInBox: boolean }) {
  const db = useDb();
  const data = useData();
  const { placeId, homeId, status, met } = person.person;
  const partyPlaceId = data.state.placeId;
  const fateLabel = fateSinceLabel(data, person.id);
  const stay = whereaboutsSince(data, person.id);
  const staySince = stay
    ? `Seit ${formatShortDate(data.campaign.calendar, data.state.now, stay.since)}`
    : undefined;
  const createPlace = createPlaceNamed(db);
  // Gelesen wird ein Satz; geändert erst nach „Ändern“ (Rundgang 17. 11.: lauter offene Felder).
  const [editing, setEditing] = useState(false);
  if (!editing)
    return (
      <Section
        title="Wo sie ist"
        action={
          <button type="button" className="wf-welt-box__toggle" onClick={() => setEditing(true)}>
            Ändern
          </button>
        }
      >
        <div className="wf-col" style={{ gap: 'var(--s-2)' }}>
          <p className="wf-welt-where">
            {placeId ? (
              <>
                Hält sich auf in <EntityLink id={placeId} icon={false} />
                {staySince && <span className="wf-mute"> · {staySince.toLowerCase()}</span>}
              </>
            ) : (
              <span className="wf-mute">Aufenthalt unbekannt</span>
            )}
            {homeId && !homeInBox && homeId !== placeId && (
              <>
                {' '}
                · zu Hause in <EntityLink id={homeId} icon={false} />
              </>
            )}
            {homeId && homeId === placeId && <span className="wf-mute"> · zu Hause</span>}
            {status !== 'alive' && (
              <b className="wf-welt-where__fate"> · {fateLabel ?? PERSON_STATUS_LABEL[status]}</b>
            )}
          </p>
          {status === 'alive' && (
            <div className="wf-row-wrap wf-welt-quick">
              {partyPlaceId && placeId !== partyPlaceId && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Users />}
                  title={`Nach ${entityName(data, partyPlaceId)}`}
                  onClick={() => patchDetails(db, person, { placeId: partyPlaceId })}
                >
                  Bei der Gruppe
                </Button>
              )}
              {homeId && placeId !== homeId && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Home />}
                  title={`Nach ${entityName(data, homeId)}`}
                  onClick={() => patchDetails(db, person, { placeId: homeId })}
                >
                  Zu Hause
                </Button>
              )}
            </div>
          )}
          <OpenConditions entityId={person.id} />
          {hasStance(data, person.id) || met ? null : (
            <Checkbox checked={met} onChange={(next) => patchDetails(db, person, { met: next })}>
              Die Gruppe kennt diese Person
            </Checkbox>
          )}
        </div>
      </Section>
    );
  return (
    <Section
      title="Wo sie ist"
      action={
        <button type="button" className="wf-welt-box__toggle" onClick={() => setEditing(false)}>
          Fertig
        </button>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-3)' }}>
        <Field label="Hält sich auf in" hint={staySince}>
          <Picker
            value={placeId}
            onChange={(next) => patchDetails(db, person, { placeId: next })}
            kinds={['place']}
            placeholder="Unbekannt – Ort wählen …"
            onCreate={createPlace}
          />
          <div className="wf-row-wrap wf-welt-quick">
            <Button
              size="sm"
              variant="ghost"
              icon={<Users />}
              disabled={!partyPlaceId || placeId === partyPlaceId}
              title={
                partyPlaceId
                  ? `Nach ${entityName(data, partyPlaceId)}`
                  : 'Die Gruppe hat keinen Aufenthaltsort'
              }
              onClick={() => patchDetails(db, person, { placeId: partyPlaceId })}
            >
              Bei der Gruppe
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Home />}
              disabled={!homeId || placeId === homeId}
              title={homeId ? `Nach ${entityName(data, homeId)}` : 'Kein Zuhause eingetragen'}
              onClick={() => patchDetails(db, person, { placeId: homeId })}
            >
              Zu Hause
            </Button>
          </div>
        </Field>
        {!homeInBox && (
          <Field label="Ist zu Hause in">
            <Picker
              value={homeId}
              onChange={(next) => patchDetails(db, person, { homeId: next })}
              kinds={['place']}
              placeholder="Kein Zuhause – Ort wählen …"
              onCreate={createPlace}
            />
          </Field>
        )}
        <Field label="Zustand" hint={fateLabel ?? undefined}>
          <Select
            value={status}
            onChange={(e) => patchDetails(db, person, { status: e.target.value as PersonStatus })}
          >
            {PERSON_STATUS.map((s) => (
              <option key={s} value={s}>
                {PERSON_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <OpenConditions entityId={person.id} />
        {hasStance(data, person.id) ? (
          // Wer eine Haltung zur Gruppe hat, ist ihr bekannt – das steht nur da.
          <span className="wf-welt-quiet">
            Die Gruppe kennt diese Person – sie hat eine Haltung zu ihr.
          </span>
        ) : (
          <Checkbox checked={met} onChange={(next) => patchDetails(db, person, { met: next })}>
            Die Gruppe kennt diese Person
          </Checkbox>
        )}
      </div>
    </Section>
  );
}

// ── Fraktion und Familie ───────────────────────────────────────────────────

/** Sitz einer Fraktion, Stammsitz einer Familie – als Auswahl, oder knapp, wenn der Steckbrief ihn nennt. */
export function SeatSection({ group, inBox }: { group: Faction | Family; inBox: boolean }) {
  const db = useDb();
  const seatId = group.kind === 'faction' ? group.faction.seatId : group.family.seatId;
  const title = group.kind === 'faction' ? 'Sitz' : 'Stammsitz';
  if (inBox)
    return seatId ? (
      <Section title={title}>
        <EntityLink id={seatId} />
      </Section>
    ) : null;
  return (
    <Section title={title}>
      <Picker
        value={seatId}
        onChange={(next) =>
          group.kind === 'faction'
            ? patchDetails(db, group, { seatId: next })
            : patchDetails(db, group, { seatId: next })
        }
        kinds={['place']}
        placeholder={`Kein ${title} – Ort wählen …`}
        onCreate={createPlaceNamed(db)}
      />
    </Section>
  );
}

/** Mitglieder einer Fraktion oder Familie, mit Haltung zur Gruppe. */
export function MemberList({ group }: { group: Faction | Family }) {
  const data = useData();
  const { family, service, split } = houseMembers(data, group);
  const groups = memberGroups(data, group.id);
  const attitudes = partyAttitudes(data);
  const [adding, setAdding] = useState(false);
  const rows = (members: Member[]) => (
    <div className="wf-welt-rows wf-welt-rows--grid">
      {members.map((member) => (
        <EntryRow
          key={member.entity.id}
          entity={member.entity}
          sub={[
            member.label,
            member.entity.kind === 'person' && member.entity.person.role,
            member.entity.kind === 'person' && entityName(data, personPlace(data, member.entity)),
          ]
            .filter(Boolean)
            .join(' · ')}
          attitude={shownAttitude(member.entity.kind, attitudes.get(member.entity.id))}
        />
      ))}
    </div>
  );
  const total = family.length + service.length;
  /** Familien und Fraktionen darin – ein Haus im Bund, eine Sippe im Orden. */
  const groupRows = groups.length > 0 && (
    <div className="wf-welt-service">
      <div className="wf-welt-service__head">
        {group.kind === 'faction' ? 'Häuser und Gruppen darin' : 'Gruppen darin'}{' '}
        <span>{groups.length}</span>
      </div>
      <div className="wf-welt-rows wf-welt-rows--grid">
        {groups.map((member) => (
          <EntryRow
            key={member.entity.id}
            entity={member.entity}
            sub={[
              member.label,
              member.entity.kind === 'family'
                ? member.entity.family.category || 'Familie'
                : member.entity.faction.category || 'Fraktion',
            ]
              .filter(Boolean)
              .join(' · ')}
            attitude={shownAttitude(member.entity.kind, attitudes.get(member.entity.id))}
          />
        ))}
      </div>
    </div>
  );
  return (
    <Section
      title={split ? 'Familie' : 'Mitglieder'}
      count={(split ? family.length : total) || undefined}
      action={
        <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setAdding(true)}>
          Mitglied
        </Button>
      }
    >
      {adding && <RelationQuick self={group} asMember onClose={() => setAdding(false)} />}
      {!split ? (
        total ? (
          rows(service)
        ) : groups.length ? null : (
          <p className="wf-welt-quiet">
            Noch keine. Wer zur Fraktion gehört, sie führt, ihr dient oder hier arbeitet – auch eine
            Familie –, steht hier.
          </p>
        )
      ) : (
        <>
          {family.length ? (
            rows(family)
          ) : (
            <p className="wf-welt-quiet">
              Noch niemand aus der Familie. Wer den Namen des Hauses trägt oder mit der Familie
              verwandt ist, steht hier.
            </p>
          )}
          {service.length > 0 && (
            <div className="wf-welt-service">
              <div className="wf-welt-service__head">
                Im Dienst des Hauses <span>{service.length}</span>
              </div>
              {rows(service)}
            </div>
          )}
        </>
      )}
      {groupRows}
    </Section>
  );
}

// ── Gegenstand ─────────────────────────────────────────────────────────────

/** Wer ihn hat – als Auswahl, oder knapp, wenn der Steckbrief den Besitzer nennt. */
export function HolderSection({ item, inBox }: { item: Item; inBox: boolean }) {
  const db = useDb();
  return (
    <Section title="Wer ihn hat">
      {inBox ? (
        item.item.holderId ? (
          <EntityLink id={item.item.holderId} />
        ) : (
          <p className="wf-welt-quiet">Unbekannt.</p>
        )
      ) : (
        <Picker
          value={item.item.holderId}
          onChange={(holderId) => patchDetails(db, item, { holderId })}
          kinds={['place', 'person', 'faction', 'character']}
          placeholder="Unbekannt – auswählen …"
        />
      )}
    </Section>
  );
}

// ── Spezies, Sprache, Schrift, Fähigkeit, Beruf ────────────────────────────

type KnowledgeEntity = Species | Language | Script | Ability | Profession;

/** Wer zu einer Spezies gehört, eine Sprache spricht, eine Schrift schreibt, eine Fähigkeit hat. */
const KNOWLEDGE: Record<
  KnowledgeEntity['kind'],
  { title: string; empty: string; people: (data: CampaignData, id: string) => Entity[] }
> = {
  species: {
    title: 'Vertreter',
    empty: 'Noch niemand. Die Spezies wählst du bei der Person.',
    people: (data, id) => speciesMembers(data, id),
  },
  language: {
    title: 'Sprechen sie',
    empty: 'Noch niemand. Wer sie spricht, trägst du bei der Person unter „Sprachen“ ein.',
    people: (data, id) => linkedFrom(data, id, 'speaks'),
  },
  script: {
    title: 'Schreiben sie',
    empty: 'Noch niemand – wer eine Beziehung „schreibt“ hat, steht hier.',
    people: (data, id) => linkedFrom(data, id, 'writes'),
  },
  profession: {
    title: 'Üben ihn aus',
    empty: 'Noch niemand. Wer ihn ausübt, trägst du bei der Person unter „Berufe“ ein.',
    people: (data, id) => linkedFrom(data, id, 'practises'),
  },
  ability: {
    title: 'Verfügen darüber',
    empty: 'Noch niemand. Wer sie hat, trägst du bei der Person unter „Fähigkeiten“ ein.',
    people: (data, id) => linkedFrom(data, id, 'has-ability'),
  },
};

export function KnowledgePeople({ entity }: { entity: KnowledgeEntity }) {
  const data = useData();
  const spec = KNOWLEDGE[entity.kind];
  const people = spec.people(data, entity.id);
  const attitudes = partyAttitudes(data);
  return (
    <Section title={spec.title} count={people.length || undefined}>
      {people.length ? (
        <div className="wf-welt-rows wf-welt-rows--grid">
          {people.map((person) => (
            <EntryRow
              key={person.id}
              entity={person}
              attitude={shownAttitude(person.kind, attitudes.get(person.id))}
            />
          ))}
        </div>
      ) : (
        <p className="wf-welt-quiet">{spec.empty}</p>
      )}
    </Section>
  );
}

/** Die Schrift einer Sprache bzw. die Sprachen einer Schrift. */
export function ScriptSide({ entity }: { entity: Language | Script }) {
  const db = useDb();
  const data = useData();
  if (entity.kind === 'language')
    return (
      <Section title="Schrift">
        <Picker
          value={entity.language.scriptId}
          onChange={(scriptId) => patchDetails(db, entity, { scriptId })}
          kinds={['script']}
          placeholder="Keine Schrift – auswählen …"
          onCreate={(name) => db.put('entities', createEntity({ kind: 'script', name })).id}
        />
      </Section>
    );
  const languages = languagesInScript(data, entity.id);
  if (!languages.length) return null;
  return (
    <Section title="Sprachen in dieser Schrift" count={languages.length}>
      <div className="wf-welt-rows">
        {languages.map((language) => (
          <EntryRow key={language.id} entity={language} />
        ))}
      </div>
    </Section>
  );
}

/** Die Kampfwerte eines Tieres im Bestiarium – oder der Weg dorthin, sie anzulegen. */
export function CombatStats({ animal }: { animal: Animal }) {
  const data = useData();
  const creature = creatureOfAnimal(data, animal);
  return (
    <Section title="Kampfwerte">
      {creature ? (
        <Link href={`/bestiarium/${creature.id}`} className="wf-welt-combat">
          <Skull aria-hidden />
          <span className="wf-grow">
            <span className="wf-welt-combat__name">{creature.name}</span>
            <span className="wf-welt-combat__sub">im Bestiarium</span>
          </span>
          <ArrowRight aria-hidden />
        </Link>
      ) : (
        <Hint
          action={
            <Link href={`/bestiarium/neu/tier/${animal.id}`} className="wf-btn wf-btn--sm">
              <Plus aria-hidden />
              Kampfwerte anlegen
            </Link>
          }
        >
          Kampfwerte entstehen im Bestiarium und bleiben mit diesem Tier verbunden.
        </Hint>
      )}
    </Section>
  );
}

// ── Hinzufügen ─────────────────────────────────────────────────────────────

/**
 * Die eine Zeile „Hinzufügen: Laden · Magie · …“ statt leerer Kästen. Ein Klick öffnet den
 * Abschnitt an seinem Platz; Abmachung und Vorhaben führen gleich zum Festhalten bzw. Anlegen.
 */
export function AddRow({
  keys,
  onOpen,
  extra,
}: {
  keys: AddKey[];
  onOpen: (key: AddKey) => void;
  extra?: ReactNode;
}) {
  if (!keys.length && !extra) return null;
  return (
    <div className="wf-welt-addrow">
      <span className="wf-welt-addrow__label">Hinzufügen</span>
      {keys.map((key) => (
        <button
          key={key}
          type="button"
          className="wf-welt-addrow__item"
          onClick={() => onOpen(key)}
        >
          <Plus aria-hidden />
          {ADD_LABEL[key]}
        </button>
      ))}
      {extra}
    </div>
  );
}

/** Für den Abschnitt „Festhalten“ im Leerzustand der Chronik. */
export function LogButton({ entity }: { entity: Entity }) {
  return (
    <Button icon={<Feather />} onClick={() => openQuickLog({ refs: [entity.id] })}>
      Festhalten
    </Button>
  );
}
