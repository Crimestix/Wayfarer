/**
 * Verwandtschaft einer Person: eintragen, was sie für jemanden ist („ist Schwester von …“), und
 * sehen, wer sich daraus als verwandt ergibt. Die Rechnung steht in `domain/kin.ts`.
 */
import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { KIN_TYPES, kinOfWord, relativesOf } from '../../domain/kin';
import type { Entity } from '../../domain/schema';
import { Button, EntityLink, EntityPicker, IconButton, Select, toast } from '../../ui';
import { removeKin, setKin } from './kin';

/** Die Wörter zur Auswahl: jede Verwandtschaft in ihrer weiblichen und männlichen Form. */
const WORDS = KIN_TYPES.filter((type) => type.key !== 'relative').flatMap((type) => [
  type.f,
  type.m,
]);

export function KinSection({ entity }: { entity: Entity }) {
  const db = useDb();
  const data = useData();
  const [word, setWord] = useState('Schwester');
  const [otherId, setOtherId] = useState<string | null>(null);
  const relatives = useMemo(() => relativesOf(data, entity.id), [data, entity.id]);

  const add = () => {
    const read = kinOfWord(word);
    if (!read || !otherId) return;
    setKin(db, entity.id, otherId, read.kin, read.gender);
    setOtherId(null);
  };

  return (
    <section className="wf-welt-kin" aria-label="Verwandtschaft">
      <h4 className="wf-section-title">Verwandtschaft</h4>
      <div className="wf-welt-kin__form">
        <span className="wf-welt-kin__who">{entity.name} ist</span>
        <Select value={word} onChange={(e) => setWord(e.target.value)} aria-label="Verwandtschaft">
          {WORDS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
        <span>von</span>
        <EntityPicker
          value={otherId}
          onChange={setOtherId}
          kinds={['person', 'character']}
          exclude={[entity.id]}
          placeholder="Person wählen …"
        />
        <Button variant="primary" onClick={add} disabled={!otherId}>
          Eintragen
        </Button>
      </div>
      {relatives.length > 0 ? (
        <ul className="wf-welt-kin__list">
          {relatives.map((relative) => (
            <li key={relative.person.id}>
              <span className="wf-welt-kin__word">{relative.label}</span>
              <EntityLink id={relative.person.id} />
              {relative.relation ? (
                <IconButton
                  label={`Verwandtschaft mit ${relative.person.name} lösen`}
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const undo = removeKin(db, relative.relation!.id);
                    if (undo)
                      toast({
                        title: 'Verwandtschaft gelöst',
                        body: `${relative.person.name} – ${relative.label}`,
                        action: { label: 'Rückgängig', run: undo },
                      });
                  }}
                >
                  <X />
                </IconButton>
              ) : (
                <span
                  className="wf-welt-kin__derived"
                  title="Von Wayfarer aus dem Eingetragenen abgeleitet"
                >
                  abgeleitet
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="wf-welt-lead">
          Trage ein, wessen Mutter, Bruder oder Tante {entity.name} ist. Cousins, Großeltern und
          Schwager ergeben sich daraus von selbst – und in der Familie entsteht der Stammbaum.
        </p>
      )}
    </section>
  );
}
