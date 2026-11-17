/**
 * Auf der Seite eines Gefährten: seine Backstory (Text der Spieler, vom Spielleiter eingetragen)
 * mit den darin genannten Namen und dem Weg aufs Fadenbrett, und seine Einrichtungen der Bastion.
 * Was davon ein Haken für eine Geschichte ist, entscheidet der Spielleiter – Wayfarer holt nur auf
 * Klick einen Absatz als Karte aufs Brett, mit Faden zum Gefährten (`pinTextToBoard`).
 */
import { useMemo } from 'react';
import { Link, useLocation } from 'wouter';
import { Pin } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { backstoryParts } from '../../domain/backstory';
import { ORDER_LABEL, STATE_LABEL, facilitiesOf } from '../../domain/bastion';
import type { Character } from '../../domain/schema';
import { writtenNames } from '../../domain/written';
import { focusOn } from '../../shell/focus';
import { KindIcon, Panel, Written, entityHref, toast } from '../../ui';
import { pinTextToBoard } from '../faeden/actions';

export function BackstoryPanel({ character }: { character: Character }) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const text = character.character.backstory;
  const parts = useMemo(() => backstoryParts(text), [text]);
  const names = useMemo(
    () => writtenNames(data, [text], [character.id]).known.slice(0, 12),
    [data, text, character.id],
  );
  // Was schon als Karte auf dem Brett liegt, sagt der Knopf.
  const onBoard = useMemo(() => {
    const titles = new Set(
      Object.values(data.threads)
        .filter((thread) => thread.onBoard)
        .map((thread) => `${thread.title}\n${thread.text}`),
    );
    return (part: string) =>
      [...titles].some((entry) => entry.endsWith(`\n${part}`) || entry.startsWith(`${part}\n`));
  }, [data.threads]);
  const pin = (part: string) => {
    const made = pinTextToBoard(db, {
      text: part,
      fromId: character.id,
      word: 'Backstory',
      known: true,
    });
    if (!made) return;
    toast({
      title: 'Aufs Fadenbrett gelegt',
      body: `Als Karte mit Faden zu ${character.name}.`,
      action: {
        label: 'Zeigen',
        run: () => {
          focusOn({ type: 'card', key: `thread:${made.thread.id}` });
          navigate('/faeden');
        },
      },
    });
  };
  return (
    <Panel title="Backstory">
      <Written
        className="wf-gruppe-backstory"
        label={`Backstory von ${character.name}`}
        grow
        value={text}
        placeholder="Die Backstory, wie der Spieler sie geschrieben hat – einfach hineinkopieren. Leerzeilen trennen die Absätze."
        onSave={(backstory) =>
          db.patch('entities', character.id, {
            character: { ...character.character, backstory: backstory.trim() },
          })
        }
      />
      {names.length > 0 && (
        <div className="wf-gruppe-backstory__names">
          <span className="wf-mute">Darin genannt:</span>
          {names.map((entity) => (
            <Link key={entity.id} href={entityHref(entity)} className="wf-gruppe-backstory__name">
              <KindIcon kind={entity.kind} />
              {entity.name}
            </Link>
          ))}
        </div>
      )}
      {parts.length > 0 && (
        <div className="wf-gruppe-backstory__parts">
          <span className="wf-mute">
            Ein Absatz ist ein Haken für eine Geschichte? Hol ihn aufs Fadenbrett.
          </span>
          {parts.map((part, index) => (
            <div key={index} className="wf-gruppe-backstory__part">
              <span className="wf-clamp-2">{part}</span>
              <button
                type="button"
                className="wf-gruppe-textlink"
                disabled={onBoard(part)}
                title={
                  onBoard(part)
                    ? 'Liegt schon auf dem Fadenbrett'
                    : 'Als Karte aufs Fadenbrett, mit Faden zum Gefährten'
                }
                onClick={() => pin(part)}
              >
                <Pin aria-hidden /> {onBoard(part) ? 'liegt auf dem Brett' : 'aufs Brett'}
              </button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/** Die Einrichtungen der Bastion, die diesem Gefährten gehören. */
export function FacilitiesPanel({ character }: { character: Character }) {
  const data = useData();
  const rows = facilitiesOf(data, character.id);
  if (!rows.length) return null;
  return (
    <Panel
      title="Bastion"
      count={rows.length}
      actions={
        <Link href="/bastion" className="wf-btn wf-btn--ghost wf-btn--sm">
          Zur Bastion
        </Link>
      }
    >
      <ul className="wf-gruppe-facilities">
        {rows.map(({ bastion, facility }) => (
          <li key={`${bastion.id}:${facility.id}`}>
            <b>{facility.name}</b>
            <em>
              {' '}
              {bastion.name} · {STATE_LABEL[facility.state]}
            </em>
            {facility.order && (
              <span className="wf-gruppe-facilities__order">
                {ORDER_LABEL[facility.order.name]}
                {facility.order.text && ` – ${facility.order.text}`}
                {facility.order.turnsLeft > 0 &&
                  ` (noch ${facility.order.turnsLeft} ${facility.order.turnsLeft === 1 ? 'Zug' : 'Züge'})`}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
