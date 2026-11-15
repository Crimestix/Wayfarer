/**
 * „Zwei Spielstände – welcher gilt?“ (Entwurf 1.9). Wayfarer mischt nie von selbst; jede Wahl
 * legt alles Abweichende vorher beiseite – das wird nie von selbst gelöscht.
 */
import { useMemo } from 'react';
import { useData } from '../../data/hooks';
import { Button, Dialog } from '../../ui';
import { summarize } from '../einstellungen/backup';
import { SummaryLine } from '../einstellungen/ReplaceDialog';
import { ProgressLine } from './KeyParts';
import { SAME_STAND, entries, firstSyncText } from './model';
import type { FirstSyncInfo, SyncView } from './state';
import './abgleich.css';

export type FirstChoice = 'localWins' | 'remoteWins';

export function FirstSyncDialog({
  open,
  info,
  older,
  otherSide,
  busy,
  progress,
  error,
  onChoose,
  onClose,
}: {
  open: boolean;
  info: FirstSyncInfo | null;
  /** Dieses Programm ist älter: nur „Der Stand aus der Ablage gilt“. */
  older: boolean;
  otherSide: { device: string | null; pushedAt: string | null };
  busy: boolean;
  progress: SyncView['progress'];
  error: string;
  onChoose: (choice: FirstChoice) => void;
  onClose: () => void;
}) {
  const data = useData();
  const here = useMemo(() => summarize(data), [data]);
  const text = info ? firstSyncText(info, data, otherSide, older) : null;
  const remoteCount = info ? info.same + info.onlyRemote.length + info.different.length : 0;

  return (
    <Dialog
      open={open && !!text}
      onClose={onClose}
      title={text?.same ? 'Derselbe Stand' : (text?.title ?? '')}
      width={760}
      guard={false}
      footer={
        text?.same ? (
          <Button variant="primary" disabled={busy} onClick={() => onChoose('localWins')}>
            Fertig
          </Button>
        ) : (
          <>
            <span className="wf-mute wf-grow">Nichts wird geändert; der Abgleich wartet.</span>
            <Button onClick={onClose} disabled={busy}>
              Abbrechen
            </Button>
          </>
        )
      }
    >
      {text && info && (
        <div className="wf-abgleich-first">
          {text.same ? (
            <p className="wf-soft">{SAME_STAND}</p>
          ) : (
            <>
              <p className="wf-soft">{text.lead}</p>
              <div className="wf-einstellungen-replace__pair">
                <div>
                  <div className="wf-caps">Dieser Rechner</div>
                  <SummaryLine summary={here} />
                </div>
                <div>
                  <div className="wf-caps">In der Ablage</div>
                  <div className="wf-einstellungen-summary">
                    <div className="wf-einstellungen-summary__parts">{entries(remoteCount)}</div>
                  </div>
                </div>
              </div>
              <div className="wf-abgleich-first__counts">{text.counts}</div>
              {text.groups.length > 0 && (
                <details className="wf-abgleich-first__list">
                  <summary>Welche Einträge?</summary>
                  {text.groups.map((group) => (
                    <div key={group.label} className="wf-abgleich-first__group">
                      <div className="wf-caps">{group.label}</div>
                      <ul>
                        {group.items.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                        {group.more > 0 && <li className="wf-mute">und {group.more} weitere</li>}
                      </ul>
                    </div>
                  ))}
                </details>
              )}
              <div className="wf-abgleich-first__choices">
                <button
                  type="button"
                  className="wf-einstellungen-choice"
                  disabled={busy || text.onlyRemote}
                  onClick={() => onChoose('localWins')}
                >
                  <span className="wf-einstellungen-choice__title">{text.local.title}</span>
                  <span className="wf-mute">
                    {text.onlyRemote
                      ? 'Geht erst, wenn Wayfarer hier aktualisiert ist – diese Version kennt nicht alles, was in der Ablage steht.'
                      : text.local.text}
                  </span>
                </button>
                <button
                  type="button"
                  className="wf-einstellungen-choice"
                  disabled={busy}
                  onClick={() => onChoose('remoteWins')}
                >
                  <span className="wf-einstellungen-choice__title">{text.remote.title}</span>
                  <span className="wf-mute">{text.remote.text}</span>
                </button>
              </div>
              <p className="wf-mute">
                Beiseitegelegtes aus dieser Wahl löscht Wayfarer nie von selbst und lässt sich mit
                einem Klick ganz zurückholen.
              </p>
            </>
          )}
          {busy && <ProgressLine progress={progress} />}
          {error && (
            <p className="wf-abgleich-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
