/** Übersicht links: suchen, nach Art filtern, Orte als Baum, alles andere als Liste. */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ChevronRight, Footprints, Plus, Search, Users, X } from 'lucide-react';
import type { Entity } from '../../domain/schema';
import { useData, useDb } from '../../data/hooks';
import { KIND_LABEL, KIND_LABEL_PLURAL, entitiesOfKind } from '../../domain/derive';
import {
  AttitudeBadge,
  Button,
  Checkbox,
  EmptyState,
  IconButton,
  Input,
  KindIcon,
  Select,
  cx,
  toast,
} from '../../ui';
import { MissingNamesHint } from '../import/NameSync';
import { adoptFamilies } from './actions';
import { planFamilies } from './dynasty';
import { openEntityDialog } from './editor';
import {
  getKindFilter,
  setKindFilter,
  setWorldView,
  useKindFilter,
  useWorldView,
} from './overview';
import { scopeChoices, visibleIds } from './scope';
import {
  WORLD_KINDS,
  entitySubline,
  listKeyMove,
  nextRowIndex,
  openAncestors,
  partyAttitudes,
  placeTreeRows,
  searchWorld,
  treeIndent,
  worldCounts,
  type WorldEntity,
  type WorldKind,
} from './model';

/** Merkt sich Suche und aufgeklappte Orte, solange die App läuft. */
const memory: { query: string; open: Record<string, boolean> } = {
  query: '',
  open: {},
};

const EMPTY_HINT: Record<WorldKind, string> = {
  place: 'Regionen, Städte, Gebäude, Wildnis – alles, wo die Gruppe sein kann.',
  person: 'Alle Figuren der Welt, die nicht von Spielern geführt werden.',
  faction: 'Häuser, Gilden, Orden und Kulte mit eigenen Zielen.',
  item: 'Artefakte, Schriftstücke und andere Dinge von Bedeutung.',
  topic: 'Gerüchte, Glaubensfragen und Handlungsfäden.',
  family: 'Häuser, Sippen und Dynastien – wer zu wem gehört.',
  species: 'Die Völker und Wesen der Welt.',
  language: 'Was in der Welt gesprochen wird.',
  script: 'Wie in der Welt geschrieben wird.',
  ability: 'Gaben, Flüche und besondere Fähigkeiten.',
};

