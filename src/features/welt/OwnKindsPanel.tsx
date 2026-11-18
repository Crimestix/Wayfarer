/**
 * Die eigenen Kategorien auf der Übersicht der Welt – dort, wo auch „Orte“, „Personen“ … stehen
 * (Rückmeldung des Spielleiters, 18. 11. 2026: nicht in den Einstellungen). Kacheln der eigenen
 * Kategorien, „+ Eigene Kategorie“ mit dem kleinen Formular an Ort und Stelle, und darunter die
 * Vorschläge: aus den Vorlagen des Wikis (aus LegendKeeper: Stadt, Distrikt, Major NPC …) und aus
 * eigenen Wörtern, die oft vorkommen. Alles auf Klick, jeder Vorschlag mit „×“.
 */
import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { KIND_LABEL, KIND_LABEL_PLURAL } from '../../domain/derive';
import {
  allOwnKindSuggestions,
  ownKindCounts,
  ownKinds,
  ownPlural,
  templateSuggestions,
} from '../../domain/ownKind';
import { DismissButton, KindIcon, toast } from '../../ui';
import { OwnKindForm } from './KindSelect';
import { WORLD_KINDS, isWorldKind, type WorldKind } from './model';
import { ownKindFromWord, removeOwnKind, removedOwnKindText } from './ownKinds';
import { setKindFilter } from './overview';

/** So viele Vorschläge stehen höchstens da – der Rest folgt, wenn diese angenommen oder weg sind. */
const MOST = 10;

export function OwnKindsPanel() {
  const db = useDb();
  const data = useData();
  const owns = ownKinds(data).filter((own) => isWorldKind(own.base));
  const counts = ownKindCounts(data);
  /** Das Formular: zu, leer geöffnet oder mit einem Vorschlag vorbelegt. */
  const [form, setForm] = useState<{ name: string; base: WorldKind } | null>(null);
  const fromTemplates = useMemo(() => templateSuggestions(data), [data]);
  const fromWords = useMemo(() => allOwnKindSuggestions(data, WORLD_KINDS), [data]);
  const suggestions = fromTemplates.length + fromWords.length;

  return (
    <section className="wf-welt-ownpanel" aria-label="Deine Unterkategorien">
      <div className="wf-welt-ownpanel__head">
        <span className="wf-caps">Deine Unterkategorien</span>
        <span className="wf-mute">
          Unterkategorien der Kategorien oben – „Stadt“ gehört zu Ort, „Major NPC“ zu Person.
        </span>
      </div>
      <div className="wf-welt-counts wf-welt-counts--own">
        {owns.map((own) => (
          <div key={own.id} className="wf-welt-count">
            <button
              type="button"
              className="wf-welt-count__show"
              onClick={() => setKindFilter(own.base as WorldKind, own.id)}
              title={`${ownPlural(own)} zeigen – Unterkategorie von ${KIND_LABEL[own.base as WorldKind]}`}
            >
              <KindIcon kind={own.base as WorldKind} />
              <span className="wf-welt-count__n">{counts.get(own.id) ?? 0}</span>
              <span className="wf-welt-count__label">
                {(counts.get(own.id) ?? 0) === 1 ? own.name : ownPlural(own)}
              </span>
              <span className="wf-welt-count__base">{KIND_LABEL[own.base as WorldKind]}</span>
            </button>
            <button
              type="button"
              className="wf-welt-count__remove"
              aria-label={`Unterkategorie ${own.name} entfernen`}
              title="Unterkategorie entfernen – die Einträge bleiben"
              onClick={() => {
                const undo = removeOwnKind(db, own.id);
                if (undo)
                  toast({
                    ...removedOwnKindText(
                      own.name,
                      counts.get(own.id) ?? 0,
                      KIND_LABEL_PLURAL[own.base as WorldKind],
                    ),
                    duration: 12000,
                    action: { label: 'Rückgängig', run: undo },
                  });
              }}
            >
              <Trash2 aria-hidden />
            </button>
          </div>
        ))}
        <div className="wf-welt-count">
          <button
            type="button"
            className="wf-welt-count__show wf-welt-count__show--add"
            aria-expanded={form !== null}
            onClick={() => setForm(form ? null : { name: '', base: 'place' })}
            title="Eine Unterkategorie anlegen: Name, Mehrzahl und zu welcher Kategorie sie gehört"
          >
            <Plus aria-hidden />
            <span className="wf-welt-count__label">Unterkategorie</span>
          </button>
        </div>
      </div>
      {form && (
        <div className="wf-welt-ownpanel__form">
          <OwnKindForm
            key={`${form.name}:${form.base}`}
            name={form.name}
            base={form.base}
            onCancel={() => setForm(null)}
            onDone={() => setForm(null)}
          />
        </div>
      )}
      {suggestions > 0 && (
        <div className="wf-welt-ownpanel__suggest">
          <span className="wf-mute">Vorschläge:</span>
          {fromTemplates.slice(0, MOST).map((suggestion) => (
            <span key={suggestion.key} className="wf-welt-ownchip">
              <button
                type="button"
                title={`Aus deinen Vorlagen. Öffnet das Formular – vorgewählt als Unterkategorie von ${KIND_LABEL[suggestion.base]}.`}
                onClick={() =>
                  setForm({
                    name: suggestion.name,
                    base: isWorldKind(suggestion.base) ? suggestion.base : 'topic',
                  })
                }
              >
                {suggestion.name} <em>Vorlage</em>
              </button>
              <DismissButton suggestionKey={suggestion.key} what="Unterkategorie" />
            </span>
          ))}
          {fromWords.slice(0, Math.max(0, MOST - fromTemplates.length)).map((suggestion) => (
            <span key={suggestion.key} className="wf-welt-ownchip">
              <button
                type="button"
                title={`${suggestion.entityIds.length} ${KIND_LABEL_PLURAL[suggestion.base]} tragen dieses Wort. Ein Klick legt die Unterkategorie an und ordnet sie zu.`}
                onClick={() => {
                  const made = ownKindFromWord(db, suggestion);
                  if (!made) return;
                  toast({
                    title: `Unterkategorie „${made.own.name}“ von ${KIND_LABEL[suggestion.base]}`,
                    body: `${suggestion.entityIds.length} ${KIND_LABEL_PLURAL[suggestion.base]} gehören jetzt dazu.`,
                    duration: 12000,
                    action: { label: 'Rückgängig', run: made.undo },
                  });
                }}
              >
                {suggestion.word}{' '}
                <em>
                  {suggestion.entityIds.length} {KIND_LABEL_PLURAL[suggestion.base]}
                </em>
              </button>
              <DismissButton suggestionKey={suggestion.key} what="Unterkategorie" />
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
