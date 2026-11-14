/**
 * Eine Strecke schreiben: Punkt für Punkt mit Pfeilen dazwischen, je Zeile eine Kette. Wayfarer
 * zeigt, was daraus würde – welche Orte es schon gibt und welche neu entstehen –, bevor etwas
 * angelegt wird.
 */
import { useMemo, useState } from 'react';
import { useData, useDb } from '../../data/hooks';
import { planRoutes, twinNote } from '../../domain/net';
import type { Net } from '../../domain/schema';
import { formatWayTime } from '../../domain/ways';
import { Button, Dialog, Field, TextArea, toast } from '../../ui';
import { addRoutes } from './actions';

const plural = (count: number, one: string, many: string) =>
  count === 1 ? `1 ${one}` : `${count} ${many}`;

export function RouteDialog({
  net,
  onClose,
  onDone,
}: {
  net: Net;
  onClose: () => void;
  onDone: () => void;
}) {
  const db = useDb();
  const data = useData();
  const [text, setText] = useState('');
  const plan = useMemo(() => planRoutes(data, net, text), [data, net, text]);
  const fresh = new Set(
    plan.flatMap((chain) => chain.filter((step) => !step.place).map((step) => step.name)),
  );
  const steps = plan.reduce((sum, chain) => sum + chain.length, 0);

  const apply = () => {
    const added = addRoutes(db, net.id, text);
    onDone();
    const parts = [
      added.places > 0 && plural(added.places, 'neuer Ort', 'neue Orte'),
      added.ways > 0 && plural(added.ways, 'neuer Weg', 'neue Wege'),
    ].filter(Boolean);
    toast({
      title: 'Strecke übernommen',
      body: [
        parts.length ? `${parts.join(', ')}.` : 'Alles davon gab es schon.',
        twinNote(added.twins),
      ]
        .filter(Boolean)
        .join(' '),
      action: { label: 'Rückgängig', run: added.undo },
      duration: 9000,
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Strecke schreiben"
      width={640}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={steps === 0} onClick={apply}>
            Übernehmen
          </Button>
        </>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-4)' }}>
        <Field
          label="Strecke"
          hint="Je Zeile eine Kette von Punkten, mit -> dazwischen. Eine Abzweigung ist eine neue Zeile, die bei einem schon genannten Punkt beginnt. Hinter einem Punkt kann in Klammern stehen, wie lange der Weg dorthin dauert."
        >
          <TextArea
            autoFocus
            rows={6}
            value={text}
            placeholder={'A -> B (4 Std.) -> C (2 Tage)\nB -> D'}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        {steps > 0 && (
          <div className="wf-netz-plan" aria-label="Was daraus wird">
            {plan.map((chain, row) => (
              <div key={row} className="wf-netz-plan__chain">
                {chain.map((step, index) => (
                  <span key={index} className="wf-netz-plan__step">
                    {index > 0 && (
                      <span className="wf-netz-plan__way">
                        {step.minutes === null ? '→' : `${formatWayTime(step.minutes)} →`}
                      </span>
                    )}
                    <span className={step.place ? undefined : 'wf-netz-plan__new'}>
                      {step.place?.name ?? step.name}
                    </span>
                  </span>
                ))}
              </div>
            ))}
            <p className="wf-mute">
              {fresh.size > 0
                ? `${plural(fresh.size, 'Ort entsteht', 'Orte entstehen')} neu in der Welt (hervorgehoben). Alle anderen gibt es schon.`
                : 'Alle diese Orte gibt es schon in der Welt.'}{' '}
              Wege entstehen nur, wo zwischen zwei Punkten noch keiner ist.
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
