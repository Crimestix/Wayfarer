/**
 * „Auf dem Storyboard“ am Spieltisch: die Karte, an der die Gruppe auf dem Fadenbrett steht
 * (`state.boardNow`), und wohin ihre Pfeile führen – die Möglichkeiten, die der Spielleiter
 * geschrieben hat. Was die Spieler daraus machen, entscheidet sich am Tisch: „Hierhin“ rückt
 * die Markierung weiter, die Karte davor gehört dann zum gespielten Weg (`moveBoardNow`).
 * Die Rechnung steht in `domain/whiteboard.ts` (`boardNowView`).
 */
import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { ChevronDown, ChevronRight, Flag } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { boardNowViews, type BoardNowView, type BoardPiece } from '../../domain/whiteboard';
import { focusOn } from '../../shell/focus';
import { cx, toast } from '../../ui';
import { moveBoardNow } from '../faeden/actions';

export function BoardNowBox() {
  const data = useData();
  const views = useMemo(() => boardNowViews(data), [data]);
  const [open, setOpen] = useState(true);
  if (!views.length) return null;
  const played = views[0]!.played;
  return (
    <section className={cx('wf-tisch-gesch wf-tisch-board', open && 'wf-tisch-gesch--open')}>
      <button
        type="button"
        className="wf-tisch-gesch__head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
        <span className="wf-tisch-gesch__title">Auf dem Storyboard</span>
        <span className="wf-tisch-gesch__where">
          {views.length > 1 ? `${views.length} Stellen` : 'Hier steht die Gruppe'}
          {played > 0 && ` · ${played} gespielt`}
        </span>
      </button>
      {!open && (
        <div className="wf-tisch-gesch__brief">
          {views.map((view) => view.here.title).join(' · ')}
        </div>
      )}
      {open && views.map((view) => <BoardNowPart key={view.here.key} view={view} />)}
    </section>
  );
}

/** Eine Stelle, an der die Gruppe steht: die Karte, ihr Text und wohin es führen kann. */
function BoardNowPart({ view }: { view: BoardNowView }) {
  const db = useDb();
  const [, navigate] = useLocation();
  const show = (piece: BoardPiece) => {
    focusOn({ type: 'card', key: piece.key });
    navigate('/faeden');
  };
  const go = (piece: BoardPiece) => {
    const undo = moveBoardNow(db, view.here.key, piece.key);
    toast({
      title: 'Weiter auf dem Storyboard',
      body: `Die Gruppe steht jetzt bei „${piece.title}“.`,
      action: { label: 'Rückgängig', run: undo },
    });
  };
  return (
    <div className="wf-tisch-board__body">
      {view.story && <span className="wf-tisch-dazu__label">{view.story.title}</span>}
      <div className="wf-tisch-board__here">
        <Flag aria-hidden />
        <button
          type="button"
          className="wf-tisch-board__title"
          title="Auf dem Fadenbrett zeigen"
          onClick={() => show(view.here)}
        >
          {view.here.title}
        </button>
      </div>
      {view.here.text.trim() && <p className="wf-tisch-board__text">{view.here.text}</p>}
      {view.next.length === 0 ? (
        <p className="wf-tisch-board__none">
          Von hier führt noch kein Pfeil weiter – auf dem Fadenbrett ziehst du einen.
        </p>
      ) : (
        <ul className="wf-tisch-board__next">
          {view.next.map((step) => (
            <li key={step.key}>
              <span className="wf-tisch-board__step">
                <button
                  type="button"
                  className="wf-tisch-board__title"
                  title="Auf dem Fadenbrett zeigen"
                  onClick={() => show(step)}
                >
                  {step.title}
                </button>
                {step.word && <em>{step.word}</em>}
                {step.text.trim() && (
                  <span className="wf-tisch-board__peek wf-clamp-2">{step.text}</span>
                )}
              </span>
              <button
                type="button"
                className="wf-btn wf-btn--sm"
                title="Die Spieler gehen hierhin – die Markierung rückt weiter"
                onClick={() => go(step)}
              >
                Hierhin
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
