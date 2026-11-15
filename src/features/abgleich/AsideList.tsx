/**
 * Beiseitegelegte Fassungen (Entwurf 1.12): was beim Abgleich auf diesem Rechner ersetzt,
 * entfernt oder nicht gewählt wurde. Zunächst nur Entscheidungen, erste Abgleiche, eingespielte
 * Stände; das Gewöhnliche hinter „Auch Ersetztes zeigen“.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, RotateCcw, Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { toSyncFailure, type AsideEntry, type AsideRun } from '../../data/platform';
import type { Json } from '../../domain/syncMerge';
import { foldDiff, lineDiff } from '../../domain/versions';
import { Button, Checkbox, Dialog, confirmDialog, toast } from '../../ui';
import { DiffView } from '../wiki/Versions';
import { activeSync } from './index';
import { asideEntryText, asideRunText, compareRows, isOrdinaryAside, keyErrorText } from './model';
import './abgleich.css';

const parse = (text: string | null): Json | null => {
  if (text === null) return null;
  try {
    return JSON.parse(text) as Json;
  } catch {
    return null;
  }
};

interface Shown {
  run: AsideRun;
  entry: AsideEntry;
  text: string;
}

function ViewDialog({
  shown,
  device,
  onClose,
}: {
  shown: Shown | null;
  device: string | null;
  onClose: () => void;
}) {
  const data = useData();
  const db = useDb();
  const today = shown ? (db.diskSnapshot().get(shown.entry.path) ?? null) : null;
  const asideJson = shown ? parse(shown.text) : null;
  const todayJson = parse(today);
  const rows = useMemo(
    () => (shown ? compareRows(asideJson, todayJson, { data }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, today, data],
  );
  return (
    <Dialog
      open={!!shown}
      onClose={onClose}
      title={shown ? asideEntryText(shown.entry, asideJson, device) : ''}
      width={720}
      guard={false}
      footer={<Button onClick={onClose}>Schließen</Button>}
    >
      {shown && (
        <div className="wf-abgleich-decide">
          {!todayJson && (
            <p className="wf-soft">
              Diesen Eintrag gibt es heute nicht mehr; zurückgeholt ist er wieder da.
            </p>
          )}
          {todayJson && !rows.length && (
            <p className="wf-soft">Diese Fassung gleicht der heutigen.</p>
          )}
          {rows.map((row, i) =>
            row.long ? (
              <div key={i} className="wf-abgleich-row wf-abgleich-row--long">
                <div className="wf-abgleich-row__label">{row.label}</div>
                <DiffView
                  parts={foldDiff(lineDiff(row.there, row.here))}
                  marks={{ added: 'erst heute', removed: 'nur in der beiseitegelegten Fassung' }}
                  same="Beide Texte lauten gleich."
                />
                <div>
                  <Button
                    size="sm"
                    icon={<Copy />}
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(row.there)
                        .then(() => toast({ title: 'Text kopiert' }))
                        .catch(() => toast({ title: 'Kopieren ging nicht' }))
                    }
                  >
                    Text kopieren
                  </Button>
                </div>
              </div>
            ) : (
              <div key={i} className="wf-abgleich-row">
                <div className="wf-abgleich-row__label">{row.label}</div>
                <div className="wf-abgleich-row__side">
                  <span className="wf-caps">beiseite</span> {row.there}
                </div>
                <div className="wf-abgleich-row__side">
                  <span className="wf-caps">heute</span> {row.here}
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </Dialog>
  );
}

export function AsideList({ device, onChange }: { device: string | null; onChange?: () => void }) {
  const sync = activeSync();
  const [runs, setRuns] = useState<AsideRun[] | null>(null);
  const [all, setAll] = useState(false);
  const [openRun, setOpenRun] = useState<number | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const db = useDb();

  const load = useCallback(() => {
    if (!sync) return;
    sync.port.asideList(sync.root).then(setRuns, (e) => setError(keyErrorText(toSyncFailure(e))));
  }, [sync]);
  useEffect(load, [load]);

  if (!sync) return null;
  const listed = (runs ?? []).filter((r) => all || !isOrdinaryAside(r.reason));
  const hidden = (runs ?? []).length - listed.length;

  const restore = async (run: AsideRun, entry?: AsideEntry) => {
    setBusy(true);
    setError('');
    try {
      const n = await sync.engine.restoreAside(
        run.run,
        entry ? [{ side: entry.side, path: entry.path }] : undefined,
      );
      toast({
        title: n === 1 ? '1 Eintrag zurückgeholt' : `${n} Einträge zurückgeholt`,
        body: 'Die heutigen Fassungen liegen ihrerseits beiseite. Das wird jetzt abgeglichen.',
      });
      load();
      onChange?.();
    } catch (e) {
      setError(keyErrorText(toSyncFailure(e)));
    } finally {
      setBusy(false);
    }
  };

  const drop = async (run: AsideRun) => {
    const ok = await confirmDialog({
      title: 'Diese beiseitegelegten Fassungen löschen?',
      body: `${asideRunText(run, device)}. Danach lassen sie sich nicht mehr zurückholen.`,
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    try {
      await sync.port.asideDrop(sync.root, run.run);
      load();
      onChange?.();
    } catch (e) {
      setError(keyErrorText(toSyncFailure(e)));
    }
  };

  const look = async (run: AsideRun, entry: AsideEntry) => {
    try {
      const text = await sync.port.asideRead(sync.root, run.run, entry.side, entry.path);
      setShown({ run, entry, text });
    } catch (e) {
      setError(keyErrorText(toSyncFailure(e)));
    }
  };

  return (
    <div className="wf-abgleich-aside">
      {runs === null && !error && <p className="wf-mute">Wird gelesen …</p>}
      {runs && !listed.length && (
        <p className="wf-mute">
          {hidden
            ? 'Keine Entscheidungen und keine ersten Abgleiche – nur gewöhnlich Ersetztes.'
            : 'Hier liegt nichts beiseite.'}
        </p>
      )}
      {listed.map((run) => (
        <div key={run.run} className="wf-abgleich-aside__run">
          <div className="wf-abgleich-aside__head">
            <button
              type="button"
              className="wf-abgleich-aside__title"
              aria-expanded={openRun === run.run}
              onClick={() => setOpenRun(openRun === run.run ? null : run.run)}
            >
              {asideRunText(run, device)}
            </button>
            <Button
              size="sm"
              icon={<RotateCcw />}
              disabled={busy}
              onClick={() => void restore(run)}
            >
              Alle zurückholen
            </Button>
            <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => void drop(run)}>
              Diese löschen
            </Button>
          </div>
          {openRun === run.run && (
            <ul className="wf-abgleich-aside__entries">
              {run.entries.map((entry) => (
                <li key={`${entry.side}/${entry.path}`}>
                  <span className="wf-grow">
                    {asideEntryText(
                      entry,
                      parse(db.diskSnapshot().get(entry.path) ?? null),
                      device,
                    )}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => void look(run, entry)}>
                    Ansehen
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    title="Setzt diesen Eintrag auf die beiseitegelegte Fassung zurück. Die heutige Fassung wird dabei ihrerseits beiseitegelegt."
                    onClick={() => void restore(run, entry)}
                  >
                    Zurückholen
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {(runs?.length ?? 0) > 0 && (
        <Checkbox checked={all} onChange={setAll}>
          Auch Ersetztes zeigen{hidden && !all ? ` (${hidden})` : ''}
        </Checkbox>
      )}
      <p className="wf-mute">
        Wayfarer hebt die letzten 50 Abgleiche auf, die etwas beiseitegelegt haben. Deine
        Entscheidungen und erste Abgleiche bleiben, bis du sie löschst.
      </p>
      {error && (
        <p className="wf-abgleich-error" role="alert">
          {error}
        </p>
      )}
      <ViewDialog shown={shown} device={device} onClose={() => setShown(null)} />
    </div>
  );
}
