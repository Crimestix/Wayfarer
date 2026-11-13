/**
 * Eine Preisliste einfügen: Wayfarer liest Zeile für Zeile Name, Preis und Menge, zeigt, welcher
 * Eintrag der Welt gemeint ist oder was neu angelegt würde – und übernimmt nur, was der
 * Spielleiter bestätigt (`takePriceList`).
 */
import { useMemo, useState } from 'react';
import { useData, useDb } from '../../data/hooks';
import { KIND_LABEL, entityName } from '../../domain/derive';
import { parsePriceLines, planPriceLines } from '../../domain/priceList';
import { formatPrice, listPrice } from '../../domain/shop';
import type { Shop } from '../../domain/schema';
import { Button, Checkbox, Dialog, Field, Select, TextArea, cx, toast } from '../../ui';
import { takePriceList } from './actions';

export function PriceListDialog({ shop, onClose }: { shop: Shop; onClose: () => void }) {
  const db = useDb();
  const data = useData();
  const [text, setText] = useState('');
  /**
   * Von Hand an- oder abgewählte Zeilen (nach Zeilennummer). Sonst gilt: Was einem Eintrag
   * gehört, den man nicht kaufen kann (etwa einer Person), bleibt zunächst weg.
   */
  const [toggled, setToggled] = useState<Record<number, boolean>>({});
  /** Bei mehreren passenden Einträgen: die Wahl je Zeile. */
  const [choice, setChoice] = useState<Record<number, string>>({});
  const reading = useMemo(() => parsePriceLines(text), [text]);
  const plan = useMemo(() => planPriceLines(data, reading.lines), [data, reading]);
  const takes = (p: (typeof plan)[number]) => toggled[p.line] ?? !p.takenBy;
  const taken = plan.filter(takes);
  const creating = taken.filter((p) => p.create && !p.entityId).length;

  const save = () => {
    const result = takePriceList(
      db,
      shop.id,
      taken.map((p) => ({ plan: p, entityId: choice[p.line] ?? p.entityId })),
    );
    onClose();
    toast({
      title: result.stocked === 1 ? '1 Ware im Bestand' : `${result.stocked} Waren im Bestand`,
      body: [
        result.created > 0 &&
          (result.created === 1
            ? '1 Gegenstand neu angelegt.'
            : `${result.created} Gegenstände neu angelegt.`),
        result.priced > 0 &&
          (result.priced === 1
            ? '1 Eintrag hat jetzt einen Listenpreis.'
            : `${result.priced} Einträge haben jetzt einen Listenpreis.`),
      ]
        .filter(Boolean)
        .join(' '),
      action: { label: 'Rückgängig', run: result.undo },
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Preisliste einfügen"
      width={780}
      footer={
        <>
          <span className="wf-grow wf-mute">
            {creating > 0 &&
              (creating === 1
                ? '1 Gegenstand wird neu angelegt.'
                : `${creating} Gegenstände werden neu angelegt.`)}
          </span>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!taken.length} onClick={save}>
            Übernehmen{taken.length ? ` (${taken.length})` : ''}
          </Button>
        </>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-3)' }}>
        <Field
          label="Je Zeile eine Ware"
          hint="„Seil (15 m): 1 GM“, „Heiltrank – 50 Gold“, „3× Fackel: 1 KM“. Überschriften wie „## Waffen“ werden zur Einordnung neuer Gegenstände."
        >
          <TextArea
            data-autofocus
            rows={6}
            value={text}
            placeholder={'Seil (15 m): 1 GM\nHeiltrank: 50 GM (3)\nFackel: 1 KM'}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        {reading.unreadable.length > 0 && (
          <p className="wf-laden-warn">
            Den Preis nicht verstanden in Zeile{' '}
            {reading.unreadable.map((u) => `${u.line} („${u.text}“)`).join(', ')} – diese Zeilen
            bleiben weg.
          </p>
        )}
        {plan.length > 0 && (
          <div className="wf-laden-plan" aria-label="So würde es übernommen">
            {plan.map((p) => {
              const entityId = choice[p.line] ?? p.entityId;
              const entity = entityId ? data.entities[entityId] : undefined;
              const list = listPrice(entity);
              const take = takes(p);
              return (
                <div key={p.line} className="wf-laden-plan__row">
                  <Checkbox
                    checked={take}
                    onChange={(on) => setToggled((current) => ({ ...current, [p.line]: on }))}
                  >
                    <span className="wf-clamp-1">{p.name}</span>
                  </Checkbox>
                  <span className="wf-mute">
                    {[p.qty !== null && `${p.qty} Stück`, p.category].filter(Boolean).join(' · ')}
                  </span>
                  <span className="wf-laden-plan__price">
                    {p.price === null ? '–' : formatPrice(p.price)}
                  </span>
                  {p.choices.length > 1 ? (
                    <Select
                      value={entityId ?? ''}
                      aria-label={`Welcher Eintrag ist „${p.name}“?`}
                      onChange={(event) =>
                        setChoice((current) => ({ ...current, [p.line]: event.target.value }))
                      }
                    >
                      {p.choices.map((id) => (
                        <option key={id} value={id}>
                          {entityName(data, id)} ({KIND_LABEL[data.entities[id]!.kind]})
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <span
                      className={cx(
                        'wf-laden-plan__match',
                        p.create && 'wf-laden-plan__match--new',
                        !p.create && !entity && 'wf-laden-plan__match--word',
                      )}
                    >
                      {entity
                        ? `${KIND_LABEL[entity.kind]} der Welt${
                            p.price !== null && list === null
                              ? ' – bekommt den Listenpreis'
                              : p.price !== null && list !== p.price
                                ? ` – eigener Preis hier (Liste ${formatPrice(list!)})`
                                : ''
                          }`
                        : p.create
                          ? 'neuer Gegenstand'
                          : `nur in Worten – der Name gehört schon: ${p.takenBy}`}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Dialog>
  );
}
