/**
 * „Vom Fadenbrett“ am Ort der Gruppe: was laut Brett hier zu finden ist („liegt in“) und wovon die
 * Leute, die gerade hier sind, wissen („weiß von“). Nur, was der Spielleiter mit Wörtern an die
 * Fäden geschrieben hat – Wayfarer rät nichts dazu. Die Rechnung steht in `domain/boardFacts.ts`.
 */
import { useMemo } from 'react';
import { useLocation } from 'wouter';
import { Waypoints } from 'lucide-react';
import { useData } from '../../data/hooks';
import { foundAt, knownBy, type BoardFact } from '../../domain/boardFacts';
import { placeCast, personPlace } from '../../domain/derive';
import { boardPiece, thingFace } from '../../domain/whiteboard';
import { focusOn } from '../../shell/focus';

export function BoardHere({ placeId }: { placeId: string }) {
  const data = useData();
  const [, navigate] = useLocation();
  const found = useMemo(() => foundAt(data, placeId), [data, placeId]);
  const knowing = useMemo(
    () =>
      placeCast(data, placeId)
        .present.filter((person) => personPlace(data, person) !== null)
        .map((person) => ({ person, facts: knownBy(data, person.id) }))
        .filter((row) => row.facts.length > 0),
    [data, placeId],
  );
  if (!found.length && !knowing.length) return null;
  const nameOf = (key: string) => thingFace(data, key)?.name ?? boardPiece(data, key)?.title ?? '?';
  const noteOf = (key: string) => thingFace(data, key)?.note || boardPiece(data, key)?.text || '';
  const show = (key: string) => {
    focusOn({ type: 'card', key });
    navigate('/faeden');
  };
  const line = (fact: BoardFact, key: string) => (
    <li key={fact.linkId}>
      <button type="button" className="wf-tisch-stories__link" onClick={() => show(key)}>
        {nameOf(key)}
      </button>
      {fact.word && <em> – {fact.word}</em>}
      {noteOf(key) && <span className="wf-tisch-brett__note">{noteOf(key)}</span>}
    </li>
  );
  return (
    <section className="wf-tisch-stories" aria-label="Vom Fadenbrett">
      <header className="wf-tisch-stories__head">
        <Waypoints aria-hidden />
        <h2 className="wf-tisch-stories__title">Vom Fadenbrett</h2>
      </header>
      {found.length > 0 && (
        <>
          <span className="wf-tisch-subtitle">Hier zu finden</span>
          <ul className="wf-tisch-brett">{found.map((fact) => line(fact, fact.from))}</ul>
        </>
      )}
      {knowing.map(({ person, facts }) => (
        <div key={person.id}>
          <span className="wf-tisch-subtitle">{person.name} weiß von</span>
          <ul className="wf-tisch-brett">{facts.map((fact) => line(fact, fact.to))}</ul>
        </div>
      ))}
    </section>
  );
}
