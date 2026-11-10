/** Kleine Bausteine, die mehrere Ansichten der Chronik teilen. */

/**
 * Text für Etiketten in Versalien. Die Versalienschrift zeichnet die 1 wie ein I – aus „Session 11“
 * würde „Session II“. Zahlen stehen deshalb in der Textschrift.
 */
export function Caps({ children }: { children: string }) {
  return (
    <>
      {children.split(/(\d[\d.:]*)/).map((part, i) =>
        i % 2 ? (
          <span key={i} className="wf-chronik-figure">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}
