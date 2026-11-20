/**
 * „Noch zu schreiben“ – eine Sicht der Welt: links als knappe Liste, rechts auf der Bühne mit den
 * Stellen, an denen etwas erwähnt wird. Gerechnet wird in `wiki/gaps.ts`; hier wird nur gezeigt.
 * Platzhalter aus Geschichten stehen zuerst und offen, alles andere zugeklappt, Dinge ohne Text
 * nach Art (`groupByKind`). Ein Klick auf einen fehlenden Titel legt den Text an (Art wählbar,
 * mit Steckbrief-Gerüst).
 */
import { useDeferredValue, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ChevronRight, FilePlus2, Feather } from 'lucide-react';
import { useData } from '../../data/hooks';
import { KIND_LABEL, KIND_LABEL_PLURAL } from '../../domain/derive';
import type { Article, Entity, EntityKind } from '../../domain/schema';
import { stubRows, type StubRow } from '../../domain/stub';
import { Button, KindIcon, cx } from '../../ui';
import { openForWriting } from '../wiki';
import { NewArticleDialog } from '../wiki/ArticleTools';
import {
  STUB_WORDS,
  gapCount,
  groupByKind,
  newArticleParent,
  wikiGaps,
  type GapMention,
  type MissingTitle,
  type WikiData,
  type WikiGaps,
} from '../wiki/gaps';
import { ArticleIcon } from '../wiki/icons';
import { FoldHead, Section } from './parts';

/** Was in „Noch zu schreiben“ aufgeklappt ist, solange die App läuft (Vorgabe: zu). */
const folds: Record<string, boolean> = { stubs: true };

function useFold(key: string): [boolean, () => void] {
  const [open, setOpen] = useState(folds[key] ?? false);
  return [
    open,
    () =>
      setOpen((before) => {
        folds[key] = !before;
        return !before;
      }),
  ];
}

/** „Personen“, ohne Art „Ohne Art“. */
const kindPlural = (kind: EntityKind | null) => (kind ? KIND_LABEL_PLURAL[kind] : 'Ohne Art');

const gapsCache = new WeakMap<object, WeakMap<object, WikiGaps>>();

/** Je Stand der Artikel und Einträge einmal gerechnet – Zeit, Wetter und Chronik ändern nichts daran. */
function gapsOf(data: WikiData): WikiGaps {
  let byEntities = gapsCache.get(data.articles);
  if (!byEntities) {
    byEntities = new WeakMap();
    gapsCache.set(data.articles, byEntities);
  }
  let gaps = byEntities.get(data.entities);
  if (!gaps) {
    gaps = wikiGaps(data);
    byEntities.set(data.entities, gaps);
  }
  return gaps;
}

/** Was im Wiki noch zu schreiben ist. */
export function useWikiGaps(): WikiGaps {
  // Nachgezogen, nicht im Takt des Tippens: Gerechnet wird über alle Artikel.
  const { articles, entities } = useDeferredValue(useData());
  return useMemo(() => gapsOf({ articles, entities }), [articles, entities]);
}

/** Platzhalter, die beim Schreiben entstanden sind – nach Geschichte. */
export function useStubRows(): StubRow[] {
  const { entities, articles, stories } = useData();
  return useMemo(() => stubRows({ entities, articles, stories }), [entities, articles, stories]);
}

/** Die Zahl für „Noch zu schreiben: 12“ – Platzhalter zählen mit, jeder Eintrag einmal. */
export function useGapCount(): number {
  const gaps = useWikiGaps();
  const stubs = useStubRows();
  const counted = new Set(
    gaps.entries.filter((entry) => entry.count > 0).map((entry) => entry.entity.id),
  );
  return gapCount(gaps) + stubs.filter((row) => !counted.has(row.entity.id)).length;
}

/** Woher ein Platzhalter stammt – in Worten. */
const stubOrigin = (row: StubRow): string =>
  row.story ? `aus „${row.story.title}“` : 'beim Schreiben angelegt';

/** Was angelegt werden soll: ein fehlender Titel oder der Artikel zu einem Eintrag. */
type Creating =
  | { title: string; kind: EntityKind | null; fromIds: string[]; entity?: undefined }
  | { entity: Entity; fromIds: string[]; title?: undefined; kind?: undefined };

