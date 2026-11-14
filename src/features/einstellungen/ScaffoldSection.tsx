/**
 * Abschnitt „Steckbrief-Gerüste“: je Art die Felder, die ein neuer Artikel leer bekommt. Eigene
 * Felder sind erlaubt – Wayfarer liest sie dann nur nicht aus. Geschrieben wird beim Verlassen.
 */
import { RotateCcw } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { KIND_LABEL } from '../../domain/derive';
import { IconButton, KindIcon, Written } from '../../ui';
import { setFactScaffold } from '../wiki/actions';
import {
  SCAFFOLD_KINDS,
  isOwnScaffold,
  readScaffoldInput,
  readsAs,
  scaffoldOf,
} from '../wiki/scaffold';

export function ScaffoldSection() {
  const db = useDb();
  const campaign = useData().campaign;
  return (
    <div className="wf-einstellungen-scaffold">
      <p className="wf-mute">
        Felder durch Komma getrennt. Ein leeres Feld lässt die Art ohne Gerüst. Felder, die Wayfarer
        nicht kennt, stehen trotzdem im Steckbrief – sie werden nur nicht in die Welt übernommen.
      </p>
      <div className="wf-einstellungen-scaffold__rows">
        {SCAFFOLD_KINDS.map((kind) => {
          const labels = scaffoldOf(campaign, kind);
          const unread = labels.filter((label) => readsAs(kind, label) === null);
          const own = isOwnScaffold(campaign, kind);
          return (
            <div key={kind} className="wf-einstellungen-scaffold__row">
              <span className="wf-einstellungen-scaffold__kind">
                <KindIcon kind={kind} />
                {KIND_LABEL[kind]}
              </span>
              <div className="wf-einstellungen-scaffold__fields">
                <Written
                  value={labels.join(', ')}
                  label={`Steckbrief-Gerüst: ${KIND_LABEL[kind]}`}
                  placeholder="kein Gerüst"
                  onSave={(text) => setFactScaffold(db, kind, readScaffoldInput(text))}
                />
                {unread.length > 0 && (
                  <span className="wf-einstellungen-scaffold__note">
                    Nur für dich, nicht ausgewertet: {unread.join(', ')}
                  </span>
                )}
              </div>
              {own ? (
                <IconButton
                  label="Vorgabe wiederherstellen"
                  size="sm"
                  variant="ghost"
                  onClick={() => setFactScaffold(db, kind, null)}
                >
                  <RotateCcw />
                </IconButton>
              ) : (
                <span className="wf-einstellungen-scaffold__spacer" aria-hidden />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
