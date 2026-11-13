/**
 * Drucken: Was gedruckt werden soll, kommt in eine eigene Ebene, die nur beim Drucken sichtbar
 * ist (`handouts.css`, `@media print`). Danach verschwindet sie wieder.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function usePrint(): { print: (content: ReactNode) => void; layer: ReactNode } {
  const [content, setContent] = useState<ReactNode>(null);
  useEffect(() => {
    if (!content) return;
    const done = () => setContent(null);
    window.addEventListener('afterprint', done);
    // Erst zeichnen lassen, dann drucken.
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('afterprint', done);
    };
  }, [content]);
  return {
    print: setContent,
    layer: content
      ? createPortal(<div className="wf-print-layer">{content}</div>, document.body)
      : null,
  };
}
