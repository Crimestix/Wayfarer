/**
 * Steckbrief und Welt: zeigt am Artikel, was sein Steckbrief sagt und noch nicht in der Welt
 * steht, und auf der Startseite des Wikis dasselbe für alle Artikel. Gelesen wird nach den festen
 * Regeln in `facts.ts`; geschrieben über `syncFacts`.
 */
import { useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ScanText } from 'lucide-react';
import type { CampaignDb } from '../../data/db';
import { useData, useDb } from '../../data/hooks';
import { KIND_LABEL } from '../../domain/derive';
import type { Article, CampaignData, EntityKind } from '../../domain/schema';
import { Button, KindIcon, MenuItem, Popover, entityHref, toast } from '../../ui';
import { relationType } from '../../domain/relations';
import { acceptHint, createNamedEntity, dismissHint, syncFacts } from './actions';
import { flushEdits } from './editing';
import { FIELD_LABEL, pendingFacts, type MissingName, type PendingFacts } from './facts';
import { entitiesOfArticle } from './model';
import { allRelationHints, relationHints, type ArticleHints, type RelationHint } from './sentences';

const MANY = 4;

/** „Aufenthaltsort: Hohenfurt · Zuhause: Hohenfurt und 2 weitere“ */
const brief = (changes: string[]): string =>
  changes.length > MANY
    ? `${changes.slice(0, MANY).join(' · ')} und ${changes.length - MANY} weitere`
    : changes.join(' · ');

/**
 * Trägt in die Welt ein, was die Steckbriefe dieser Artikel sagen (ohne Angabe: aller), und meldet
 * es kurz – mit „Rückgängig“. Ohne Änderung bleibt es still.
 */
export function applyFacts(db: CampaignDb, articleIds?: readonly string[]): void {
  const sync = syncFacts(db, articleIds);
  const total = sync.created.length + sync.changed.length;
  if (!total) return;
  const one = sync.changed.length === 1 && sync.created.length <= 1 ? sync.changed[0]! : null;
  const fresh = sync.created.map((e) => `${e.name} (${KIND_LABEL[e.kind]})`);
  toast({
    title: one
      ? `Aus dem Steckbrief übernommen: ${one.entity.name}`
      : sync.changed.length
        ? `Aus den Steckbriefen übernommen: ${sync.changed.length} Einträge`
        : 'Neu in der Welt',
    body: [one ? brief(one.changes) : '', fresh.length ? `Neu in der Welt: ${brief(fresh)}` : '']
      .filter(Boolean)
      .join(' – '),
    action: { label: 'Rückgängig', run: sync.undo },
    duration: 9000,
  });
}

const pendingCache = new WeakMap<CampaignData, PendingFacts>();

function usePending(articleId?: string): PendingFacts {
  const data = useData();
  return useMemo(() => {
    if (articleId) return pendingFacts(data, [articleId]);
    let all = pendingCache.get(data);
    if (!all) {
      all = pendingFacts(data);
      pendingCache.set(data, all);
    }
    return all;
  }, [data, articleId]);
}

/** Knopf „anlegen als …“ für einen Namen, den ein Steckbrief nennt. */
function CreateMissing({ missing }: { missing: MissingName }) {
  const db = useDb();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const create = (kind: EntityKind) => {
    setOpen(false);
    flushEdits();
    const { entity, undo } = createNamedEntity(db, missing.name, kind, missing.articleIds);
    toast({
      title: `„${entity.name}“ steht jetzt in der Welt`,
      body: `als ${KIND_LABEL[kind]} – die Steckbriefe zeigen darauf.`,
      action: { label: 'Rückgängig', run: undo },
    });
  };
  const kinds = missing.kinds;
  if (!kinds.length) return null;
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="wf-wiki-facts__act"
        title={`Einen Eintrag „${missing.name}“ in der Welt anlegen`}
        onClick={() => (kinds.length === 1 ? create(kinds[0]!) : setOpen((o) => !o))}
      >
        {kinds.length === 1 ? `als ${KIND_LABEL[kinds[0]!]} anlegen` : 'anlegen als …'}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} width={220}>
        {kinds.map((kind) => (
          <MenuItem key={kind} icon={<KindIcon kind={kind} />} onClick={() => create(kind)}>
            als {KIND_LABEL[kind]}
          </MenuItem>
        ))}
      </Popover>
    </>
  );
}

