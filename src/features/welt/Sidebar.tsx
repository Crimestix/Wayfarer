/** Übersicht links: suchen, nach Art filtern, Orte als Baum, alles andere als Liste. */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ChevronRight, FilePlus2, Footprints, Plus, Search, Users, X } from 'lucide-react';
import type { Article, Entity } from '../../domain/schema';
import { useData, useDb } from '../../data/hooks';
import { useMediaSrc } from '../../data/media';
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
import { ArticleTree, openForWriting, useArticleHits } from '../wiki';
import { NewArticleDialog } from '../wiki/ArticleTools';
import { ArticleIcon } from '../wiki/icons';
import { adoptFamilies } from './actions';
import { planFamilies } from './dynasty';
import { openEntityDialog } from './editor';
import {
  getKindFilter,
  setKindFilter,
  setWorldLayout,
  setWorldView,
  useKindFilter,
  useWorldLayout,
  useWorldView,
} from './overview';
import { NetIndex } from './NetIndex';
import { GapsIndex, useGapCount } from './Gaps';
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
  plant: 'Alles, was wächst – Kräuter, Bäume, Pilze und Moose.',
  animal: 'Alles, was lebt und keinen eigenen Namen trägt.',
  mineral: 'Was aus dem Boden kommt – Erze, Edelsteine, Gesteine, Salze.',
  profession: 'Handwerke, Gewerbe und Ämter, die man ausübt.',
};

