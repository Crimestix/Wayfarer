/**
 * Der Steckbrief als Kasten auf der Seite eines Dings: Felder, die man direkt ausfüllt – geschrieben
 * wird beim Verlassen eines Feldes, in den `> [!steckbrief]`-Kasten des Artikels (`writeBoxField`).
 * Ohne Artikel stehen die Felder des Gerüsts bereit; mit dem ersten Wort entsteht der Artikel.
 * Leere Felder stehen gedämpft da und lassen sich ausblenden; „+ Feld“ für eigene.
 */
import { useMemo, useRef, useState, type MouseEvent } from 'react';
import { useLocation } from 'wouter';
import { Plus } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import type { Article } from '../../domain/schema';
import { Input, Written, cx } from '../../ui';
import { Inlines, type ArticleContext } from '../legendkeeper/Article';
import { applyFacts } from '../wiki/FactsHint';
import { parseInline } from '../wiki/markdown';
import { scaffoldOf } from '../wiki/scaffold';
import { linkIndex, pageText } from '../wiki/text';
import { boxRows, isFilled, worldValue, type BoxRow } from './page';
import { writeBoxField } from './pageActions';
import { Section } from './parts';
import type { WorldEntity } from './model';

/** Ob leere Felder ausgeblendet sind – gilt für alle Seiten, bis die App neu startet. */
const memory = { hideBlank: true };

export function FactBox({ entity, article }: { entity: WorldEntity; article: Article | null }) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const [hideBlank, setHideBlankState] = useState(memory.hideBlank);
  const setHideBlank = (next: boolean) => {
    memory.hideBlank = next;
    setHideBlankState(next);
  };
  const [adding, setAdding] = useState(false);
  const doc = article?.docs.find((d) => d.kind === 'page');
  const text = article && doc ? pageText(data.articles, article, doc) : null;
  const rows = useMemo(
    () => boxRows(text, entity.kind, scaffoldOf(data.campaign, entity.kind)),
    [text, entity.kind, data.campaign],
  );
  // Leere Felder stehen nur da, wenn die Welt schon etwas dazu weiß (gedämpft zum Übernehmen) –
  // die übrigen leeren erst auf Wunsch (Rundgang 17. 11.: sieben leere Zeilen machen die Seite voll).
  const knownOf = (row: (typeof rows)[number]) =>
    isFilled(row) ? '' : worldValue(data, entity, row.field);
  const blanks = rows.filter((row) => !isFilled(row) && !knownOf(row)).length;
  const shown = hideBlank ? rows.filter((row) => isFilled(row) || knownOf(row)) : rows;
  const resolve = linkIndex(data.articles).resolve;
  const ctx = useMemo<ArticleContext>(
    () => ({
      onOpen: (target) => {
        if (target.resourceId) navigate(`/wiki/${target.resourceId}`);
      },
      titleOf: (id) => data.articles[id]?.title ?? null,
      local: true,
    }),
    [data.articles, navigate],
  );

  const save = (label: string, value: string) => {
    const articleId = writeBoxField(db, entity, label, value);
    if (articleId) applyFacts(db, [articleId]);
  };

  // Noch nichts im Steckbrief: eine Zeile statt eines leeren Kastens – der Platz gehört dem Text.
  if (shown.length === 0 && !adding)
    return (
      <div className="wf-welt-box wf-welt-box--slim">
        <span className="wf-section-title">Steckbrief</span>
        <button type="button" className="wf-welt-box__add" onClick={() => setAdding(true)}>
          <Plus aria-hidden />
          Feld
        </button>
        {blanks > 0 && (
          <button type="button" className="wf-welt-box__toggle" onClick={() => setHideBlank(false)}>
            {blanks === 1 ? 'Ein leeres Feld zeigen' : `${blanks} leere Felder zeigen`}
          </button>
        )}
      </div>
    );

  return (
    <Section
      title="Steckbrief"
      className="wf-welt-box"
      action={
        blanks > 0 && (
          <button
            type="button"
            className="wf-welt-box__toggle"
            aria-pressed={!hideBlank}
            onClick={() => setHideBlank(!hideBlank)}
          >
            {hideBlank
              ? blanks === 1
                ? 'Ein leeres Feld zeigen'
                : `${blanks} leere Felder zeigen`
              : 'Leere ausblenden'}
          </button>
        )
      }
    >
      <dl className="wf-welt-box__rows">
        {shown.map((row) => (
          <BoxField
            key={row.label}
            row={row}
            known={knownOf(row)}
            ctx={ctx}
            render={(value) => parseInline(value, { resolve, headings: 0 })}
            onSave={(value) => save(row.label, value)}
          />
        ))}
      </dl>
      {adding ? (
        <NewField
          taken={rows.map((row) => row.label)}
          onDone={(label, value) => {
            setAdding(false);
            if (label && value) save(label, value);
          }}
        />
      ) : (
        <button type="button" className="wf-welt-box__add" onClick={() => setAdding(true)}>
          <Plus aria-hidden />
          Feld
        </button>
      )}
    </Section>
  );
}

