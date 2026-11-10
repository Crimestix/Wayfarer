/** Abschnitt „Alten Spielstand übernehmen“: Backup der alten Version wählen, Bericht ansehen, einspielen. */
import { useState, type ReactNode } from 'react';
import { Check, CircleSlash, Copy, Info, ScrollText, TriangleAlert } from 'lucide-react';
import { useDb } from '../../data/hooks';
import {
  lastImport,
  previewV157Backup,
  rememberImport,
  type ImportResult,
  type ImportSections,
} from '../import/v157';
import { Button, Dialog, toast } from '../../ui';
import { formatRealTime, summarize } from './backup';
import { errorText, readJsonFile } from './files';
import { ActionRow, Notice, useFilePicker } from './parts';
import { ReplaceDialog } from './ReplaceDialog';

interface Picked {
  result: ImportResult;
  fileName: string;
}

/** Die Gruppe trägt die Überschrift schon; der Satz beginnt danach wieder groß. */
function withoutPrefix(line: string): string {
  const rest = line.replace(/^(Nicht übernommen|Übersprungen, weil unlesbar): /, '');
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

function ReportGroup({
  tone,
  icon,
  title,
  lines,
}: {
  tone: 'ok' | 'info' | 'warn' | 'danger';
  icon: ReactNode;
  title: string;
  lines: string[];
}) {
  if (!lines.length) return null;
  return (
    <section className={`wf-einstellungen-report__group wf-einstellungen-report__group--${tone}`}>
      <h3 className="wf-einstellungen-report__title">
        {icon}
        {title}
        <span className="wf-einstellungen-report__count">{lines.length}</span>
      </h3>
      <ul className="wf-einstellungen-report__list">
        {lines.map((line, i) => (
          <li key={i}>{withoutPrefix(line)}</li>
        ))}
      </ul>
    </section>
  );
}

export function ImportReport({ sections }: { sections: ImportSections }) {
  return (
    <div className="wf-einstellungen-report">
      <ReportGroup tone="ok" icon={<Check />} title="Übernommen" lines={sections.adopted} />
      <ReportGroup tone="info" icon={<Info />} title="Dabei angepasst" lines={sections.hints} />
      <ReportGroup
        tone="warn"
        icon={<CircleSlash />}
        title="Nicht übernommen"
        lines={sections.omitted}
      />
      <ReportGroup
        tone="danger"
        icon={<TriangleAlert />}
        title="Übersprungen, weil unlesbar"
        lines={sections.skipped}
      />
    </div>
  );
}

function reportText(sections: ImportSections): string {
  const block = (title: string, lines: string[]) =>
    lines.length ? `${title}\n${lines.map((l) => `– ${l}`).join('\n')}` : '';
  return [
    block('Übernommen', sections.adopted),
    block('Dabei angepasst', sections.hints),
    block('Nicht übernommen', sections.omitted),
    block('Übersprungen', sections.skipped),
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function copyReport(sections: ImportSections) {
  try {
    await navigator.clipboard.writeText(reportText(sections));
    toast({ title: 'Bericht in die Zwischenablage kopiert' });
  } catch {
    toast({ title: 'Der Bericht ließ sich nicht kopieren', tone: 'danger' });
  }
}

export function LegacySection() {
  const db = useDb();
  const [pending, setPending] = useState<Picked | null>(null);
  const [shown, setShown] = useState<Picked | null>(null);
  // Auch eine Übernahme vom Startbildschirm aus ist hier nachzulesen.
  const [last, setLast] = useState(lastImport);
  const [viewing, setViewing] = useState(false);

  const picker = useFilePicker(async (file) => {
    try {
      const next = { result: previewV157Backup(await readJsonFile(file)), fileName: file.name };
      setShown(next);
      setPending(next);
    } catch (e) {
      toast({
        title: 'Diese Datei lässt sich nicht übernehmen',
        body: errorText(e),
        tone: 'danger',
        duration: 12000,
      });
    }
  });

  const apply = () => {
    if (!pending) return;
    db.replaceAll(pending.result.data);
    rememberImport(pending.result, pending.fileName);
    setLast(lastImport());
    setPending(null);
    toast({ title: 'Alter Spielstand übernommen', body: `aus ${pending.fileName}` });
  };

  return (
    <div className="wf-einstellungen-stack">
      <div className="wf-einstellungen-actions">
        <ActionRow
          icon={<ScrollText />}
          title="Backup der alten Version einlesen"
          action={
            <Button icon={<ScrollText />} onClick={picker.open}>
              Backup-Datei wählen …
            </Button>
          }
        >
          Die Datei heißt „elaris-backup-….json“ und entsteht im alten Wayfarer über das Menü mit
          „Backup herunterladen“. Erst nach deiner Bestätigung wird etwas ersetzt.
        </ActionRow>
      </div>
      {picker.input}

      {last && (
        <Notice
          icon={<Check />}
          title={last.fileName ? `Übernommen aus ${last.fileName}` : 'Alter Spielstand übernommen'}
          action={<Button onClick={() => setViewing(true)}>Bericht ansehen</Button>}
        >
          {formatRealTime(last.at)}. Der Bericht bleibt hier einsehbar, bis du Wayfarer schließt.
        </Notice>
      )}

      <ReplaceDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Alten Spielstand übernehmen"
        incomingLabel={shown ? shown.fileName : 'Backup der alten Version'}
        incoming={shown ? summarize(shown.result.data) : null}
        confirmLabel="Übernehmen und Stand ersetzen"
        onConfirm={apply}
        width={860}
      >
        {shown && <ImportReport sections={shown.result.sections} />}
      </ReplaceDialog>

      <Dialog
        open={viewing && last !== null}
        onClose={() => setViewing(false)}
        title="Bericht der Übernahme"
        width={860}
        footer={
          <>
            <Button icon={<Copy />} onClick={() => last && copyReport(last.sections)}>
              Bericht kopieren
            </Button>
            <Button variant="primary" onClick={() => setViewing(false)} data-autofocus>
              Schließen
            </Button>
          </>
        }
      >
        {last && <ImportReport sections={last.sections} />}
      </Dialog>
    </div>
  );
}
