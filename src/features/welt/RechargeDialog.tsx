/**
 * „Auffrischen“: Wayfarer würfelt den Ausdruck der Ladungen („1W6+1 bei Morgengrauen“) mit echtem
 * Zufall und zeigt das Ergebnis zum Bestätigen. Die Zahl lässt sich vorher ändern – am Tisch hat
 * vielleicht jemand selbst gewürfelt.
 */
import { useState } from 'react';
import { Dices } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { chargesText, rollRecharge, rollText, type RechargeRoll } from '../../domain/magicItem';
import { Button, Dialog, Field, Input, toast } from '../../ui';
import { fairDie } from '../bestiarium/model';
import { rechargeItem } from './magic';
import './magic.css';

export function RechargeDialog({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const db = useDb();
  const data = useData();
  const entity = data.entities[itemId];
  const charges = entity?.kind === 'item' ? entity.item.magic?.charges : undefined;
  const [roll, setRoll] = useState<RechargeRoll | null>(() =>
    charges ? rollRecharge(charges, fairDie) : null,
  );
  const [text, setText] = useState(roll ? String(roll.gained) : '');
  if (!entity || !charges) return null;

  const gained = /^\s*\d+\s*$/.test(text) ? Number(text) : null;
  const after = gained === null ? null : Math.min(charges.max, charges.current + gained);
  const reroll = () => {
    const next = rollRecharge(charges, fairDie);
    setRoll(next);
    if (next) setText(String(next.gained));
  };
  const apply = () => {
    if (gained === null) return;
    const undo = rechargeItem(db, itemId, gained);
    toast({
      title: 'Aufgefrischt',
      body: `${entity.name}: ${after} von ${charges.max} Ladungen`,
      action: undo ? { label: 'Rückgängig', run: undo } : undefined,
    });
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      guard={false}
      title={`Ladungen auffrischen · ${entity.name}`}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={apply} disabled={gained === null}>
            Übernehmen
          </Button>
        </>
      }
    >
      <div className="wf-welt-recharge">
        <p className="wf-welt-recharge__now">Jetzt: {chargesText(charges)}</p>
        {roll ? (
          <p className="wf-welt-recharge__roll">{rollText(roll)}</p>
        ) : (
          <p className="wf-welt-recharge__roll">
            Im Text steht kein Wurf – trag ein, wie viele zurückkommen.
          </p>
        )}
        <div className="wf-welt-recharge__row">
          <Field label="Zurück">
            <Input
              value={text}
              inputMode="numeric"
              aria-label="Wie viele Ladungen zurückkommen"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') apply();
              }}
            />
          </Field>
          {roll && roll.rolls.length > 0 && (
            <Button icon={<Dices />} onClick={reroll}>
              Neu würfeln
            </Button>
          )}
        </div>
        {after !== null && (
          <p className="wf-welt-recharge__after">
            Danach: {after} von {charges.max} Ladungen
          </p>
        )}
      </div>
    </Dialog>
  );
}
