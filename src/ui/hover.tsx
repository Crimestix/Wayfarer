/**
 * Ein ruhiger Kurzblick beim Darüberfahren: Nach einer kleinen Verzögerung erscheint neben dem
 * Wort eine Karte; sie bleibt, solange die Maus auf Wort oder Karte ist, und geht ohne Klick.
 * Mit der Tastatur erscheint sie, solange das Wort den Fokus hat. Nie ein Fenster, nie ein
 * Fokuswechsel.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** So lange ruht die Maus, bevor die Karte kommt – wer nur darüberstreicht, sieht nichts. */
export const HOVER_DELAY = 450;
const CLOSE_DELAY = 160;
const CARD_WIDTH = 320;

export function HoverCard({
  children,
  card,
  delay = HOVER_DELAY,
}: {
  children: ReactNode;
  /** Der Inhalt der Karte – erst gerechnet, wenn sie erscheint; null = keine Karte. */
  card: () => ReactNode;
  delay?: number;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [style, setStyle] = useState<CSSProperties | null>(null);

  const clear = () => window.clearTimeout(timer.current);
  useEffect(() => clear, []);

  const show = (wait: number) => {
    clear();
    timer.current = window.setTimeout(() => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const next: CSSProperties = { position: 'fixed', width: CARD_WIDTH };
      const below = window.innerHeight - rect.bottom;
      if (below < 240 && rect.top > below) next.bottom = window.innerHeight - rect.top + 6;
      else next.top = rect.bottom + 6;
      next.left = Math.max(8, Math.min(rect.left, window.innerWidth - CARD_WIDTH - 8));
      setStyle(next);
    }, wait);
  };
  const hide = () => {
    clear();
    timer.current = window.setTimeout(() => setStyle(null), CLOSE_DELAY);
  };
  const content = style ? card() : null;

  return (
    <span
      ref={anchor}
      className="wf-hover"
      onMouseEnter={() => show(delay)}
      onMouseLeave={hide}
      onFocus={() => show(delay)}
      onBlur={hide}
      // Ein Klick öffnet das Ziel; die Karte hat dann ausgedient.
      onClick={() => {
        clear();
        setStyle(null);
      }}
    >
      {children}
      {content &&
        // Am Rand der Seite: Im Fließtext stünde die Karte sonst mitten in einem Absatz.
        createPortal(
          <div
            className="wf-hovercard"
            role="tooltip"
            style={style!}
            onMouseEnter={clear}
            onMouseLeave={hide}
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}
