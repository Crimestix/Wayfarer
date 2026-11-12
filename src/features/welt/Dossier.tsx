/** Dossier eines Eintrags: Kopf mit dem Wichtigsten, darunter die Reiter. */
import { useState, type CSSProperties } from 'react';
import { useLocation } from 'wouter';
import { BookOpen, EyeOff, Feather, Footprints, Pencil, Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { KIND_LABEL, attitudeHistory, attitudeToParty, chronicleFor } from '../../domain/derive';
import { RULES_ATTITUDE_LABEL, attitudeLevel } from '../../domain/relations';
import { PARTY_ID, type Faction, type Person } from '../../domain/schema';
import { formatRelative } from '../../domain/time/calendar';
import { openAttitude, openQuickLog } from '../../shell/commands';
import {
  AttitudeBadge,
  Badge,
  Button,
  ChronicleList,
  EmptyState,
  IconButton,
  Portrait,
  Tabs,
  confirmDialog,
  cx,
  toast,
} from '../../ui';
import { LkArticlePanel } from '../legendkeeper';
import { ArticlePage } from '../wiki';
import { createArticle } from '../wiki/actions';
import { deleteEntityUndoable } from './actions';
import { openEntityDialog } from './editor';
import {
  deletionImpact,
  deletionNotes,
  entityFacts,
  isLongName,
  relationRows,
  type WorldEntity,
} from './model';
import { OverviewTab, type DossierTab, type RelationIntent } from './OverviewTab';
import { AttitudePips, Facts, attitudeVar } from './parts';
import { FamilyTree } from './FamilyTree';
import { RelationsTab } from './RelationsTab';

export function Dossier({ entity }: { entity: WorldEntity }) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  // Wer einen Artikel hat, beginnt mit dem Text – er ist die Quelle; sonst mit dem Überblick.
  const [tab, setTabState] = useState<DossierTab>(() =>
    entity.lk && data.articles[entity.lk.resourceId] ? 'lk' : 'overview',
  );
  /** Aus dem Überblick heraus: im Reiter „Beziehungen“ gleich den Dialog öffnen. */
  const [intent, setIntent] = useState<RelationIntent | undefined>();
  const setTab = (next: DossierTab, nextIntent?: RelationIntent) => {
    setTabState(next);
    setIntent(nextIntent);
  };
  const chronicle = chronicleFor(data, entity.id);
  const relationCount = relationRows(data, entity.id).length;
  const partyHere = entity.kind === 'place' && data.state.placeId === entity.id;
  /** Der verknüpfte Artikel, wenn er im eigenen Wiki liegt. */
  const localArticle =
    entity.lk && data.articles[entity.lk.resourceId] ? entity.lk.resourceId : null;
  const log = () => openQuickLog({ refs: [entity.id] });

  const remove = async () => {
    const notes = deletionNotes(deletionImpact(data, entity.id));
    const ok = await confirmDialog({
      title: `„${entity.name}“ löschen?`,
      body: (
        <div className="wf-col">
          <p>Der Eintrag wird aus der Weltdatenbank entfernt.</p>
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

  return (
    <article className="wf-welt-dossier">
      <header className="wf-welt-hero">
        <div className="wf-welt-hero__image">
          <Portrait entity={entity} size={120} />
        </div>
        <div className="wf-welt-hero__title">
          <div className="wf-welt-hero__kind">
            <span>{KIND_LABEL[entity.kind]}</span>
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
        </div>
        <div className="wf-welt-hero__more">
          {entity.tagline ? (
            <p className="wf-welt-hero__tagline">{entity.tagline}</p>
          ) : (
            <button
              type="button"
              className="wf-welt-hero__tagline wf-welt-hero__tagline--missing"
              onClick={() => openEntityDialog({ mode: 'edit', id: entity.id })}
            >
              Noch ohne Kurzbeschreibung – ein Satz, der am Tisch reicht.
            </button>
          )}
          <Facts facts={entityFacts(data, entity)} />
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
            variant="primary"
            icon={<Feather />}
            onClick={log}
            title="Etwas zu diesem Eintrag festhalten"
          >
            Festhalten
          </Button>
          <Button
            icon={<Pencil />}
            onClick={() => openEntityDialog({ mode: 'edit', id: entity.id })}
            title="Eintrag bearbeiten"
            aria-label="Bearbeiten"
          >
            <span className="wf-welt-hero__wide">Bearbeiten</span>
          </Button>
          <IconButton label="Eintrag löschen" variant="ghost" onClick={remove}>
            <Trash2 />
          </IconButton>
        </div>
      </header>

      {(entity.kind === 'person' || entity.kind === 'faction') && <AttitudeBand entity={entity} />}

      <div className="wf-welt-tabs">
        <Tabs<DossierTab>
          tabs={[
            ...(localArticle ? [{ id: 'lk' as const, label: 'Text' }] : []),
            { id: 'overview', label: 'Überblick' },
            { id: 'relations', label: 'Beziehungen', count: relationCount || undefined },
            // Eine Familie zeigt, wie ihre Mitglieder miteinander verwandt sind.
            ...(entity.kind === 'family' ? [{ id: 'tree' as const, label: 'Stammbaum' }] : []),
            { id: 'chronicle', label: 'Chronik', count: chronicle.length || undefined },
            // Ohne eigenen Artikel steht der Text am Ende: schreiben oder mit LegendKeeper verknüpfen.
            ...(localArticle ? [] : [{ id: 'lk' as const, label: 'Text' }]),
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      <div className="wf-welt-body">
        {tab === 'overview' && <OverviewTab entity={entity} onShowTab={setTab} />}
        {tab === 'relations' && <RelationsTab entity={entity} startNew={intent} />}
        {tab === 'tree' && entity.kind === 'family' && <FamilyTree family={entity} />}
        {tab === 'chronicle' && (
          <div className="wf-welt-chron">
            <div className="wf-welt-rel__bar">
              <p className="wf-welt-lead">
                {entity.kind === 'place'
                  ? 'Alles, was hier und in den Orten darunter geschah – das Neueste zuerst.'
                  : `Alles, was mit ${entity.name} geschah – das Neueste zuerst.`}
              </p>
              <Button icon={<Feather />} onClick={log}>
                Festhalten
              </Button>
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
                    <Button variant="primary" icon={<Feather />} onClick={log}>
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
        {tab === 'lk' && localArticle && (
          <ArticlePage article={data.articles[localArticle]!} embedded />
        )}
        {tab === 'lk' && !localArticle && (
          <div className="wf-welt-write">
            <p>
              Zu „{entity.name}“ gibt es noch keinen Artikel. Schreib ihn hier – was im Steckbrief
              steht, liest Wayfarer in den Überblick.
            </p>
            <Button
              variant="primary"
              icon={<Feather />}
              onClick={() => {
                const article = createArticle(db, { title: entity.name });
                if (article)
                  db.patch('entities', entity.id, {
                    lk: { resourceId: article.id, title: article.title },
                  });
              }}
            >
              Artikel schreiben
            </Button>
          </div>
        )}
        {tab === 'lk' && !localArticle && (
          <LkArticlePanel
            link={entity.lk}
            onLink={(lk) => db.patch('entities', entity.id, { lk })}
            suggest={entity.name}
          />
        )}
      </div>
    </article>
  );
}

/** Haltung zur Gruppe – das Erste, was man am Tisch über eine Person wissen will. */
function AttitudeBand({ entity }: { entity: Person | Faction }) {
  const data = useData();
  const value = attitudeToParty(data, entity.id);
  const level = attitudeLevel(value);
  const history = attitudeHistory(data, entity.id, PARTY_ID);
  const last = history[history.length - 1];
  return (
    <section className="wf-welt-att" style={{ '--att-color': attitudeVar(value) } as CSSProperties}>
      <div className="wf-welt-att__label">Haltung zur Gruppe</div>
      <div className="wf-welt-att__value">
        <AttitudeBadge value={value} />
      </div>
      <AttitudePips value={value} />
      <div className="wf-welt-att__note wf-clamp-1">
        {level ? (
          <>
            Nach Regelwerk: {RULES_ATTITUDE_LABEL[level.rules].toLowerCase()}
            {last && ` · zuletzt geändert ${formatRelative(data.state.now, last.at)}`}
            {last?.text && ` – ${last.text}`}
          </>
        ) : (
          'Noch nicht festgelegt.'
        )}
      </div>
      <Button onClick={() => openAttitude({ fromId: entity.id })}>
        {level ? 'Ändern' : 'Festlegen'}
      </Button>
    </section>
  );
}
