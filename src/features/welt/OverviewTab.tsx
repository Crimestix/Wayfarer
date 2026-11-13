/** Reiter „Überblick“ im Dossier: je Art das, was am Tisch zuerst gebraucht wird. */
import { RoomsSection } from './RoomsSection';
import { Schemes } from './Schemes';
import { ShopSection } from '../laden/ShopSection';
import { GroupKnows } from './GroupKnows';
import { BookSection, BookSwitch } from './BookSection';
import { ItemLife } from './ItemLife';
import { MadeBy, RecipeSection, UsedIn } from './RecipeSection';
import { tracksOf } from '../../domain/track';
import { TrackCard } from '../fortschritt/TrackCard';
import { Children, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import {
  ArrowRight,
  EyeOff,
  Feather,
  Footprints,
  Handshake,
  Home,
  Plus,
  Skull,
  Sparkles,
  Users,
} from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { creatureOfAnimal, natureAt } from '../../domain/nature';
import { NatureFold } from './NatureList';
import { articleShare } from '../wiki/facts';
import { fateSinceLabel } from '../../domain/chronicleKinds';
import { whereaboutsSince } from '../../domain/history';
import {
  attitudeHistory,
  attitudeToParty,
  entityName,
  openPromises,
  placeCast,
  placeChildren,
  placePath,
  placeStatus,
} from '../../domain/derive';
import {
  PARTY_ID,
  PERSON_STATUS,
  createEntity,
  type Ability,
  type Animal,
  type CampaignData,
  type Entity,
  type Faction,
  type Family,
  type Item,
  type Language,
  type NatureEntity,
  type Person,
  type PersonStatus,
  type Place,
  type Profession,
  type Script,
  type Species,
  type Topic,
} from '../../domain/schema';
import { formatClock } from '../../domain/time/calendar';
import { openAttitude, openQuickLog } from '../../shell/commands';
import {
  AttitudeBadge,
  Badge,
  Button,
  Checkbox,
  ChronicleList,
  Field,
  OpenConditions,
  Select,
  toast,
} from '../../ui';
import { movePartyTo, patchDetails } from './actions';
import { openEntityDialog } from './editor';
import {
  CAST_PREVIEW,
  PERSON_STATUS_LABEL,
  castSubline,
  describeVisit,
  formatShortDate,
  groupMembers,
  itemsHeldBy,
  languagesInScript,
  linkedFrom,
  linkedSubline,
  partyAttitudes,
  recentChronicle,
  relationRows,
  speciesMembers,
  upcomingFor,
  workersAt,
  type WorldEntity,
} from './model';
import {
  EntryRow,
  Hint,
  NotesSection,
  SecretSection,
  Section,
  UpcomingList,
  Picker,
} from './parts';

export type DossierTab = 'overview' | 'relations' | 'tree' | 'chronicle' | 'lk';
/** Was der Reiter „Beziehungen“ beim Öffnen gleich anbietet. */
export type RelationIntent = 'relation' | 'member';

interface Props<E> {
  entity: E;
  /** Wechselt den Reiter; mit `intent` öffnet „Beziehungen“ gleich den Dialog zum Anlegen. */
  onShowTab: (tab: DossierTab, intent?: RelationIntent) => void;
}

/** Ein Satz dazu, was dieser Eintrag aus dem Steckbrief seines Artikels hat. */
function FromArticle({ entity }: { entity: WorldEntity }) {
  const data = useData();
  const article = entity.lk ? data.articles[entity.lk.resourceId] : undefined;
  const { fields, relations } = articleShare(entity);
  if (!article || (!fields.length && !relations)) return null;
  const parts = [...fields];
  if (relations) parts.push(relations === 1 ? 'eine Beziehung' : `${relations} Beziehungen`);
  const list =
    parts.length > 1 ? `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}` : parts[0];
  return (
    <p className="wf-welt-fromarticle">
      Aus dem Steckbrief des Artikels <Link href={`/wiki/${article.id}`}>„{article.title}“</Link>:{' '}
      {list}. Ändert sich dort der Wortlaut, zieht dieser Eintrag nach; was du hier von Hand
      änderst, bleibt bis dahin.
    </p>
  );
}

export function OverviewTab(props: Props<WorldEntity>) {
  return (
    <>
      <FromArticle entity={props.entity} />
      <KindOverview {...props} />
    </>
  );
}

function KindOverview({ entity, onShowTab }: Props<WorldEntity>) {
  switch (entity.kind) {
    case 'place':
      return <PlaceOverview entity={entity} onShowTab={onShowTab} />;
    case 'person':
      return <PersonOverview entity={entity} onShowTab={onShowTab} />;
    case 'faction':
      return <FactionOverview entity={entity} onShowTab={onShowTab} />;
    case 'item':
      return <ItemOverview entity={entity} onShowTab={onShowTab} />;
    case 'topic':
      return <TopicOverview entity={entity} onShowTab={onShowTab} />;
    case 'family':
      return <FamilyOverview entity={entity} onShowTab={onShowTab} />;
    case 'species':
    case 'language':
    case 'script':
    case 'ability':
    case 'profession':
      return <KnowledgeOverview entity={entity} onShowTab={onShowTab} />;
    case 'plant':
    case 'animal':
    case 'mineral':
      return <NatureOverview entity={entity} onShowTab={onShowTab} />;
  }
}

function Columns({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div className="wf-welt-cols">
      <div className="wf-welt-cols__main">{main}</div>
      <aside className="wf-welt-cols__side">{side}</aside>
    </div>
  );
}

// ── Ort ────────────────────────────────────────────────────────────────────

function PlaceOverview({ entity: place }: Props<Place>) {
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
  const items = itemsHeldBy(data, place.id);
  // Kehrt die Gruppe zurück, ist das Wichtigste, was sich seitdem getan hat – dann steht es oben.
  const changesFirst = placeStatus(data, place.id).changesSince.length > 0;
  const createPerson = () =>
    openEntityDialog({
      mode: 'create',
      kind: 'person',
      preset: { placeId: place.id, homeId: place.id },
    });

  return (
    <Columns
      main={
        <>
          {changesFirst && <ChangesSince place={place} />}
          <Section
            title="Wer hier eine Rolle spielt"
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
                Noch niemand. Hier erscheint, wer sich an diesem Ort aufhält, hier zu Hause ist oder
                seinen Sitz hat.
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
                        attitude={
                          link.entity.kind === 'person' || link.entity.kind === 'faction'
                            ? attitude(link.entity.id)
                            : undefined
                        }
                      />
                    ))}
                  </CastGroup>
                )}
              </div>
            )}
          </Section>
          {!changesFirst && <ChangesSince place={place} />}
          {items.length > 0 && (
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
          )}
          <ShopSection entity={place} />
          <NotesSection entity={place} />
          <SecretSection entity={place} />
          <GroupKnows entity={place} />
        </>
      }
      side={
        <>
          <PartyAtPlace place={place} />
          <RoomsSection place={place} />
          <Tracks entity={place} />
          <PlacesBelow place={place} />
          <Upcoming entity={place} empty="In den nächsten Monaten steht hier kein Termin an." />
          <NatureFold
            spot={`ort:${place.id}`}
            hits={natureAt(data, { placeId: place.id, allYear: true })}
          />
        </>
      }
    />
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

