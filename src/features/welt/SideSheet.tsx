/**
 * Das Seitenblatt: die Seite eines Eintrags rechts neben der Seite, auf der man arbeitet
 * (`ui/sideSheet.ts`). Oben „Zurück“, wenn Seiten aufeinanderliegen, „Ganze Seite“ und
 * Schließen. Zuerst steht dort nur das Nötigste zum Nachschlagen (F07: Kurzblick und der Anfang des
 * Textes); „Alles hier zeigen“ öffnet dieselbe Seite wie in der Welt (`Dossier`), auch zum Schreiben.
 * Escape schließt, ein Wechsel in die Welt schließt es auch (dort ist die Seite die ganze Seite).
 */
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, Maximize2, PanelRightOpen, X } from 'lucide-react';
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
import { articleOf } from '../tisch/wiki';
import { PeekCard } from '../tisch/PeekCard';
import { Dossier } from './Dossier';
import { leadOf } from './lookup';
import { EntityDialogHost } from './EntityDialog';
import { isWorldKind, type WorldEntity } from './model';

export function SideSheet() {
  const stack = useSheetStack();
  const data = useData();
  const [location, navigate] = useLocation();
  const id = stack[stack.length - 1];
  const entity = id ? data.entities[id] : undefined;
  const open = !!entity && isWorldKind(entity.kind) && sheetOpensAt(location);
  // Die volle Seite nur auf Wunsch – je Eintrag neu (F07).
  const [fullId, setFullId] = useState<string | null>(null);
  const full = !!id && fullId === id;
  const lead = useMemo(() => {
    if (!entity) return '';
    const article = articleOf(data, entity);
    return leadOf(article?.docs[0]?.text ?? '');
  }, [data, entity]);

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
    <aside
      className="wf-sidesheet"
      data-compact={full ? undefined : ''}
      aria-label={`Seite: ${entity.name}`}
    >
      <header className="wf-sidesheet__head">
        {below ? (
          <button type="button" className="wf-sidesheet__back" onClick={sheetBack}>
            <ArrowLeft /> {below.name}
          </button>
        ) : (
          <span className="wf-sidesheet__kind">
            <KindIcon kind={entity.kind} />{' '}
            {full ? 'Nachsehen, ohne die Seite zu verlassen' : 'Nachschlagen'}
          </span>
        )}
        <span className="wf-sidesheet__tools">
          {!full && (
            <IconButton label="Alles hier zeigen" onClick={() => setFullId(entity.id)}>
              <PanelRightOpen />
            </IconButton>
          )}
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
        {full ? (
          <Dossier key={entity.id} entity={entity as WorldEntity} inSheet />
        ) : (
          <div className="wf-sidesheet__lookup">
            <PeekCard id={entity.id} />
            {lead ? (
              <p className="wf-sidesheet__lead">{lead}</p>
            ) : (
              !entity.tagline && (
                <p className="wf-sidesheet__lead" data-empty="">
                  Hierzu steht noch nichts geschrieben.
                </p>
              )
            )}
            <div className="wf-sidesheet__more">
              <button type="button" onClick={() => setFullId(entity.id)}>
                Alles hier zeigen
              </button>
              <span aria-hidden>·</span>
              <button
                type="button"
                onClick={() => {
                  closeSheet();
                  navigate(entityHref(entity));
                }}
              >
                Ganze Seite öffnen
              </button>
            </div>
          </div>
        )}
      </div>
      <EntityDialogHost />
    </aside>
  );
}
