/**
 * „Was darin steht“ im Abschnitt „Buch“: ein Thema der Welt wählen (Art, Einordnung, Schlagwort,
 * Gegend, Ordner, Suche nach Namen), alle Einträge dazu sehen und ankreuzen, was im Buch steht.
 * „Alles aus diesem Thema“ nimmt auch, was später dazukommt. Welches Thema gerade offen ist, ist
 * Ansicht der Seite, nicht Spielstand. Gerechnet wird in `domain/book.ts` und
 * `domain/bookTopics.ts`, geschrieben über `./book.ts`.
 */
import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { topicListing, type BookItem, type TopicRow } from '../../domain/book';
import {
  bookRules,
  bookTopics,
  emptyTopic,
  isEmptyTopic,
  sameTopic,
  topicLabel,
  wordKey,
  type BookTopic,
} from '../../domain/bookTopics';
import { KIND_LABEL_PLURAL } from '../../domain/derive';
import { Button, Checkbox, IconButton, Input, Select, cx } from '../../ui';
import { setBookRule, setInBook } from './book';
import { entitySubline } from './model';

/** So viele Einträge stehen zuerst in der Liste; der Rest auf Wunsch. */
const ROWS_SHOWN = 150;
/** So viele Namen nennt „Außerdem im Buch“ zuerst. */
const ELSEWHERE_SHOWN = 12;