function PartyAtPlace({ place }: { place: Place }) {
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
  const shown = earlier.slice(0, 5);
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
    <Section title="Die Gruppe an diesem Ort">
      <div className="wf-welt-party" data-here={status.here}>
        <Footprints />
        <div className="wf-grow">
          {current ? (
            <>
              <div className="wf-welt-party__state">Die Gruppe ist gerade hier</div>
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
              <div className="wf-welt-party__sub">Der erste Besuch steht noch aus.</div>
            </>
          )}
        </div>
      </div>
      {!exactlyHere && (
        <Button icon={<ArrowRight />} onClick={move} className="wf-welt-party__move">
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
            <li className="wf-mute">
              und {earlier.length - shown.length} frühere – siehe Reiter „Chronik“
            </li>
          )}
        </ul>
      )}
    </Section>
  );
}

function ChangesSince({ place }: { place: Place }) {
  const data = useData();
  const status = placeStatus(data, place.id);
  if (status.lastLeft === null) return null;
  const cal = data.campaign.calendar;
  const left = formatShortDate(cal, data.state.now, status.lastLeft);
  const logChange = () => openQuickLog({ kind: 'change', refs: [place.id] });
  return (
    <Section
      className="wf-welt-sec--changes"
      title="Seit dem letzten Besuch"
      count={status.changesSince.length || undefined}
      action={
        <Button size="sm" variant="ghost" icon={<Plus />} onClick={logChange}>
          Veränderung
        </Button>
      }
    >
      <p className="wf-welt-lead">
        {status.here
          ? `Was geschah, während die Gruppe fort war – vom Aufbruch am ${left} bis zur Rückkehr.`
          : `Die Gruppe ist am ${left} aufgebrochen. Was seitdem hier und mit den Leuten von hier geschah:`}
      </p>
      <ChronicleList
        entries={status.changesSince}
        showDate
        hideRefs={[place.id]}
        empty={
          <Hint
            action={
              <Button size="sm" icon={<Feather />} onClick={logChange}>
                Veränderung festhalten
              </Button>
            }
          >
            Seit dem Aufbruch ist hier nichts festgehalten worden.
          </Hint>
        }
      />
    </Section>
  );
}