export function Sidebar({ selected }: { selected: WorldEntity | undefined }) {
  const data = useData();
  const dbRef = useDb();
  const [, navigate] = useLocation();
  const filter = useKindFilter();
  const [query, setQuery] = useState(memory.query);
  const [open, setOpen] = useState(memory.open);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    memory.query = query;
    memory.open = open;
  }, [query, open]);

  // Der gewählte Eintrag soll in der Übersicht zu sehen sein.
  const selectedId = selected?.id;
  const selectedKind = selected?.kind;
  useEffect(() => {
    if (!selectedId || !selectedKind) return;
    if (getKindFilter() !== selectedKind) setKindFilter('all');
    if (selectedKind === 'place') setOpen((o) => openAncestors(dataRef.current, selectedId, o));
  }, [selectedId, selectedKind]);
  // Eine neue Suche oder ein anderer Filter beginnt oben.
  useEffect(() => {
    list.current?.scrollTo(0, 0);
  }, [query, filter]);
  // Erst rollen, wenn die Zeile nach dem Aufklappen wirklich da ist – und nur nach einer neuen Auswahl.
  const scrollPending = useRef(true);
  useEffect(() => {
    scrollPending.current = true;
  }, [selectedId]);
  useEffect(() => {
    if (!scrollPending.current) return;
    const row = list.current?.querySelector('[aria-current="page"]');
    if (!row) return;
    scrollPending.current = false;
    row.scrollIntoView({ block: 'nearest' });
  });

  // Eingrenzung: ein Bereich (Ort mit allem, was dazugehört) und nur, was die Gruppe kennt.
  const view = useWorldView();
  const visible = useMemo(() => visibleIds(data, view), [data, view]);
  const choices = useMemo(() => scopeChoices(data, view.scopeId), [data, view.scopeId]);
  const scopePlace = view.scopeId ? data.entities[view.scopeId] : undefined;
  const narrowed = visible !== null;
  const shown = <E extends Entity>(entities: E[]): E[] =>
    visible ? entities.filter((entity) => visible.has(entity.id)) : entities;

  const counts = useMemo(() => worldCounts(data, visible), [data, visible]);
  const total = WORLD_KINDS.reduce((sum, kind) => sum + counts[kind], 0);
  const attitudes = useMemo(() => partyAttitudes(data), [data]);
  const searching = query.trim() !== '';
  const hits = useMemo(
    () => (searching ? searchWorld(data, query, filter, visible) : []),
    [data, query, filter, searching, visible],
  );
  const tree = useMemo(() => placeTreeRows(data, open, visible), [data, open, visible]);
  // Personen, deren Nachname auf eine Familie schließen lässt, die es noch nicht gibt oder der sie
  // noch nicht angehören. Nur gerechnet, solange die Familien zu sehen sind.
  const familyPlan = useMemo(
    () => (filter === 'family' ? planFamilies(data) : null),
    [data, filter],
  );
  const pendingFamilies = familyPlan ? familyPlan.create.length : 0;
  const pendingJoins = familyPlan ? familyPlan.join.length : 0;
  const familyHint =
    pendingFamilies + pendingJoins === 0
      ? ''
      : [
          pendingFamilies
            ? `${pendingFamilies === 1 ? 'Eine Familie' : `${pendingFamilies} Familien`} aus Nachnamen anlegen`
            : '',
          pendingJoins
            ? `${pendingJoins === 1 ? 'eine Person' : `${pendingJoins} Personen`} zuordnen`
            : '',
        ]
          .filter(Boolean)
          .join(' und ');
  const deriveFamilies = () => {
    const adopted = adoptFamilies(dbRef);
    if (adopted)
      toast({
        title: 'Familien aus Nachnamen',
        body: adopted.text,
        action: { label: 'Rückgängig', run: adopted.undo },
      });
  };
  const createKind: WorldKind = filter === 'all' ? 'person' : filter;
  const create = (preset?: { name: string }) =>
    openEntityDialog({ mode: 'create', kind: createKind, preset });

  /** Pfeiltasten wandern durch die Übersicht; links und rechts klappen Orte zu und auf. */
  const rowLinks = () =>
    Array.from(list.current?.querySelectorAll<HTMLAnchorElement>('a.wf-welt-row') ?? []);
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a.wf-welt-row');
    if (!link) return;
    const move = listKeyMove(e.key);
    if (move !== null) {
      e.preventDefault();
      const links = rowLinks();
      const index = links.indexOf(link);
      if (move === 'up' && index === 0) search.current?.focus();
      else links[nextRowIndex(index, links.length, move)]?.focus();
      return;
    }
    const placeId = link.dataset.place;
    const branch = link.dataset.open;
    if (!placeId || branch === undefined) return;
    if (
      (e.key === 'ArrowRight' && branch === 'false') ||
      (e.key === 'ArrowLeft' && branch === 'true')
    ) {
      e.preventDefault();
      setOpen((o) => ({ ...o, [placeId]: branch === 'false' }));
    }
  };

  const row = (entity: WorldEntity, withKind: boolean): ReactNode => (
    <Link
      key={entity.id}
      href={`/welt/${entity.id}`}
      className="wf-welt-row"
      aria-current={entity.id === selectedId ? 'page' : undefined}
      title={entity.name}
    >
      <span className="wf-welt-row__icon">
        {entity.image ? <img src={entity.image} alt="" /> : <KindIcon kind={entity.kind} />}
      </span>
      <span className="wf-welt-row__main">
        <span className="wf-welt-row__name wf-clamp-1">{entity.name}</span>
        <span className="wf-welt-row__sub wf-clamp-1">
          {[withKind && KIND_LABEL[entity.kind], entitySubline(data, entity)]
            .filter(Boolean)
            .join(' · ') || entity.tagline}
        </span>
      </span>
      {(entity.kind === 'person' || entity.kind === 'faction') && (
        <AttitudeBadge value={attitudes.get(entity.id) ?? null} label={false} />
      )}
    </Link>
  );

  const places = (
    <div className="wf-welt-tree">
      {tree.map(({ place, depth, childCount, open: isOpen, partyHere, partyBelow }) => (
        <div
          key={place.id}
          className="wf-welt-tree__row"
          style={{ paddingLeft: treeIndent(depth) }}
        >
          {childCount > 0 ? (
            <button
              type="button"
              className="wf-welt-twist"
              aria-expanded={isOpen}
              aria-label={isOpen ? `${place.name} zuklappen` : `${place.name} aufklappen`}
              onClick={() => setOpen((o) => ({ ...o, [place.id]: !isOpen }))}
            >
              <ChevronRight />
            </button>
          ) : (
            <span className="wf-welt-twist wf-welt-twist--leaf" />
          )}
          <Link
            href={`/welt/${place.id}`}
            className="wf-welt-row wf-welt-row--place"
            aria-current={place.id === selectedId ? 'page' : undefined}
            title={place.name}
            data-place={place.id}
            data-open={childCount > 0 ? isOpen : undefined}
          >
            <span className="wf-welt-row__name wf-clamp-1">{place.name}</span>
            <span className="wf-welt-row__sub wf-clamp-1">
              {place.place.category}
              {!isOpen && childCount > 0 && ` · ${childCount}`}
            </span>
            {(partyHere || (partyBelow && !isOpen)) && (
              <span
                className={cx('wf-welt-row__party', !partyHere && 'wf-welt-row__party--below')}
                title={partyHere ? 'Die Gruppe ist hier' : 'Die Gruppe ist in einem Ort darunter'}
              >
                <Footprints />
              </span>
            )}
          </Link>
        </div>
      ))}
    </div>
  );

  const kinds = filter === 'all' ? WORLD_KINDS.filter((kind) => counts[kind] > 0) : [filter];

  return (
    <aside className="wf-welt-side" aria-label="Übersicht der Weltdatenbank">
      <div className="wf-welt-side__head">
        <div className="wf-spread">
          <Link href="/welt" className="wf-welt-side__title">
            Welt
          </Link>
          <Button variant="primary" size="sm" icon={<Plus />} onClick={() => create()}>
            Neu
          </Button>
        </div>
        <div className="wf-welt-search">
          <Search />
          <Input
            ref={search}
            value={query}
            placeholder="Suchen …"
            aria-label="In der Welt suchen"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hits[0]) navigate(`/welt/${hits[0].id}`);
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                rowLinks()[0]?.focus();
              } else if (e.key === 'Escape' && query) {
                e.preventDefault();
                setQuery('');
              }
            }}
          />
          {query && (
            <IconButton label="Suche leeren" size="sm" variant="ghost" onClick={() => setQuery('')}>
              <X />
            </IconButton>
          )}
        </div>
        <div className="wf-welt-filter" role="tablist" aria-label="Nach Art filtern">
          {(['all', ...WORLD_KINDS] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              role="tab"
              aria-selected={filter === kind}
              onClick={() => setKindFilter(kind)}
            >
              {kind === 'all' ? 'Alle' : KIND_LABEL_PLURAL[kind]}
              <span>{kind === 'all' ? total : counts[kind]}</span>
            </button>
          ))}
        </div>
        {(choices.length > 0 || narrowed) && (
          <div className="wf-welt-scope">
            {choices.length > 0 && (
              <Select
                value={scopePlace ? scopePlace.id : ''}
                aria-label="Bereich eingrenzen"
                title="Nur zeigen, was zu diesem Ort gehört: Orte darunter, wer dort lebt, Fraktionen mit Sitz dort"
                onChange={(e) => setWorldView({ scopeId: e.target.value || null })}
              >
                <option value="">Ganze Welt</option>
                {choices.map((place, index) => (
                  <option key={place.id} value={place.id}>
                    {index === 0 && place.id === data.state.placeId ? 'Hier: ' : 'In: '}
                    {place.name}
                  </option>
                ))}
              </Select>
            )}
            <Checkbox
              checked={view.knownOnly}
              onChange={(knownOnly) => setWorldView({ knownOnly })}
            >
              <span title="Nur Personen, die die Gruppe getroffen hat, und Orte, an denen sie war">
                Nur Bekanntes
              </span>
            </Checkbox>
          </div>
        )}
      </div>

      <MissingNamesHint />
      {filter === 'family' && familyHint && (
        <button type="button" className="wf-welt-derive" onClick={deriveFamilies}>
          <Users />
          <span>{familyHint}</span>
        </button>
      )}
      <div className="wf-welt-side__list" ref={list} onKeyDown={onListKey}>
        {searching ? (
          hits.length ? (
            <>
              <div className="wf-welt-group">
                {hits.length === 1 ? 'Ein Treffer' : `${hits.length} Treffer`}
                <span className="wf-welt-group__hint">Eingabe öffnet den ersten</span>
              </div>
              {hits.map((entity) => row(entity, filter === 'all'))}
            </>
          ) : (
            <EmptyState
              icon={<Search />}
              title="Nichts gefunden"
              action={
                <Button size="sm" icon={<Plus />} onClick={() => create({ name: query.trim() })}>
                  „{query.trim()}“ anlegen
                </Button>
              }
            >
              Kein Eintrag passt zu dieser Suche
              {filter === 'all' ? '' : ` unter ${KIND_LABEL_PLURAL[filter]}`}.
            </EmptyState>
          )
        ) : narrowed && (total === 0 || (filter !== 'all' && counts[filter] === 0)) ? (
          <EmptyState
            icon={<Search />}
            title="Hier passt nichts"
            action={
              <Button size="sm" onClick={() => setWorldView({ scopeId: null, knownOnly: false })}>
                Ganze Welt zeigen
              </Button>
            }
          >
            {scopePlace
              ? `Zu „${scopePlace.name}“ gehört nichts${view.knownOnly ? ', das die Gruppe schon kennt' : ''}.`
              : 'Die Gruppe kennt noch nichts davon. Getroffene Personen und besuchte Orte erscheinen hier.'}
          </EmptyState>
        ) : total === 0 ? (
          <EmptyState
            title="Die Welt ist noch leer"
            action={
              <Button
                size="sm"
                variant="primary"
                icon={<Plus />}
                onClick={() => openEntityDialog({ mode: 'create', kind: 'place' })}
              >
                Ersten Ort anlegen
              </Button>
            }
          >
            Beginne mit einem Ort – Personen und Fraktionen finden dort ihren Platz.
          </EmptyState>
        ) : kinds.length === 1 && counts[kinds[0]!] === 0 ? (
          <EmptyState
            icon={<KindIcon kind={kinds[0]!} />}
            title={`Noch keine ${KIND_LABEL_PLURAL[kinds[0]!]}`}
            action={
              <Button size="sm" icon={<Plus />} onClick={() => create()}>
                {KIND_LABEL[kinds[0]!]} anlegen
              </Button>
            }
          >
            {EMPTY_HINT[kinds[0]!]}
          </EmptyState>
        ) : (
          kinds.map((kind) => (
            <div key={kind}>
              {filter === 'all' && (
                <div className="wf-welt-group">
                  {KIND_LABEL_PLURAL[kind]} <span>{counts[kind]}</span>
                </div>
              )}
              {kind === 'place'
                ? places
                : shown(entitiesOfKind(data, kind)).map((entity) => row(entity, false))}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