/** „verwandt mit“, „dient“ … – oder „ist zu Hause in“ für das Zuhause. */
const hintLabel = (type: string) =>
  type === 'home' ? 'ist zu Hause in' : relationType(type).label;

/** Ein Vorschlag aus einem Satz: eintragen oder ablehnen. */
function HintRow({ article, hint }: { article: Article; hint: RelationHint }) {
  const db = useDb();
  const accept = () => {
    flushEdits();
    const undo = acceptHint(db, hint);
    toast({
      title: 'In die Welt eingetragen',
      body: `${hint.from.name} ${hintLabel(hint.type)} ${hint.to.name}`,
      action: { label: 'Rückgängig', run: undo },
    });
  };
  const dismiss = () => {
    flushEdits();
    const undo = dismissHint(db, article.id, hint.key);
    toast({
      title: 'Vorschlag verworfen',
      body: 'Er wird für diesen Artikel nicht wieder gezeigt.',
      action: { label: 'Rückgängig', run: undo },
    });
  };
  return (
    <div className="wf-wiki-facts__row" title={`Gelesen aus: „${hint.sentence}“`}>
      <span className="wf-wiki-facts__label">Im Text</span>
      <span>
        <span className="wf-wiki-facts__what">{hint.from.name}</span> {hintLabel(hint.type)}{' '}
        <span className="wf-wiki-facts__what">{hint.to.name}</span>
      </span>
      <button type="button" className="wf-wiki-facts__act" onClick={accept}>
        Eintragen
      </button>
      <button type="button" className="wf-wiki-facts__act" onClick={dismiss}>
        Stimmt nicht
      </button>
    </div>
  );
}

/** Am Artikel: was sein Steckbrief und sein Text sagen und in der Welt noch fehlt. */
export function FactsHint({ article }: { article: Article }) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const pending = usePending(article.id);
  const hints = useMemo(
    () => relationHints(data, article, entitiesOfArticle(data, article.id)[0]),
    [data, article],
  );
  const apply = () => {
    flushEdits();
    applyFacts(db, [article.id]);
  };
  if (!pending.changes.length && !pending.create.length && !pending.missing.length && !hints.length)
    return null;
  return (
    <div className="wf-wiki-facts" role="status">
      {pending.create.map(({ kind }) => (
        <div key="create" className="wf-wiki-facts__row">
          <span className="wf-wiki-facts__label">Steckbrief</span>
          <span>
            beschreibt{' '}
            {kind === 'person' || kind === 'faction' || kind === 'family' ? 'eine' : 'einen'}{' '}
            <span className="wf-wiki-facts__what">{KIND_LABEL[kind]}</span>, steht aber noch nicht
            in der Welt.
          </span>
          <button type="button" className="wf-wiki-facts__act" onClick={apply}>
            Als {KIND_LABEL[kind]} anlegen
          </button>
        </div>
      ))}
      {pending.changes.map(({ entity, changes }) => (
        <div key={entity.id} className="wf-wiki-facts__row">
          <span className="wf-wiki-facts__label">Steckbrief</span>
          <span>
            sagt mehr als der Eintrag in der Welt:{' '}
            <span className="wf-wiki-facts__what">{brief(changes)}</span>
          </span>
          <button type="button" className="wf-wiki-facts__act" onClick={apply}>
            Übernehmen
          </button>
          <button
            type="button"
            className="wf-wiki-facts__act"
            onClick={() => navigate(entityHref(entity))}
          >
            Eintrag ansehen
          </button>
        </div>
      ))}
      {pending.missing.map((missing) => (
        <div key={missing.name} className="wf-wiki-facts__row">
          <span className="wf-wiki-facts__label">
            {missing.fields.map((field) => FIELD_LABEL[field]).join(', ')}
          </span>
          <span>
            <span className="wf-wiki-facts__what">„{missing.name}“</span> hat noch keinen Eintrag in
            der Welt.
          </span>
          <CreateMissing missing={missing} />
        </div>
      ))}
      {hints.map((hint) => (
        <HintRow key={hint.key} article={article} hint={hint} />
      ))}
    </div>
  );
}