function PlacesBelow({ place }: { place: Place }) {
  const data = useData();
  // Räume stehen unter „Räume“, nicht hier.
  const children = placeChildren(data, place.id).filter((child) => !child.place.room);
  const create = () =>
    openEntityDialog({ mode: 'create', kind: 'place', preset: { parentId: place.id } });
  return (
    <Section
      title="Orte darunter"
      count={children.length || undefined}
      action={
        children.length > 0 && (
          <Button size="sm" variant="ghost" icon={<Plus />} onClick={create}>
            Ort
          </Button>
        )
      }
    >
      {children.length ? (
        <div className="wf-welt-rows">
          {children.map((child) => (
            <EntryRow
              key={child.id}
              entity={child}
              aside={
                child.id === data.state.placeId ? (
                  <Badge tone="gold" icon={<Footprints />}>
                    Gruppe
                  </Badge>
                ) : undefined
              }
            />
          ))}
        </div>
      ) : (
        <Hint
          action={
            <Button size="sm" icon={<Plus />} onClick={create}>
              Ort darunter anlegen
            </Button>
          }
        >
          Keine Orte darunter. Viertel, Gebäude oder Räume, die zu diesem Ort gehören, hängst du
          hier an.
        </Hint>
      )}
    </Section>
  );
}

// ── Gemeinsame Abschnitte ──────────────────────────────────────────────────

function Upcoming({ entity, empty }: { entity: Entity; empty?: string }) {
  const data = useData();
  const upcoming = upcomingFor(data, entity.id);
  if (!upcoming.length && !empty) return null;
  return (
    <Section title="Kommende Termine" count={upcoming.length || undefined}>
      {upcoming.length ? (
        <UpcomingList occurrences={upcoming} />
      ) : (
        <Hint
          action={
            <Link href="/kalender" className="wf-btn wf-btn--sm">
              Zum Kalender
            </Link>
          }
        >
          {empty}
        </Hint>
      )}
    </Section>
  );
}

function AttitudeTrail({ entity }: { entity: Person | Faction }) {
  const data = useData();
  const cal = data.campaign.calendar;
  const history = [...attitudeHistory(data, entity.id, PARTY_ID)].reverse();
  const known = attitudeToParty(data, entity.id) !== null;
  const change = () => openAttitude({ fromId: entity.id });
  return (
    <Section
      title="Haltung zur Gruppe · Verlauf"
      count={history.length || undefined}
      action={
        history.length > 0 && (
          <Button size="sm" variant="ghost" onClick={change}>
            Ändern
          </Button>
        )
      }
    >
      {history.length ? (
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
              <span className="wf-welt-trail__why">{entry.text || 'ohne Grund festgehalten'}</span>
            </li>
          ))}
        </ol>
      ) : (
        <Hint
          action={
            <Button size="sm" onClick={change}>
              {known ? 'Haltung ändern' : 'Haltung festlegen'}
            </Button>
          }
        >
          {known
            ? 'Seit dem Anlegen unverändert – jede Änderung steht hier mit Datum und Grund.'
            : 'Noch nicht festgelegt – jede Änderung steht hier mit Datum und Grund.'}
        </Hint>
      )}
    </Section>
  );
}

