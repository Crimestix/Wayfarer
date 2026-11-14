/**
 * Vorlagen für Ladenarten schreiben: je Art eine eigene Liste, geschrieben wie eine Preisliste
 * („Langschwert: 15 GM“, „Salz: 5 KM je Pfund (20)“, Überschriften als Einordnung). Geschrieben
 * wird beim Verlassen eines Feldes. Übernommen wird eine Vorlage im Laden unter „Liste
 * vorschlagen“ – Zeile für Zeile, angekreuzt.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { parsePriceLines } from '../../domain/priceList';
import { templateOfKind } from '../../domain/shopTemplate';
import type { ShopTemplate } from '../../domain/schema';
import { Button, Dialog, Field, Input, TextArea, cx, toast } from '../../ui';
import { newShopTemplate, patchShopTemplate, removeShopTemplate } from './actions';

export function TemplatesDialog({
  initialKind = '',
  onClose,
}: {
  /** Die Art des Ladens, von dem aus geöffnet wurde – ihre Vorlage ist zuerst gewählt. */
  initialKind?: string;
  onClose: () => void;
}) {
  const db = useDb();
  const data = useData();
  const templates = useMemo(
    () => Object.values(data.assortments).sort((a, b) => a.kind.localeCompare(b.kind, 'de')),
    [data.assortments],
  );
  const [chosenId, setChosenId] = useState<string | null>(
    () => templateOfKind(data, initialKind)?.id ?? templates[0]?.id ?? null,
  );
  const chosen = chosenId ? data.assortments[chosenId] : undefined;

  const create = () => {
    const kind = initialKind.trim() && !templateOfKind(data, initialKind) ? initialKind.trim() : '';
    const made = newShopTemplate(db, { kind });
    setChosenId(made.id);
  };
  const remove = (template: ShopTemplate) => {
    const undo = removeShopTemplate(db, template.id);
    setChosenId(templates.find((t) => t.id !== template.id)?.id ?? null);
    if (undo)
      toast({
        title: `Vorlage „${template.kind || 'Ohne Art'}“ gelöscht`,
        body: 'Läden, die danach gefüllt sind, bleiben, wie sie sind.',
        action: { label: 'Rückgängig', run: undo },
      });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      width={820}
      // Geschrieben wird beim Verlassen eines Feldes und beim Schließen – nichts geht verloren.
      guard={false}
      title="Vorlagen für Ladenarten"
      footer={
        <Button variant="primary" onClick={onClose}>
          Fertig
        </Button>
      }
    >
      <div className="wf-laden-templates">
        <div className="wf-laden-templates__list" role="list" aria-label="Vorlagen">
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              role="listitem"
              className={cx(
                'wf-laden-templates__item',
                template.id === chosenId && 'wf-laden-templates__item--on',
              )}
              aria-current={template.id === chosenId || undefined}
              onClick={() => setChosenId(template.id)}
            >
              <b className="wf-clamp-1">{template.kind || 'Ohne Art'}</b>
              <span className="wf-laden-templates__n">
                {parsePriceLines(template.text).lines.length} Zeilen
              </span>
            </button>
          ))}
          <Button size="sm" variant="ghost" icon={<Plus />} onClick={create}>
            Neue Vorlage
          </Button>
        </div>
        {chosen ? (
          <TemplateEditor key={chosen.id} template={chosen} onRemove={() => remove(chosen)} />
        ) : (
          <p className="wf-laden-empty">
            Eine Vorlage ist deine Liste für eine Ladenart: was eine Schmiede, ein Tierhändler oder
            ein Hafen bei dir gewöhnlich führt. Jeder Laden dieser Art kann sie mit einem Klick
            übernehmen – Zeile für Zeile, angekreuzt.
          </p>
        )}
      </div>
    </Dialog>
  );
}

function TemplateEditor({ template, onRemove }: { template: ShopTemplate; onRemove: () => void }) {
  const db = useDb();
  const [kind, setKind] = useState(template.kind);
  const [text, setText] = useState(template.text);
  const reading = useMemo(() => parsePriceLines(text), [text]);
  // Was gerade in den Feldern steht – damit es auch beim Schließen (Escape) geschrieben wird.
  const typed = useRef({ kind: template.kind, text: template.text });
  useEffect(
    () => () => {
      const now = db.getSnapshot().assortments[template.id];
      if (!now) return;
      const change: { kind?: string; text?: string } = {};
      if (typed.current.kind.trim() !== now.kind) change.kind = typed.current.kind.trim();
      if (typed.current.text !== now.text) change.text = typed.current.text;
      if (change.kind !== undefined || change.text !== undefined)
        patchShopTemplate(db, template.id, change);
    },
    [db, template.id],
  );
  return (
    <div className="wf-laden-templates__edit">
      <Field
        label="Ladenart"
        hint="Frei: Schmiede, Tierhändler, Hafen … Passt auch zu „Waffenschmied“."
      >
        <Input
          data-autofocus
          value={kind}
          placeholder="Schmiede"
          onChange={(event) => {
            setKind(event.target.value);
            typed.current.kind = event.target.value;
          }}
          onBlur={() => {
            if (kind.trim() !== template.kind)
              patchShopTemplate(db, template.id, { kind: kind.trim() });
          }}
        />
      </Field>
      <Field
        label="Liste"
        hint="Eine Ware je Zeile, wie eine Preisliste. Ohne Preis gilt der Listenpreis; „je Pfund“ hinter dem Preis ist die Einheit, „(20)“ die Menge."
      >
        <TextArea
          rows={14}
          value={text}
          placeholder={
            '## Waffen\nLangschwert\nPfeile (20): 1 GM\n## Handelsgüter\nEisen: 1 SM je Pfund'
          }
          onChange={(event) => {
            setText(event.target.value);
            typed.current.text = event.target.value;
          }}
          onBlur={() => {
            if (text !== template.text) patchShopTemplate(db, template.id, { text });
          }}
        />
      </Field>
      <div className="wf-row">
        <span className="wf-grow wf-laden-rules__count">
          {reading.lines.length === 1 ? '1 Ware gelesen' : `${reading.lines.length} Waren gelesen`}
          {reading.unreadable.length > 0 &&
            ` · nicht gelesen: ${reading.unreadable.map((line) => line.text).join(' · ')}`}
        </span>
        <Button size="sm" variant="danger" icon={<Trash2 />} onClick={onRemove}>
          Vorlage löschen
        </Button>
      </div>
    </div>
  );
}
