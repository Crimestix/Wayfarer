/**
 * „Was hier passieren kann“: Szenen vom Blatt des Abends und aus Geschichten, die an den Ort der
 * Gruppe geheftet sind. Die Rechnung steht in `domain/scenesHere.ts`.
 */
import { useMemo } from 'react';
import { useLocation } from 'wouter';
import { Drama } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { scenesHere } from '../../domain/scenesHere';
import { toast } from '../../ui';
import { setSceneDone } from '../abend/actions';

export function ScenesHere() {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const scenes = useMemo(() => scenesHere(data), [data]);
  if (!scenes.length) return null;
  const played = (sceneId: string, text: string) => {
    setSceneDone(db, sceneId, true);
    toast({
      title: 'Szene gespielt',
      body: text.slice(0, 120),
      action: { label: 'Rückgängig', run: () => setSceneDone(db, sceneId, false) },
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
    </section>
  );
}