/** Fortschrittsleisten dieses Eintrags – nur, wenn es welche gibt (angelegt unter Gefährten → Fortschritt). */
function Tracks({ entity }: { entity: Entity }) {
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

function Promises({ entity }: { entity: Entity }) {
  const data = useData();
  const promises = openPromises(data, entity.id);
  const add = () => openQuickLog({ kind: 'promise', refs: [entity.id] });
  return (
    <Section
      title="Offene Abmachungen"
      count={promises.length || undefined}
      action={
        promises.length > 0 && (
          <Button size="sm" variant="ghost" icon={<Plus />} onClick={add}>
            Abmachung
          </Button>
        )
      }
    >
      <ChronicleList
        entries={promises}
        showDate
        hideRefs={[entity.id]}
        empty={
          <Hint
            action={
              <Button size="sm" icon={<Handshake />} onClick={add}>
                Abmachung festhalten
              </Button>
            }
          >
            Nichts offen – Versprechen, Schulden und Aufträge stehen hier, bis du sie abhakst.
          </Hint>
        }
      />
    </Section>
  );
}

function RecentChronicle({ entity, onShowTab }: Props<Entity>) {
  const data = useData();
  const { entries, total } = recentChronicle(data, entity.id);
  const log = () => openQuickLog({ refs: [entity.id] });
  return (
    <Section
      title="Zuletzt in der Chronik"
      action={
        total > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onShowTab('chronicle')}>
            {total === 1 ? 'Chronik öffnen' : `Alle ${total} anzeigen`}
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
          <Hint
            action={
              <Button size="sm" icon={<Feather />} onClick={log}>
                Festhalten
              </Button>
            }
          >
            {total > 0
              ? 'Sonst nichts – alles Bisherige steht schon oben.'
              : 'Noch nichts – was am Tisch mit diesem Eintrag geschieht, erscheint hier.'}
          </Hint>
        }
      />
    </Section>
  );
}

function Connections({
  entity,
  onShowTab,
  title = 'Beziehungen',
  skip = [],
}: Props<Entity> & {
  title?: string;
  /** Gegenüber, die das Dossier schon an anderer Stelle zeigt. */ skip?: string[];
}) {
  const data = useData();
  const rows = relationRows(data, entity.id).filter(
    (r) => r.otherId !== PARTY_ID && !r.ended && r.entity && !skip.includes(r.otherId),
  );
  const shown = rows.slice(0, 6);
  return (
    <Section
      title={title}
      count={rows.length || undefined}
      action={
        rows.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onShowTab('relations')}>
            {rows.length > shown.length ? 'Alle anzeigen' : 'Bearbeiten'}
          </Button>
        )
      }
    >
      {shown.length ? (
        <div className="wf-welt-rows">
          {shown.map((row) => (
            <EntryRow
              key={row.otherId}
              entity={row.entity!}
              sub={row.label}
              aside={
                row.secret ? (
                  <EyeOff className="wf-welt-entry__secret" aria-label="Geheim" />
                ) : undefined
              }
            />
          ))}
        </div>
      ) : (
        <Hint
          action={
            <Button size="sm" icon={<Plus />} onClick={() => onShowTab('relations', 'relation')}>
              Beziehung anlegen
            </Button>
          }
        >
          Noch keine Beziehungen zu anderen Einträgen.
        </Hint>
      )}
    </Section>
  );
}