/** Ein Feld: gesetzt zum Lesen (Verweise anklickbar), ein Klick schreibt. */
function BoxField({
  row,
  known,
  ctx,
  render,
  onSave,
}: {
  row: BoxRow;
  /** Was die Welt zu dem leeren Feld schon weiß – gedämpft gezeigt, beim Schreiben vorgegeben. */
  known: string;
  ctx: ArticleContext;
  render: (value: string) => ReturnType<typeof parseInline>;
  onSave: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const filled = isFilled(row);
  const start = (event?: MouseEvent) => {
    // Ein Verweis führt zu seiner Seite, statt das Feld zu öffnen.
    const target = event?.target as HTMLElement | undefined;
    if (target?.closest('.wf-lk-mention:not(.wf-lk-mention--missing)')) return;
    setEditing(true);
  };
  return (
    <div className={cx('wf-welt-box__row', !filled && 'wf-welt-box__row--blank')}>
      <dt title={row.field ? undefined : 'Ein eigenes Feld – Wayfarer liest es nicht aus.'}>
        {row.label}
      </dt>
      <dd
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setEditing(false);
        }}
      >
        {editing ? (
          <Written
            wrap
            autoFocus
            value={row.value || known}
            label={row.label}
            className="wf-welt-box__input"
            onSave={onSave}
          />
        ) : (
          <div
            role="button"
            tabIndex={0}
            className="wf-welt-box__value"
            aria-label={`${row.label}: ${filled ? row.value : 'leer'} – ändern`}
            onClick={start}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              setEditing(true);
            }}
          >
            {filled ? (
              <Inlines inlines={render(row.value)} ctx={ctx} />
            ) : known ? (
              <em
                className="wf-welt-box__known"
                title="So steht es in der Welt – ein Klick übernimmt es in den Steckbrief."
              >
                {known}
              </em>
            ) : (
              <span>leer</span>
            )}
          </div>
        )}
      </dd>
    </div>
  );
}

/** Ein eigenes Feld: Bezeichnung und Wert. Geschrieben wird erst, wenn beides dasteht. */
function NewField({
  taken,
  onDone,
}: {
  taken: string[];
  onDone: (label: string, value: string) => void;
}) {
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const clash = taken.some(
    (other) => other.toLocaleLowerCase('de') === label.trim().toLocaleLowerCase('de'),
  );
  const finish = () => onDone(clash ? '' : label.replace(/[:\n]/g, ' ').trim(), value.trim());
  return (
    <div
      ref={wrap}
      className="wf-welt-box__row wf-welt-box__new"
      onBlur={(event) => {
        if (!wrap.current?.contains(event.relatedTarget as Node | null)) finish();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onDone('', '');
        if (event.key === 'Enter' && label.trim() && value.trim()) finish();
      }}
    >
      <Input
        autoFocus
        aria-label="Bezeichnung des neuen Feldes"
        placeholder="Bezeichnung"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
      />
      <Input
        aria-label="Wert des neuen Feldes"
        placeholder={clash ? 'Dieses Feld gibt es schon' : 'Wert'}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </div>
  );
}
