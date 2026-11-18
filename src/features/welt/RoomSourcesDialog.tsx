/**
 * „Aus Artikeln …“: Was unter einem Ort schon geschrieben steht – Orte darin und Artikel ohne
 * Eintrag –, wird zu seinen Etagen und Räumen (`roomSources`, `takeRoomSources`). Je Zeile wählt
 * der Spielleiter: Etage, Raum oder nicht; Wayfarer wählt nur vor. Übernommen auf Klick, mit
 * Rückgängig; am Text ändert sich nichts.
 */
import { useMemo, useState } from 'react';
import { useData, useDb } from '../../data/hooks';
import { roomSources } from '../../domain/rooms';
import type { Place } from '../../domain/schema';
import { Button, Dialog, toast } from '../../ui';
import { takeRoomSources, type RoomPick } from './rooms';

type Choice = 'floor' | 'room' | 'none';

const CHOICES: { value: Choice; label: string }[] = [
  { value: 'floor', label: 'Etage' },
  { value: 'room', label: 'Raum' },
  { value: 'none', label: 'nicht' },
];

export function RoomSourcesDialog({ place, onClose }: { place: Place; onClose: () => void }) {
  const db = useDb();
  const data = useData();
  const sources = useMemo(() => roomSources(data, place.id), [data, place.id]);
  /** Nur was der Spielleiter umgestellt hat – sonst gilt die Vorwahl. */
  const [changed, setChanged] = useState<Record<string, Choice>>({});
  const choiceOf = (key: string): Choice => {
    const source = sources.find((entry) => entry.key === key);
    return changed[key] ?? (source?.preselect ? source.guess : 'none');
  };
  const picks: RoomPick[] = sources.flatMap((source) => {
    const as = choiceOf(source.key);
    return as === 'none' ? [] : [{ key: source.key, as }];
  });
  const setAll = (choice: Choice | null) =>
    setChanged(choice ? Object.fromEntries(sources.map((source) => [source.key, choice])) : {});

  const take = () => {
    const result = takeRoomSources(db, place.id, picks);
    onClose();
    if (!result) return;
    const parts = [
      result.floors && (result.floors === 1 ? 'Eine Etage' : `${result.floors} Etagen`),
      result.rooms && (result.rooms === 1 ? 'ein Raum' : `${result.rooms} Räume`),
    ].filter(Boolean) as string[];
    toast({
      title: `${parts.join(' und ').replace(/^./, (first) => first.toLocaleUpperCase('de'))} übernommen`,
      body: `Sie stehen jetzt bei „${place.name}“ unter „Räume“. Ihr Artikel ist die Seite des Raums.`,
      duration: 12000,
      action: { label: 'Rückgängig', run: result.undo },
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Etagen und Räume aus Artikeln"
      width={680}
      guard={false}
      footer={
        <>
          <span className="wf-grow" />
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!picks.length} onClick={take}>
            {picks.length === 1 ? 'Eine übernehmen' : `${picks.length} übernehmen`}
          </Button>
        </>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-3)' }}>
        <p className="wf-mute" style={{ margin: 0 }}>
          Was unter „{place.name}“ schon geschrieben steht: Orte darin und Artikel unter seinem
          Artikel. Wähle je Zeile, was es ist. Ein Artikel ohne Eintrag wird dabei ein Raum oder
          eine Etage; am Text ändert sich nichts.
        </p>
        {sources.length === 0 ? (
          <p className="wf-mute">
            Unter „{place.name}“ steht nichts mehr, das noch kein Raum und keine Etage ist.
          </p>
        ) : (
          <>
            <div className="wf-row" style={{ gap: 'var(--s-2)' }}>
              <span className="wf-caps wf-grow">Was es ist</span>
              <Button size="sm" variant="ghost" onClick={() => setAll(null)}>
                Wie vorgeschlagen
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAll('room')}>
                Alle als Raum
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAll('none')}>
                Keine
              </Button>
            </div>
            <div className="wf-welt-roomsrc">
              {sources.map((source) => {
                const choice = choiceOf(source.key);
                return (
                  <div
                    key={source.key}
                    className="wf-welt-roomsrc__row"
                    data-off={choice === 'none' || undefined}
                    style={{ paddingLeft: `calc(${source.depth} * var(--s-5))` }}
                  >
                    <span className="wf-welt-roomsrc__name">{source.name}</span>
                    <span className="wf-welt-roomsrc__note">
                      {source.note}
                      {source.placeId && source.articleId ? ' · mit Artikel' : ''}
                    </span>
                    <span className="wf-grow" />
                    <div className="wf-btn-group" role="group" aria-label={`${source.name} ist`}>
                      {CHOICES.map(({ value, label }) => (
                        <Button
                          key={value}
                          size="sm"
                          aria-pressed={choice === value}
                          onClick={() =>
                            setChanged((current) => ({ ...current, [source.key]: value }))
                          }
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
