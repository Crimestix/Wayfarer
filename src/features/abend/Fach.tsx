/**
 * Ein Fach des Abend-Blatts: einklappbar, mit seiner Leitfrage, einer leisen Marke („reicht“,
 * „heute nicht nötig“) statt eines Zählers – und unten dem Schritt zum nächsten Fach. Jedes Fach
 * ist freiwillig. Wie es steht, sagt `prepStand` in `domain/prep.ts`.
 */
import type { ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import type { PrepStand } from '../../domain/prep';
import { cx } from '../../ui';

/** Die Kennung, unter der `focusSheetSection` ein Fach findet. */
export const fachId = (key: string) => `wf-sheet-sec-${key}`;

export function Fach({
  stand,
  open,
  first,
  onToggle,
  onSkip,
  next,
  action,
  children,
}: {
  stand: PrepStand;
  open: boolean;
  /** Hier geht es weiter: das erste Fach, das noch nicht reicht. */
  first: boolean;
  onToggle: () => void;
  /** „Heute nicht nötig“ setzen oder zurücknehmen. */
  onSkip: (skipped: boolean) => void;
  /** Das Fach danach – der Knopf unten führt dorthin. */
  next: { title: string; go: () => void } | null;
  /** Knöpfe rechts im Kopf des aufgeklappten Fachs. */
  action?: ReactNode;
  children: ReactNode;
}) {
  const mark = stand.skipped ? 'heute nicht nötig' : stand.enough ? 'reicht' : '';
  return (
    <section
      id={fachId(stand.key)}
      className={cx(
        'wf-abend-fach',
        open && 'wf-abend-fach--open',
        first && 'wf-abend-fach--first',
        stand.skipped && 'wf-abend-fach--skipped',
      )}
    >
      <header className="wf-abend-fach__head">
        <button
          type="button"
          className="wf-abend-fach__toggle"
          aria-expanded={open}
          onClick={onToggle}
        >
          {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
          <h2>{stand.title}</h2>
          {!open && stand.brief && (
            <span className="wf-abend-fach__brief wf-clamp-1">{stand.brief}</span>
          )}
        </button>
        {open && action}
        {mark && (
          <span
            className="wf-abend-fach__mark"
            data-enough={stand.enough && !stand.skipped}
            title={stand.note}
          >
            {stand.enough && !stand.skipped && <Check aria-hidden />}
            {mark}
          </span>
        )}
      </header>
      {open && (
        <div className="wf-abend-fach__body">
          <p className="wf-sheet__hint">{stand.question}</p>
          {children}
          <footer className="wf-abend-fach__foot">
            <span className="wf-abend-fach__note">{stand.skipped ? '' : stand.note}</span>
            <button
              type="button"
              className="wf-abend-link"
              title={
                stand.skipped
                  ? 'Das Fach zählt wieder mit'
                  : 'Dieses Fach brauchst du für diesen Abend nicht – es zählt dann nicht als offen'
              }
              onClick={() => onSkip(!stand.skipped)}
            >
              {stand.skipped ? 'doch vorbereiten' : 'heute nicht nötig'}
            </button>
            {next && (
              <button type="button" className="wf-btn wf-btn--sm" onClick={next.go}>
                Weiter: {next.title}
              </button>
            )}
          </footer>
        </div>
      )}
    </section>
  );
}

/** Eine Zeile zum Dazunehmen: was es ist, woher es kommt – und der Handgriff. */
export function OfferRow({
  label,
  text,
  sub,
  taken,
  takenText = 'Liegt bereit',
  action,
  onTake,
  title,
}: {
  /** Ein kurzes Etikett vorn („Szene“, „Hinweis“) – kann fehlen. */
  label?: string | undefined;
  text: ReactNode;
  /** Woher das Angebot kommt. */
  sub?: ReactNode;
  taken?: boolean | undefined;
  takenText?: string | undefined;
  /** Was der Knopf sagt: „dazunehmen“, „auf den Abend legen“ … */
  action: string;
  onTake: () => void;
  title?: string | undefined;
}) {
  return (
    <div className={cx('wf-abend-offer', taken && 'wf-abend-offer--taken')}>
      {label && <span className="wf-abend-offer__label">{label}</span>}
      <span className="wf-abend-offer__text">
        {text}
        {sub && <em> – {sub}</em>}
      </span>
      {taken ? (
        <span className="wf-abend-offer__done">
          <Check aria-hidden />
          {takenText}
        </span>
      ) : (
        <button type="button" className="wf-abend-link" title={title} onClick={onTake}>
          {action}
        </button>
      )}
    </div>
  );
}

/** Die Überschrift über einer Reihe von Angeboten. */
export function OfferHead({ children }: { children: ReactNode }) {
  return <div className="wf-abend-offers__head">{children}</div>;
}
