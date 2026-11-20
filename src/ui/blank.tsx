/**
 * Eine leere Seite zum Losschreiben: kein Knopf davor, man tippt einfach. Mit dem ersten Zeichen
 * entsteht, was dahintersteht (der Text eines Dings, ein freier Text), und der Editor übernimmt –
 * die Einfügemarke steht dann hinter dem Getippten (`requestFocusEnd`).
 */
import { useRef, type ReactNode } from 'react';
import { cx } from './components';

export function BlankPage({
  label,
  placeholder,
  onStart,
  onFocus,
  size = 'page',
  footer,
}: {
  /** Für Bildschirmleser: was hier entsteht. */
  label: string;
  placeholder: string;
  /** Das erste Getippte – danach verschwindet die leere Seite. */
  onStart: (typed: string) => void;
  /** Etwa: den Editor schon laden, während man zu tippen beginnt. */
  onFocus?: () => void;
  /** `page`: eine Seite hoch, `lead`: als großes Feld am Anfang einer Übersicht. */
  size?: 'page' | 'lead';
  /** Leise Zeile darunter (etwa „mit LegendKeeper verknüpfen“). */
  footer?: ReactNode;
}) {
  const started = useRef(false);
  return (
    <div className={cx('wf-blank', `wf-blank--${size}`)}>
      <textarea
        className="wf-blank__input"
        aria-label={label}
        placeholder={placeholder}
        spellCheck
        onFocus={onFocus}
        onChange={(event) => {
          const typed = event.target.value;
          if (started.current || !typed.trim()) return;
          started.current = true;
          onStart(typed);
        }}
      />
      {footer && <div className="wf-blank__foot">{footer}</div>}
    </div>
  );
}
