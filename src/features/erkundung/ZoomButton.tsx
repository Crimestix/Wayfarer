/**
 * „Hineinzoomen“ an einem Feld: Gibt es seine feinere Karte schon, öffnet der Knopf sie – sonst
 * entsteht sie (`zoomArea`) und öffnet sich. Auf der feineren Karte führt `ZoomBack` zurück.
 */
import { ZoomIn, ZoomOut } from 'lucide-react';
import { useLocation } from 'wouter';
import { useData, useDb } from '../../data/hooks';
import type { Area, Hex } from '../../domain/schema';
import { Button, toast } from '../../ui';
import { scaleWords, zoomArea, zoomFactor, zoomOf } from './freeMap';

export function ZoomButton({ area, hex }: { area: Area; hex: Hex }) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const there = zoomOf(data.areas, area.id, hex);
  const finer = scaleWords(area.hexKm / zoomFactor(area.hexKm));
  return (
    <Button
      size="sm"
      icon={<ZoomIn />}
      title={
        there
          ? `Die feinere Karte dieses Feldes öffnen (${scaleWords(there.hexKm)})`
          : `Dieses Feld als eigene, feinere Karte (${finer}) – Gelände und Landschaften kommen von hier`
      }
      onClick={() => {
        if (there) {
          navigate(`/erkundung/${there.id}`);
          return;
        }
        const child = zoomArea(area, hex);
        if (!child) return;
        const made = db.put('areas', child);
        navigate(`/erkundung/${made.id}`);
        toast({
          slot: 'hexkarte',
          title: 'Feinere Karte angelegt',
          body: `${made.hexes.length} Felder · ${scaleWords(made.hexKm)}`,
          action: { label: 'Rückgängig', run: () => db.remove('areas', made.id) },
        });
      }}
    >
      {there ? 'Feinere Karte öffnen' : 'Hineinzoomen'}
    </Button>
  );
}

/** Auf einer hineingezoomten Karte: zurück zur gröberen. */
export function ZoomBack({ area }: { area: Area }) {
  const data = useData();
  const [, navigate] = useLocation();
  const parent = area.parent ? data.areas[area.parent.areaId] : undefined;
  if (!parent) return null;
  return (
    <button
      type="button"
      className="wf-erk-zoomback"
      title={`Zurück zur gröberen Karte (${scaleWords(parent.hexKm)})`}
      onClick={() => navigate(`/erkundung/${parent.id}`)}
    >
      <ZoomOut aria-hidden /> Teil von {parent.name}
    </button>
  );
}