export function Sidebar({
  selected,
  articleId,
}: {
  selected: WorldEntity | undefined;
  /** Der offene Artikel, wenn er zu keinem Eintrag gehört. */
  articleId?: string;
}) {
  const data = useData();
  const dbRef = useDb();
  const [, navigate] = useLocation();
  const filter = useKindFilter();
  const src = useMediaSrc();
  const [query, setQuery] = useState(memory.query);
  const [open, setOpen] = useState(memory.open);
  // Vier Blicke auf dieselbe Welt: nach Art, in den Ordnern, in denen geschrieben wird, als Netz der
  // Fraktionen – oder was im Wiki noch zu schreiben ist (beides steht groß rechts auf der Bühne).
  const layout = useWorldLayout();
  const setLayout = setWorldLayout;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const gapsCount = useGapCount();
  const [writing, setWriting] = useState<{ title: string } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    memory.query = query;
    memory.open = open;
  }, [query, open]);
  // Ein Artikel ohne Eintrag steht nur in den Ordnern – außer man kommt aus „Noch zu schreiben“.
  useEffect(() => {
    if (articleId && layoutRef.current !== 'gaps') setLayout('tree');
  }, [articleId]);

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
  // Die Suche findet auch Wörter mitten im Text – Artikel, deren Eintrag schon oben steht, nicht doppelt.
  const articleHits = useArticleHits(query);
  const listed = new Set(hits.map((entity) => entity.lk?.resourceId));
  const textHits = (articleHits ?? []).filter((hit) => !listed.has(hit.article.id)).slice(0, 40);
  /** Der Artikel des gewählten Eintrags – für die Markierung im Ordnerbaum. */
  const currentArticle =
    articleId ??
    (selected?.lk && data.articles[selected.lk.resourceId] ? selected.lk.resourceId : undefined);
  const parentArticle: Article | null =
    currentArticle && !data.articles[currentArticle]?.template
      ? (data.articles[currentArticle] ?? null)
      : null;
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
        {entity.image ? (
          <img src={src(entity.image)} alt="" loading="lazy" decoding="async" />
        ) : (
          <KindIcon kind={entity.kind} />
        )}
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
          <span className="wf-row" style={{ gap: 'var(--s-2)' }}>
            <IconButton
              label={
                parentArticle
                  ? `Neuer Artikel – auf Wunsch unter „${parentArticle.title}“`
                  : 'Neuer Artikel'
              }
              size="sm"
              onClick={() => setWriting({ title: '' })}
            >
              <FilePlus2 />
            </IconButton>
            <Button size="sm" icon={<Plus />} onClick={() => create()}>
              Neu
            </Button>
          </span>
        </div>
        <div className="wf-welt-search">
          <Search />
          <Input
            ref={search}
            value={query}
            placeholder="Suchen – auch im Text …"
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
        <div className="wf-welt-layout" role="tablist" aria-label="Ansicht der Übersicht">
          <button
            type="button"
            role="tab"
            aria-selected={layout === 'kinds'}
            title="Orte, Personen, Fraktionen … nach Art geordnet"
            onClick={() => setLayout('kinds')}
          >
            Nach Art
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={layout === 'tree'}
            title="Alle Artikel in ihren Ordnern – so, wie sie geschrieben sind"
            onClick={() => setLayout('tree')}
          >
            Ordner
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={layout === 'net'}
            title="Fraktionen, Familien und ihre Leute als Netz – wer mit wem verbündet oder verfeindet ist"
            onClick={() => {
              setLayout('net');
              if (selected || articleId) navigate('/welt');
            }}
          >
            Netz
          </button>
          <button
            type="button"
            role="tab"
            className="wf-welt-layout__wide"
            aria-selected={layout === 'gaps'}
            title="Was im Wiki erwähnt wird, aber noch fehlt – und was noch kurz ist"
            onClick={() => {
              setLayout('gaps');
              if (selected || articleId) navigate('/welt');
            }}
          >
            Noch zu schreiben
            {gapsCount > 0 && <span>{gapsCount}</span>}
          </button>
        </div>
        {layout === 'kinds' && (
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
        )}
        {layout === 'kinds' && (choices.length > 0 || narrowed) && (
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
      {layout !== 'net' && filter === 'family' && familyHint && (
        <button type="button" className="wf-welt-derive" onClick={deriveFamilies}>
          <Users />
          <span>{familyHint}</span>
        </button>
      )}
      <div className="wf-welt-side__list" ref={list} onKeyDown={onListKey}>
        {layout === 'net' ? (
          <NetIndex query={query} selectedId={selectedId} />
        ) : layout === 'gaps' && !searching ? (
          <GapsIndex selectedId={selectedId} articleId={currentArticle} />
        ) : searching ? (
          hits.length + textHits.length ? (
            <>
              {hits.length > 0 && (
                <div className="wf-welt-group">
                  {hits.length === 1 ? 'Ein Eintrag' : `${hits.length} Einträge`}
                  <span className="wf-welt-group__hint">Eingabe öffnet den ersten</span>
                </div>
              )}
              {hits.map((entity) => row(entity, filter === 'all'))}
              {textHits.length > 0 && (
                <div className="wf-welt-group">
                  {textHits.length === 1 ? 'Ein Artikel' : `${textHits.length} Artikel`}
                  <span className="wf-welt-group__hint">Titel oder Text</span>
                </div>
              )}
              {textHits.map((hit) => (
                <Link
                  key={hit.article.id}
                  href={`/wiki/${hit.article.id}`}
                  className="wf-wiki-hit"
                  data-current={hit.article.id === currentArticle}
                >
                  <span className="wf-wiki-hit__title">
                    <ArticleIcon icon={hit.article.icon} />
                    {hit.article.title}
                  </span>
                  {hit.where === 'names' && (
                    <span className="wf-wiki-hit__sub">
                      {[...hit.article.aliases, ...hit.article.tags].join(' · ')}
                    </span>
                  )}
                  {hit.snippet && <span className="wf-wiki-hit__sub">{hit.snippet}</span>}
                </Link>
              ))}
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
              Kein Eintrag und kein Artikel passt zu dieser Suche
              {filter === 'all' ? '' : ` unter ${KIND_LABEL_PLURAL[filter]}`}.
            </EmptyState>
          )
        ) : layout === 'tree' ? (
          Object.keys(data.articles).length ? (
            <ArticleTree current={currentArticle} />
          ) : (
            <EmptyState
              title="Noch keine Artikel"
              action={
                <Button size="sm" icon={<FilePlus2 />} onClick={() => setWriting({ title: '' })}>
                  Ersten Artikel schreiben
                </Button>
              }
            >
              In den Ordnern stehen die Artikel über deine Welt – geschrieben in Wayfarer oder aus
              LegendKeeper übernommen.
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
      {writing && (
        <NewArticleDialog
          parent={parentArticle}
          initialTitle={writing.title}
          onClose={() => setWriting(null)}
          onCreated={(created) => {
            setWriting(null);
            openForWriting();
            navigate(`/wiki/${created.id}`);
          }}
        />
      )}
    </aside>
  );
}
