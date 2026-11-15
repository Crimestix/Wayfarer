/**
 * Das Blatt eines Abends zum Lesen: schlicht, auf einer Seite – zum Drucken (Einstieg, Namen,
 * Szenen, Geheimnisse, Orte, Personen) und zum Nachlesen früherer Abende aus der Chronik (dort
 * mit dem, was gespielt und aufgedeckt wurde). Nur lesen; geschrieben wird unter „Abend
 * vorbereiten“.
 */
import { useMemo } from 'react';
import { useData } from '../../data/hooks';
import {
  hintOf,
  prepOfSession,
  readyEncounters,
  resolveContent,
  type PrepContent,
} from '../../domain/prep';
import { personRows, placeRows } from '../../domain/prepOffers';
import { formatDayMonth } from '../../domain/time/calendar';
import { Button, Dialog } from '../../ui';
import { sessionLabel } from '../chronik/model';
import type { SpareName } from './model';
import '../handouts/handouts.css';
import './abend.css';

export function PrepPaper({
  title,
  content,
  names = [],
  past = false,
}: {
  title: string;
  content: PrepContent;
  /** Erzeugte Namen für den Notfall – nur auf dem Ausdruck. */
  names?: readonly SpareName[];
  /** Ein früherer Abend: Dann steht dabei, was gespielt und aufgedeckt wurde. */
  past?: boolean;
}) {
  const data = useData();
  const cal = data.campaign.calendar;
  const places = useMemo(() => placeRows(data, content), [data, content]);
  const people = useMemo(() => personRows(data, content), [data, content]);
  const encounters = readyEncounters(data, content);
  const scenes = content.scenes.filter((scene) => scene.text.trim() && (past || !scene.done));
  const secrets = content.secrets.filter(
    (secret) => secret.text.trim() && (past || !secret.revealed),
  );
  // Ein früherer Abend zeigt, wie es an ihm stand; was erst danach gespielt oder aufgedeckt
  // wurde (in der Geschichte, an einem späteren Abend), steht als „später“ dabei.
  const later = useMemo(() => resolveContent(data, content), [data, content]);
  const laterDone = (id: string) => !!later.scenes.find((scene) => scene.id === id)?.done;
  const laterTold = (id: string) => !!later.secrets.find((secret) => secret.id === id)?.revealed;
  const name = (id: string | null) => (id ? data.entities[id]?.name : undefined);
  const empty =
    !content.start.trim() &&
    !content.plan.trim() &&
    !content.treasure.trim() &&
    scenes.length + secrets.length + places.length + people.length + encounters.length === 0;
  return (
    <article className="wf-abend-paper">
      <h1>{title}</h1>
      {empty && <p className="wf-abend-paper__none">Auf diesem Blatt steht nichts.</p>}
      {content.plan.trim() && (
        <section>
          <h2>Was die Gruppe vorhat</h2>
          <p className="wf-abend-paper__text">{content.plan.trim()}</p>
        </section>
      )}
      {content.start.trim() && (
        <section>
          <h2>Einstieg</h2>
          <p className="wf-abend-paper__text">{content.start.trim()}</p>
          {past && (
            <p className="wf-abend-paper__mark">
              {content.startDone ? 'gespielt' : 'nicht als gespielt abgehakt'}
            </p>
          )}
        </section>
      )}
      {scenes.length > 0 && (
        <section>
          <h2>Mögliche Szenen</h2>
          <ul>
            {scenes.map((scene) => (
              <li key={scene.id}>
                <span className="wf-abend-paper__text">{scene.text.trim()}</span>
                {[name(scene.placeId), scene.storyId && data.stories[scene.storyId]?.title]
                  .filter(Boolean)
                  .map((part) => (
                    <em key={String(part)}> · {part}</em>
                  ))}
                {past && (
                  <span className="wf-abend-paper__mark">
                    {' '}
                    –{' '}
                    {scene.done
                      ? 'gespielt'
                      : laterDone(scene.id)
                        ? 'an diesem Abend nicht gespielt, später schon'
                        : 'nicht gespielt'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {secrets.length > 0 && (
        <section>
          <h2>Geheimnisse und Hinweise</h2>
          <ul>
            {secrets.map((secret) => {
              const linked = hintOf(data, secret);
              const story = secret.storyId ? data.stories[secret.storyId]?.title : undefined;
              return (
                <li key={secret.id}>
                  <span className="wf-abend-paper__text">{secret.text.trim()}</span>
                  {(linked || story) && <em> · {linked ? linked.thread.title : story}</em>}
                  {past && (
                    <span className="wf-abend-paper__mark">
                      {' '}
                      –{' '}
                      {secret.revealed
                        ? secret.revealedAt !== null
                          ? `aufgedeckt am ${formatDayMonth(cal, secret.revealedAt)}`
                          : 'aufgedeckt'
                        : laterTold(secret.id)
                          ? 'an diesem Abend nicht aufgedeckt, später schon'
                          : 'nicht aufgedeckt'}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {places.length > 0 && (
        <section>
          <h2>Orte</h2>
          <ul>
            {places.map((row) => (
              <li key={row.place.id}>
                <b>{row.place.name}</b>
                {row.line && <> – {row.line}</>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {people.length > 0 && (
        <section>
          <h2>Personen</h2>
          <ul>
            {people.map((row) => (
              <li key={row.entity.id}>
                <b>{row.entity.name}</b>
                {row.facts.length > 0 && <> – {row.facts.map((fact) => fact.text).join(' · ')}</>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {names.length > 0 && (
        <section>
          <h2>Namen für den Notfall</h2>
          <p className="wf-abend-paper__names">
            {names.map((entry) => `${entry.name} (${entry.role})`).join(' · ')}
          </p>
          <p className="wf-abend-paper__mark">Von Wayfarer erzeugt.</p>
        </section>
      )}
      {encounters.length > 0 && (
        <section>
          <h2>Begegnungen</h2>
          <p>{encounters.map((encounter) => encounter.name).join(' · ')}</p>
        </section>
      )}
      {past && content.treasure.trim() && (
        <section>
          <h2>Gedanken zur Beute</h2>
          <p className="wf-abend-paper__text">{content.treasure.trim()}</p>
        </section>
      )}
    </article>
  );
}

/** Das Blatt eines früheren Abends – aus der Chronik zum Nachlesen geöffnet. */
export function PrepSheetDialog({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const data = useData();
  const session = data.sessions[sessionId];
  const prep = useMemo(() => prepOfSession(data, sessionId), [data, sessionId]);
  if (!session) return null;
  return (
    <Dialog
      open
      onClose={onClose}
      guard={false}
      width={720}
      title={`Das Blatt des Abends – ${sessionLabel(session)}`}
      footer={<Button onClick={onClose}>Schließen</Button>}
    >
      {prep ? (
        <PrepPaper title="Was vorbereitet war" content={prep} past />
      ) : (
        <p className="wf-sheet__none">Für diesen Abend wurde kein Blatt geschrieben.</p>
      )}
    </Dialog>
  );
}
