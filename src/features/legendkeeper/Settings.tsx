/** Abschnitt der Einstellungen: Verbindung zu LegendKeeper einrichten und prüfen. */
import { useState, type FormEvent } from 'react';
import { KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import { isDesktopApp } from '../../data/platform';
import { Button, Field, Input, cx, confirmDialog, toast } from '../../ui';
import { appSentence, describeError } from './errors';
import {
  checkConnection,
  ensureCatalog,
  removeKey,
  saveKey,
  useCatalog,
  useConnection,
  type Connection,
} from './state';
import { statusView } from './status';
import './legendkeeper.css';

type Busy = 'save' | 'remove' | 'check' | null;

function report(result: Connection, done: string) {
  if (result.phase === 'ready')
    toast({ title: done, body: `Verbunden mit „${result.project.name}“.` });
  else if (result.phase === 'failed') {
    const view = describeError(result.error, 'connection');
    toast({
      title: view.title,
      body: view.text,
      tone: view.tone === 'problem' ? 'danger' : 'default',
    });
  }
}

export function LegendKeeperSettings() {
  const desktop = isDesktopApp();
  const connection = useConnection();
  const catalog = useCatalog(connection.phase === 'ready');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [formError, setFormError] = useState('');

  const status = statusView({
    phase: busy === 'check' || busy === 'save' ? 'checking' : connection.phase,
    projectName: connection.phase === 'ready' ? connection.project.name : undefined,
    error: connection.phase === 'failed' ? connection.error : undefined,
    desktop,
    catalog,
    checkedAt:
      connection.phase === 'ready' || connection.phase === 'failed'
        ? connection.checkedAt
        : undefined,
  });
  const hasKey = connection.hasKey === true;

  const run = async (kind: Exclude<Busy, null>, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(kind);
    setFormError('');
    try {
      await work();
    } catch (cause) {
      // Die App-Seite meldet Fehler als fertigen deutschen Satz.
      setFormError(appSentence(cause) ?? 'Das hat nicht geklappt. Bitte versuche es noch einmal.');
    } finally {
      setBusy(null);
    }
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    const value = key.trim();
    if (!value) {
      setFormError('Bitte füge zuerst den API-Key ein.');
      return;
    }
    void run('save', async () => {
      const result = await saveKey(value);
      setKey('');
      report(result, 'Key gespeichert');
      if (result.phase === 'ready') ensureCatalog(true);
    });
  };

  const check = () =>
    void run('check', async () => {
      const result = await checkConnection(true);
      report(result, 'Verbindung steht');
      if (result.phase === 'ready') ensureCatalog(true);
    });

  const remove = async () => {
    const ok = await confirmDialog({
      title: 'LegendKeeper-Key entfernen?',
      body: 'Der Key wird aus dem Schlüsselbund dieses Geräts gelöscht. Die Verknüpfungen deiner Einträge bleiben erhalten; die Artikel lassen sich aber erst wieder lesen, wenn ein Key hinterlegt ist.',
      confirmLabel: 'Key entfernen',
      danger: true,
    });
    if (!ok) return;
    void run('remove', async () => {
      await removeKey();
      toast({ title: 'Key entfernt', body: 'Wayfarer hat keinen Zugang mehr zu LegendKeeper.' });
    });
  };

  return (
    <div className="wf-lk-settings">
      <div className={cx('wf-lk-status', `wf-lk-status--${status.tone}`)} role="status">
        <i className="wf-lk-status__gem" aria-hidden />
        <div className="wf-grow">
          <div className="wf-lk-status__title">{status.title}</div>
          <div className="wf-lk-status__text">{status.text}</div>
        </div>
        {(hasKey || !desktop) && (
          <Button
            icon={<RefreshCw />}
            onClick={check}
            disabled={busy !== null || connection.phase === 'checking'}
          >
            Verbindung prüfen
          </Button>
        )}
      </div>

      {desktop ? (
        <form className="wf-col" onSubmit={save}>
          <Field
            label={hasKey ? 'API-Key ersetzen' : 'API-Key'}
            hint={
              hasKey
                ? 'Ein Key ist hinterlegt. Er liegt im Schlüsselbund deines Systems und wird nie angezeigt – auch hier nicht.'
                : 'Der Key wird im Schlüsselbund deines Systems abgelegt, nicht im Kampagnenordner. Er wird nie angezeigt.'
            }
          >
            <div className="wf-lk-keyrow">
              <Input
                type="password"
                name="legendkeeper-key"
                value={key}
                placeholder={
                  hasKey
                    ? 'Neuen Key einfügen, um den hinterlegten zu ersetzen'
                    : 'Key aus LegendKeeper hier einfügen'
                }
                aria-label="API-Key von LegendKeeper"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setKey(event.target.value);
                  setFormError('');
                }}
              />
              <Button
                type="submit"
                variant="primary"
                icon={<KeyRound />}
                disabled={busy !== null || !key.trim()}
              >
                {busy === 'save' ? 'Wird geprüft …' : 'Speichern und prüfen'}
              </Button>
            </div>
          </Field>
          {formError && (
            <div className="wf-lk-settings__error" role="alert">
              {formError}
            </div>
          )}
        </form>
      ) : (
        <div className="wf-lk-settings__notice">
          Dies ist die Vorschau im Browser. Die Verbindung zu LegendKeeper wird in der installierten
          App eingerichtet: Nur dort kann der API-Key sicher im Schlüsselbund des Systems liegen.
          Hier lässt sich kein Key eingeben.
        </div>
      )}

      <div className="wf-lk-howto">
        <div className="wf-lk-label">So bekommst du den API-Key</div>
        <ol>
          <li>Öffne dein Projekt in LegendKeeper (legendkeeper.com).</li>
          <li>
            Gehe in die Projekteinstellungen: <em>Project Settings</em> → <em>Developers</em> →{' '}
            <em>API Keys</em>.
          </li>
          <li>Erzeuge dort einen neuen Key und kopiere ihn.</li>
          <li>
            {desktop
              ? 'Füge ihn oben ein und wähle „Speichern und prüfen“.'
              : 'Füge ihn in der installierten App an dieser Stelle ein und wähle „Speichern und prüfen“.'}
          </li>
        </ol>
        <ul className="wf-lk-howto__notes">
          <li>Wayfarer liest nur. In LegendKeeper wird nichts angelegt, geändert oder gelöscht.</li>
          <li>
            Der Key gilt je Gerät: Auf dem Mac und unter Windows trägst du ihn jeweils einmal ein.
            Im Kampagnenordner steht er nie.
          </li>
          <li>
            Geheime Abschnitte und verborgene Seiten liefert LegendKeeper nur, wenn der Key
            Admin-Rechte hat. API-Keys setzen einen bezahlten LegendKeeper-Tarif voraus.
          </li>
        </ul>
      </div>

      {desktop && hasKey && (
        <Button
          className="wf-lk-settings__remove"
          variant="danger"
          icon={<Trash2 />}
          onClick={() => void remove()}
          disabled={busy !== null}
        >
          Key von diesem Gerät entfernen
        </Button>
      )}
    </div>
  );
}