const hintCache = new WeakMap<CampaignData, ArticleHints[]>();

const SHOWN = 12;

/** Auf der Startseite des Wikis: alle Steckbriefe auf einmal auswerten. */
export function FactsOverview() {
  const db = useDb();
  const data = useData();
  const pending = usePending();
  const [all, setAll] = useState(false);
  const [allHints, setAllHints] = useState(false);
  const hinted = useMemo(() => {
    let list = hintCache.get(data);
    if (!list) {
      list = allRelationHints(data);
      hintCache.set(data, list);
    }
    return list;
  }, [data]);
  const rows = hinted.flatMap(({ article, hints }) => hints.map((hint) => ({ article, hint })));
  const shownRows = allHints ? rows : rows.slice(0, SHOWN);
  const count = pending.changes.length + pending.create.length;
  if (!count && !pending.missing.length && !rows.length) return null;
  const missing = all ? pending.missing : pending.missing.slice(0, SHOWN);
  return (
    <section className="wf-wiki-factsall" aria-label="Steckbriefe und Welt">
      <h2 className="wf-lk-label">Steckbriefe und Welt</h2>
      {count > 0 && (
        <>
          <p className="wf-mute">
            {count === 1 ? 'Ein Steckbrief sagt' : `${count} Steckbriefe sagen`} etwas, das noch
            nicht in der Welt steht – Beruf, Aufenthaltsort, Zuhause, Zugehörigkeit und Ähnliches.
            {pending.create.length > 0 &&
              ` ${
                pending.create.length === 1
                  ? 'Ein Artikel bekäme dabei einen Eintrag'
                  : `${pending.create.length} Artikel bekämen dabei einen Eintrag`
              }, weil sein Steckbrief verrät, was er beschreibt.`}{' '}
            Was du in der Welt von Hand geändert hast, bleibt, solange der Steckbrief nichts Neues
            sagt.
          </p>
          <Button icon={<ScanText />} onClick={() => applyFacts(db)}>
            Alle Steckbriefe übernehmen
          </Button>
        </>
      )}
      {pending.missing.length > 0 && (
        <>
          <p className="wf-mute">
            Diese Namen stehen in Steckbriefen, haben aber keinen Eintrag in der Welt. Angelegt
            zeigen die Steckbriefe von selbst darauf.
          </p>
          <ul className="wf-wiki-factsall__list">
            {missing.map((entry) => (
              <li key={entry.name}>
                <span className="wf-wiki-facts__row">
                  <span className="wf-wiki-facts__what">{entry.name}</span>
                  <CreateMissing missing={entry} />
                </span>
                <span className="wf-wiki-factsall__sub">
                  {entry.fields.map((field) => FIELD_LABEL[field]).join(', ')} bei{' '}
                  {entry.articleIds
                    .slice(0, 3)
                    .map((id) => data.articles[id]?.title ?? '?')
                    .join(', ')}
                  {entry.articleIds.length > 3 && ` und ${entry.articleIds.length - 3} weiteren`}
                </span>
              </li>
            ))}
          </ul>
          {pending.missing.length > missing.length && (
            <button type="button" className="wf-wiki-more" onClick={() => setAll(true)}>
              und {pending.missing.length - missing.length} weitere
            </button>
          )}
        </>
      )}
      {rows.length > 0 && (
        <>
          <p className="wf-mute">
            Aus Sätzen gelesen – Beziehungen, die im Text stehen, aber nicht in der Welt. Der Satz
            erscheint, wenn du mit der Maus auf der Zeile bleibst. Eingetragen wird nur, was du
            bestätigst.
          </p>
          <div className="wf-wiki-facts wf-wiki-facts--list">
            {shownRows.map(({ article, hint }) => (
              <HintRow key={`${article.id}|${hint.key}`} article={article} hint={hint} />
            ))}
          </div>
          {rows.length > shownRows.length && (
            <button type="button" className="wf-wiki-more" onClick={() => setAllHints(true)}>
              und {rows.length - shownRows.length} weitere
            </button>
          )}
        </>
      )}
    </section>
  );
}
