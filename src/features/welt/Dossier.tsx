/**
 * Die Seite eines Dings: eine Seite zum Verstehen, ohne Reiter. Kopf (Pfad, Name, Art, ein Satz),
 * links breit: ein Laden, wenn das Ding einer ist – dann der Steckbrief als Kasten, was darin
 * oder dazu gehört, der Text mit „Schreiben“ an Ort und Stelle. Rechts schmal: was jetzt gilt,
 * Beziehungen, „Zuletzt“ und „Hinzufügen: …“. Reiter nur noch für Seltenes (Beziehungen
 * ändern, Stammbaum, Verlauf). Was wo steht, sagt `pagePlan` (`page.ts`).
 */
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { BookOpen, EyeOff, Feather, Footprints, Link2, Pencil, Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { KIND_LABEL, chronicleFor, placeAncestors } from '../../domain/derive';
import { natureAt } from '../../domain/nature';
import { isStub } from '../../domain/stub';
import { openQuickLog } from '../../shell/commands';
import {
  Badge,
  Button,
  ChronicleList,
  EmptyState,
  IconButton,
  Portrait,
  Tabs,
  Written,
  confirmDialog,
  cx,
  toast,
} from '../../ui';
import { ShopSection } from '../laden/ShopSection';
import { LkArticlePanel } from '../legendkeeper';
import { ContinuityNote } from '../offen/ContinuityItem';
import { ArticlePage, openForWriting } from '../wiki';
import { createArticleOfKind } from '../wiki/actions';
import { flushEdits } from '../wiki/editing';
import { FactsHint } from '../wiki/FactsHint';
import { scaffoldOf } from '../wiki/scaffold';
import { pageText } from '../wiki/text';
import { deleteEntityUndoable } from './actions';
import { BookSection, BookSwitch } from './BookSection';
import { openEntityDialog } from './editor';
import { FactBox } from './FactBox';
import { FamilyTree } from './FamilyTree';
import { GroupKnows } from './GroupKnows';
import { InStories } from './InStories';
import { ItemLife } from './ItemLife';
import { MagicSection } from './MagicSection';
import {
  deletionImpact,
  deletionNotes,
  entityCategory,
  entityFacts,
  groupMembers,
  isLongName,
  relationRows,
  type WorldEntity,
} from './model';
import { NatureFold } from './NatureList';
import { boxCovers, boxRows, headFacts, pagePlan, pageShops, type AddKey } from './page';
import {
  AddRow,
  AttitudeNow,
  Belongings,
  CastSection,
  ChangesSince,
  CombatStats,
  Connections,
  HolderSection,
  KnowledgePeople,
  MemberList,
  PartyAtPlace,
  PlaceItems,
  PlacesBelow,
  Promises,
  RecentChronicle,
  ScriptSide,
  SeatSection,
  ShopsHere,
  Tracks,
  Upcoming,
  Whereabouts,
  type PageTab,
  type RelationIntent,
} from './PageParts';
import { Facts, NotesSection, SecretSection } from './parts';
import { MadeBy, RecipeSection, UsedIn } from './RecipeSection';
import { RelationsTab } from './RelationsTab';
import { RoomsSection } from './RoomsSection';
import { Schemes } from './Schemes';
import { finishStub } from './writing';

export function Dossier({ entity }: { entity: WorldEntity }) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const [tab, setTabState] = useState<PageTab>('page');
  /** Aus der Seite heraus: im Reiter „Beziehungen“ gleich den Dialog öffnen. */
  const [intent, setIntent] = useState<RelationIntent | undefined>();
  const setTab = (next: PageTab, nextIntent?: RelationIntent) => {
    setTabState(next);
    setIntent(nextIntent);
  };
  /** Leere Abschnitte, die der Spielleiter über „Hinzufügen“ geöffnet hat. */
  const [opened, setOpened] = useState<ReadonlySet<AddKey>>(new Set());
  const chronicle = chronicleFor(data, entity.id);
  const relationCount = relationRows(data, entity.id).length;
  const partyHere = entity.kind === 'place' && data.state.placeId === entity.id;
  /** Der verknüpfte Artikel, wenn er im eigenen Wiki liegt. */
  const article = entity.lk ? (data.articles[entity.lk.resourceId] ?? null) : null;
  const doc = article?.docs.find((d) => d.kind === 'page');
  const text = article && doc ? pageText(data.articles, article, doc) : null;
  const covers = useMemo(
    () => boxCovers(boxRows(text, entity.kind, scaffoldOf(data.campaign, entity.kind))),
    [text, entity.kind, data.campaign],
  );
  const plan = pagePlan(data, entity, { hasText: article !== null, opened });
  const shops = pageShops(data, entity);
  /** Ein Laden ist der Hauptteil – dann trägt sein Knopf zum Handeln das Messing, nicht „Festhalten“. */
  const shopLead = plan.main[0] === 'shop' && shops.lead.length > 0;
  const log = () => openQuickLog({ refs: [entity.id] });
  /** Beim Schreiben einer Geschichte angelegt und noch ohne eigenen Text. */
  const stub = isStub(data, entity);
  const fromStory = stub && entity.fromStoryId ? data.stories[entity.fromStoryId] : undefined;
  const finish = () => {
    const undo = finishStub(db, entity.id);
    toast({
      title: `„${entity.name}“ ist kein Platzhalter mehr`,
      action: { label: 'Rückgängig', run: undo },
    });
  };
  const above = entity.kind === 'place' ? placeAncestors(data, entity.id).reverse() : [];
  const category = entity.kind === 'person' ? '' : entityCategory(entity).trim();

  const openAdd = (key: AddKey) => {
    if (key === 'promise') {
      openQuickLog({ kind: 'promise', refs: [entity.id] });
      return;
    }
    setOpened((current) => new Set([...current, key]));
  };

  const remove = async () => {
    const notes = deletionNotes(deletionImpact(data, entity.id));
    const ok = await confirmDialog({
      title: `„${entity.name}“ löschen?`,
      body: (
        <div className="wf-col">
          <p>Der Eintrag wird aus der Welt entfernt; sein Text bleibt im Wiki.</p>
          {notes.length > 0 && (
            <ul className="wf-welt-confirm">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </div>
      ),
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    navigate('/welt');
    const undo = deleteEntityUndoable(db, entity.id);
    toast({
      title: 'Eintrag gelöscht',
      body: entity.name,
      action: {
        label: 'Rückgängig',
        run: () => {
          undo();
          navigate(`/welt/${entity.id}`);
        },
      },
    });
  };

  const main: Record<string, () => ReactNode> = {
    shop: () =>
      shops.lead.length ? (
        <ShopSection entity={entity} lead shops={shops.lead} />
      ) : (
        <ShopSection entity={entity} shops={[]} />
      ),
    box: () => (
      <>
        <FactBox entity={entity} article={article} />
        {article && <FactsHint article={article} />}
      </>
    ),
    members: () =>
      (entity.kind === 'faction' || entity.kind === 'family') && (
        <MemberList group={entity} onShowTab={setTab} />
      ),
    people: () =>
      (entity.kind === 'species' ||
        entity.kind === 'language' ||
        entity.kind === 'script' ||
        entity.kind === 'ability' ||
        entity.kind === 'profession') && <KnowledgePeople entity={entity} />,
    places: () => entity.kind === 'place' && <PlacesBelow place={entity} />,
    shopsHere: () => <ShopsHere shops={shops.listed} />,
    rooms: () => entity.kind === 'place' && <RoomsSection place={entity} />,
    items: () => entity.kind === 'place' && <PlaceItems place={entity} />,
    magic: () => entity.kind === 'item' && <MagicSection item={entity} />,
    recipe: () => entity.kind === 'item' && <RecipeSection item={entity} />,
    book: () =>
      entity.kind === 'item' && (
        <>
          <BookSwitch item={entity} />
          <BookSection item={entity} />
        </>
      ),
    madeBy: () => entity.kind === 'profession' && <MadeBy professionId={entity.id} />,
    combat: () => entity.kind === 'animal' && <CombatStats animal={entity} />,
    belongings: () => (
      <Belongings
        entity={entity}
        title={entity.kind === 'person' ? 'Trägt bei sich' : 'Im Besitz'}
      />
    ),
    notes: () => <NotesSection entity={entity} />,
    secret: () => <SecretSection entity={entity} />,
    text: () => <TextSection entity={entity} />,
  };
  const side: Record<string, () => ReactNode> = {
    party: () => entity.kind === 'place' && <PartyAtPlace place={entity} onShowTab={setTab} />,
    changes: () => entity.kind === 'place' && <ChangesSince place={entity} />,
    cast: () => entity.kind === 'place' && <CastSection place={entity} />,
    nature: () =>
      entity.kind === 'place' && (
        <NatureFold
          spot={`ort:${entity.id}`}
          hits={natureAt(data, { placeId: entity.id, allYear: true })}
        />
      ),
    whereabouts: () =>
      entity.kind === 'person' && <Whereabouts person={entity} homeInBox={covers.has('home')} />,
    attitude: () =>
      (entity.kind === 'person' || entity.kind === 'faction') && <AttitudeNow entity={entity} />,
    schemes: () => <Schemes entity={entity} />,
    promises: () => <Promises entity={entity} />,
    seat: () =>
      (entity.kind === 'faction' || entity.kind === 'family') && (
        <SeatSection group={entity} inBox={covers.has('seat')} />
      ),
    holder: () =>
      entity.kind === 'item' && <HolderSection item={entity} inBox={covers.has('owner')} />,
    life: () => entity.kind === 'item' && <ItemLife item={entity} />,
    usedIn: () => <UsedIn entity={entity} />,
    script: () =>
      (entity.kind === 'language' || entity.kind === 'script') && <ScriptSide entity={entity} />,
    relations: () => (
      <Connections
        entity={entity}
        onShowTab={setTab}
        skip={
          entity.kind === 'faction' || entity.kind === 'family'
            ? groupMembers(data, entity.id).map((m) => m.entity.id)
            : []
        }
      />
    ),
    stories: () => <InStories entity={entity} />,
    knows: () => <GroupKnows entity={entity} />,
    tracks: () => <Tracks entity={entity} />,
    upcoming: () => <Upcoming entity={entity} />,
    recent: () => <RecentChronicle entity={entity} onShowTab={setTab} />,
  };

  return (
    <article className="wf-welt-dossier wf-welt-page">
      <header className="wf-welt-hero" data-image={entity.image ? 'true' : 'false'}>
        {entity.image && (
          <div className="wf-welt-hero__image">
            <Portrait entity={entity} size={104} />
          </div>
        )}
        <div className="wf-welt-hero__title">
          <nav className="wf-welt-path" aria-label="Wo es liegt">
            <Link href="/welt">Welt</Link>
            {above.map((place) => (
              <Fragment key={place.id}>
                <span aria-hidden>›</span>
                <Link href={`/welt/${place.id}`}>{place.name}</Link>
              </Fragment>
            ))}
          </nav>
          <div className="wf-welt-hero__kind">
            <span>
              {KIND_LABEL[entity.kind]}
              {category && <span className="wf-welt-hero__category"> · {category}</span>}
            </span>
            {partyHere && (
              <Badge tone="gold" icon={<Footprints />}>
                Die Gruppe ist hier
              </Badge>
            )}
            {entity.kind === 'person' && !entity.person.met && (
              <Badge icon={<EyeOff />} title="Die Gruppe ist dieser Person noch nicht begegnet.">
                Der Gruppe unbekannt
              </Badge>
            )}
          </div>
          <h1
            className={cx(
              'wf-welt-hero__name',
              isLongName(entity.name) && 'wf-welt-hero__name--long',
            )}
          >
            {entity.name}
          </h1>
          {entity.aliases.length > 0 && (
            <div className="wf-welt-hero__alias">auch: {entity.aliases.join(', ')}</div>
          )}
          {stub && (
            <div
              className="wf-welt-hero__stub"
              title="Beim Schreiben angelegt. Sobald hier ein Text oder Notizen stehen, gilt der Eintrag von selbst als fertig."
            >
              <span className="wf-stub">Platzhalter</span>
              <span>
                {fromStory ? (
                  <>
                    aus <Link href={`/geschichte/${fromStory.id}`}>„{fromStory.title}“</Link>
                  </>
                ) : (
                  'beim Schreiben angelegt'
                )}{' '}
                – noch zu schreiben
              </span>
              <button type="button" className="wf-welt-hero__stubdone" onClick={finish}>
                Fertig – kein Platzhalter mehr
              </button>
            </div>
          )}
        </div>
        <div className="wf-welt-hero__more">
          <Written
            wrap
            value={entity.tagline}
            label="Ein Satz dazu"
            placeholder="Ein Satz, der am Tisch reicht …"
            className="wf-welt-hero__tagline wf-welt-hero__taglineinput"
            onSave={(tagline) =>
              db.getSnapshot().entities[entity.id] &&
              db.patch('entities', entity.id, { tagline: tagline.replace(/\s+/g, ' ').trim() })
            }
          />
          <Facts facts={headFacts(entityFacts(data, entity))} />
          {entity.tags.length > 0 && (
            <div className="wf-row-wrap wf-welt-hero__tags">
              {entity.tags.map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
            </div>
          )}
        </div>
        <div className="wf-welt-hero__actions">
          <Button
            variant={shopLead ? 'default' : 'primary'}
            icon={<Feather />}
            onClick={log}
            title="Etwas zu diesem Eintrag festhalten"
          >
            Festhalten
          </Button>
          <IconButton
            label="Name, Art, Schlagworte und mehr ändern"
            onClick={() => openEntityDialog({ mode: 'edit', id: entity.id })}
          >
            <Pencil />
          </IconButton>
          <IconButton label="Eintrag löschen" variant="ghost" onClick={remove}>
            <Trash2 />
          </IconButton>
        </div>
      </header>

      <ContinuityNote entityId={entity.id} />

      <div className="wf-welt-tabs wf-welt-tabs--quiet">
        <Tabs<PageTab>
          tabs={[
            { id: 'page', label: 'Seite' },
            { id: 'relations', label: 'Beziehungen', count: relationCount || undefined },
            // Eine Familie zeigt, wie ihre Mitglieder miteinander verwandt sind.
            ...(entity.kind === 'family' ? [{ id: 'tree' as const, label: 'Stammbaum' }] : []),
            { id: 'chronicle', label: 'Verlauf', count: chronicle.length || undefined },
          ]}
          value={tab}
          onChange={(next) => setTab(next)}
        />
      </div>

      <div className="wf-welt-body">
        {tab === 'page' && (
          <>
            {/* Ist das Ding ein Laden, steht er über beiden Spalten: der Hauptteil, breit. */}
            {shopLead && (
              <div className="wf-welt-shoplead">
                <ShopSection entity={entity} lead shops={shops.lead} />
              </div>
            )}
            <div className="wf-welt-cols">
              <div className="wf-welt-cols__main">
                {(shopLead ? plan.main.slice(1) : plan.main).map((block) => (
                  <Fragment key={block}>{main[block]?.()}</Fragment>
                ))}
              </div>
              <aside className="wf-welt-cols__side" aria-label="Jetzt">
                {plan.side.map((block) => (
                  <Fragment key={block}>{side[block]?.()}</Fragment>
                ))}
                <AddRow keys={plan.add} onOpen={openAdd} />
              </aside>
            </div>
          </>
        )}
        {tab === 'relations' && <RelationsTab entity={entity} startNew={intent} />}
        {tab === 'tree' && entity.kind === 'family' && <FamilyTree family={entity} />}
        {tab === 'chronicle' && (
          <div className="wf-welt-chron">
            <div className="wf-welt-rel__bar">
              <p className="wf-welt-lead">
                {entity.kind === 'place'
                  ? 'Alles, was hier und in den Orten darin geschah – das Neueste zuerst.'
                  : `Alles, was mit ${entity.name} geschah – das Neueste zuerst.`}
              </p>
            </div>
            <ChronicleList
              entries={chronicle}
              newestFirst
              showDate
              hideRefs={[entity.id]}
              empty={
                <EmptyState
                  icon={<BookOpen />}
                  title="Noch nichts festgehalten"
                  action={
                    <Button icon={<Feather />} onClick={log}>
                      Festhalten
                    </Button>
                  }
                >
                  Notizen, Abmachungen und Veränderungen, die diesen Eintrag betreffen, sammeln sich
                  hier.
                </EmptyState>
              }
            />
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * Der Text des Dings auf derselben Seite: der Artikel, gesetzt zum Lesen, „Schreiben“ öffnet den
 * Editor an Ort und Stelle. Ohne Artikel: anfangen (mit dem Gerüst der Art) – oder mit einem
 * Artikel in LegendKeeper verknüpfen.
 */
function TextSection({ entity }: { entity: WorldEntity }) {
  const db = useDb();
  const data = useData();
  const [linking, setLinking] = useState(false);
  const article = entity.lk ? data.articles[entity.lk.resourceId] : undefined;
  if (article)
    return (
      <section className="wf-welt-text" aria-label="Text">
        <ArticlePage article={article} embedded />
      </section>
    );
  const write = () => {
    flushEdits();
    openForWriting();
    createArticleOfKind(db, {
      title: entity.name,
      kind: entity.kind,
      scaffold: true,
      entityId: entity.id,
    });
  };
  return (
    <section className="wf-welt-text wf-welt-text--empty" aria-label="Text">
      <div className="wf-welt-text__head">
        <span className="wf-section-title">Text</span>
        <Button icon={<Feather />} onClick={write}>
          Schreiben
        </Button>
      </div>
      <p className="wf-welt-quiet">
        Noch kein Text. Was du schreibst, steht hier – mit [[Verweisen]] auf andere Dinge, Geheimes
        als eigener Kasten.
      </p>
      {entity.lk || linking ? (
        <LkArticlePanel
          link={entity.lk}
          onLink={(lk) => db.patch('entities', entity.id, { lk })}
          suggest={entity.name}
        />
      ) : (
        <button type="button" className="wf-welt-linkish" onClick={() => setLinking(true)}>
          <Link2 aria-hidden /> Mit einem Artikel in LegendKeeper verknüpfen …
        </button>
      )}
    </section>
  );
}
