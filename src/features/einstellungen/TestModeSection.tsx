/**
 * Abschnitt „Testmodus“: ein Schalter. An – Wayfarer legt den ganzen Spielstand beiseite, und
 * man kann machen, was man will. Aus – alles seit dem Einschalten ist weg, der Stand ist wie
 * vorher. Der Abgleich ruht solange. (Wunsch des Spielleiters, 18. 11. 2026.)
 */
import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { useDb } from '../../data/hooks';
import { endTestMode, startTestMode, useTestMode } from '../../data/testMode';
import { Button, Dialog, toast } from '../../ui';
import { flushEdits } from '../wiki/editing';
import { formatRealTime } from './backup';
import { errorText } from './files';
import { ActionRow, Notice } from './parts';

export function TestModeSection() {
  const db = useDb();
  const testing = useTestMode();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  const run = async (work: () => Promise<void>, done: { title: string; body: string }) => {
    setBusy(true);
    try {
      // Ein offener Editor schreibt zuerst – sein Text gehört zum Stand davor oder danach.
      flushEdits();
      await work();
      toast(done);
    } catch (e) {
      toast({
        title: 'Das hat nicht geklappt',
        body: errorText(e),
        tone: 'danger',
        duration: 12000,
      });
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(() => startTestMode(db), {
      title: 'Testmodus an',
      body: 'Probier aus, was du willst. Beim Ausschalten ist alles wieder wie jetzt.',
    });
  const end = (keep: boolean) => {
    setAsking(false);
    return run(
      () => endTestMode(db, keep),
      keep
        ? { title: 'Testmodus aus', body: 'Was du im Testmodus getan hast, bleibt.' }
        : { title: 'Testmodus aus', body: 'Dein Spielstand ist wieder wie vor dem Testmodus.' },
    );
  };
  const since = testing ? formatRealTime(testing.startedAt) : '';

  return (
    <div className="wf-einstellungen-stack">
      {testing && (
        <Notice tone="info" icon={<FlaskConical />} title="Der Testmodus läuft">
          {since ? `Eingeschaltet am ${since}. ` : ''}
          Alles, was du seitdem angelegt, geändert oder gelöscht hast, verschwindet beim
          Ausschalten. Der Abgleich mit dem anderen Rechner ruht solange.
        </Notice>
      )}
      <div className="wf-einstellungen-actions">
        <ActionRow
          icon={<FlaskConical />}
          title="Testmodus"
          action={
            <div className="wf-btn-group" role="group" aria-label="Testmodus">
              <Button
                aria-pressed={!testing}
                disabled={busy}
                onClick={() => testing && setAsking(true)}
              >
                Aus
              </Button>
              <Button
                aria-pressed={!!testing}
                disabled={busy}
                onClick={() => !testing && void start()}
              >
                An
              </Button>
            </div>
          }
        >
          Zum Ausprobieren in deiner echten Welt, mit allen Artikeln. Schaltest du den Testmodus
          wieder aus, ist alles genau wie vorher – egal, was du dazwischen getan hast. Der Abgleich
          ruht solange.
        </ActionRow>
      </div>
      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        title="Testmodus ausschalten"
        width={520}
        guard={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => void end(true)} disabled={busy}>
              Stattdessen alles behalten
            </Button>
            <span className="wf-grow" />
            <Button onClick={() => setAsking(false)}>Abbrechen</Button>
            <Button variant="primary" onClick={() => void end(false)} disabled={busy}>
              Alles verwerfen
            </Button>
          </>
        }
      >
        <div className="wf-col" style={{ gap: 'var(--s-3)' }}>
          <p>
            Alles, was du seit dem Einschalten{since ? ` (${since})` : ''} angelegt, geändert oder
            gelöscht hast, wird verworfen. Dein Spielstand ist danach genau wie vorher. Das lässt
            sich nicht zurücknehmen.
          </p>
          <p className="wf-mute">
            Hast du im Testmodus versehentlich echt gespielt? Dann wähle „Stattdessen alles
            behalten“ – der Testmodus endet, und nichts geht verloren.
          </p>
        </div>
      </Dialog>
    </div>
  );
}
