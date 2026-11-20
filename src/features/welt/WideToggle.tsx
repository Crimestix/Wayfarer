import { Maximize2, Minimize2 } from 'lucide-react';
import { IconButton } from '../../ui';
import { setWideText, useWideText } from './wide';

/** Der Knopf zum breiten Schreiben (F11) – im Kopf einer Seite der Welt. */
export function WideToggle() {
  const wide = useWideText();
  return (
    <IconButton
      label={
        wide
          ? 'Liste und Seitenspalte wieder zeigen'
          : 'Breit schreiben: Liste und Seitenspalte ausblenden'
      }
      variant="ghost"
      onClick={() => setWideText(!wide)}
    >
      {wide ? <Minimize2 /> : <Maximize2 />}
    </IconButton>
  );
}
