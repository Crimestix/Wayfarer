/**
 * Lexikon der Pflanzen, Tiere, Gesteine und Berufe: erscheint rechts, wenn links eine dieser
 * Arten gewählt und kein Eintrag offen ist. Keine eigene Seite und keine eigene Ablage – nur eine
 * Sicht auf die Einträge der Welt, nach ihrer Einordnung gruppiert und zu filtern
 * (`lexicon.ts`).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Plus, X } from 'lucide-react';
import { useData } from '../../data/hooks';
import { KIND_LABEL, KIND_LABEL_PLURAL } from '../../domain/derive';
import { Button, EmptyState, KindIcon, Select } from '../../ui';
import { openEntityDialog } from './editor';
import {
  NO_LEXICON_FILTER,
  lexicon,
  lexiconFacets,
  lexiconTotal,
  type LexiconFilter,
  type LexiconKind,
  type LexiconRow,
} from './lexicon';
import { setWorldView, useWorldView } from './overview';
import { Picker } from './parts';
import { ProfessionSuggestions } from './ProfessionSuggestions';
import { visibleIds } from './scope';

/** Merkt sich die Filter je Art, solange die App läuft. */
const memory: Partial<Record<LexiconKind, LexiconFilter>> = {};

const LEAD: Record<LexiconKind, string> = {
  plant: 'Alles, was wächst – Kräuter, Bäume, Pilze und Moose.',
  animal: 'Alles, was lebt und keinen eigenen Namen trägt.',
  mineral: 'Was aus dem Boden kommt – Erze, Edelsteine, Gesteine und Salze.',
  profession: 'Handwerke, Gewerbe und Ämter – und wer sie ausübt.',
};

