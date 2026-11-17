/**
 * Das Seitenblatt: die Seite eines Eintrags rechts neben der Seite, auf der man arbeitet
 * (`ui/sideSheet.ts`). Oben „Zurück“, wenn Seiten aufeinanderliegen, „Ganze Seite“ und
 * Schließen; darunter dieselbe Seite wie in der Welt (`Dossier`) – man kann dort auch schreiben.
 * Escape schließt, ein Wechsel in die Welt schließt es auch (dort ist die Seite die ganze Seite).
 */
import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, Maximize2, X } from 'lucide-react';
import { useData } from '../../data/hooks';
import {
  IconButton,
  KindIcon,
  closeSheet,
  entityHref,
  sheetBack,
  sheetOpensAt,
  useSheetStack,
} from '../../ui';
import { Dossier } from './Dossier';
import { EntityDialogHost } from './EntityDialog';
import { isWorldKind, type WorldEntity } from './model';

export function SideSheet() {
  const stack = useSheetStack();
  const data = useData();
  const [location, navigate] = useLocation();
  const id = stack[stack.length - 1];
  const entity = id ? data.entities[id] : undefined;
  const open = !!entity && isWorldKind(entity.kind) && sheetOpensAt(location);

  // In der Welt ist die Seite die ganze Seite – dort braucht es kein Blatt daneben.
  useEffect(() => {
    if (stack.length && !sheetOpensAt(location)) closeSheet();
  }, [location, stack.length]);
  // Gibt es den Eintrag nicht mehr (gelöscht), fällt er vom Stapel.
  useEffect(() => {
    if (id && !data.entities[id]) sheetBack();
  }, [id, data.entities]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      // Ein offenes Fenster (Dialog) oder ein Feld fängt Escape selbst.
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"], .cm-editor')) return;
      closeSheet();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open || !entity) return null;
  const below = stack.length > 1 ? data.entities[stack[stack.length - 2]!] : undefined;
  return (
    <aside className="wf-sidesheet" aria-label={`Seite: ${entity.name}`}>
      <header className="wf-sidesheet__head">
        {below ? (
          <button type="button" className="wf-sidesheet__back" onClick={sheetBack}>
            <ArrowLeft /> {below.name}
          </button>
        ) : (
          <span className="wf-sidesheet__kind">
            <KindIcon kind={entity.kind} /> Nachsehen, ohne die Seite zu verlassen
          </span>
        )}
        <span className="wf-sidesheet__tools">
          <IconButton
            label="Ganze Seite öffnen"
            onClick={() => {
              closeSheet();
              navigate(entityHref(entity));
            }}
          >
            <Maximize2 />
          </IconButton>
          <IconButton label="Schließen (Escape)" onClick={closeSheet}>
            <X />
          </IconButton>
        </span>
      </header>
      <div className="wf-sidesheet__body">
        <Dossier key={entity.id} entity={entity as WorldEntity} inSheet />
      </div>
      <EntityDialogHost />
    </aside>
  );
}