function Belongings({ entity, title }: { entity: Entity; title: string }) {
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

function PersonOverview({ entity: person, onShowTab }: Props<Person>) {
  return (
    <Columns
      main={
        <>
          <Promises entity={person} />
          <Tracks entity={person} />
          <ShopSection entity={person} />
          <NotesSection entity={person} />
          <SecretSection entity={person} />
          <GroupKnows entity={person} />
          <AttitudeTrail entity={person} />
          <RecentChronicle entity={person} onShowTab={onShowTab} />
        </>
      }
      side={
        <>
          <Whereabouts person={person} />
          <Schemes entity={person} quiet />
          <Connections entity={person} onShowTab={onShowTab} />
          <Belongings entity={person} title="Trägt bei sich" />
          <Upcoming entity={person} />
        </>
      }
    />
  );
}

function Whereabouts({ person }: { person: Person }) {
  const db = useDb();
  const data = useData();
  const { placeId, homeId, status, met } = person.person;
  const partyPlaceId = data.state.placeId;
  // Seit wann – aus den Einträgen der Chronik (Schicksal, Aufenthalt).
  const fateLabel = fateSinceLabel(data, person.id);
  const stay = whereaboutsSince(data, person.id);
  const staySince = stay
    ? `Seit ${formatShortDate(data.campaign.calendar, data.state.now, stay.since)}`
    : undefined;
  const createPlace = (name: string) =>
    db.put('entities', createEntity({ kind: 'place', name })).id;
  return (
    <Section title="Aufenthalt">
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
        <Field label="Ist zu Hause in">
          <Picker
            value={homeId}
            onChange={(next) => patchDetails(db, person, { homeId: next })}
            kinds={['place']}
            placeholder="Kein Zuhause – Ort wählen …"
            onCreate={createPlace}
          />
        </Field>
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
        <Checkbox checked={met} onChange={(next) => patchDetails(db, person, { met: next })}>
          Die Gruppe kennt diese Person
        </Checkbox>
      </div>
    </Section>
  );
}

// ── Fraktion ───────────────────────────────────────────────────────────────

function FactionOverview({ entity: faction, onShowTab }: Props<Faction>) {
  const db = useDb();
  const data = useData();
  const members = groupMembers(data, faction.id);
  return (
    <Columns
      main={
        <>
          <MemberList
            group={faction}
            onShowTab={onShowTab}
            empty="Noch keine Mitglieder. Wer über eine Beziehung zur Fraktion gehört, sie führt, ihr dient oder hier arbeitet, erscheint hier."
          />
          <Schemes entity={faction} />
          <Promises entity={faction} />
          <Tracks entity={faction} />
          <ShopSection entity={faction} />
          <NotesSection entity={faction} />
          <SecretSection entity={faction} />
          <GroupKnows entity={faction} />
          <AttitudeTrail entity={faction} />
          <RecentChronicle entity={faction} onShowTab={onShowTab} />
        </>
      }
      side={
        <>
          <Section title="Sitz">
            <Picker
              value={faction.faction.seatId}
              onChange={(seatId) => patchDetails(db, faction, { seatId })}
              kinds={['place']}
              placeholder="Kein Sitz – Ort wählen …"
              onCreate={(name) => db.put('entities', createEntity({ kind: 'place', name })).id}
            />
          </Section>
          <Connections
            entity={faction}
            onShowTab={onShowTab}
            title="Beziehungen"
            skip={members.map((m) => m.entity.id)}
          />
          <Belongings entity={faction} title="Im Besitz" />
          <Upcoming entity={faction} />
        </>
      }
    />
  );
}

// ── Gegenstand und Thema ───────────────────────────────────────────────────

function ItemOverview({ entity: item, onShowTab }: Props<Item>) {
  const db = useDb();
  // Mit Lebenslauf steht alles aus der Chronik dort – dann nicht noch einmal „Zuletzt“.
  const life = item.item.history;
  return (
    <Columns
      main={
        <>
          {life ? (
            <ItemLife item={item} />
          ) : (
            <RecentChronicle entity={item} onShowTab={onShowTab} />
          )}
          <NotesSection entity={item} />
          <BookSection item={item} />
          <RecipeSection item={item} />
          <SecretSection entity={item} />
          <GroupKnows entity={item} />
          {!life && <ItemLife item={item} />}
        </>
      }
      side={
        <>
          <Section title="Verbleib">
            <Field
              label="Befindet sich bei"
              hint="Ein Ort, eine Person, eine Fraktion oder ein Gefährte."
            >
              <Picker
                value={item.item.holderId}
                onChange={(holderId) => patchDetails(db, item, { holderId })}
                kinds={['place', 'person', 'faction', 'character']}
                placeholder="Unbekannt – auswählen …"
              />
            </Field>
          </Section>
          <BookSwitch item={item} />
          <UsedIn entity={item} />
          <Connections entity={item} onShowTab={onShowTab} />
          <Upcoming entity={item} />
        </>
      }
    />
  );
}

// ── Familie ────────────────────────────────────────────────────────────────

function FamilyOverview({ entity: family, onShowTab }: Props<Family>) {
  const db = useDb();
  const data = useData();
  return (
    <Columns
      main={
        <>
          <MemberList
            group={family}
            onShowTab={onShowTab}
            empty="Noch niemand. Wer bei einer Person als Mitglied dieser Familie eingetragen ist, sie führt oder hier arbeitet, erscheint hier."
          />
          <Schemes entity={family} quiet />
          <Promises entity={family} />
          <Tracks entity={family} />
          <NotesSection entity={family} />
          <SecretSection entity={family} />
          <GroupKnows entity={family} />
          <RecentChronicle entity={family} onShowTab={onShowTab} />
        </>
      }
      side={
        <>
          <Section title="Stammsitz">
            <Picker
              value={family.family.seatId}
              onChange={(seatId) => patchDetails(db, family, { seatId })}
              kinds={['place']}
              placeholder="Kein Stammsitz – Ort wählen …"
              onCreate={(name) => db.put('entities', createEntity({ kind: 'place', name })).id}
            />
          </Section>
          <Connections
            entity={family}
            onShowTab={onShowTab}
            skip={groupMembers(data, family.id).map((m) => m.entity.id)}
          />
          <Belongings entity={family} title="Im Besitz" />
          <Upcoming entity={family} />
        </>
      }
    />
  );
}

/** Mitglieder einer Fraktion oder Familie, mit Haltung zur Gruppe. */
function MemberList({
  group,
  onShowTab,
  empty,
}: Omit<Props<Faction | Family>, 'entity'> & { group: Faction | Family; empty: string }) {
  const data = useData();
  const members = groupMembers(data, group.id);
  const attitudes = partyAttitudes(data);
  return (
    <Section
      title="Mitglieder"
      count={members.length || undefined}
      action={
        members.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus />}
            onClick={() => onShowTab('relations', 'member')}
          >
            Mitglied
          </Button>
        )
      }
    >
      {members.length ? (
        <div className="wf-welt-rows">
          {members.map((member) => (
            <EntryRow
              key={member.entity.id}
              entity={member.entity}
              sub={[
                member.label,
                member.entity.kind === 'person' && member.entity.person.role,
                member.entity.kind === 'person' && entityName(data, member.entity.person.placeId),
              ]
                .filter(Boolean)
                .join(' · ')}
              attitude={
                member.entity.kind === 'person'
                  ? (attitudes.get(member.entity.id) ?? null)
                  : undefined
              }
            />
          ))}
        </div>
      ) : (
        <Hint
          action={
            <Button size="sm" icon={<Plus />} onClick={() => onShowTab('relations', 'member')}>
              Mitglied eintragen
            </Button>
          }
        >
          {empty}
        </Hint>
      )}
    </Section>
  );
}

