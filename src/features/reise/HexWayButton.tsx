/**
 * „Gelände dazwischen“: öffnet die Hexkarte eines Weges – erzeugt sie beim ersten Mal
 * (`hexMapForWay`). Steht im Wegenetz, im Fenster eines Weges und bei der Reise.
 */
import { useLocation } from 'wouter';
import { Hexagon } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import type { TravelPath } from '../../domain/schema';
import { Button, toast } from '../../ui';
import { hexMapForWay } from './hexway';

export function HexWayButton({ path, onOpened }: { path: TravelPath; onOpened?: () => void }) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const has = !!path.areaId && !!data.areas[path.areaId];
  return (
    <Button
      size="sm"
      icon={<Hexagon />}
      title={
        has
          ? 'Die Hexkarte dieses Weges öffnen'
          : 'Eine Hexkarte für diesen Weg erzeugen – einmal, danach bleibt sie gleich. Unterwegs geht es dann Feld für Feld.'
      }
      onClick={() => {
        const area = hexMapForWay(db, path.id);
        if (!area) {
          toast({
            title: 'Länge unbekannt',
            body: 'Trag am Weg eine Dauer ein oder gib den Orten eine Lage – dann lässt sich das Gelände erzeugen.',
          });
          return;
        }
        if (!has)
          toast({ title: 'Gelände dazwischen erzeugt', body: `${area.hexes.length} Felder` });
        onOpened?.();
        navigate(`/erkundung/${area.id}`);
      }}
    >
      {has ? 'Gelände dazwischen' : 'Gelände dazwischen erzeugen'}
    </Button>
  );
}
