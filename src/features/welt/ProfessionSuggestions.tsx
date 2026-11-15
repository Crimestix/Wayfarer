/**
 * „Vorschläge“ im Lexikon der Berufe: was im Geschriebenen vorkommt (mit den Personen dazu) und die
 * übrigen Berufe der Liste. Ruhig und eingeklappt; angelegt und verbunden wird nur, was der
 * Spielleiter ankreuzt und übernimmt (`professions.ts`).
 */
import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Lightbulb } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import type { ProfessionSuggestion } from '../../domain/professions';
import { Button, Checkbox, DismissButton, toast } from '../../ui';
import { SUGGESTION } from '../../domain/dismiss';
import { acceptProfessions, worldProfessionSuggestions, type ProfessionPick } from './professions';
import './craft.css';

/** Ob der Kasten offen ist – solange die App läuft. */
let remembered = false;

const times = (n: number) => (n === 1 ? 'einmal' : `${n}-mal`);

export function ProfessionSuggestions() {
  const db = useDb();
  const data = useData();
  const [open, setOpen] = useState(remembered);
  const [showMore, setShowMore] = useState(false);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const suggestions = useMemo(
    () => (open ? worldProfessionSuggestions(data) : null),
    // Neu gelesen wird nur, wenn sich Einträge, Beziehungen oder Artikel ändern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, data.entities, data.relations, data.articles],
  );

  const toggleOpen = () => {
    remembered = !open;
    setOpen(!open);
  };
  const flip = (keys: string[], on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  const all = suggestions ? [...suggestions.found, ...suggestions.more] : [];
  const picks: ProfessionPick[] = all.flatMap((s) => {
    const peopleIds = s.people
      .filter((p) => chosen.has(personKey(s, p.entityId)))
      .map((p) => p.entityId);
    if (!chosen.has(s.key) && !peopleIds.length) return [];
    return [
      { name: s.name, category: s.category, tool: s.tool, professionId: s.professionId, peopleIds },
    ];
  });
  const newCount = picks.filter((p) => !p.professionId).length;
  const linkCount = picks.reduce((sum, p) => sum + p.peopleIds.length, 0);

  const accept = () => {
    const result = acceptProfessions(db, picks);
    setChosen(new Set());
    const parts = [
      result.created === 1
        ? 'ein Beruf angelegt'
        : result.created
          ? `${result.created} Berufe angelegt`
          : '',
      result.linked === 1
        ? 'eine Person verbunden'
        : result.linked
          ? `${result.linked} Personen verbunden`
          : '',
    ].filter(Boolean);
    toast({
      title: parts.length ? `Übernommen: ${parts.join(', ')}` : 'Nichts Neues übernommen',
      action: parts.length ? { label: 'Rückgängig', run: result.undo } : undefined,
    });
  };

  const grouped = new Map<string, ProfessionSuggestion[]>();
  for (const s of suggestions?.more ?? []) {
    const list = grouped.get(s.category || 'Ohne Einordnung') ?? [];
    list.push(s);
    grouped.set(s.category || 'Ohne Einordnung', list);
  }

  return (
    <section className="wf-welt-profsug" aria-label="Vorschläge für Berufe">
      <button
        type="button"
        className="wf-welt-profsug__head"
        aria-expanded={open}
        onClick={toggleOpen}
      >
        <Lightbulb aria-hidden />
        <span className="wf-welt-profsug__title">Vorschläge</span>
        {suggestions && suggestions.found.length > 0 && (
          <span>{suggestions.found.length} aus dem Geschriebenen</span>
        )}
        {open ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
      </button>
      {open && suggestions && (
        <>
          <p className="wf-welt-profsug__lead">
            Berufe, die in deinen Artikeln und Einträgen vorkommen, und Personen, die sie ausüben –
            dazu eine Liste mittelalterlicher Berufe. Angelegt wird nur, was du ankreuzt: Name,
            Einordnung und Werkzeug.
          </p>
          {suggestions.found.length > 0 ? (
            <ul className="wf-welt-profsug__list">
              {suggestions.found.map((s) => (
                <li key={s.key} className="wf-welt-profsug__item">
                  {s.professionId ? (
                    <b>{s.name}</b>
                  ) : (
                    <Checkbox
                      checked={chosen.has(s.key)}
                      onChange={(on) =>
                        flip(
                          [s.key, ...(on ? [] : s.people.map((p) => personKey(s, p.entityId)))],
                          on,
                        )
                      }
                    >
                      <b>{s.name}</b>
                    </Checkbox>
                  )}
                  <span className="wf-welt-profsug__meta">
                    {[
                      s.professionId ? 'schon in der Welt' : '',
                      s.category,
                      s.tool,
                      s.mentions
                        ? `kommt ${times(s.mentions)} vor: ${s.sources.join(', ')}${s.mentions > s.sources.length ? ' …' : ''}`
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <DismissButton
                    suggestionKey={SUGGESTION.profession(s.name)}
                    what={`Beruf „${s.name}“`}
                  />
                  {s.people.length > 0 && (
                    <ul className="wf-welt-profsug__people">
                      {s.people.map((person) => (
                        <li key={person.entityId}>
                          <Checkbox
                            checked={chosen.has(personKey(s, person.entityId))}
                            onChange={(on) =>
                              flip(
                                [
                                  personKey(s, person.entityId),
                                  ...(on && !s.professionId ? [s.key] : []),
                                ],
                                on,
                              )
                            }
                          >
                            {person.name} übt ihn aus{' '}
                            <span className="wf-welt-profsug__why">– {person.why}</span>
                          </Checkbox>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="wf-welt-profsug__lead">
              In deinen Artikeln und Einträgen kommt kein Beruf vor, den es noch nicht gibt.
            </p>
          )}
          {suggestions.more.length > 0 && (
            <>
              <button
                type="button"
                className="wf-welt-profsug__head"
                aria-expanded={showMore}
                onClick={() => setShowMore(!showMore)}
              >
                <span className="wf-welt-profsug__title">
                  Weitere Berufe aus der Liste ({suggestions.more.length})
                </span>
                {showMore ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
              </button>
              {showMore &&
                [...grouped.entries()].map(([category, list]) => (
                  <div key={category}>
                    <h3 className="wf-welt-profsug__sub">{category}</h3>
                    <div className="wf-welt-profsug__more">
                      {list.map((s) => (
                        <Checkbox
                          key={s.key}
                          checked={chosen.has(s.key)}
                          onChange={(on) => flip([s.key], on)}
                        >
                          <span title={s.tool ? `Werkzeug: ${s.tool}` : undefined}>{s.name}</span>
                        </Checkbox>
                      ))}
                    </div>
                  </div>
                ))}
            </>
          )}
          <div className="wf-welt-profsug__foot">
            <Button icon={<Check />} disabled={!picks.length} onClick={accept}>
              Übernehmen
            </Button>
            <span>
              {picks.length
                ? [
                    newCount === 1 ? 'ein neuer Beruf' : newCount ? `${newCount} neue Berufe` : '',
                    linkCount === 1
                      ? 'eine Person verbinden'
                      : linkCount
                        ? `${linkCount} Personen verbinden`
                        : '',
                  ]
                    .filter(Boolean)
                    .join(', ')
                : 'Nichts ausgewählt.'}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

const personKey = (s: ProfessionSuggestion, personId: string) => `${s.key}|${personId}`;