/** Das Fenster zum Anlegen – danach öffnet sich der Artikel zum Schreiben. */
function useCreate(): [(what: Creating) => void, ReactNode] {
  const data = useData();
  const [, navigate] = useLocation();
  const [creating, setCreating] = useState<Creating | null>(null);
  const dialog = creating && (
    <NewArticleDialog
      parent={null}
      initialTitle={creating.title ?? ''}
      kind={creating.kind ?? null}
      {...(creating.entity ? { entity: creating.entity } : {})}
      suggestParent={(kind) => newArticleParent(data.articles, kind, creating.fromIds)}
      onClose={() => setCreating(null)}
      onCreated={(article) => {
        setCreating(null);
        openForWriting();
        navigate(`/wiki/${article.id}`);
      }}
    />
  );
  return [setCreating, dialog];
}

const times = (count: number) => (count === 1 ? 'einmal' : `${count}-mal`);

const mentionText = (mentions: GapMention[]): string =>
  mentions.length === 1 ? `in ${mentions[0]!.title}` : `in ${mentions.length} Artikeln`;

// ── Links in der Übersicht ─────────────────────────────────────────────────

const INDEX_SHOWN = 40;

function IndexGroup({
  fold,
  label,
  count,
  children,
  more,
}: {
  /** Schlüssel, unter dem sich die Gruppe ihr Aufklappen merkt. */
  fold: string;
  label: string;
  count: number;
  children: ReactNode;
  /** Was nicht in der Liste steht; ein Klick zeigt die ganze Sicht. */
  more: ReactNode;
}) {
  const [, navigate] = useLocation();
  const [open, toggle] = useFold(fold);
  if (!count) return null;
  return (
    <>
      <FoldHead open={open} onToggle={toggle} label={label} count={count} />
      {open && children}
      {open && more && (
        <button type="button" className="wf-welt-gaps__more" onClick={() => navigate('/welt')}>
          {more}
        </button>
      )}
    </>
  );
}

const moreText = (count: number): string | null => (count > 0 ? `und ${count} weitere` : null);

/** Links: die Lücken als knappe Liste. */
export function GapsIndex({
  selectedId,
  articleId,
}: {
  selectedId?: string | undefined;
  articleId?: string | undefined;
}) {
  const gaps = useWikiGaps();
  const stubs = useStubRows();
  const [create, dialog] = useCreate();
  // Ein Platzhalter steht oben bei den Platzhaltern – nicht noch einmal ohne Artikel.
  const stubIds = new Set(stubs.map((row) => row.entity.id));
  const entries = gaps.entries.filter((entry) => !stubIds.has(entry.entity.id));
  const byKind = groupByKind(entries, (entry) => entry.entity.kind);
  if (
    !gapCount(gaps) &&
    !gaps.stubs.length &&
    !gaps.orphans.length &&
    !entries.length &&
    !stubs.length
  )
    return (
      <p className="wf-welt-gaps__none">
        Nichts offen: Jeder Verweis führt zu einem Artikel, und kein Artikel ist auffallend kurz.
      </p>
    );
  return (
    <div className="wf-welt-gaps__index">
      <IndexGroup
        fold="stubs"
        label="Platzhalter aus Geschichten"
        count={stubs.length}
        more={moreText(stubs.length - INDEX_SHOWN)}
      >
        {stubs.slice(0, INDEX_SHOWN).map((row) => (
          <Link
            key={row.entity.id}
            href={`/welt/${row.entity.id}`}
            className="wf-welt-row"
            aria-current={row.entity.id === selectedId ? 'page' : undefined}
          >
            <span className="wf-welt-row__icon">
              <KindIcon kind={row.entity.kind} />
            </span>
            <span className="wf-welt-row__main">
              <span className="wf-welt-row__name wf-clamp-1">{row.entity.name}</span>
              <span className="wf-welt-row__sub wf-clamp-1">
                {KIND_LABEL[row.entity.kind]} · {stubOrigin(row)}
              </span>
            </span>
          </Link>
        ))}
      </IndexGroup>
      <IndexGroup
        fold="missing"
        label="Erwähnt, fehlt noch"
        count={gaps.missing.length}
        more={moreText(gaps.missing.length - INDEX_SHOWN)}
      >
        {gaps.missing.slice(0, INDEX_SHOWN).map((entry) => (
          <button
            key={entry.title}
            type="button"
            className="wf-welt-row wf-welt-gaps__row"
            title={`Artikel „${entry.title}“ anlegen`}
            onClick={() =>
              create({
                title: entry.title,
                kind: entry.kinds[0] ?? null,
                fromIds: entry.mentions.map((m) => m.articleId),
              })
            }
          >
            <span className="wf-welt-row__icon">
              <FilePlus2 />
            </span>
            <span className="wf-welt-row__main">
              <span className="wf-welt-row__name wf-clamp-1">{entry.title}</span>
              <span className="wf-welt-row__sub wf-clamp-1">
                {times(entry.count)} erwähnt {mentionText(entry.mentions)}
              </span>
            </span>
          </button>
        ))}
      </IndexGroup>
      {byKind.map(({ kind, items }) => (
        <IndexGroup
          key={kind ?? 'ohne'}
          fold={`text:${kind ?? ''}`}
          label={`Ohne Text: ${kindPlural(kind)}`}
          count={items.length}
          more={moreText(items.length - INDEX_SHOWN)}
        >
          {items.slice(0, INDEX_SHOWN).map(({ entity, count, mentions }) => (
            <Link
              key={entity.id}
              href={`/welt/${entity.id}`}
              className="wf-welt-row"
              aria-current={entity.id === selectedId ? 'page' : undefined}
            >
              <span className="wf-welt-row__icon">
                <KindIcon kind={entity.kind} />
              </span>
              <span className="wf-welt-row__main">
                <span className="wf-welt-row__name wf-clamp-1">{entity.name}</span>
                <span className="wf-welt-row__sub wf-clamp-1">
                  {count > 0
                    ? `${times(count)} erwähnt ${mentionText(mentions)}`
                    : 'wird nirgends erwähnt'}
                </span>
              </span>
            </Link>
          ))}
        </IndexGroup>
      ))}
      <IndexGroup
        fold="short"
        label="Noch kurz"
        count={gaps.stubs.length}
        more={moreText(gaps.stubs.length - INDEX_SHOWN)}
      >
        {gaps.stubs.slice(0, INDEX_SHOWN).map(({ article, words, mentionedBy }) => (
          <ArticleRow
            key={article.id}
            article={article}
            current={article.id === articleId}
            sub={`${wordsText(words)}${mentionedBy ? ` · erwähnt in ${mentionedBy}` : ''}`}
          />
        ))}
      </IndexGroup>
      <IndexGroup
        fold="orphans"
        label="Wird nirgends erwähnt"
        count={gaps.orphans.length}
        more={moreText(gaps.orphans.length - INDEX_SHOWN)}
      >
        {gaps.orphans.slice(0, INDEX_SHOWN).map((article) => (
          <ArticleRow
            key={article.id}
            article={article}
            current={article.id === articleId}
            sub="Kein anderer Text nennt es"
          />
        ))}
      </IndexGroup>
      {dialog}
    </div>
  );
}

