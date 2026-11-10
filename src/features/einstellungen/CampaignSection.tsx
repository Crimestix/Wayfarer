/** Abschnitt „Kampagne“: Name, Ablageort, Ordner wechseln bzw. Hinweis auf die Browser-Vorschau. */
import { useEffect, useState } from 'react';
import { Cloud, FlaskConical, FolderOpen, RotateCcw } from 'lucide-react';
import { CampaignDb, CampaignMissingError } from '../../data/db';
import { useData, useDb } from '../../data/hooks';
import { FolderStore, isDesktopApp, pickFolder, setConfig } from '../../data/platform';
import { demoCampaign } from '../../data/seed';
import { Button, Dialog, Field, Input, toast } from '../../ui';
import { errorText } from './files';
import { CAMPAIGN_NAME_MAX, cleanCampaignName, isInsideFolder } from './model';
import { ActionRow, Notice } from './parts';

function NameField() {
  const db = useDb();
  const stored = useData().campaign.name;
  const [name, setName] = useState(stored);
  // Nach dem Einspielen eines anderen Stands gilt dessen Name.
  useEffect(() => setName(stored), [stored]);
  const cleaned = cleanCampaignName(name);
  const dirty = name !== stored;
  const save = () => {
    if (!cleaned || cleaned === stored) {
      setName(stored);
      return;
    }
    db.setCampaign({ name: cleaned });
    setName(cleaned);
    toast({ title: 'Name der Kampagne geändert', body: cleaned });
  };
  return (
    <form
      className="wf-einstellungen-name"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Field
        label="Name der Kampagne"
        className="wf-grow"
        hint={
          dirty && !cleaned
            ? 'Die Kampagne braucht einen Namen.'
            : 'Steht oben links unter „Wayfarer“ und im Dateinamen der Sicherungen.'
        }
      >
        <Input
          value={name}
          maxLength={CAMPAIGN_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && dirty) {
              e.preventDefault();
              setName(stored);
            }
          }}
          aria-label="Name der Kampagne"
        />
      </Field>
      {dirty && (
        <div className="wf-einstellungen-name__actions">
          <Button variant="primary" type="submit" disabled={!cleaned}>
            Speichern
          </Button>
          <Button variant="ghost" onClick={() => setName(stored)}>
            Verwerfen
          </Button>
        </div>
      )}
    </form>
  );
}