export function BookTopics({ item }: { item: BookItem }) {
  const db = useDb();
  const data = useData();
  const { selection } = item.item.book;
  const rules = useMemo(() => bookRules(selection), [selection]);
  // Zuerst das erste Thema des Buches – sonst wird gewählt.
  const [topic, setTopic] = useState<BookTopic>(() => rules[0] ?? emptyTopic());
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [showElsewhere, setShowElsewhere] = useState(false);
  const topics = useMemo(() => bookTopics(data, topic.kind), [data, topic.kind]);
  const listing = useMemo(() => topicListing(data, item, topic, query), [data, item, topic, query]);

  const choose = (change: Partial<BookTopic>) => {
    setTopic((now) => ({ ...now, ...change }));
    setShowAll(false);
  };
  const pickKind = (kind: BookTopic['kind']) =>
    // Einordnungen gehören zur Art – mit der Art wechselt die Wahl.
    choose(kind === topic.kind ? { kind: null, category: '' } : { kind, category: '' });

  const rows = listing.groups.flatMap((group) => group.rows);
  const ids = (list: TopicRow[]) => list.map((row) => row.entity.id);
  let left = showAll ? Infinity : ROWS_SHOWN;
  const groups = listing.groups
    .map((group) => {
      const shown = group.rows.slice(0, Math.max(0, left));
      left -= shown.length;
      return { ...group, shown };
    })
    .filter((group) => group.shown.length > 0);
  const hiddenRows = rows.length - groups.reduce((sum, group) => sum + group.shown.length, 0);
  const elsewhere = showElsewhere ? listing.elsewhere : listing.elsewhere.slice(0, ELSEWHERE_SHOWN);

  // Was gewählt ist, steht in der Auswahl, auch wenn es gerade nichts mehr dazu gibt.
  const withChosen = <T,>(list: T[], has: (entry: T) => boolean, chosen: T | null) =>
    chosen && !list.some(has) ? [chosen, ...list] : list;
  const tagChoices = withChosen(
    topics.tags.map((tag) => tag.label),
    (tag) => wordKey(tag) === wordKey(topic.tag),
    topic.tag.trim() || null,
  );
  const regionChoices = withChosen(
    topics.regions,
    (region) => region.id === topic.regionId,
    topic.regionId
      ? { id: topic.regionId, name: data.entities[topic.regionId]?.name ?? 'Gelöscht', depth: 0 }
      : null,
  );
  const folderChoices = withChosen(
    topics.folders,
    (folder) => folder.id === topic.folderId,
    topic.folderId
      ? {
          id: topic.folderId,
          title: data.articles[topic.folderId]?.title ?? 'Gelöscht',
          path: [],
          depth: 0,
          count: 0,
        }
      : null,
  );
  const categoryOn = (label: string) => wordKey(label) === wordKey(topic.category);
  const pad = (depth: number) => ' '.repeat(Math.min(depth, 6));

  return (
    <div className="wf-welt-booktopic">
      {rules.length > 0 && (
        <div className="wf-welt-booktopic__line">
          <span className="wf-welt-booksec__label">Ganz im Buch</span>
          {rules.map((rule) => (
            <button
              key={`${rule.kind}|${rule.category}|${rule.tag}|${rule.regionId}|${rule.folderId}`}
              type="button"
              className="wf-welt-booksec__chip"
              aria-pressed={sameTopic(rule, topic)}
              title="Dieses Thema durchsehen"
              onClick={() => {
                setTopic(rule);
                setShowAll(false);
              }}
            >
              {topicLabel(data, rule)}
            </button>
          ))}
        </div>
      )}

      <div className="wf-welt-booksec__chips" aria-label="Arten">
        {topics.kinds.map(({ kind, count }) => (
          <button
            key={kind}
            type="button"
            className="wf-welt-booksec__chip"
            aria-pressed={topic.kind === kind}
            onClick={() => pickKind(kind)}
          >
            {KIND_LABEL_PLURAL[kind]} <span className="wf-welt-booktopic__count">{count}</span>
          </button>
        ))}
      </div>

      {topic.kind && topics.categories.length > 0 && (
        <div className="wf-welt-booktopic__line" aria-label="Einordnungen">
          <span className="wf-welt-booksec__label">Einordnung</span>
          {topics.categories.map((category) => (
            <button
              key={category.label}
              type="button"
              className="wf-welt-booksec__chip"
              aria-pressed={categoryOn(category.label)}
              onClick={() => choose({ category: categoryOn(category.label) ? '' : category.label })}
            >
              {category.label} <span className="wf-welt-booktopic__count">{category.count}</span>
            </button>
          ))}
        </div>
      )}

      <div className="wf-welt-booktopic__filters">
        <label className="wf-welt-booktopic__filter">
          <span className="wf-welt-booksec__label">Schlagwort</span>
          <Select
            value={topic.tag}
            disabled={tagChoices.length === 0}
            onChange={(e) => choose({ tag: e.target.value })}
          >
            <option value="">{tagChoices.length ? 'Jedes' : 'Keine Schlagworte'}</option>
            {tagChoices.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </Select>
        </label>
        <label className="wf-welt-booktopic__filter">
          <span className="wf-welt-booksec__label">Gegend</span>
          <Select
            value={topic.regionId ?? ''}
            disabled={regionChoices.length === 0}
            onChange={(e) => choose({ regionId: e.target.value || null })}
          >
            <option value="">Überall</option>
            {regionChoices.map((region) => (
              <option key={region.id} value={region.id}>
                {pad(region.depth)}
                {region.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="wf-welt-booktopic__filter">
          <span className="wf-welt-booksec__label">Ordner</span>
          <Select
            value={topic.folderId ?? ''}
            disabled={folderChoices.length === 0}
            onChange={(e) => choose({ folderId: e.target.value || null })}
          >
            <option value="">{folderChoices.length ? 'Jeder' : 'Keine Ordner'}</option>
            {folderChoices.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {pad(folder.depth)}
                {folder.title}
                {folder.count ? ` (${folder.count})` : ''}
              </option>
            ))}
          </Select>
        </label>
        <label className="wf-welt-booktopic__filter">
          <span className="wf-welt-booksec__label">Name</span>
          <Input
            type="search"
            value={query}
            placeholder="Suchen …"
            onChange={(e) => {
              setQuery(e.target.value);
              setShowAll(false);
            }}
          />
        </label>
      </div>

      {listing.idle ? (
        <p className="wf-welt-booksec__sum">
          Wähle oben eine Art, eine Gegend oder einen Ordner – oder suche nach einem Namen. Dann
          stehen hier alle Einträge dazu, und du kreuzt an, was im Buch stehen soll.
        </p>
      ) : (
        <>
          <div className="wf-welt-booktopic__bar">
            <div className="wf-welt-booktopic__title">
              <strong>{isEmptyTopic(topic) ? 'Suche' : topicLabel(data, topic)}</strong>
              <span className="wf-welt-booktopic__tally">
                {listing.total === 1 ? '1 Eintrag' : `${listing.total} Einträge`}, davon{' '}
                {listing.inBook} im Buch
              </span>
            </div>
            <div className="wf-row">
              <Button
                size="sm"
                variant="ghost"
                disabled={listing.inBook === listing.total}
                onClick={() => setInBook(db, item.id, ids(rows), true)}
              >
                Alle
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={listing.inBook === 0}
                onClick={() => setInBook(db, item.id, ids(rows), false)}
              >
                Keine
              </Button>
              {!isEmptyTopic(topic) && (
                <Button size="sm" variant="ghost" onClick={() => choose(emptyTopic())}>
                  Thema leeren
                </Button>
              )}
            </div>
          </div>
          {!isEmptyTopic(topic) && (
            <Checkbox
              checked={listing.ruleOn}
              onChange={(on) => setBookRule(db, item.id, topic, on)}
            >
              Alles aus diesem Thema – auch was später dazukommt
            </Checkbox>
          )}

          {rows.length === 0 ? (
            <p className="wf-welt-booksec__sum">
              {query.trim()
                ? `Kein Name passt zu „${query.trim()}“.`
                : 'Zu diesem Thema gibt es nichts.'}
            </p>
          ) : (
            <div className="wf-welt-booktopic__list" role="group" aria-label="Einträge zum Thema">
              {groups.map((group) => (
                <div key={group.label} className="wf-welt-booktopic__group">
                  <div className="wf-welt-booksec__group">
                    {group.label} · {group.rows.length}
                  </div>
                  {group.shown.map((row) => (
                    <TopicLine
                      key={row.entity.id}
                      row={row}
                      subline={
                        rowSubline(entitySubline(data, row.entity), group.label) ||
                        row.entity.tagline
                      }
                      onChange={(on) => setInBook(db, item.id, [row.entity.id], on)}
                    />
                  ))}
                </div>
              ))}
              {hiddenRows > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>
                  {hiddenRows === 1
                    ? 'Noch 1 Eintrag zeigen'
                    : `Noch ${hiddenRows} Einträge zeigen`}
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {listing.elsewhere.length > 0 && (
        <div className="wf-welt-booktopic__line">
          <span className="wf-welt-booksec__label">Außerdem im Buch</span>
          {elsewhere.map((entity) => (
            <span key={entity.id} className="wf-welt-booktopic__other">
              {entity.name}
              <IconButton
                label={`${entity.name} aus dem Buch nehmen`}
                size="sm"
                variant="ghost"
                onClick={() => setInBook(db, item.id, [entity.id], false)}
              >
                <X />
              </IconButton>
            </span>
          ))}
          {listing.elsewhere.length > elsewhere.length && (
            <Button size="sm" variant="ghost" onClick={() => setShowElsewhere(true)}>
              {`und ${listing.elsewhere.length - elsewhere.length} weitere`}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Die Kurzzeile ohne das, was schon über der Gruppe steht (die Einordnung). */
const rowSubline = (subline: string, groupLabel: string) =>
  subline
    .split(' · ')
    .filter((part) => wordKey(part) !== wordKey(groupLabel))
    .join(' · ');

/** Ein Eintrag mit Kästchen: Name und Kurzzeile – Art und Einordnung stehen in der Gruppe. */
function TopicLine({
  row,
  subline,
  onChange,
}: {
  row: TopicRow;
  subline: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className={cx('wf-welt-booktopic__row', row.inBook && 'wf-welt-booktopic__row--in')}>
      <Checkbox checked={row.inBook} onChange={onChange}>
        <span className="wf-welt-booktopic__name">{row.entity.name}</span>
      </Checkbox>
      {subline && <span className="wf-welt-booktopic__meta">{subline}</span>}
      {row.withheld && (
        <span className="wf-welt-booktopic__meta wf-welt-booktopic__meta--note">
          Artikel verborgen
        </span>
      )}
    </div>
  );
}
