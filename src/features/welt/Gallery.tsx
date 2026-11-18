/**
 * Galerie einer Art: Karten zum Durchblättern, gefiltert nach Ort und – bei Personen und Orten –
 * danach, ob die Gruppe sie kennt. Erscheint rechts, wenn links „nur diese“ gewählt und kein
 * Eintrag offen ist; dieselbe Ansicht für jede Art (Pflanzen, Tiere, Gesteine und Berufe haben
 * ihr Lexikon). Die Rechnung steht in `galleryModel.ts`.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, Eye, EyeOff, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { KIND_LABEL, KIND_LABEL_PLURAL, entityName } from '../../domain/derive';
import { hasStance, knowsPerson } from '../../domain/known';
import { showsAttitude } from '../../domain/relations';
import {
  AttitudeBadge,
  Button,
  DismissButton,
  EmptyState,
  IconButton,
  Input,
  KindIcon,
  Portrait,
  Select,
  cx,
  toast,
} from '../../ui';
import { SUGGESTION } from '../../domain/dismiss';
import { ownKindById, ownKindSuggestions, ownPlural } from '../../domain/ownKind';
import { isRoom } from '../../domain/rooms';
import { scopeMembers } from '../../domain/scope';
import { ownKindFromWord, patchOwnKind, removeOwnKind } from './ownKinds';
import { setKindFilter } from './overview';
import { ALL_ROOMS, roomLikes } from '../../domain/rooms';
import { setRooms } from './rooms';
import { patchDetails } from './actions';
import { openEntityDialog, openNew } from './editor';
import {
  galleryEntries,
  galleryFacets,
  galleryWhere,
  knowsKnown,
  withFacets,
  type FacetKey,
} from './galleryModel';
import {
  PERSON_STATUS_LABEL,
  entitySubline,
  partyAttitudes,
  splitPast,
  type GalleryFilter,
  type KnownFilter,
  type WorldEntity,
  type WorldKind,
} from './model';
import { FoldHead, Picker } from './parts';
import { isKnown, visitedPlaces } from './scope';

/** Merkt sich die Filter je Art, solange die App läuft. */
const memory: Partial<Record<WorldKind, GalleryFilter>> = {};
/** Ob „Vergangenheit“ aufgeklappt ist, je Art – zu Beginn zu. */
const pastMemory: Partial<Record<WorldKind, boolean>> = {};
const EMPTY_FILTER: GalleryFilter = { query: '', placeId: null, known: 'all' };
/** Die gewählten Filter je Art, solange die App läuft. */
const facetMemory: Partial<Record<WorldKind, Partial<Record<FacetKey, string>>>> = {};

const KNOWN_LABEL: Record<KnownFilter, string> = {
  all: 'Alle',
  known: 'Bekannt',
  unknown: 'Unbekannt',
};

const KNOWN_TITLE: Record<'person' | 'place', Record<KnownFilter, string>> = {
  person: {
    all: 'Alle Personen',
    known: 'Nur Personen, die die Gruppe kennt',
    unknown: 'Nur Personen, denen die Gruppe noch nicht begegnet ist',
  },
  place: {
    all: 'Alle Orte',
    known: 'Nur Orte, an denen die Gruppe war',
    unknown: 'Nur Orte, an denen die Gruppe noch nicht war',
  },
};

/** Was unter „Vergangenheit“ steht, in einem Wort. */
const PAST_HINT: Partial<Record<WorldKind, string>> = {
  person: 'Verstorbene',
  place: 'Untergegangene Orte',
  faction: 'Aufgelöste',
  family: 'Erloschene und Aufgelöste',
  item: 'Zerstörtes',
};

