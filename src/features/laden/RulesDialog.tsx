/**
 * „Aus dem Regelwerk“: die Ausrüstung des SRD 5.2.1 als Nachschlagewerk für einen Laden. Gruppen
 * anklicken (mehrere zugleich) oder suchen – deutsch oder englisch –, ankreuzen, „In den Bestand“.
 * Der Vorschlag nach der Art des Ladens ist nur eine Gruppe mehr: Angekreuzt wird von Hand.
 * Angelegt werden nur Zeilen im Bestand, keine Einträge der Welt (`addRuleItems`).
 */
import { useMemo, useState } from 'react';
import { useData, useDb } from '../../data/hooks';
import {
  formatPrice,
  rulePrice,
  ruleSuggestions,
  shopTitle,
  stockedRuleIds,
} from '../../domain/shop';
import {
  SRD_ATTRIBUTION,
  SRD_GROUPS,
  srdGroupSize,
  srdWeightText,
  type SrdGroup,
} from '../../domain/srd/lookup';
import type { Shop } from '../../domain/schema';
import { Button, Checkbox, Dialog, Input, cx, toast } from '../../ui';
import { addRuleItems } from './actions';
import { ruleChoice, ruleSections } from './model';

export function RulesDialog({ shop, onClose }: { shop: Shop; onClose: () => void }) {
  const db = useDb();
  const data = useData();
  const suggestion = useMemo(() => ruleSuggestions(data, shop), [data, shop]);
  const stocked = useMemo(() => stockedRuleIds(data, shop), [data, shop]);
  // Passt etwas zur Art des Ladens, ist der Vorschlag zuerst gewählt.
  const [suggestedOn, setSuggestedOn] = useState(() => suggestion.items.length > 0);
  const [groups, setGroups] = useState<SrdGroup[]>([]);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);

  const shown = useMemo(
    () =>
      ruleChoice({
        groups,
        suggested: suggestedOn ? suggestion.items : null,
        query,
      }),
    [groups, suggestedOn, suggestion.items, query],
  );
  const sections = useMemo(() => ruleSections(shown), [shown]);
  const open = shown.filter((item) => !stocked.has(item.id));
  const idle = !groups.length && !suggestedOn && !query.trim();
  const factor = shop.priceFactor;

  const toggleGroup = (group: SrdGroup) =>
    setGroups((now) => (now.includes(group) ? now.filter((g) => g !== group) : [...now, group]));
  const pick = (ids: string[], on: boolean) =>
    setPicked((now) =>
      on
        ? [...now, ...ids.filter((id) => !now.includes(id))]
        : now.filter((id) => !ids.includes(id)),
    );

  const save = () => {
    const result = addRuleItems(db, shop.id, picked);
    onClose();
    if (result && result.added > 0)
      toast({
        title: result.added === 1 ? '1 Ware im Bestand' : `${result.added} Waren im Bestand`,
        body: 'Preis nach dem Regelwerk mal Preisstufe – ändern kannst du ihn in der Zeile.',
        action: { label: 'Rückgängig', run: result.undo },
      });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      width={820}
      title={`Aus dem Regelwerk · ${shopTitle(data, shop)}`}
      footer={
        <>
          <span className="wf-grow wf-laden-rules__count">
            {picked.length === 0
              ? 'Noch nichts angekreuzt.'
              : picked.length === 1
                ? '1 angekreuzt'
                : `${picked.length} angekreuzt`}
          </span>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!picked.length} onClick={save}>
            In den Bestand{picked.length ? ` (${picked.length})` : ''}
          </Button>
        </>
      }
    >
      <div className="wf-laden-rules">
        <div className="wf-laden-rules__chips" aria-label="Gruppen">
          {suggestion.items.length > 0 && (
            <button
              type="button"
              className="wf-laden-rules__chip wf-laden-rules__chip--suggest"
              aria-pressed={suggestedOn}
              title="Nach der Art des Ladens – nur ein Vorschlag, angekreuzt wird von Hand"
              onClick={() => setSuggestedOn((on) => !on)}
            >
              Passt zu „{suggestion.labels.join(', ')}“{' '}
              <span className="wf-laden-rules__n">{suggestion.items.length}</span>
            </button>
          )}
          {SRD_GROUPS.map((group) => (
            <button
              key={group.id}
              type="button"
              className="wf-laden-rules__chip"
              aria-pressed={groups.includes(group.id)}
              onClick={() => toggleGroup(group.id)}
            >
              {group.label} <span className="wf-laden-rules__n">{srdGroupSize(group.id)}</span>
            </button>
          ))}
        </div>
        <div className="wf-laden-rules__bar">
          <Input
            data-autofocus
            type="search"
            value={query}
            placeholder="Suchen – deutsch oder englisch: Langschwert, rope …"
            aria-label="Im Regelwerk suchen"
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={!open.length || open.every((item) => picked.includes(item.id))}
            onClick={() =>
              pick(
                open.map((item) => item.id),
                true,
              )
            }
          >
            Alle ankreuzen
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!shown.some((item) => picked.includes(item.id))}
            onClick={() =>
              pick(
                shown.map((item) => item.id),
                false,
              )
            }
          >
            Keine
          </Button>
        </div>

        <div className="wf-laden-rules__list" role="group" aria-label="Ausrüstung">
          {idle ? (
            <p className="wf-laden-empty">
              Klicke oben eine oder mehrere Gruppen an – oder suche nach einem Namen. Dann stehen
              hier alle Gegenstände dazu, und du kreuzt an, was der Laden führt.
            </p>
          ) : shown.length === 0 ? (
            <p className="wf-laden-empty">Nichts gefunden zu „{query.trim()}“.</p>
          ) : (
            sections.map((section) => (
              <div key={section.sub}>
                <div className="wf-laden-rules__sub">
                  {section.sub} · {section.items.length}
                </div>
                {section.items.map((item) => {
                  const have = stocked.has(item.id);
                  const facts = [
                    item.en,
                    srdWeightText(item.lb),
                    factor !== 1 && `Liste ${formatPrice(item.price)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <div
                      key={item.id}
                      className={cx('wf-laden-rules__row', have && 'wf-laden-rules__row--have')}
                    >
                      {have ? (
                        <span className="wf-laden-rules__name wf-laden-rules__name--have">
                          {item.name}
                        </span>
                      ) : (
                        <Checkbox
                          checked={picked.includes(item.id)}
                          onChange={(on) => pick([item.id], on)}
                        >
                          <span className="wf-laden-rules__name">{item.name}</span>
                        </Checkbox>
                      )}
                      <span className="wf-laden-rules__facts">
                        {have ? 'schon im Bestand' : facts}
                      </span>
                      <span className="wf-laden-rules__price">
                        {formatPrice(rulePrice(shop, item))}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <p className="wf-laden-rules__credit" title={SRD_ATTRIBUTION.en}>
          {SRD_ATTRIBUTION.short} Deutsche Namen: eigene Übersetzung. Preise hier mal Preisstufe des
          Ladens.
        </p>
      </div>
    </Dialog>
  );
}
