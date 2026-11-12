/**
 * Abschnitt „LegendKeeper ganz übernehmen“: Exportdatei wählen, ansehen, was daraus wird, und
 * übernehmen. Danach liegen Artikel, Karten und Steckbriefe in Wayfarer selbst.
 */
import { useMemo, useState } from 'react';
import { BookMarked, Check, Copy, FileArchive, Library, Undo2 } from 'lucide-react';
import { useLocation } from 'wouter';
import { useData, useDb } from '../../data/hooks';
import { applyLkImport, canUndoLkImport, lastLkImport, undoLkImport } from '../wiki/actions';
import { planLkImport } from '../wiki/apply';
import { readLkFile } from '../wiki/files';
import { convertLkExport, type LkConversion } from '../wiki/lkexport';
import { Button, Checkbox, Dialog, toast } from '../../ui';
import { formatRealTime } from './backup';
import { errorText } from './files';
import { ImportReport, copyReport } from './LegacySection';
import { MediaSection } from './MediaSection';
import { ActionRow, Notice, useFilePicker } from './parts';

interface Picked {
  conversion: LkConversion;
  fileName: string;
}

export function WikiImportSection() {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [recognize, setRecognize] = useState(true);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [last, setLast] = useState(lastLkImport);
  const [viewing, setViewing] = useState(false);

  const picker = useFilePicker(async (file) => {
    setReading(true);
    try {
      const conversion = convertLkExport(await readLkFile(file));
      setError('');
      setRecognize(true);
      setPicked({ conversion, fileName: file.name });
    } catch (e) {
      toast({
        title: 'Diese Datei lässt sich nicht übernehmen',
        body: errorText(e),
        tone: 'danger',
        duration: 12000,
      });
    } finally {
      setReading(false);
    }
  }, '.lk,.gz,.json');

  // Gerechnet gegen den jetzigen Stand – der Bericht zeigt genau, was beim Übernehmen geschieht.
  const plan = useMemo(
    () => (picked ? planLkImport(data, picked.conversion, { recognize }) : null),
    [data, picked, recognize],
  );

  const undo = () => {
    if (undoLkImport(db)) toast({ title: 'Übernahme zurückgenommen' });
    setLast(lastLkImport());
  };

  const apply = () => {
    if (!picked || !plan) return;
    try {
      // Mit dem Erkennen der Einträge werden auch ihre Steckbriefe gleich gelesen.
      const families = applyLkImport(db, plan, picked.fileName, { facts: recognize });
      const applied = lastLkImport();
      setLast(applied);
      setPicked(null);
      if (families)
        toast({
          title: 'Familien aus Nachnamen',
          body: families.text,
          action: { label: 'Rückgängig', run: families.undo },
        });
      toast({
        title: 'LegendKeeper übernommen',
        body: [
          `${plan.counts.articles} Artikel und ${plan.counts.maps} Karten liegen jetzt in Wayfarer.`,
          applied && applied.facts.changed + applied.facts.created > 0
            ? ` Aus den Steckbriefen kamen Angaben zu ${
                applied.facts.changed === 1 ? 'einem Eintrag' : `${applied.facts.changed} Einträgen`
              } in die Welt${
                applied.facts.created === 1
                  ? ', ein Eintrag entstand neu'
                  : applied.facts.created
                    ? `, ${applied.facts.created} Einträge entstanden neu`
                    : ''
              }.`
            : '',
        ].join(''),
        action: { label: 'Zu den Artikeln', run: () => navigate('/welt') },
        duration: 12000,
      });
    } catch (e) {
      setError(errorText(e));
    }
  };

  const count = Object.keys(data.articles).length;
  const undoable = last !== null && canUndoLkImport(db);

  return (
    <div className="wf-einstellungen-stack">
      <div className="wf-einstellungen-actions">
        <ActionRow
          icon={<FileArchive />}
          title="Exportdatei von LegendKeeper einlesen"
          action={
            <Button icon={<FileArchive />} onClick={picker.open} disabled={reading}>
              {reading ? 'Wird gelesen …' : 'Exportdatei wählen …'}
            </Button>
          }
        >
          Die Datei mit der Endung „.lk“ entsteht in LegendKeeper in den Einstellungen des Projekts
          über „Export“. Wayfarer zeigt zuerst, was daraus wird; nichts von dem, was du hier
          eingetragen hast, wird überschrieben.
        </ActionRow>
      </div>
      {picker.input}

      {last ? (
        <Notice
          icon={<Check />}
          title={`Zuletzt übernommen: ${last.fileName || 'LegendKeeper-Export'}`}
          action={
            <span className="wf-row">
              <Button onClick={() => setViewing(true)}>Bericht ansehen</Button>
              {undoable && (
                <Button icon={<Undo2 />} onClick={undo}>
                  Zurücknehmen
                </Button>
              )}
            </span>
          }
        >
          {formatRealTime(last.at)}.{' '}
          {undoable
            ? 'Solange du seither nichts geändert hast, lässt sich die Übernahme zurücknehmen.'
            : 'Der Bericht bleibt hier einsehbar, bis du Wayfarer schließt.'}
        </Notice>
      ) : (
        count > 0 && (
          <Notice
            icon={<Library />}
            title={
              count === 1 ? 'In der Welt liegt ein Artikel' : `In der Welt liegen ${count} Artikel`
            }
            action={<Button onClick={() => navigate('/welt')}>Welt öffnen</Button>}
          >
            Ein neuerer Export lässt sich jederzeit darüber einlesen: Artikel und Karten werden
            aufgefrischt, in der Welt wird nichts doppelt angelegt.
          </Notice>
        )
      )}

      <MediaSection />

      <Dialog
        open={picked !== null}
        onClose={() => setPicked(null)}
        title="LegendKeeper übernehmen"
        width={860}
        footer={
          <>
            <Button onClick={() => setPicked(null)}>Abbrechen</Button>
            <Button variant="primary" icon={<BookMarked />} onClick={apply} data-autofocus>
              Übernehmen
            </Button>
          </>
        }
      >
        {picked && plan && (
          <div className="wf-einstellungen-stack">
            <p className="wf-mute">
              Aus <strong>{picked.fileName}</strong>
              {picked.conversion.exportedAt &&
                `, in LegendKeeper erstellt am ${formatRealTime(picked.conversion.exportedAt)}`}
              . Dein jetziger Stand bleibt erhalten und wird ergänzt.
            </p>
            <Checkbox checked={recognize} onChange={setRecognize}>
              Personen, Orte, Fraktionen und Gegenstände erkennen und in der Welt anlegen
            </Checkbox>
            {error && (
              <Notice tone="danger" title="Das hat nicht geklappt">
                {error}
              </Notice>
            )}
            <ImportReport sections={plan.sections} />
          </div>
        )}
      </Dialog>

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
