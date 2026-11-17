/**
 * Am Halt eines Rettungswurfs (Gewaltmarsch, Kälte, Hitze, Hunger): Die Spieler würfeln am Tisch,
 * hier steht je Gefährte „geschafft“ oder „gescheitert“ – gescheitert trägt eine Stufe Erschöpfung
 * ein (mit Rückgängig). Gilt die Folge für alle (Durst, fünf Tage ohne Nahrung), genügt ein Knopf.
 * So merkt sich Wayfarer, was sonst als Strichliste auf dem Tisch läge.
 */
import { useState } from 'react';
import { useDb } from '../../data/hooks';
import type { BodyCheck as Check } from '../../domain/travelRules';
import type { Character } from '../../domain/schema';
import { Button, toast } from '../../ui';
import { patchCharacter } from '../gruppe/actions';

export function BodyCheck({
  check,
  members,
  allToo = false,
}: {
  check: Check;
  members: readonly Character[];
  /** Dazu gilt eine Folge für alle (Durst neben dem Hunger): ein Knopf darunter. */
  allToo?: boolean;
}) {
  const db = useDb();
  /** Wer schon entschieden ist – je Halt neu (der Aufrufer gibt einen `key`). */
  const [done, setDone] = useState<Record<string, 'ok' | 'fail'>>({});
  const tire = (ids: readonly string[]) => {
    const before = ids.map((id) => {
      const current = db.getSnapshot().entities[id];
      return { id, level: current?.kind === 'character' ? current.character.exhaustion : 0 };
    });
    db.batch(() => {
      for (const { id, level } of before)
        patchCharacter(db, id, { exhaustion: Math.min(6, level + 1) });
    });
    setDone((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, 'fail'])) }));
    toast({
      slot: 'reise',
      title:
        ids.length === 1
          ? `Eine Stufe Erschöpfung: ${members.find((m) => m.id === ids[0])?.name ?? ''}`
          : `Eine Stufe Erschöpfung für ${ids.length} Gefährten`,
      body: before.some(({ level }) => level + 1 >= 6)
        ? 'Stufe 6: Wer sie erreicht, stirbt.'
        : 'Steht beim Gefährten; eine Lange Rast nimmt eine Stufe.',
      action: {
        label: 'Rückgängig',
        run: () =>
          db.batch(() => {
            for (const { id, level } of before) patchCharacter(db, id, { exhaustion: level });
            setDone((current) => {
              const next = { ...current };
              for (const id of ids) delete next[id];
              return next;
            });
          }),
      },
    });
  };
  if (!members.length) return null;
  if (check === 'automatic')
    return (
      <div className="wf-reise-body">
        <Button
          size="sm"
          disabled={members.every((member) => done[member.id])}
          onClick={() => tire(members.map((member) => member.id))}
        >
          Allen eine Stufe Erschöpfung
        </Button>
      </div>
    );
  return (
    <>
      <ul className="wf-reise-body" aria-label="Rettungswürfe">
        {members.map((member) => (
          <li key={member.id} data-state={done[member.id]}>
            <span className="wf-reise-body__name">
              {member.name}
              {member.character.exhaustion > 0 && (
                <em title={`Erschöpfung Stufe ${member.character.exhaustion}`}>
                  {' '}
                  · Stufe {member.character.exhaustion}
                </em>
              )}
            </span>
            {done[member.id] ? (
              <span className="wf-reise-body__done">
                {done[member.id] === 'ok' ? 'geschafft' : '+1 Erschöpfung'}
              </span>
            ) : (
              <span className="wf-reise-body__acts">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDone((current) => ({ ...current, [member.id]: 'ok' }))}
                >
                  geschafft
                </Button>
                <Button size="sm" onClick={() => tire([member.id])}>
                  gescheitert
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {members.some((member) => !done[member.id]) && (
        <div className="wf-reise-body wf-reise-body--all">
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setDone((current) => ({
                ...Object.fromEntries(members.map((member) => [member.id, 'ok' as const])),
                ...current,
              }))
            }
          >
            Alle übrigen geschafft
          </Button>
        </div>
      )}
      {allToo && (
        <div className="wf-reise-body">
          <Button size="sm" onClick={() => tire(members.map((member) => member.id))}>
            Durst: allen eine Stufe Erschöpfung
          </Button>
        </div>
      )}
    </>
  );
}
