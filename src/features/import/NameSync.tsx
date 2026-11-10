/**
 * Namen aus LegendKeeper – von selbst. Personen, die die alte Version nur als Verweis auf einen
 * LegendKeeper-Artikel kannte, kommen ohne Namen an. Sobald die Verbindung steht, trägt Wayfarer
 * die Namen ein, ohne dass jemand danach suchen oder etwas anklicken muss. Solange sie fehlt,
 * sagt ein Hinweis in der Welt, was zu tun ist.
 */
import { useEffect, useMemo } from 'react';
import { Link } from 'wouter';
import { UserRoundSearch } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { isDesktopApp } from '../../data/platform';
import { useCatalog, useConnection } from '../legendkeeper/state';
import { toast } from '../../ui';
import { adoptFamilies } from '../welt/actions';
import { namesFromCatalog, nameFixes, unnamedFromLk } from './lknames';

/** Läuft unsichtbar mit; rendert nichts. Fragt LegendKeeper nur, solange Namen fehlen. */
export function LkNameSync() {
  const data = useData();
  const waiting = useMemo(() => unnamedFromLk(data).length, [data]);
  return waiting > 0 ? <Syncing waiting={waiting} /> : null;
}

function Syncing({ waiting }: { waiting: number }) {
  const db = useDb();
  const connection = useConnection();
  const { catalog } = useCatalog(connection.phase === 'ready');
  useEffect(() => {
    if (!catalog) return;
    const fixes = nameFixes(db.getSnapshot(), namesFromCatalog(catalog.entries));
    if (!fixes.named) return;
    db.batch(() => {
      for (const entity of fixes.changed) db.put('entities', entity);
    });
    const adopted = adoptFamilies(
      db,
      fixes.changed.map((entity) => entity.id),
    );
    toast({
      title:
        fixes.named === 1
          ? 'Eine Person trägt jetzt ihren Namen'
          : `${fixes.named} Personen tragen jetzt ihren Namen`,
      body: [
        'Die Namen stammen aus LegendKeeper.',
        adopted?.text,
        fixes.notFound
          ? `Zu ${fixes.notFound === 1 ? 'einer weiteren' : `${fixes.notFound} weiteren`} gibt es dort keinen Artikel mehr.`
          : '',
      ]
        .filter(Boolean)
        .join(' '),
      action: adopted ? { label: 'Familien zurücknehmen', run: adopted.undo } : undefined,
    });
    // Neu prüfen, wenn das Verzeichnis neu geladen wurde oder weitere Namenlose dazukommen.
  }, [db, catalog, waiting]);
  return null;
}

/** Hinweis über der Übersicht der Welt, solange Personen auf ihren Namen warten. */
export function MissingNamesHint() {
  const data = useData();
  const waiting = useMemo(() => unnamedFromLk(data).length, [data]);
  return waiting > 0 ? <Hint waiting={waiting} /> : null;
}

function Hint({ waiting }: { waiting: number }) {
  const connection = useConnection();
  const { catalog, status } = useCatalog(connection.phase === 'ready');
  const who = waiting === 1 ? 'Eine Person wartet' : `${waiting} Personen warten`;
  const text =
    connection.phase === 'ready'
      ? catalog
        ? `Zu ${waiting === 1 ? 'einer Person' : `${waiting} Personen`} gibt es in LegendKeeper keinen Artikel mehr. Benenne sie von Hand oder lösche sie.`
        : status === 'failed'
          ? `${who} auf den Namen – das Artikelverzeichnis von LegendKeeper ließ sich nicht laden.`
          : `${who} auf den Namen – LegendKeeper wird gerade gelesen …`
      : !isDesktopApp()
        ? `${who} auf den Namen aus LegendKeeper. Das geht nur in der installierten App – die Vorschau im Browser erreicht LegendKeeper nicht.`
        : connection.phase === 'failed' && connection.hasKey
          ? `${who} auf den Namen – LegendKeeper ist gerade nicht erreichbar.`
          : `${who} auf den Namen aus LegendKeeper. Verbinde LegendKeeper, dann trägt Wayfarer sie von selbst ein.`;
  return (
    <Link href="/einstellungen" className="wf-welt-derive wf-welt-derive--names">
      <UserRoundSearch />
      <span>{text}</span>
    </Link>
  );
}
