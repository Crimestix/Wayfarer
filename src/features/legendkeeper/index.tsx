/**
 * LegendKeeper in Wayfarer: Artikel nachschlagen und mit Einträgen verknüpfen (nur lesen).
 * Diese beiden Bausteine sind die Schnittstelle zum Rest der App.
 */
import { BookOpen } from 'lucide-react';
import type { LkLink } from '../../domain/schema';
import { EmptyState } from '../../ui';

/** Zeigt den verknüpften LegendKeeper-Artikel eines Eintrags und erlaubt, die Verknüpfung zu ändern. */
export function LkArticlePanel(_props: { link: LkLink | null; onLink: (link: LkLink | null) => void }) {
  return (
    <EmptyState icon={<BookOpen />} title="LegendKeeper">
      Die Anbindung wird gerade gebaut.
    </EmptyState>
  );
}

/** Abschnitt der Einstellungen: Verbindung zu LegendKeeper einrichten und prüfen. */
export function LegendKeeperSettings() {
  return (
    <EmptyState icon={<BookOpen />} title="LegendKeeper">
      Die Anbindung wird gerade gebaut.
    </EmptyState>
  );
}
