/**
 * Regeln des Tisches: die Hausregeln und Absprachen der Runde, geschrieben vom Spielleiter.
 * Am Spieltisch ein leiser Knopf, der das Blatt zum Lesen und Ändern öffnet; in den Einstellungen
 * dasselbe Blatt. Die Suche findet Zeilen daraus (`domain/tableRules.ts`).
 */
import { Suspense, lazy, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { useData } from '../../data/hooks';
import { TABLE_RULES_TITLE, hasTableRules } from '../../domain/tableRules';
import { useFocus } from '../../shell/focus';
import { Dialog, IconButton } from '../../ui';
import './tisch.css';

// Der Editor ist groß und wird erst geladen, wenn das Blatt offen ist.
const RulesEditor = lazy(() => import('./RulesEditor'));

const PLACEHOLDER = 'Schreib auf, was ihr am Tisch vereinbart habt.';

/** Das Blatt zum Lesen und Schreiben – mit einem Hinweis, solange es leer ist. */
export function TableRulesSheet({ autoFocus = false }: { autoFocus?: boolean }) {
  const data = useData();
  const empty = !hasTableRules(data.campaign.tableRules);
  return (
    <div className="wf-tisch-rules">
      {empty && (
        <p className="wf-tisch-rules__hint">
          Hierher gehören die Hausregeln und Absprachen eurer Runde: Regeln, die ihr anders spielt
          als im Buch, Grenzen und Themen, die nicht an den Tisch kommen, wie offen gewürfelt wird
          und was sonst für alle gilt. Mit [[ oder @ verweist du auf einen Artikel.
        </p>
      )}
      <Suspense fallback={<p className="wf-tisch-rules__hint">Der Editor wird geladen …</p>}>
        <RulesEditor placeholder={PLACEHOLDER} autoFocus={autoFocus} />
      </Suspense>
    </div>
  );
}

/** Der leise Knopf am Spieltisch – und das Blatt, das er öffnet (auch aus der Suche). */
export function TableRulesButton() {
  const [open, setOpen] = useState(false);
  useFocus(['rules'], () => setOpen(true));
  return (
    <>
      <IconButton
        size="sm"
        variant="ghost"
        label={`${TABLE_RULES_TITLE} – Hausregeln und Absprachen der Runde`}
        onClick={() => setOpen(true)}
      >
        <ScrollText />
      </IconButton>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={TABLE_RULES_TITLE}
        width={720}
        guard={false}
      >
        {open && <TableRulesSheet autoFocus />}
      </Dialog>
    </>
  );
}
