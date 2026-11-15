/**
 * Das Zeichen unter „Gespeichert“ (Entwurf 1.4), die ruhige Zeile unter der Weltleiste und die
 * Tafel beim Schließen. Am Tisch öffnet sich nie etwas von selbst – nur das Zeichen ändert sich.
 */
import { useLocation } from 'wouter';
import { closeNow } from '../../data/platform';
import { Button } from '../../ui';
import { activeSync, useSync } from './index';
import { incomingText, signOf } from './model';
import { openDecide, showSyncSettings, useSurface } from './open';
import './abgleich.css';

export function SyncSign() {
  const view = useSync();
  const surface = useSurface();
  const [, navigate] = useLocation();
  const sign = signOf(view, new Date());
  if (!sign) return null;
  const looking = surface.decide === 'looking';
  const idle = sign.click === 'none' || looking;
  const click = () => {
    if (idle) return;
    if (sign.click === 'sync') void activeSync()?.engine.syncNow();
    else if (sign.click === 'decide') void openDecide();
    else showSyncSettings(navigate);
  };
  return (
    <button
      type="button"
      className="wf-abgleich-sign"
      data-dot={looking ? 'run' : sign.dot}
      title={sign.title}
      aria-disabled={idle || undefined}
      onClick={click}
    >
      <i aria-hidden="true" />
      <span className="wf-abgleich-sign__text">
        {looking ? 'Wayfarer sieht nach …' : sign.label}
        {sign.note && <span className="wf-abgleich-sign__note">{sign.note}</span>}
      </span>
    </button>
  );
}

/** „Vom MacBook kommt Neues (14 Einträge) – gleich da.“ – kein Knopf, verschwindet von selbst. */
export function IncomingLine() {
  const text = incomingText(useSync());
  if (!text) return null;
  return (
    <div className="wf-abgleich-incoming" role="status" aria-live="polite">
      {text}
    </div>
  );
}

/** Beim Schließen, solange hochgeladen wird (höchstens 12 Sekunden). */
export function ClosingPanel() {
  const { closing } = useSync();
  if (!closing) return null;
  return (
    <div className="wf-abgleich-closing" role="alertdialog" aria-live="assertive">
      <div className="wf-abgleich-closing__card">
        <p>
          <strong>Wayfarer gleicht noch ab</strong> und schließt dann von selbst.
        </p>
        <Button onClick={() => void closeNow()}>Sofort schließen</Button>
      </div>
    </div>
  );
}