export function Lexicon({ kind }: { kind: LexiconKind }) {
  const data = useData();
  const view = useWorldView();
  const [filter, setFilter] = useState<LexiconFilter>(() => memory[kind] ?? NO_LEXICON_FILTER);
  const set = (change: Partial<LexiconFilter>) => setFilter((f) => ({ ...f, ...change }));
  useEffect(() => {
    memory[kind] = filter;
  }, [kind, filter]);
  // Eine gelöschte Gegend filtert nicht weiter ins Leere.
  const regionId = filter.regionId && data.entities[filter.regionId] ? filter.regionId : null;
  const visible = useMemo(() => visibleIds(data, view), [data, view]);
  const groups = useMemo(
    () => lexicon(data, kind, { ...filter, regionId }, visible),
    [data, kind, filter, regionId, visible],
  );
  const facets = useMemo(() => lexiconFacets(data, kind), [data, kind]);
  const total = useMemo(() => lexiconTotal(data, kind), [data, kind]);
  /** Was der Ausschnitt links (ein Ort, nur Bekanntes) übrig lässt. */
  const inView = useMemo(() => lexiconTotal(data, kind, visible), [data, kind, visible]);
  const shown = groups.reduce((sum, group) => sum + group.rows.length, 0);
  const filtered = filter.habitat !== '' || regionId !== null || filter.season !== '';
  const nature = kind !== 'profession';
  const create = () =>
    openEntityDialog({
      mode: 'create',
      kind,
      preset: {
        regionIds: regionId ? [regionId] : [],
      },
    });

  return (
    <div className="wf-welt-landing wf-welt-lex">
      <header className="wf-welt-landing__head">
        <div className="wf-welt-landing__eyebrow">Welt</div>
        <h1 className="wf-welt-landing__title">{KIND_LABEL_PLURAL[kind]}</h1>
        <p className="wf-welt-landing__lead">{LEAD[kind]}</p>
      </header>

      <div className="wf-welt-lex__bar">
        {nature && (
          <>
            <Select
              value={filter.habitat}
              aria-label="Nach Lebensraum filtern"
              disabled={!facets.habitats.length}
              onChange={(e) => set({ habitat: e.target.value })}
            >
              <option value="">Jeder Lebensraum</option>
              {facets.habitats.map((habitat) => (
                <option key={habitat.value} value={habitat.value}>
                  {habitat.label} ({habitat.count})
                </option>
              ))}
            </Select>
            <div
              className="wf-welt-lex__place"
              title="Was dort vorkommt: mit dieser Gegend eingetragen oder passend zu ihrem Lebensraum"
            >
              <Picker
                value={regionId}
                onChange={(next) => set({ regionId: next })}
                kinds={['place']}
                placeholder="Jede Gegend"
              />
            </div>
            <Select
              value={filter.season}
              aria-label="Nach Jahreszeit oder Monat filtern"
              onChange={(e) => set({ season: e.target.value })}
            >
              <option value="">Das ganze Jahr</option>
              <optgroup label="Jahreszeit">
                {facets.seasons
                  .filter((s) => s.value.startsWith('s:'))
                  .map((season) => (
                    <option key={season.value} value={season.value}>
                      {season.label}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Monat">
                {facets.seasons
                  .filter((s) => s.value.startsWith('m:'))
                  .map((month) => (
                    <option key={month.value} value={month.value}>
                      {month.label}
                    </option>
                  ))}
              </optgroup>
            </Select>
          </>
        )}
        <span className="wf-welt-lex__count">
          {filtered ? `${shown} von ${inView}` : inView === 1 ? '1 Eintrag' : `${inView} Einträge`}
          {filtered && (
            <button
              type="button"
              className="wf-welt-lex__reset"
              onClick={() => setFilter(NO_LEXICON_FILTER)}
            >
              <X aria-hidden /> Alle zeigen
            </button>
          )}
        </span>
        <Button variant="primary" icon={<Plus />} onClick={create}>
          {KIND_LABEL[kind]}
        </Button>
      </div>

      {!nature && <ProfessionSuggestions />}

      {total === 0 ? (
        <EmptyState icon={<KindIcon kind={kind} />} title={`Noch keine ${KIND_LABEL_PLURAL[kind]}`}>
          {nature
            ? 'Lege an, was in deiner Welt vorkommt – mit Lebensraum, Gegend und Jahreszeit. Am Spieltisch steht dann, was dort wächst und lebt.'
            : 'Lege die Berufe deiner Welt an oder übernimm sie aus den Vorschlägen. Wer einen ausübt, trägst du bei der Person unter „Berufe“ ein.'}
        </EmptyState>
      ) : inView === 0 ? (
        <p className="wf-welt-lex__none">
          Im gewählten Ausschnitt der Welt steht nichts davon.{' '}
          <button
            type="button"
            className="wf-welt-form__link"
            onClick={() => setWorldView({ scopeId: null, knownOnly: false })}
          >
            Ganze Welt zeigen
          </button>
        </p>
      ) : shown === 0 ? (
        <p className="wf-welt-lex__none">
          Nichts passt zu dieser Auswahl.{' '}
          <button
            type="button"
            className="wf-welt-form__link"
            onClick={() => setFilter(NO_LEXICON_FILTER)}
          >
            Alle zeigen
          </button>
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.category || '-'} className="wf-welt-lex__group">
            <h2 className="wf-welt-lex__category">
              {group.category || 'Ohne Einordnung'}
              <span>{group.rows.length}</span>
            </h2>
            <div className="wf-welt-lex__rows">
              {group.rows.map((row) => (
                <LexiconLine key={row.entity.id} row={row} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function LexiconLine({ row }: { row: LexiconRow }) {
  const { entity } = row;
  const facts =
    entity.kind === 'profession'
      ? [
          row.tool && { label: 'Werkzeug', text: row.tool },
          row.people.length > 0 && {
            label: 'Üben ihn aus',
            text: row.people.map((p) => p.name).join(', '),
          },
        ]
      : [
          row.habitats && { label: 'Lebensraum', text: row.habitats },
          row.seasons && { label: 'Zeit', text: row.seasons },
          row.price && { label: 'Wert', text: row.price },
        ];
  return (
    <Link href={`/welt/${entity.id}`} className="wf-welt-lex__row">
      <span className="wf-welt-lex__icon">
        <KindIcon kind={entity.kind} />
      </span>
      <span className="wf-welt-lex__main">
        <span className="wf-welt-lex__name">
          {entity.name}
          {row.rarity && <em className="wf-welt-lex__rarity">{row.rarity}</em>}
        </span>
        {row.line && <span className="wf-welt-lex__line wf-clamp-1">{row.line}</span>}
      </span>
      <span className="wf-welt-lex__facts">
        {facts
          .filter((fact): fact is { label: string; text: string } => !!fact)
          .map((fact) => (
            <span key={fact.label} className="wf-clamp-1" title={`${fact.label}: ${fact.text}`}>
              <b>{fact.label}</b> {fact.text}
            </span>
          ))}
      </span>
    </Link>
  );
}