/** Installierte App: einen anderen Kampagnenordner öffnen – oder die Kampagne dorthin mitnehmen. */
function FolderSwitch() {
  const db = useDb();
  const data = useData();
  const [busy, setBusy] = useState(false);
  /** Gewählter Ordner, in dem noch keine Kampagne liegt. */
  const [emptyFolder, setEmptyFolder] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast({ title: 'Der Ordner ließ sich nicht öffnen', body: errorText(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const switchTo = async (folder: string) => {
    await db.flush();
    if (db.hasUnsavedChanges())
      throw new Error(
        'Die letzten Änderungen sind noch nicht gespeichert. Bitte gleich noch einmal versuchen.',
      );
    await setConfig({ campaignDir: folder });
    window.location.reload();
  };

  const choose = () =>
    run(async () => {
      const folder = await pickFolder('Kampagnenordner wählen');
      if (!folder) return;
      if (isInsideFolder(folder, db.store.location) && isInsideFolder(db.store.location, folder)) {
        toast({ title: 'Dieser Ordner ist bereits geöffnet' });
        return;
      }
      try {
        (await CampaignDb.open(new FolderStore(folder))).close();
      } catch (e) {
        if (!(e instanceof CampaignMissingError)) throw e;
        setEmptyFolder(folder);
        return;
      }
      await switchTo(folder);
    });

  /**
   * Zum Startbildschirm, ohne einen Ordner vorzumerken: Dort wird der leere Ordner neu gewählt.
   * Bliebe er vorgemerkt, meldete der Start „keine Kampagne mehr“, als wäre etwas verloren gegangen.
   */
  const startFresh = () =>
    run(async () => {
      await db.flush();
      if (db.hasUnsavedChanges())
        throw new Error(
          'Die letzten Änderungen sind noch nicht gespeichert. Bitte gleich noch einmal versuchen.',
        );
      await setConfig({ campaignDir: null });
      window.location.reload();
    });

  const copyThere = () =>
    run(async () => {
      if (!emptyFolder) return;
      await db.flush();
      (await CampaignDb.create(new FolderStore(emptyFolder), db.getSnapshot())).close();
      await switchTo(emptyFolder);
    });

  return (
    <>
      <ActionRow
        icon={<FolderOpen />}
        title="Anderen Kampagnenordner öffnen"
        action={
          <Button onClick={choose} disabled={busy}>
            Ordner wählen …
          </Button>
        }
      >
        Öffnet eine andere Kampagne – oder nimmt diese mit in einen neuen Ordner, etwa in dein
        Cloud-Laufwerk.
      </ActionRow>
      <Dialog
        open={emptyFolder !== null}
        onClose={() => setEmptyFolder(null)}
        title="In diesem Ordner liegt noch keine Kampagne"
        width={620}
        footer={<Button onClick={() => setEmptyFolder(null)}>Abbrechen</Button>}
      >
        <div className="wf-col">
          <p className="wf-soft">
            <span className="wf-gold wf-einstellungen-path">{emptyFolder}</span>
          </p>
          <button
            type="button"
            className="wf-einstellungen-choice"
            onClick={copyThere}
            disabled={busy}
            data-autofocus
          >
            <span className="wf-einstellungen-choice__title">
              „{data.campaign.name}“ dorthin mitnehmen
            </span>
            <span className="wf-mute">
              Kopiert den gesamten Spielstand in den neuen Ordner und arbeitet ab jetzt dort. Der
              bisherige Ordner bleibt unverändert liegen.
            </span>
          </button>
          <button
            type="button"
            className="wf-einstellungen-choice"
            onClick={startFresh}
            disabled={busy}
          >
            <span className="wf-einstellungen-choice__title">Dort etwas Neues beginnen</span>
            <span className="wf-mute">
              Schließt „{data.campaign.name}“ und wechselt zum Startbildschirm. Dort wählst du den
              Ordner noch einmal und beginnst eine neue Kampagne oder übernimmst den Spielstand der
              alten Version. Der bisherige Ordner bleibt unverändert liegen.
            </span>
          </button>
        </div>
      </Dialog>
    </>
  );
}

export function CampaignSection() {
  const db = useDb();
  const desktop = isDesktopApp();

  const [resetOpen, setResetOpen] = useState(false);
  const resetDemo = () => {
    setResetOpen(false);
    db.replaceAll(demoCampaign());
    toast({ title: 'Beispielwelt zurückgesetzt' });
  };

  return (
    <div className="wf-col wf-einstellungen-stack">
      <NameField />

      <div className="wf-field">
        <div className="wf-field__label">Ablageort</div>
        <div className="wf-einstellungen-location">
          <span className="wf-einstellungen-path">{db.store.location}</span>
        </div>
      </div>

      {desktop ? (
        <>
          <FolderSwitch />
          <Notice icon={<Cloud />} title="Ein Spielstand auf Mac und Windows">
            Liegt der Ordner in einem Cloud-Laufwerk (OneDrive, Dropbox, Google Drive, iCloud),
            arbeiten alle deine Rechner mit demselben Spielstand. Öffne Wayfarer immer nur auf einem
            Rechner zur selben Zeit und warte nach dem Schließen, bis das Laufwerk fertig
            abgeglichen hat – sonst legt es Konfliktkopien an.
          </Notice>
        </>
      ) : (
        <Notice
          icon={<FlaskConical />}
          title="Vorschau im Browser mit Beispielwelt"
          action={
            <Button icon={<RotateCcw />} onClick={() => setResetOpen(true)}>
              Beispielwelt zurücksetzen
            </Button>
          }
        >
          Orte und Personen hier sind erfunden. Änderungen bleiben nur in diesem Browser. Erst die
          installierte App speichert die Kampagne als Ordner – auf Wunsch im Cloud-Laufwerk, damit
          Mac und Windows denselben Spielstand haben.
        </Notice>
      )}

      <Dialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Beispielwelt zurücksetzen?"
        width={480}
        footer={
          <>
            <Button onClick={() => setResetOpen(false)}>Abbrechen</Button>
            <Button variant="danger" onClick={resetDemo} data-autofocus>
              Zurücksetzen
            </Button>
          </>
        }
      >
        <p className="wf-soft">
          Alles, was du in der Vorschau geändert hast, geht verloren. Die Beispielwelt beginnt
          wieder am 17. Tauwind 701 AD.
        </p>
      </Dialog>
    </div>
  );
}
