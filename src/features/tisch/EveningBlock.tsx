/**
 * „Dieser Abend“ am Spieltisch: was auf dem Blatt des Abends bereitliegt – der starke Einstieg,
 * mögliche Szenen und Geheimnisse zum Abhaken, Begegnungen, Beute. Geschrieben wird es unter
 * „Abend vorbereiten“ (`features/abend`); die Rechnung steht in `domain/prep.ts`.
 */
import { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import {
  openScenes,
  openSecrets,
  prepHasContent,
  prepView,
  readyEncounters,
} from '../../domain/prep';
import { cx, toast } from '../../ui';
import { setSceneDone, setSecretRevealed } from '../abend/actions';

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

export function EveningBlock() {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const view = useMemo(() => prepView(data), [data]);
  const [open, setOpen] = useState(true);
  const { content } = view;
  const scenes = openScenes(content);
  const secrets = openSecrets(content);
  const encounters = readyEncounters(data, content);

  if (!prepHasContent(data, content))
    return (
      <div className="wf-tisch-abend wf-tisch-abend--blank">
        Für diesen Abend liegt noch nichts bereit.
        <Link href="/abend">Abend vorbereiten</Link>
      </div>
    );

  const brief = [
    scenes.length > 0 && count(scenes.length, 'Szene', 'Szenen'),
    secrets.length > 0 && count(secrets.length, 'Geheimnis', 'Geheimnisse'),
    encounters.length > 0 && count(encounters.length, 'Begegnung', 'Begegnungen'),
  ]
    .filter(Boolean)
    .join(' · ');
  const played = (id: string, text: string) => {
    setSceneDone(db, id, true);
    toast({
      title: 'Szene gespielt',
      body: text.slice(0, 120),
      action: { label: 'Rückgängig', run: () => setSceneDone(db, id, false) },
    });
  };
  const revealed = (id: string, text: string) => {
    setSecretRevealed(db, id, true);
    toast({
      title: 'Geheimnis aufgedeckt',
      body: text.slice(0, 120),
      action: { label: 'Rückgängig', run: () => setSecretRevealed(db, id, false) },
    });
  };

  return (
    <section className={cx('wf-tisch-gesch wf-tisch-abend', open && 'wf-tisch-gesch--open')}>
      <button
        type="button"
        className="wf-tisch-gesch__head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
        <span className="wf-tisch-gesch__title">Dieser Abend</span>
        <span className="wf-tisch-gesch__where">
          {view.session ? `Session ${view.number}` : `vorbereitet für Session ${view.number}`}
        </span>
      </button>
      {!open && brief && <div className="wf-tisch-gesch__brief">{brief}</div>}
      {open && (
        <div className="wf-tisch-dazu">
          {content.start.trim() && (
            <>
              <span className="wf-tisch-dazu__label" data-here>
                Einstieg
              </span>
              <div className="wf-tisch-dazu__row wf-tisch-abend__text">{content.start.trim()}</div>
            </>
          )}
          {scenes.map((scene) => (
            <Line key={scene.id} label="Szene">
              <button
                type="button"
                className="wf-chron__check"
                title="Gespielt"
                aria-label={`Gespielt: ${scene.text}`}
                onClick={() => played(scene.id, scene.text)}
              />
              <span>{scene.text}</span>
            </Line>
          ))}
          {secrets.map((secret) => (
            <Line key={secret.id} label="Geheimnis">
              <button
                type="button"
                className="wf-chron__check"
                title="Die Gruppe hat es erfahren"
                aria-label={`Aufgedeckt: ${secret.text}`}
                onClick={() => revealed(secret.id, secret.text)}
              />
              <span>
                {secret.text}
                {secret.storyId && data.stories[secret.storyId] && (
                  <em> – {data.stories[secret.storyId]!.title}</em>
                )}
              </span>
            </Line>
          ))}
          {encounters.map((encounter) => (
            <Line key={encounter.id} label="Begegnung">
              <span>
                {encounter.name}
                <button
                  type="button"
                  className="wf-tisch-dazu__link"
                  onClick={() => navigate(`/begegnungen/${encounter.id}`)}
                >
                  öffnen
                </button>
              </span>
            </Line>
          ))}
          {content.treasure.trim() && (
            <>
              <span className="wf-tisch-dazu__label">Beute</span>
              <div className="wf-tisch-dazu__row wf-tisch-abend__text">
                {content.treasure.trim()}
              </div>
            </>
          )}
          <div className="wf-tisch-dazu__foot">
            <button type="button" onClick={() => navigate('/abend')}>
              Vorbereitung öffnen
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="wf-tisch-dazu__label">{label}</span>
      <div className="wf-tisch-dazu__row">{children}</div>
    </>
  );
}
