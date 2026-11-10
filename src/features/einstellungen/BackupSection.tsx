/** Abschnitt „Sicherung“: gesamte Kampagne als eine Datei sichern und wieder einspielen. */
import { useMemo, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { isDesktopApp } from '../../data/platform';
import { Button, toast } from '../../ui';
import {
  backupFileName,
  formatRealTime,
  readBackup,
  serializeBackup,
  summarize,
  type RestoreResult,
} from './backup';
import { errorText, readJsonFile, saveBackupFile } from './files';
import { ActionRow, Notice, useFilePicker } from './parts';
import { ReplaceDialog } from './ReplaceDialog';

const MAX_LISTED = 6;

export function BackupSection() {
  const db = useDb();
  const data = useData();
  const desktop = isDesktopApp();
  const summary = useMemo(() => summarize(data), [data]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ result: RestoreResult; fileName: string } | null>(null);
  // Bleibt beim Schließen stehen, damit der Dialog nicht leer ausblendet.
  const [shown, setShown] = useState<{ result: RestoreResult; fileName: string } | null>(null);

  const save = async () => {
    setBusy(true);
    try {
      const where = await saveBackupFile(
        backupFileName(data.campaign.name),
        serializeBackup(db.getSnapshot()),
        db.store.location,
      );
      if (where) toast({ title: 'Sicherung gespeichert', body: where });
    } catch (e) {
      toast({ title: 'Die Sicherung wurde nicht gespeichert', body: errorText(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const picker = useFilePicker(async (file) => {
    try {
      const next = { result: readBackup(await readJsonFile(file)), fileName: file.name };
      setShown(next);
      setPending(next);
    } catch (e) {
      toast({
        title: 'Diese Datei lässt sich nicht einspielen',
        body: errorText(e),
        tone: 'danger',
        duration: 12000,
      });
    }
  });

  const apply = () => {
    if (!pending) return;
    db.replaceAll(pending.result.data);
    setPending(null);
    toast({
      title: 'Sicherung eingespielt',
      body: `„${pending.result.data.campaign.name}“ aus ${pending.fileName}`,
    });
  };

  const result = shown?.result;
  const savedAt = result ? formatRealTime(result.exportedAt) : '';

  return (
    <div className="wf-einstellungen-stack">
      <div className="wf-einstellungen-contents">
        <span className="wf-caps">In dieser Kampagne</span>
        <span>
          {summary.parts.length
            ? summary.parts.join(' · ')
            : 'Noch keine Einträge – lege in der Welt etwas an oder hole weiter unten den alten Spielstand herüber.'}
        </span>
      </div>
      <div className="wf-einstellungen-actions">
        <ActionRow
          icon={<Download />}
          title={desktop ? 'Sicherung speichern' : 'Sicherung herunterladen'}
          action={
            <Button variant="primary" icon={<Download />} onClick={save} disabled={busy}>
              {desktop ? 'Sicherung speichern …' : 'Sicherung herunterladen'}
            </Button>
          }
        >
          Schreibt die gesamte Kampagne in eine einzige Datei – Welt, Chronik, Kalender, Gefährten,
          Bilder.
          {desktop && ' Du wählst den Ordner; am besten einen außerhalb des Kampagnenordners.'}
        </ActionRow>
        <ActionRow
          icon={<Upload />}
          title="Sicherung einspielen"
          action={
            <Button icon={<Upload />} onClick={picker.open}>
              Datei wählen …
            </Button>
          }
        >
          Ersetzt den jetzigen Stand durch den einer Sicherungsdatei. Vorher siehst du, was darin
          steckt, und wirst gefragt.
        </ActionRow>
      </div>
      {picker.input}

      <ReplaceDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Sicherung einspielen"
        incomingLabel={savedAt ? `Sicherung vom ${savedAt}` : 'Sicherung'}
        incoming={result ? summarize(result.data) : null}
        confirmLabel="Stand ersetzen"
        onConfirm={apply}
      >
        {result && result.skipped.length > 0 && (
          <Notice
            tone="warn"
            title={`${result.skipped.length === 1 ? 'Ein Teil' : `${result.skipped.length} Teile`} der Sicherung ${result.skipped.length === 1 ? 'ist' : 'sind'} unlesbar und ${result.skipped.length === 1 ? 'wird' : 'werden'} ausgelassen`}
          >
            <ul className="wf-einstellungen-list">
              {result.skipped.slice(0, MAX_LISTED).map((s, i) => (
                <li key={i}>
                  {s.label} – {s.reason}
                </li>
              ))}
              {result.skipped.length > MAX_LISTED && (
                <li>… und {result.skipped.length - MAX_LISTED} weitere.</li>
              )}
            </ul>
          </Notice>
        )}
        {result && result.repaired > 0 && (
          <p className="wf-mute wf-italic">
            {result.repaired === 1
              ? 'Ein Verweis zeigte auf etwas, das in der Sicherung fehlt, und wird entfernt.'
              : `${result.repaired} Verweise zeigten auf etwas, das in der Sicherung fehlt, und werden entfernt.`}
          </p>
        )}
      </ReplaceDialog>
    </div>
  );
}