export function Gallery({
  kind,
  ownKindId = null,
}: {
  kind: WorldKind;
  /** Nur die Einträge dieser eigenen Kategorie („Städte“) – eine Gruppe innerhalb von `kind`. */
  ownKindId?: string | null;
}) {
  const data = useData();
  const own = ownKindById(data, ownKindId);
  const [filter, setFilter] = useState<GalleryFilter>(() => ({
    ...(memory[kind] ?? EMPTY_FILTER),
  }));
  const set = (change: Partial<GalleryFilter>) => setFilter((f) => ({ ...f, ...change }));
  useEffect(() => {
    memory[kind] = filter;
  }, [kind, filter]);
  const withKnown = knowsKnown(kind);
  // Ein gelöschter Ort filtert nicht weiter ins Leere.
  const placeId = filter.placeId && data.entities[filter.placeId] ? filter.placeId : null;
  const known = withKnown ? filter.known : 'all';
  // Filter, die zur Kategorie passen (`galleryFacets`): Ihre Möglichkeiten zählen über alles,
  // was Suche, Ort und Bekanntheit stehen lassen – gewählt wird je Filter eine.
  const [chosen, setChosenState] = useState<Partial<Record<FacetKey, string>>>(
    () => facetMemory[kind] ?? {},
  );
  const choose = (key: FacetKey, value: string) => {
    const next = { ...chosen, [key]: value || undefined };
    facetMemory[kind] = next;
    setChosenState(next);
  };
  // Räume stehen bei ihrem Ort – hier nur auf Wunsch, dann für sich (damit man sie wiederfindet).
  const [roomsOnly, setRoomsOnly] = useState(false);
  const rooms = useMemo(
    () =>
      kind === 'place' && !own
        ? (Object.values(data.entities).filter(
            (entity) => entity.kind === 'place' && isRoom(data, entity),
          ) as WorldEntity[])
        : [],
    [data, kind, own],
  );
  const showRooms = roomsOnly && rooms.length > 0;
  const base = useMemo(() => {
    if (showRooms) {
      const query = filter.query.trim().toLocaleLowerCase('de');
      const scope = placeId ? scopeMembers(data, placeId) : null;
      return rooms
        .filter((room) => !query || room.name.toLocaleLowerCase('de').includes(query))
        .filter((room) => !scope || scope.has(room.id))
        .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
    }
    return galleryEntries(data, kind, { ...filter, placeId, known }).filter(
      (entity) => !own || entity.ownKindId === own.id,
    );
  }, [data, kind, filter, placeId, known, own, showRooms, rooms]);
  const roomsLead = `${rooms.length} ${rooms.length === 1 ? 'Raum' : 'Räume'} – sie stehen sonst auf der Seite ihres Ortes unter „Räume“.`;
  const facets = useMemo(
    // In den Kacheln einer eigenen Kategorie ist sie selbst kein Filter mehr.
    () => galleryFacets(data, kind, base).filter((facet) => !own || facet.key !== 'own'),
    [data, kind, base, own],
  );
  const entries = useMemo(
    () => splitPast(data, withFacets(data, base, chosen)),
    [data, base, chosen],
  );
  // Vergangenes steht für sich – nie weggefiltert, nur nicht zwischen dem, was heute ist.
  const [pastOpen, setPastOpenState] = useState(pastMemory[kind] ?? false);
  const setPastOpen = (open: boolean) => {
    pastMemory[kind] = open;
    setPastOpenState(open);
  };
  const found = entries.present.length + entries.past.length;
  const attitudes = useMemo(() => partyAttitudes(data), [data]);
  const visited = useMemo(
    () => (kind === 'place' ? visitedPlaces(data) : new Set<string>()),
    [data, kind],
  );
  const all = useMemo(
    () =>
      Object.values(data.entities).filter(
        (e) => e.kind === kind && !isRoom(data, e) && (!own || e.ownKindId === own.id),
      ),
    [data, kind, own],
  );
  const total = all.length;
  const knownCount = withKnown ? all.filter((e) => isKnown(data, e, visited)).length : 0;
  const filtered =
    filter.query.trim() !== '' ||
    placeId !== null ||
    known !== 'all' ||
    Object.values(chosen).some(Boolean);
  const plural = own ? ownPlural(own) : KIND_LABEL_PLURAL[kind];
  const single = own ? own.name : KIND_LABEL[kind];
  const create = () =>
    kind === 'person'
      ? openEntityDialog({
          mode: 'create',
          kind: 'person',
          preset: {
            name: filter.query.trim(),
            placeId,
            met: filter.known === 'known',
            ownKindId: own?.id ?? null,
          },
        })
      : openNew({
          kind,
          ownKindId: own?.id ?? null,
          ...(filter.query.trim() ? { name: filter.query.trim() } : {}),
        });

  const lead =
    total === 0
      ? `Noch keine ${plural} verzeichnet.`
      : kind === 'person'
        ? `${total} ${total === 1 ? single : plural}, ${knownCount} davon der Gruppe bekannt.`
        : kind === 'place'
          ? `${total} ${total === 1 ? single : plural}, an ${knownCount} davon war die Gruppe.`
          : `${total} ${total === 1 ? single : plural}.`;

  const card = (entity: WorldEntity) => (
    <GalleryCard
      key={entity.id}
      entity={entity}
      attitude={attitudes.get(entity.id) ?? null}
      unknown={withKnown && !isKnown(data, entity, visited)}
    />
  );

  return (
    <div className="wf-welt-landing wf-welt-gallery">
      <nav className="wf-welt-back wf-welt-back--stage" aria-label="Zurück">
        <button
          type="button"
          className="wf-welt-linkish"
          title="Zurück zur Übersicht mit allen Kategorien"
          onClick={() => setKindFilter('all')}
        >
          <ArrowLeft aria-hidden /> Übersicht
        </button>
        {own && (
          <button
            type="button"
            className="wf-welt-linkish"
            title={`Alle ${KIND_LABEL_PLURAL[kind]} zeigen`}
            onClick={() => setKindFilter(kind)}
          >
            {KIND_LABEL_PLURAL[kind]}
          </button>
        )}
      </nav>
      <header className="wf-welt-landing__head">
        <div className="wf-welt-landing__eyebrow">
          {own ? `Welt · deine Kategorie, verhält sich wie ${KIND_LABEL[kind]}` : 'Welt'}
        </div>
        <h1 className="wf-welt-landing__title">{plural}</h1>
        <p className="wf-welt-landing__lead">{roomsOnly ? roomsLead : lead}</p>
        {own && <OwnKindEdit ownId={own.id} kind={kind} />}
      </header>

      <div className="wf-welt-gallery__bar" data-known={withKnown}>
        <div className="wf-welt-search wf-welt-gallery__search">
          <Search />
          <Input
            value={filter.query}
            placeholder={
              kind === 'person' ? 'Name, Rolle, Schlagwort …' : 'Name, Art, Schlagwort …'
            }
            aria-label={`${plural} durchsuchen`}
            onChange={(e) => set({ query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && filter.query) {
                e.preventDefault();
                set({ query: '' });
              }
            }}
          />
          {filter.query && (
            <IconButton
              label="Suche leeren"
              size="sm"
              variant="ghost"
              onClick={() => set({ query: '' })}
            >
              <X />
            </IconButton>
          )}
        </div>
        <div className="wf-welt-gallery__place">
          <Picker
            value={placeId}
            onChange={(next) => set({ placeId: next })}
            kinds={['place']}
            placeholder="Überall"
          />
        </div>
        {withKnown && (kind === 'person' || kind === 'place') && (
          <div
            className="wf-welt-filter wf-welt-gallery__known"
            role="radiogroup"
            aria-label="Bekanntheit"
          >
            {(['all', 'known', 'unknown'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={filter.known === value}
                title={KNOWN_TITLE[kind][value]}
                onClick={() => set({ known: value })}
              >
                {KNOWN_LABEL[value]}
              </button>
            ))}
          </div>
        )}
        <Button variant="primary" icon={<Plus />} onClick={create}>
          {single}
        </Button>
      </div>
      {facets.length > 0 && (
        <div className="wf-welt-gallery__facets" aria-label="Filter">
          {facets.map((facet) => (
            <label key={facet.key} className="wf-welt-gallery__facet">
              <span>{facet.label}</span>
              <Select
                value={chosen[facet.key] ?? ''}
                aria-pressed={!!chosen[facet.key]}
                onChange={(e) => choose(facet.key, e.target.value)}
              >
                <option value="">alle</option>
                {facet.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} ({option.count})
                  </option>
                ))}
              </Select>
            </label>
          ))}
          {Object.values(chosen).some(Boolean) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                facetMemory[kind] = {};
                setChosenState({});
              }}
            >
              Filter lösen
            </Button>
          )}
        </div>
      )}
      {rooms.length > 0 && (
        <p className="wf-welt-gallery__note">
          {showRooms ? (
            <>
              Du siehst die Räume.{' '}
              <button type="button" className="wf-welt-linkish" onClick={() => setRoomsOnly(false)}>
                Wieder die Orte zeigen
              </button>
            </>
          ) : (
            <>
              {rooms.length} {rooms.length === 1 ? 'Raum steht' : 'Räume stehen'} bei{' '}
              {rooms.length === 1 ? 'seinem Ort' : 'ihren Orten'}, nicht hier.{' '}
              <button type="button" className="wf-welt-linkish" onClick={() => setRoomsOnly(true)}>
                Räume zeigen
              </button>
            </>
          )}
        </p>
      )}
      {kind === 'place' && !own && <RoomLikesNote />}
      {!own && <OwnKindNote kind={kind} />}
      {placeId && (
        <p className="wf-welt-gallery__note">
          {kind === 'person'
            ? `Wer in ${entityName(data, placeId)} oder einem Ort darin ist, wohnt oder arbeitet.`
            : `Was zu ${entityName(data, placeId)} gehört – darin liegt, dort seinen Sitz hat oder dort ist.`}
        </p>
      )}

      {found ? (
        <>
          {entries.present.length > 0 && (
            <div className="wf-welt-gallery__grid">{entries.present.map(card)}</div>
          )}
          {entries.past.length > 0 && (
            <div className="wf-welt-past wf-welt-gallery__past">
              <FoldHead
                open={pastOpen}
                onToggle={() => setPastOpen(!pastOpen)}
                label="Vergangenheit"
                count={entries.past.length}
                hint={PAST_HINT[kind] ?? 'Vergangenes'}
              />
              {pastOpen && <div className="wf-welt-gallery__grid">{entries.past.map(card)}</div>}
            </div>
          )}
        </>
      ) : (
        <EmptyState
          icon={<KindIcon kind={kind} />}
          title={filtered ? 'Nichts passt zu diesen Filtern' : `Noch keine ${plural}`}
          action={
            <div className="wf-row" style={{ gap: 8 }}>
              {filtered && (
                <Button
                  size="sm"
                  onClick={() => {
                    setFilter({ ...EMPTY_FILTER });
                    facetMemory[kind] = {};
                    setChosenState({});
                  }}
                >
                  Filter zurücksetzen
                </Button>
              )}
              <Button size="sm" icon={<Plus />} onClick={create}>
                {filter.query.trim()
                  ? `„${filter.query.trim()}“ anlegen`
                  : `${KIND_LABEL[kind]} anlegen`}
              </Button>
            </div>
          }
        >
          {filtered
            ? 'Lockere die Suche, die Filter oder wähle einen anderen Ort.'
            : kind === 'person'
              ? 'Alle Figuren der Welt, die nicht von Spielern geführt werden, erscheinen hier mit ihrem Porträt.'
              : `Alle ${plural} der Welt erscheinen hier als Karten – mit Bild, wenn sie eines haben.`}
        </EmptyState>
      )}
    </div>
  );
}

