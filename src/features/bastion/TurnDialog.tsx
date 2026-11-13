/**
 * Der Bastionszug: je bereite besondere Einrichtung ein Befehl (Vorschlag: der vom letzten Mal),
 * was daraus wird, und bei „Instandhalten“ ein Ereignis aus der Tabelle des Spielleiters.
 */
import { useMemo, useState } from 'react';
import { Dices } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import {
  ORDER_LABEL,
  eventFor,
  needsEvent,
  parseEvents,
  proposeTurn,
  type TurnChoice,
} from '../../domain/bastion';
import type { Bastion, BastionOrder } from '../../domain/schema';
import { formatDayMonth, MINUTES_PER_DAY } from '../../domain/time/calendar';
import { Button, Checkbox, Dialog, Input, Select, toast } from '../../ui';
import { fairDie } from '../bestiarium/model';
import { runTurn } from './actions';

export function TurnDialog({ bastion, onClose }: { bastion: Bastion; onClose: () => void }) {
  const db = useDb();
  const data = useData();
  const [choices, setChoices] = useState<TurnChoice[]>(() => proposeTurn(bastion));
  const rows = useMemo(() => parseEvents(bastion.events), [bastion.events]);
  const [event, setEvent] = useState('');
  const [roll, setRoll] = useState<number | null>(null);
  const turnAt = (bastion.lastTurnAt ?? data.state.now) + bastion.turnDays * MINUTES_PER_DAY;
  const set = (id: string, change: Partial<TurnChoice>) =>
    setChoices((all) => all.map((c) => (c.facilityId === id ? { ...c, ...change } : c)));
  const rollEvent = () => {
    const value = fairDie(bastion.eventDie);
    setRoll(value);
    setEvent(eventFor(rows, value)?.text ?? '');
  };
  const run = () => {
    const undo = runTurn(
      db,
      bastion.id,
      choices,
      needsEvent(choices) && event.trim() ? event.trim() : null,
    );
    onClose();
    if (undo)
      toast({
        title: 'Bastionszug ausgeführt',
        body: 'Steht in der Chronik.',
        action: { label: 'Rückgängig', run: undo },
      });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Bastionszug · ${formatDayMonth(data.campaign.calendar, turnAt)}`}
      width={860}
      footer={
        <>
          <span className="wf-mute" style={{ marginRight: 'auto' }}>
            Danach ist der nächste Zug in {bastion.turnDays} Tagen fällig.
          </span>
          <Button onClick={onClose}>Später</Button>
          <Button variant="primary" onClick={run}>
            Zug ausführen
          </Button>
        </>
      }
    >
      <p className="wf-mute" style={{ margin: '0 0 var(--s-3)' }}>
        Wayfarer schlägt die Befehle vom letzten Mal vor – du entscheidest. Was daraus wird,
        schreibst du.
      </p>
      {choices.length === 0 && (
        <p className="wf-mute">
          Keine besondere Einrichtung ist bereit. Der Zug hält nur fest, dass die Zeit vergangen
          ist.
        </p>
      )}
      <div className="wf-bastion-turn">
        {choices.map((choice) => {
          const facility = bastion.facilities.find((f) => f.id === choice.facilityId)!;
          const owner = facility.ownerId ? data.entities[facility.ownerId]?.name : 'die Gruppe';
          return (
            <div key={choice.facilityId} className="wf-bastion-turn__row">
              <div className="wf-bastion-turn__name">
                {facility.name}
                <small>
                  {owner}
                  {facility.hirelings && ` · ${facility.hirelings}`}
                </small>
              </div>
              <Select
                value={choice.order ?? ''}
                aria-label={`Befehl für ${facility.name}`}
                onChange={(e) =>
                  set(choice.facilityId, { order: (e.target.value || null) as BastionOrder | null })
                }
              >
                <option value="">kein Befehl</option>
                {facility.orders.map((order) => (
                  <option key={order} value={order}>
                    {ORDER_LABEL[order]}
                  </option>
                ))}
              </Select>
              <Input
                value={choice.text}
                aria-label={`Was in ${facility.name} entsteht`}
                placeholder={choice.order === 'maintain' ? '–' : 'Was daraus wird …'}
                onChange={(e) => set(choice.facilityId, { text: e.target.value })}
              />
              <label
                className="wf-bastion-turn__left"
                title="Wie viele Züge der Befehl danach noch braucht"
              >
                noch
                <Input
                  inputMode="numeric"
                  value={String(choice.turnsLeft)}
                  aria-label="Weitere Züge"
                  onChange={(e) =>
                    set(choice.facilityId, { turnsLeft: Math.max(0, Number(e.target.value) || 0) })
                  }
                />
              </label>
              <Checkbox
                checked={choice.asLoot}
                onChange={(asLoot) => set(choice.facilityId, { asLoot })}
              >
                als Beute
              </Checkbox>
            </div>
          );
        })}
      </div>
      {needsEvent(choices) && (
        <div className="wf-bastion-event">
          <span className="wf-caps">Ereignis</span>
          {rows.length ? (
            <Button size="sm" icon={<Dices />} onClick={rollEvent}>
              W{bastion.eventDie} würfeln
            </Button>
          ) : (
            <span className="wf-mute">
              Trag deine Ereignistabelle auf der Seite der Bastion ein.
            </span>
          )}
          {roll !== null && <b className="wf-bastion-event__roll">{roll}</b>}
          <Input
            value={event}
            aria-label="Ereignis"
            placeholder="Was geschieht – gewürfelt oder selbst eingetragen"
            onChange={(e) => setEvent(e.target.value)}
          />
        </div>
      )}
    </Dialog>
  );
}