// ── Spezies, Sprache, Schrift, Fähigkeit ───────────────────────────────────

type KnowledgeEntity = Species | Language | Script | Ability | Profession;

/** Wer zu einer Spezies gehört, eine Sprache spricht, eine Schrift schreibt, eine Fähigkeit hat. */
const KNOWLEDGE: Record<
  KnowledgeEntity['kind'],
  { title: string; empty: string; people: (data: CampaignData, id: string) => Entity[] }
> = {
  species: {
    title: 'Vertreter',
    empty:
      'Noch niemand. Personen dieser Spezies erscheinen hier – die Spezies wählst du bei der Person.',
    people: (data, id) => speciesMembers(data, id),
  },
  language: {
    title: 'Sprechen sie',
    empty:
      'Noch niemand. Wer diese Sprache spricht, trägst du bei der Person unter „Sprachen“ ein.',
    people: (data, id) => linkedFrom(data, id, 'speaks'),
  },
  script: {
    title: 'Schreiben sie',
    empty:
      'Noch niemand. Wer diese Schrift beherrscht, steht hier, sobald eine Beziehung „schreibt“ besteht.',
    people: (data, id) => linkedFrom(data, id, 'writes'),
  },
  profession: {
    title: 'Üben ihn aus',
    empty: 'Noch niemand. Wer diesen Beruf ausübt, trägst du bei der Person unter „Berufe“ ein.',
    people: (data, id) => linkedFrom(data, id, 'practises'),
  },
  ability: {
    title: 'Verfügen darüber',
    empty:
      'Noch niemand. Wer diese Fähigkeit hat, trägst du bei der Person unter „Fähigkeiten“ ein.',
    people: (data, id) => linkedFrom(data, id, 'has-ability'),
  },
};

