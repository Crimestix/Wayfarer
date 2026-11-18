/**
 * „Aus Räumen und Artikeln“: Was der Spielleiter über die Räume seiner Bastion schon geschrieben
 * hat, wird zu ihren Einrichtungen (`facilityCandidates`, `facilitiesFromRooms`). Eine Liste zum
 * Ankreuzen – alles vorgewählt –, übernommen auf Klick, mit Rückgängig. Fehlt der Bastion noch ihr
 * Ort, fragt das Fenster zuerst danach: Ohne ihn weiß Wayfarer nicht, welche Räume gemeint sind.
 */
import { useMemo, useState } from 'react';
import { useData, useDb } from '../../data/hooks';
import { facilityCandidates } from '../../domain/bastion';
import type { Bastion } from '../../domain/schema';
import { Button, Checkbox, Dialog, EntityPicker, Field, toast } from '../../ui';
import { facilitiesFromRooms, patchBastion } from './actions';

export function RoomsDialog({ bastion, onClose }: { bastion: Bastion; onClose: () => void }) {
  const db = useDb();
  const data = useData();
  const candidates = useMemo(() => facilityCandidates(data, bastion), [data, bastion]);
  /** Abgewählte – so sind auch Vorschläge vorgewählt, die erst nach der Wahl des Ortes erscheinen. */
  const [off, setOff] = useState<Set<string>>(() => new Set());
  const chosen = candidates.filter((candidate) => !off.has(candidate.key));
  const place = bastion.placeId ? data.entities[bastion.placeId] : undefined;

  const take = () => {
    const result = facilitiesFromRooms(db, bastion.id, chosen);
    onClose();
    if (!result) return;
    const total = result.added + result.joined;
    toast({
      title: total === 1 ? 'Eine Einrichtung übernommen' : `${total} Einrichtungen übernommen`,
      body: `${
        result.joined
          ? result.joined === 1
            ? 'Eine gab es schon – sie hat jetzt ihren Raum. '
            : `${result.joined} gab es schon – sie haben jetzt ihren Raum. `
          : ''
      }Der Artikel ist jetzt die Seite der Einrichtung. Besitzer, Befehle und Gefolgsleute trägst du über den Stift ein.`,
      duration: 12000,
      action: { label: 'Rückgängig', run: result.undo },
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Einrichtungen aus Räumen und Artikeln"
      width={600}
      guard={false}
      footer={
        <>
          <span className="wf-grow" />
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!chosen.length} onClick={take}>
            {chosen.length === 1 ? 'Eine übernehmen' : `${chosen.length} übernehmen`}
          </Button>
        </>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-4)' }}>
        <Field
          label="Ort der Bastion"
          hint="Der Ort, an dem die Bastion steht – ihre Räume und die Artikel darunter stehen hier zur Wahl."
        >
          <EntityPicker
            value={bastion.placeId}
            onChange={(placeId) => patchBastion(db, bastion.id, { placeId })}
            kinds={['place']}
            placeholder="Ort wählen …"
          />
        </Field>
        {!place ? (
          <p className="wf-mute">Wähle zuerst den Ort der Bastion.</p>
        ) : candidates.length === 0 ? (
          <p className="wf-mute">
            Unter „{place.name}“ steht nichts mehr, das noch keine Einrichtung ist. Räume legst du
            auf der Seite des Ortes unter „Räume“ an – oder schreibst Artikel unter seinem Artikel.
          </p>
        ) : (
          <div className="wf-col" style={{ gap: 'var(--s-1)' }}>
            <div className="wf-row" style={{ gap: 'var(--s-3)' }}>
              <span className="wf-caps wf-grow">Was unter „{place.name}“ steht</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setOff(off.size ? new Set() : new Set(candidates.map((entry) => entry.key)))
                }
              >
                {off.size ? 'Alle wählen' : 'Keine wählen'}
              </Button>
            </div>
            {candidates.map((candidate) => (
              <Checkbox
                key={candidate.key}
                checked={!off.has(candidate.key)}
                onChange={(on) =>
                  setOff((current) => {
                    const next = new Set(current);
                    if (on) next.delete(candidate.key);
                    else next.add(candidate.key);
                    return next;
                  })
                }
              >
                {candidate.name}{' '}
                <span className="wf-mute">
                  · {candidate.note}
                  {candidate.articleId && candidate.placeId ? ' · mit Artikel' : ''}
                  {candidate.joins ? ' · gehört zur Einrichtung gleichen Namens' : ''}
                </span>
              </Checkbox>
            ))}
            <p className="wf-mute">
              Jede wird eine Einrichtung mit ihrem Namen – gibt es die Einrichtung schon, bekommt
              sie nur ihren Raum. Ein Artikel ohne Eintrag wird dabei ein Raum der Bastion; am Text
              ändert sich nichts.
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