const wordsText = (words: number) =>
  words === 0 ? 'noch leer' : words === 1 ? 'ein Wort' : `${words} Wörter`;

function ArticleRow({
  article,
  current,
  sub,
}: {
  article: Article;
  current: boolean;
  sub: string;
}) {
  return (
    <Link
      href={`/wiki/${article.id}`}
      className="wf-welt-row"
      aria-current={current ? 'page' : undefined}
    >
      <span className="wf-welt-row__icon">
        <ArticleIcon icon={article.icon} />
      </span>
      <span className="wf-welt-row__main">
        <span className="wf-welt-row__name wf-clamp-1">{article.title}</span>
        <span className="wf-welt-row__sub wf-clamp-1">{sub}</span>
      </span>
    </Link>
  );
}

// ── Die Bühne ──────────────────────────────────────────────────────────────

/** Wo etwas erwähnt wird: je Artikel ein Stück Text, ein Klick öffnet ihn. */
function Mentions({ mentions }: { mentions: GapMention[] }) {
  return (
    <ul className="wf-welt-gaps__spots">
      {mentions.map((mention) => (
        <li key={mention.articleId}>
          <Link href={`/wiki/${mention.articleId}`} className="wf-welt-gaps__spot">
            <span className="wf-welt-gaps__where">
              {mention.title}
              {mention.count > 1 && <span> · {times(mention.count)}</span>}
            </span>
            {mention.snippet && <span className="wf-welt-gaps__snippet">{mention.snippet}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Eine Zeile mit Namen, Erwähnungen und – aufgeklappt – den Stellen. */
function GapItem({
  name,
  icon,
  count,
  mentions,
  action,
}: {
  name: ReactNode;
  icon: ReactNode;
  count: number;
  mentions: GapMention[];
  action: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="wf-welt-gaps__item">
      <div className="wf-welt-gaps__line">
        <span className="wf-welt-gaps__icon">{icon}</span>
        <span className="wf-welt-gaps__name">{name}</span>
        {mentions.length > 0 ? (
          <button
            type="button"
            className="wf-welt-gaps__count"
            aria-expanded={open}
            title="Zeigen, wo es erwähnt wird"
            onClick={() => setOpen((o) => !o)}
          >
            <ChevronRight className={cx(open && 'wf-welt-gaps__chev--open')} />
            {times(count)} erwähnt {mentionText(mentions)}
          </button>
        ) : (
          <span className="wf-welt-gaps__count wf-welt-gaps__count--none">nirgends erwähnt</span>
        )}
        <span className="wf-grow" />
        {action}
      </div>
      {open && <Mentions mentions={mentions} />}
    </li>
  );
}

const SHOWN = 30;

/** Eine Liste, die mit „und N weitere“ endet. */
function Capped<T>({ items, render }: { items: T[]; render: (item: T) => ReactNode }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, SHOWN);
  return (
    <>
      <ul className="wf-welt-gaps__list">{shown.map(render)}</ul>
      {items.length > shown.length && (
        <button type="button" className="wf-wiki-more" onClick={() => setAll(true)}>
          und {items.length - shown.length} weitere
        </button>
      )}
    </>
  );
}

/** Eine Art unter „Ohne Text“ auf der Bühne: zugeklappt, bis man an ihr weiterschreiben will. */
function KindFold({
  kind,
  count,
  children,
}: {
  kind: EntityKind | null;
  count: number;
  children: ReactNode;
}) {
  const [open, toggle] = useFold(`stage:${kind ?? ''}`);
  return (
    <div className="wf-welt-gaps__kind-group">
      <FoldHead open={open} onToggle={toggle} label={kindPlural(kind)} count={count} />
      {open && children}
    </div>
  );
}

/** Rechts auf der Bühne: alles, was noch zu schreiben ist, mit den Stellen. */
export function GapsView() {
  const gaps = useWikiGaps();
  const stubs = useStubRows();
  const [create, dialog] = useCreate();
  // Ein Platzhalter steht oben bei den Platzhaltern – nicht noch einmal ohne Text.
  const stubIds = new Set(stubs.map((row) => row.entity.id));
  const entries = gaps.entries.filter((entry) => !stubIds.has(entry.entity.id));
  const byKind = groupByKind(entries, (entry) => entry.entity.kind);
  const createMissing = (entry: MissingTitle) =>
    create({
      title: entry.title,
      kind: entry.kinds[0] ?? null,
      fromIds: entry.mentions.map((m) => m.articleId),
    });
  const writeFor = (entity: Entity, mentions: GapMention[]) =>
    create({ entity, fromIds: mentions.map((m) => m.articleId) });
  const nothing =
    !stubs.length &&
    !gaps.missing.length &&
    !entries.length &&
    !gaps.stubs.length &&
    !gaps.orphans.length;

  return (
    <div className="wf-welt-landing wf-welt-gaps">
      <header className="wf-welt-landing__head">
        <div className="wf-welt-landing__eyebrow">Wiki</div>
        <h1 className="wf-welt-landing__title">Noch zu schreiben</h1>
        <p className="wf-welt-landing__lead">
          Was dein Text erwähnt, ohne dass es dazu einen Artikel gibt, und was noch kurz geraten
          ist. Nur Hinweise – was du schreibst und wann, entscheidest du.
        </p>
      </header>

      {nothing && (
        <p className="wf-welt-gaps__none">
          Nichts offen: Jeder Verweis führt zu einem Artikel, jeder Eintrag hat seinen Text, und
          kein Artikel ist auffallend kurz.
        </p>
      )}

      {stubs.length > 0 && (
        <Section title="Platzhalter aus Geschichten" count={stubs.length}>
          <p className="wf-welt-gaps__lead">
            Beim Schreiben angelegt: ein Name, eine Art, höchstens ein Satz. Sobald du Notizen oder
            einen Text dazu schreibst, ist es kein Platzhalter mehr.
          </p>
          <Capped
            items={stubs}
            render={(row) => (
              <li key={row.entity.id} className="wf-welt-gaps__item">
                <div className="wf-welt-gaps__line">
                  <span className="wf-welt-gaps__icon">
                    <KindIcon kind={row.entity.kind} />
                  </span>
                  <Link href={`/welt/${row.entity.id}`} className="wf-welt-gaps__link">
                    {row.entity.name}
                  </Link>
                  <span className="wf-welt-gaps__stubline wf-clamp-1">
                    {KIND_LABEL[row.entity.kind]}
                    {row.entity.tagline && ` · ${row.entity.tagline}`}
                  </span>
                  <span className="wf-grow" />
                  {row.story ? (
                    <Link href={`/geschichte/${row.story.id}`} className="wf-welt-gaps__from">
                      {stubOrigin(row)}
                    </Link>
                  ) : (
                    <span className="wf-welt-gaps__kind">{stubOrigin(row)}</span>
                  )}
                </div>
              </li>
            )}
          />
        </Section>
      )}

      {gaps.missing.length > 0 && (
        <Section title="Erwähnt, aber noch nicht angelegt" count={gaps.missing.length}>
          <p className="wf-welt-gaps__lead">
            Auf diese Titel verweist dein Text in Klammern, ohne dass es den Artikel gibt – am
            häufigsten erwähnte zuerst. Ein Klick auf den Namen legt ihn an.
          </p>
          <Capped
            items={gaps.missing}
            render={(entry) => (
              <GapItem
                key={entry.title}
                icon={<FilePlus2 />}
                name={
                  <button
                    type="button"
                    className="wf-welt-gaps__create"
                    title={`Artikel „${entry.title}“ anlegen`}
                    onClick={() => createMissing(entry)}
                  >
                    {entry.title}
                  </button>
                }
                count={entry.count}
                mentions={entry.mentions}
                action={
                  entry.kinds[0] && (
                    <span
                      className="wf-welt-gaps__kind"
                      title="Gelesen aus dem Feld des Steckbriefs"
                    >
                      wohl {KIND_LABEL[entry.kinds[0]]}
                    </span>
                  )
                }
              />
            )}
          />
        </Section>
      )}

      {entries.length > 0 && (
        <Section title="Ohne Text" count={entries.length}>
          <p className="wf-welt-gaps__lead">
            Diese Dinge stehen in der Welt, haben aber noch keinen Text – nach Art, erwähnte zuerst.
            Aufklappen, wenn du an einer Art weiterschreiben willst.
          </p>
          {byKind.map(({ kind, items }) => (
            <KindFold key={kind ?? 'ohne'} kind={kind} count={items.length}>
              <Capped
                items={items}
                render={({ entity, count, mentions }) => (
                  <GapItem
                    key={entity.id}
                    icon={<KindIcon kind={entity.kind} />}
                    name={
                      <Link href={`/welt/${entity.id}`} className="wf-welt-gaps__link">
                        {entity.name}
                      </Link>
                    }
                    count={count}
                    mentions={mentions}
                    action={
                      <Button
                        size="sm"
                        icon={<Feather />}
                        onClick={() => writeFor(entity, mentions)}
                      >
                        Text schreiben
                      </Button>
                    }
                  />
                )}
              />
            </KindFold>
          ))}
        </Section>
      )}

      {gaps.stubs.length > 0 && (
        <Section title="Noch kurz" count={gaps.stubs.length}>
          <p className="wf-welt-gaps__lead">
            Artikel mit weniger als {STUB_WORDS} Wörtern Text neben dem Steckbrief – oft erwähnte
            zuerst.
          </p>
          <Capped
            items={gaps.stubs}
            render={({ article, words, mentionedBy }) => (
              <li key={article.id} className="wf-welt-gaps__item">
                <div className="wf-welt-gaps__line">
                  <span className="wf-welt-gaps__icon">
                    <ArticleIcon icon={article.icon} />
                  </span>
                  <Link href={`/wiki/${article.id}`} className="wf-welt-gaps__link">
                    {article.title}
                  </Link>
                  <span className="wf-welt-gaps__count wf-welt-gaps__count--none">
                    {wordsText(words)}
                    {mentionedBy > 0 &&
                      ` · erwähnt in ${mentionedBy === 1 ? 'einem Artikel' : `${mentionedBy} Artikeln`}`}
                  </span>
                </div>
              </li>
            )}
          />
        </Section>
      )}

      {gaps.orphans.length > 0 && (
        <Section title="Wird nirgends erwähnt" count={gaps.orphans.length}>
          <p className="wf-welt-gaps__lead">
            Kein anderer Text nennt diese – weder in Klammern noch mit dem Namen. Ordnerseiten und
            Vorlagen fehlen hier.
          </p>
          <Capped
            items={gaps.orphans}
            render={(article) => (
              <li key={article.id} className="wf-welt-gaps__item">
                <div className="wf-welt-gaps__line">
                  <span className="wf-welt-gaps__icon">
                    <ArticleIcon icon={article.icon} />
                  </span>
                  <Link href={`/wiki/${article.id}`} className="wf-welt-gaps__link">
                    {article.title}
                  </Link>
                </div>
              </li>
            )}
          />
        </Section>
      )}
      {dialog}
    </div>
  );
}