function GalleryCard({
  entity,
  attitude,
  unknown,
}: {
  entity: WorldEntity;
  attitude: number | null;
  /** Die Gruppe kennt die Person nicht oder war noch nicht an dem Ort. */
  unknown: boolean;
}) {
  const db = useDb();
  const data = useData();
  const sub =
    entity.kind === 'person'
      ? [
          entity.person.role,
          entity.person.status !== 'alive' && PERSON_STATUS_LABEL[entity.person.status],
        ]
          .filter(Boolean)
          .join(' · ')
      : entitySubline(data, entity);
  // Was die erste Zeile schon nennt (der Sitz einer Fraktion), steht nicht noch einmal da.
  const place = galleryWhere(data, entity);
  const where = place && !sub.includes(place) ? place : '';
  const withAttitude = showsAttitude(entity.kind, attitude);
  return (
    <div className={cx('wf-welt-card', unknown && 'wf-welt-card--unknown')}>
      <Link href={`/welt/${entity.id}`} className="wf-welt-card__link" title={entity.name}>
        <Portrait entity={entity} size={112} />
        <span className="wf-welt-card__name wf-clamp-2">{entity.name}</span>
        <span className="wf-welt-card__sub wf-clamp-1">{sub || entity.tagline || ' '}</span>
        <span className="wf-welt-card__sub wf-clamp-1">{where || ' '}</span>
      </Link>
      {(withAttitude || entity.kind === 'person') && (
        <div className="wf-welt-card__foot">
          {withAttitude ? <AttitudeBadge value={attitude} /> : <span />}
          {entity.kind === 'person' && (
            <IconButton
              size="sm"
              variant="ghost"
              // Wer eine Haltung zur Gruppe hat, ist ihr bekannt – das Auge sagt es nur.
              disabled={hasStance(data, entity.id)}
              label={
                hasStance(data, entity.id)
                  ? 'Der Gruppe bekannt – die Person hat eine Haltung zu ihr'
                  : entity.person.met
                    ? 'Als der Gruppe unbekannt markieren'
                    : 'Als der Gruppe bekannt markieren'
              }
              onClick={() => patchDetails(db, entity, { met: !entity.person.met })}
            >
              {knowsPerson(data, entity) ? <Eye /> : <EyeOff />}
            </IconButton>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Über den Kacheln der Orte: Orte, die wie Räume aussehen („Dungeonraum“, „Kammer“), auf einen
 * Klick zu Räumen machen – sie stehen dann auf der Seite ihres Ortes statt zwischen den Orten.
 */
function RoomLikesNote() {
  const db = useDb();
  const data = useData();
  const likes = useMemo(() => roomLikes(data), [data]);
  if (!likes.length) return null;
  const examples = likes
    .slice(0, 3)
    .map((place) => `„${place.name}“`)
    .join(', ');
  return (
    <div className="wf-welt-gallery__rooms" role="note">
      <span className="wf-grow">
        <b>
          {likes.length === 1 ? 'Ein Ort sieht' : `${likes.length} Orte sehen`} aus wie ein Raum
        </b>{' '}
        ({examples}
        {likes.length > 3 ? ' …' : ''}). Räume stehen auf der Seite ihres Ortes, nicht zwischen den
        Orten.
      </span>
      <Button
        size="sm"
        onClick={() => {
          const undo = setRooms(
            db,
            likes.map((place) => place.id),
            true,
          );
          toast({
            title:
              likes.length === 1 ? 'Zum Raum gemacht' : `${likes.length} Orte zu Räumen gemacht`,
            body: 'Sie stehen jetzt bei ihrem Ort unter „Räume“.',
            duration: 12000,
            action: { label: 'Rückgängig', run: undo },
          });
        }}
      >
        Zu Räumen machen
      </Button>
      <DismissButton suggestionKey={SUGGESTION.room(ALL_ROOMS)} what="Räume" />
    </div>
  );
}

/**
 * Über den Kacheln: Ein eigenes Wort, das oft vorkommt, als eigene Kategorie führen („47 Orte
 * heißen Stadt“) – auf einen Klick, mit Rückgängig; das Wort der Einträge bleibt stehen.
 */
function OwnKindNote({ kind }: { kind: WorldKind }) {
  const db = useDb();
  const data = useData();
  const suggestion = useMemo(() => ownKindSuggestions(data, kind)[0], [data, kind]);
  if (!suggestion) return null;
  const count = suggestion.entityIds.length;
  return (
    <div className="wf-welt-gallery__rooms" role="note">
      <span className="wf-grow">
        <b>
          {count} {KIND_LABEL_PLURAL[kind]} heißen „{suggestion.word}“.
        </b>{' '}
        Als eigene Kategorie stehen sie für sich in der Liste, mit eigenen Kacheln und bei „Neu“ –
        und bleiben {KIND_LABEL_PLURAL[kind]}.
      </span>
      <Button
        size="sm"
        onClick={() => {
          const made = ownKindFromWord(db, suggestion);
          if (!made) return;
          setKindFilter(kind, made.own.id);
          toast({
            title: `Eigene Kategorie „${made.own.name}“`,
            body: `${count} Einträge gehören jetzt dazu. Die Mehrzahl stellst du in den Einstellungen unter „Eigene Kategorien“ ein.`,
            duration: 12000,
            action: {
              label: 'Rückgängig',
              run: () => {
                setKindFilter(kind);
                made.undo();
              },
            },
          });
        }}
      >
        „{suggestion.word}“ als Kategorie
      </Button>
      <DismissButton suggestionKey={suggestion.key} what="Eigene Kategorie" />
    </div>
  );
}

/**
 * Unter dem Titel einer eigenen Kategorie: umbenennen, Mehrzahl, entfernen – dort, wo man sie
 * ansieht. Entfernen lässt die Einträge stehen; sie gehören dann wieder nur zur Grundkategorie.
 */
function OwnKindEdit({ ownId, kind }: { ownId: string; kind: WorldKind }) {
  const db = useDb();
  const data = useData();
  const own = ownKindById(data, ownId);
  const [open, setOpen] = useState(false);
  if (!own) return null;
  if (!open)
    return (
      <button
        type="button"
        className="wf-welt-linkish wf-welt-ownedit__open"
        onClick={() => setOpen(true)}
      >
        <Pencil aria-hidden /> Kategorie umbenennen oder entfernen
      </button>
    );
  return (
    <div className="wf-welt-ownform wf-welt-ownedit">
      <Input
        key={`n-${own.name}`}
        defaultValue={own.name}
        aria-label="Name der Kategorie"
        onBlur={(e) => patchOwnKind(db, own.id, { name: e.target.value })}
      />
      <Input
        key={`p-${own.plural}`}
        defaultValue={own.plural}
        placeholder={`Mehrzahl – leer: ${own.name}`}
        aria-label="Mehrzahl der Kategorie"
        onBlur={(e) => patchOwnKind(db, own.id, { plural: e.target.value })}
      />
      <Button
        size="sm"
        variant="ghost"
        icon={<Trash2 />}
        title="Die Einträge bleiben – sie stehen danach wieder nur unter ihrer Grundkategorie"
        onClick={() => {
          const undo = removeOwnKind(db, own.id);
          if (!undo) return;
          setKindFilter(kind);
          toast({
            title: `Kategorie „${own.name}“ entfernt`,
            body: `Die Einträge sind geblieben – als ${KIND_LABEL_PLURAL[kind]}.`,
            duration: 12000,
            action: { label: 'Rückgängig', run: undo },
          });
        }}
      >
        Kategorie entfernen
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Fertig
      </Button>
    </div>
  );
}
