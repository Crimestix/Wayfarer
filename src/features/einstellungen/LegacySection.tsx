/** Abschnitt „Alten Spielstand übernehmen“: Backup der alten Version wählen, Bericht ansehen, einspielen. */
import { useMemo, useState, type ReactNode } from 'react';
import {
  Check,
  CircleSlash,
  Copy,
  Info,
  ScrollText,
  TriangleAlert,
  UserRoundSearch,
} from 'lucide-react';
import { useLocation } from 'wouter';
import { useData, useDb } from '../../data/hooks';
import { namesFromCatalog, nameFixes, unnamedFromLk, withLkNames } from '../import/lknames';
import {
  lastImport,
  previewV157Backup,
  rememberImport,
  type ImportResult,
  type ImportSections,
} from '../import/v157';
import { useCatalog, useConnection } from '../legendkeeper/state';
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

/**
 * Personen, die die alte Version nur als Verweis auf LegendKeeper kannte, kommen ohne Namen an.
 * Steht die Verbindung, holt ein Klick die Namen aus dem Artikelverzeichnis.
 */
function MissingNames() {
  const db = useDb();
  const data = useData();
  const waiting = useMemo(() => unnamedFromLk(data), [data]);
  const connection = useConnection();
  const catalog = useCatalog(connection.phase === 'ready');
  const names = useMemo(
    () => (catalog.catalog ? namesFromCatalog(catalog.catalog.entries) : null),
    [catalog.catalog],
  );
  const fixes = useMemo(() => (names ? nameFixes(data, names) : null), [data, names]);
  const [, navigate] = useLocation();
  if (!waiting.length) return null;

  const count = waiting.length;
  const title =
    count === 1 ? 'Eine Person hat noch keinen Namen' : `${count} Personen haben noch keinen Namen`;
  const intro =
    'Die alte Version kannte sie nur als Verweis auf einen LegendKeeper-Artikel; der Name steht dort, nicht im Backup. ';

  const apply = () => {
    if (!fixes?.named) return;
    db.batch(() => {
      for (const entity of fixes.changed) db.put('entities', entity);
    });
    toast({
      title:
        fixes.named === 1
          ? 'Eine Person trägt jetzt ihren Namen'
          : `${fixes.named} Personen tragen jetzt ihren Namen`,
      body: fixes.notFound
        ? `Zu ${fixes.notFound === 1 ? 'einer weiteren' : `${fixes.notFound} weiteren`} gibt es in LegendKeeper keinen Artikel mehr.`
        : 'Die Namen stammen aus dem Artikelverzeichnis von LegendKeeper.',
    });
  };

  if (fixes && fixes.named > 0)
    return (
      <Notice
        icon={<UserRoundSearch />}
        title={title}
        action={
          <Button variant="primary" onClick={apply}>
            Namen aus LegendKeeper holen
          </Button>
        }
      >
        {intro}
        {fixes.notFound
          ? `Für ${fixes.named} von ihnen steht der Artikel im Verzeichnis; für ${fixes.notFound === 1 ? 'eine' : fixes.notFound} gibt es dort keinen mehr.`
          : 'Das Artikelverzeichnis ist geladen – ein Klick trägt die Namen ein.'}
      </Notice>
    );

  const loading =
    connection.phase === 'idle' ||
    connection.phase === 'checking' ||
    (connection.phase === 'ready' && !fixes && catalog.status !== 'failed');
  return (
    <Notice
      icon={<UserRoundSearch />}
      title={title}
      action={
        fixes ? (
          <Button onClick={() => navigate(`/welt/${waiting[0]!.id}`)}>
            {count === 1 ? 'In der Welt öffnen' : 'Erste in der Welt öffnen'}
          </Button>
        ) : undefined
      }
    >
      {intro}
      {fixes
        ? count === 1
          ? 'Im Artikelverzeichnis von LegendKeeper gibt es zu ihr keinen Artikel mehr. Du findest sie in der Welt unter dem Schlagwort „Name fehlt“ und kannst sie dort von Hand benennen oder löschen.'
          : 'Im Artikelverzeichnis von LegendKeeper gibt es zu ihnen keinen Artikel mehr. Du findest sie in der Welt unter dem Schlagwort „Name fehlt“ und kannst sie dort von Hand benennen oder löschen.'
        : loading
          ? 'Das Artikelverzeichnis von LegendKeeper wird gerade geladen …'
          : 'Sobald weiter unten unter „LegendKeeper“ die Verbindung steht, lassen sich die Namen hier mit einem Klick holen.'}
    </Notice>
  );
}

export function LegacySection() {
  const db = useDb();
  const connection = useConnection();
  const catalog = useCatalog(connection.phase === 'ready');
  const [pending, setPending] = useState<Picked | null>(null);
  const [shown, setShown] = useState<Picked | null>(null);
  // Auch eine Übernahme vom Startbildschirm aus ist hier nachzulesen.
  const [last, setLast] = useState(lastImport);
  const [viewing, setViewing] = useState(false);

  const picker = useFilePicker(async (file) => {
    try {
      const plain = previewV157Backup(await readJsonFile(file));
      // Liegt das Artikelverzeichnis von LegendKeeper schon vor, kommen die Personen gleich mit Namen an.
      const result = catalog.catalog
        ? withLkNames(plain, namesFromCatalog(catalog.catalog.entries))
        : plain;
      const next = { result, fileName: file.name };
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

      <MissingNames />

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
