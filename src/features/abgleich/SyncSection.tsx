/**
 * Einstellungen → Abgleich (Entwurf 1.2, 1.10–1.15): einrichten, wenn noch nicht geschehen;
 * sonst Zustand, Hinweise, „Jetzt abgleichen“, „Beiseitegelegte Fassungen“, „Zugangsschlüssel
 * ersetzen“, Bilder und „Abgleich trennen“.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  CloudOff,
  ImageDown,
  KeyRound,
  RefreshCw,
  TriangleAlert,
  Unplug,
  X,
} from 'lucide-react';
import { useData } from '../../data/hooks';
import { useLocalMediaCount } from '../../data/media';
import { toSyncFailure, type SyncStateInfo } from '../../data/platform';
import { DATA_VERSION } from '../../domain/schema';
import { Button, Checkbox, Dialog, IconButton, toast } from '../../ui';
import { ActionRow, Notice } from '../einstellungen/parts';
import { MediaSection } from '../einstellungen/MediaSection';
import { AsideList } from './AsideList';
import { FirstSyncDialog, type FirstChoice } from './FirstSyncDialog';
import { KeyForm, KeyGuide, OutLink } from './KeyParts';
import { Setup } from './Setup';
import { activeSync, syncEnv, useSync } from './index';
import {
  DISCONNECT_AFTER,
  DISCONNECT_TEXT,
  DISCONNECT_TITLE,
  NOT_SET_UP,
  PREVIEW_ONLY,
  RELEASES_URL,
  keyErrorText,
  lastLine,
  moveQuestion,
  needsInfo,
  newerHereText,
  offlineText,
  otherDevice,
  picturesNotice,
  reopenedText,
  resultLine,
  skippedText,
  statusLine,
} from './model';
import { openDecide, takeFocus, useSurface } from './open';
import './abgleich.css';

/** Die Frage bei einem kopierten oder verschobenen Ordner (1.15). Bis zur Antwort kein Netz. */
function MoveQuestion({ oldRoot, newRoot }: { oldRoot: string; newRoot: string }) {
  const sync = activeSync();
  const [busy, setBusy] = useState(false);
  if (!sync) return null;
  const answer = async (mine: boolean) => {
    setBusy(true);
    try {
      await sync.engine.confirmMove(mine);
      toast(
        mine
          ? {
              title: 'Das ist jetzt dein Kampagnenordner',
              body: 'Ab jetzt wird von hier abgeglichen.',
            }
          : { title: 'Diese Kopie gleicht nicht ab', body: 'Beiseitegelegtes bleibt erhalten.' },
      );
    } catch (e) {
      toast({ title: 'Nicht geändert', body: keyErrorText(toSyncFailure(e)), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Notice
      tone="warn"
      icon={<TriangleAlert />}
      title="Dieser Ordner ist eine Kopie oder wurde verschoben"
    >
      <p>{moveQuestion(oldRoot, newRoot)}</p>
      <div className="wf-row-wrap wf-abgleich-gap">
        <Button variant="primary" disabled={busy} onClick={() => void answer(false)}>
          Nicht abgleichen – das ist eine Kopie
        </Button>
        <Button disabled={busy} onClick={() => void answer(true)}>
          Das ist jetzt mein Kampagnenordner
        </Button>
      </div>
    </Notice>
  );
}

/** „Zugangsschlüssel ersetzen“: Anleitung aus Schritt 3, darunter das Feld aus Schritt 4. */
function KeyReplace({ onDone, primary }: { onDone: () => void; primary: boolean }) {
  const sync = activeSync();
  const view = useSync();
  if (!sync || !view.link) return null;
  const link = view.link;
  return (
    <div className="wf-abgleich-box">
      <KeyGuide
        device={link.device}
        second={false}
        showTail={false}
        repo={`${link.owner}/${link.repo}`}
      />
      <KeyForm
        port={sync.port}
        primary={primary}
        target={{ owner: link.owner, repo: link.repo }}
        onResult={(result) => {
          const f = result.found;
          if (f && f.info.owner === link.owner && f.info.repo === link.repo) {
            toast({
              title: 'Neuer Zugangsschlüssel gilt',
              body: `Für ${link.owner}/${link.repo}.`,
            });
            onDone();
            void sync.engine.syncNow();
          }
        }}
      />
    </div>
  );
}

function Disconnect() {
  const sync = activeSync();
  const [open, setOpen] = useState(false);
  const [removeKey, setRemoveKey] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!sync) return null;
  const run = async () => {
    setBusy(true);
    try {
      await sync.engine.disconnect(removeKey);
      setOpen(false);
      toast({ title: 'Abgleich getrennt', body: DISCONNECT_AFTER, duration: 12000 });
    } catch (e) {
      toast({ title: 'Nicht getrennt', body: keyErrorText(toSyncFailure(e)), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="wf-abgleich-disconnect">
        <Button variant="danger" icon={<Unplug />} onClick={() => setOpen(true)}>
          Abgleich trennen
        </Button>
      </div>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={DISCONNECT_TITLE}
        width={520}
        guard={false}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Abbrechen</Button>
            <Button variant="danger" disabled={busy} onClick={() => void run()}>
              Trennen
            </Button>
          </>
        }
      >
        <div className="wf-col">
          <p className="wf-soft">{DISCONNECT_TEXT}</p>
          <Checkbox checked={removeKey} onChange={setRemoveKey}>
            Auch den Zugangsschlüssel von diesem Rechner entfernen
          </Checkbox>
          <p className="wf-mute">{DISCONNECT_AFTER}</p>
        </div>
      </Dialog>
    </>
  );
}

/** Die Frage „Zwei Spielstände“, wenn der laufende Abgleich sie stellt (1.9). */
function FirstSyncQuestion({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sync = activeSync();
  const view = useSync();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!sync) return null;
  const choose = async (choice: FirstChoice) => {
    setBusy(true);
    setError('');
    try {
      await sync.engine.firstSync(choice);
      onClose();
    } catch (e) {
      setError(keyErrorText(toSyncFailure(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <FirstSyncDialog
      open={open}
      info={view.firstSync}
      older={view.older}
      otherSide={view.other}
      busy={busy}
      progress={view.progress}
      error={error}
      onChoose={(c) => void choose(c)}
      onClose={onClose}
    />
  );
}

export function SyncSection() {
  const sync = activeSync();
  const env = syncEnv();
  const view = useSync();
  const surface = useSurface();
  const data = useData();
  const localImages = useLocalMediaCount();
  const [setup, setSetup] = useState(false);
  const [info, setInfo] = useState<SyncStateInfo | null>(null);
  /** Rückmeldung nach „Jetzt abgleichen“ – gilt nur für den Stand, zu dem sie gehört. */
  const [result, setResult] = useState<{ text: string; at: string | null; phase: string } | null>(
    null,
  );
  const [running, setRunning] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [showAside, setShowAside] = useState(false);
  const [question, setQuestion] = useState(false);
  const [reopenSeen, setReopenSeen] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  const images = useRef<HTMLDivElement>(null);
  const key = useRef<HTMLDivElement>(null);
  const now = new Date();

  // Stand ohne Netz: Schlüssel, Zahl des Beiseitegelegten (nach jedem Lauf neu).
  useEffect(() => {
    if (!sync) return;
    let gone = false;
    sync.port.state(sync.root, DATA_VERSION).then(
      (st) => !gone && setInfo(st),
      () => undefined,
    );
    return () => {
      gone = true;
    };
  }, [sync, view.syncedAt, view.phase, view.link]);

  // Sprung aus dem Zeichen oder der Meldung „Spielstand geholt“.
  useEffect(() => {
    const part = takeFocus();
    if (!part) return;
    if (part === 'key') setShowKey(true);
    if (part === 'aside') setShowAside(true);
    const target = part === 'bilder' ? images : part === 'key' ? key : top;
    requestAnimationFrame(() =>
      target.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
    );
  }, [surface.focus]);

  if (!env || !sync) return <p className="wf-soft">{PREVIEW_ONLY}</p>;

  const linked = !!view.link && view.phase !== 'off' && view.phase !== 'unlinked';
  if (!linked)
    return (
      <div ref={top} className="wf-col wf-einstellungen-stack">
        {setup ? (
          <Setup onClose={() => setSetup(false)} />
        ) : (
          <Notice
            icon={<CloudOff />}
            title="Noch nicht eingerichtet"
            action={
              <Button variant="primary" onClick={() => setSetup(true)}>
                Abgleich einrichten
              </Button>
            }
          >
            {NOT_SET_UP}
          </Notice>
        )}
      </div>
    );

  const needs = needsInfo(view, now);
  const status = statusLine(view, now);
  const decidePrimary = needs?.action === 'decide' || needs?.action === 'firstSync';
  const keyPrimary = needs?.action === 'replaceKey';
  const dev = otherDevice(view);
  const reopened = reopenSeen ? null : reopenedText(view.reopened);
  const skipped = skippedText(view.skipped, data);
  const last = lastLine(view, now);

  const syncNow = async () => {
    setRunning(true);
    setResult(null);
    try {
      await sync.engine.syncNow();
    } finally {
      setRunning(false);
      const after = sync.engine.view.get();
      setResult({ text: resultLine(after, new Date()), at: after.syncedAt, phase: after.phase });
    }
  };

  const act = () => {
    switch (needs?.action) {
      case 'decide':
        return void openDecide();
      case 'firstSync':
        return setQuestion(true);
      case 'replaceKey':
        setShowKey(true);
        return requestAnimationFrame(() =>
          key.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
        );
      case 'retry':
        return void syncNow();
      case 'retryKeychain':
        return void sync.engine.retryKeychain();
      case 'resetup':
        return void sync.engine.disconnect(false).then(() => setSetup(true));
      default:
        return undefined;
    }
  };

  return (
    <div ref={top} className="wf-col wf-einstellungen-stack">
      <div className="wf-abgleich-status" data-phase={view.phase}>
        <strong>{status.head}</strong>
        {status.rest && <> – {status.rest}</>}
      </div>

      {needs && needs.action === 'move' && view.link && (
        <MoveQuestion oldRoot={view.link.root} newRoot={sync.root} />
      )}
      {needs && needs.action === 'releases' && (
        <Notice
          tone="warn"
          icon={<TriangleAlert />}
          title={needs.title}
          action={<OutLink href={RELEASES_URL}>{needs.button}</OutLink>}
        >
          {needs.text}
        </Notice>
      )}
      {needs && needs.action !== 'move' && needs.action !== 'releases' && (
        <Notice
          tone={decidePrimary ? 'info' : 'warn'}
          icon={<TriangleAlert />}
          title={needs.title}
          action={
            needs.button ? (
              <Button
                variant={decidePrimary ? 'primary' : 'default'}
                disabled={surface.decide === 'looking'}
                onClick={act}
              >
                {surface.decide === 'looking' && needs.action === 'decide'
                  ? 'Wayfarer sieht nach …'
                  : needs.button}
              </Button>
            ) : undefined
          }
        >
          {needs.text}
        </Notice>
      )}
      {view.phase === 'offline' && <p className="wf-abgleich-line">{offlineText(view)}</p>}
      {view.otherNeedsUpdate && (
        <p className="wf-abgleich-line">{newerHereText(view.otherNeedsUpdate)}</p>
      )}
      {reopened && (
        <div className="wf-abgleich-line wf-row">
          <span className="wf-grow">{reopened}</span>
          <IconButton
            label="Hinweis ausblenden"
            size="sm"
            variant="ghost"
            onClick={() => setReopenSeen(true)}
          >
            <X />
          </IconButton>
        </div>
      )}
      {skipped && <p className="wf-abgleich-line wf-mute">{skipped}</p>}

      <div className="wf-einstellungen-actions">
        <ActionRow
          icon={<RefreshCw />}
          title="Jetzt abgleichen"
          action={
            <Button disabled={running || view.phase === 'running'} onClick={() => void syncNow()}>
              {running || view.phase === 'running' ? 'Gleicht ab …' : 'Jetzt abgleichen'}
            </Button>
          }
        >
          Sonst geschieht das von selbst: beim Öffnen, nach Änderungen, beim Schließen.
          {result && result.at === view.syncedAt && result.phase === view.phase ? (
            <span className="wf-abgleich-result"> {result.text}</span>
          ) : (
            last && <> {last}.</>
          )}
          <span className="wf-abgleich-quiet">
            Was du hier änderst, wird abgeglichen. Zum Ausprobieren nimm vorher eine Sicherung.
          </span>
        </ActionRow>
        <ActionRow
          icon={<Archive />}
          title={`Beiseitegelegte Fassungen${info ? ` (${info.aside})` : ''}`}
          action={
            <Button aria-expanded={showAside} onClick={() => setShowAside((s) => !s)}>
              {showAside ? 'Zuklappen' : 'Ansehen'}
            </Button>
          }
        >
          Was beim Abgleich auf diesem Rechner ersetzt, entfernt oder nicht gewählt wurde.
        </ActionRow>
        {showAside && (
          <div className="wf-abgleich-inset">
            <AsideList
              device={dev}
              onChange={() => sync.port.state(sync.root, DATA_VERSION).then(setInfo)}
            />
          </div>
        )}
        <div ref={key}>
          <ActionRow
            icon={<KeyRound />}
            title="Zugangsschlüssel ersetzen"
            action={
              <Button aria-expanded={showKey} onClick={() => setShowKey((s) => !s)}>
                {showKey ? 'Zuklappen' : 'Ersetzen'}
              </Button>
            }
          >
            Wenn GitHub den Schlüssel nicht mehr annimmt oder du ihn bei GitHub neu erzeugt hast.
          </ActionRow>
        </div>
        {showKey && (
          <div className="wf-abgleich-inset">
            <KeyReplace primary={keyPrimary} onDone={() => setShowKey(false)} />
          </div>
        )}
      </div>

      <div ref={images} className="wf-col wf-einstellungen-stack">
        <Notice icon={<ImageDown />} title="Bilder reisen nicht mit">
          {picturesNotice(localImages)}
        </Notice>
        <MediaSection primary={!needs} />
      </div>

      <Disconnect />
      <FirstSyncQuestion open={question} onClose={() => setQuestion(false)} />
    </div>
  );
}
