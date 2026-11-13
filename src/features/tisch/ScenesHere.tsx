/**
 * „Was hier passieren kann“: Szenen vom Blatt des Abends und aus Geschichten, die an den Ort der
 * Gruppe geheftet sind – dazu, was hier noch offen hängt (ein Gerücht über diesen Ort, ein
 * Vorhaben, das hierher führte, etwas Angeheftetes). Die Rechnung steht in
 * `domain/scenesHere.ts` und `domain/looseEnds.ts`.
 */
import { useMemo } from 'react';
import { useLocation } from 'wouter';
import { Drama } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { entityName } from '../../domain/derive';
import { LOOSE_REASON_SHORT, looseEndsHere, sinceText } from '../../domain/looseEnds';
import { scenesHere } from '../../domain/scenesHere';
import { chronicleEntryLabel, toast } from '../../ui';
import { setSceneDone } from '../abend/actions';
import { entryHeadline } from '../chronik/model';

export function ScenesHere() {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const scenes = useMemo(() => scenesHere(data), [data]);
  const loose = useMemo(() => looseEndsHere(data), [data]);
  if (!scenes.length && !loose.length) return null;
  const played = (sceneId: string, text: string) => {
    setSceneDone(db, sceneId, true);
    toast({
      title: 'Szene gespielt',
      body: text.slice(0, 120),
      action: { label: 'Rückgängig', run: () => setSceneDone(db, sceneId, false) },
    });
  };
  const settle = (id: string, text: string) => {
    const before = data.chronicle[id]?.loose ?? null;
    db.patch('chronicle', id, { loose: 'settled' });
    toast({
      title: 'Erledigt',
      body: text.slice(0, 120),
      action: { label: 'Rückgängig', run: () => db.patch('chronicle', id, { loose: before }) },
    });
  };
  return (
    <section className="wf-tisch-stories" aria-label="Was hier passieren kann">
      <header className="wf-tisch-stories__head">
        <Drama aria-hidden />
        <h2 className="wf-tisch-stories__title">Was hier passieren kann</h2>
      </header>
      {scenes.map((scene) => (
        <div key={scene.key} className="wf-tisch-story wf-tisch-scene">
          <div className="wf-tisch-story__title">
            {scene.from === 'prep' && (
              <button
                type="button"
                className="wf-chron__check"
                title="Gespielt"
                aria-label={`Gespielt: ${scene.text}`}
                onClick={() => played(scene.sceneId, scene.text)}
              />
            )}
            <span className="wf-tisch-scene__text">{scene.text}</span>
          </div>
          <div className="wf-tisch-scene__meta">
            {scene.from === 'prep' ? (
              <span>vom Abend-Blatt</span>
            ) : (
              <button
                type="button"
                className="wf-tisch-stories__link"
                onClick={() => navigate(`/geschichte/${scene.storyId}`)}
              >
                {scene.storyTitle}
              </button>
            )}
            {scene.odds === 'sure' && <span>kommt sicher</span>}
            {scene.odds === 'unlikely' && <span>eher nicht</span>}
            {scene.encounterId && (
              <button
                type="button"
                className="wf-tisch-stories__link"
                onClick={() => navigate(`/begegnungen/${scene.encounterId}`)}
              >
                Begegnung öffnen
              </button>
            )}
          </div>
        </div>
      ))}
      {loose.length > 0 && (
        <div className="wf-tisch-loosehead">
          <span className="wf-tisch-subtitle">Hängt hier noch offen</span>
          <button
            type="button"
            className="wf-tisch-stories__link"
            onClick={() => navigate('/offen')}
          >
            Alles, was offen ist
          </button>
        </div>
      )}
      {loose.map((end) => {
        const places = end.placeIds.map((id) => entityName(data, id)).join(', ');
        const text =
          end.entry.text.trim() ||
          entryHeadline(data, end.entry) ||
          [chronicleEntryLabel(end.entry), places].filter(Boolean).join(': ');
        return (
          <div key={end.entry.id} className="wf-tisch-story wf-tisch-scene">
            <div className="wf-tisch-story__title">
              <button
                type="button"
                className="wf-chron__check"
                title="Erledigt – nicht mehr offen"
                aria-label={`Erledigt: ${text}`}
                onClick={() => settle(end.entry.id, text)}
              />
              <span className="wf-tisch-scene__text">{text}</span>
            </div>
            <div className="wf-tisch-scene__meta">
              <span>{LOOSE_REASON_SHORT[end.reason]}</span>
              <span>{sinceText(end)}</span>
            </div>
          </div>
        );
      })}
    </section>
  );
}