function KnowledgeOverview({ entity, onShowTab }: Props<KnowledgeEntity>) {
  const db = useDb();
  const data = useData();
  const spec = KNOWLEDGE[entity.kind];
  const people = spec.people(data, entity.id);
  const attitudes = partyAttitudes(data);
  const languages = entity.kind === 'script' ? languagesInScript(data, entity.id) : [];
  return (
    <Columns
      main={
        <>
          <Section title={spec.title} count={people.length || undefined}>
            {people.length ? (
              <div className="wf-welt-rows">
                {people.map((person) => (
                  <EntryRow
                    key={person.id}
                    entity={person}
                    attitude={
                      person.kind === 'person' ? (attitudes.get(person.id) ?? null) : undefined
                    }
                  />
                ))}
              </div>
            ) : (
              <Hint>{spec.empty}</Hint>
            )}
          </Section>
          {entity.kind === 'profession' && <MadeBy professionId={entity.id} />}
          <NotesSection entity={entity} />
          <SecretSection entity={entity} />
          <GroupKnows entity={entity} />
          <RecentChronicle entity={entity} onShowTab={onShowTab} />
        </>
      }
      side={
        <>
          {entity.kind === 'language' && (
            <Section title="Schrift">
              <Picker
                value={entity.language.scriptId}
                onChange={(scriptId) => patchDetails(db, entity, { scriptId })}
                kinds={['script']}
                placeholder="Keine Schrift – auswählen …"
                onCreate={(name) => db.put('entities', createEntity({ kind: 'script', name })).id}
              />
            </Section>
          )}
          {entity.kind === 'script' && languages.length > 0 && (
            <Section title="Sprachen in dieser Schrift" count={languages.length}>
              <div className="wf-welt-rows">
                {languages.map((language) => (
                  <EntryRow key={language.id} entity={language} />
                ))}
              </div>
            </Section>
          )}
          <Connections
            entity={entity}
            onShowTab={onShowTab}
            title="Zusammenhänge"
            skip={people.map((p) => p.id)}
          />
        </>
      }
    />
  );
}

// ── Pflanze, Tier, Gestein ─────────────────────────────────────────────────

/** Was in der Natur vorkommt: Text und Geheimnis; beim Tier dazu seine Kampfwerte. */
function NatureOverview({ entity, onShowTab }: Props<NatureEntity>) {
  return (
    <Columns
      main={
        <>
          <NotesSection entity={entity} />
          <SecretSection entity={entity} />
          <GroupKnows entity={entity} />
          <RecentChronicle entity={entity} onShowTab={onShowTab} />
        </>
      }
      side={
        <>
          {entity.kind === 'animal' && <CombatStats animal={entity} />}
          <UsedIn entity={entity} />
          <Connections entity={entity} onShowTab={onShowTab} title="Zusammenhänge" />
        </>
      }
    />
  );
}

/** Die Kampfwerte eines Tieres im Bestiarium – oder der Weg dorthin, sie anzulegen. */
function CombatStats({ animal }: { animal: Animal }) {
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
          Noch keine. Kampfwerte entstehen im Bestiarium und bleiben mit diesem Tier verbunden.
        </Hint>
      )}
    </Section>
  );
}

function TopicOverview({ entity: topic, onShowTab }: Props<Topic>) {
  return (
    <Columns
      main={
        <>
          <RecentChronicle entity={topic} onShowTab={onShowTab} />
          <NotesSection entity={topic} />
          <SecretSection entity={topic} />
          <GroupKnows entity={topic} />
        </>
      }
      side={
        <>
          <Connections entity={topic} onShowTab={onShowTab} title="Zusammenhänge" />
          <Upcoming entity={topic} />
        </>
      }
    />
  );
}
