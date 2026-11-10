/** Chronik: das Gedächtnis der Kampagne – als Verlauf aller Einträge und nach Sessions. */
import { useCallback, useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { useData } from '../../data/hooks';
import type { ChronicleEntry } from '../../domain/schema';
import { Button, Tabs } from '../../ui';
import { EntryDialog, type EntryDialogRequest } from './EntryDialog';
import { Sessions } from './Sessions';
import { Verlauf } from './Verlauf';
import { EMPTY_FILTER, sessionSpans, type ChronicleFilter } from './model';
import './chronik.css';

type View = 'verlauf' | 'sessions';

/** Merkt sich die Ansicht, solange die App läuft – beim Wechsel zwischen den Bereichen geht nichts verloren. */
const remembered: { view: View; filter: ChronicleFilter; newestFirst: boolean; sessionId: string | null } = {
  view: 'verlauf',
  filter: EMPTY_FILTER,
  newestFirst: true,
  sessionId: null,
};

export default function ChronikPage() {
  const data = useData();
  const [view, setView] = useState<View>(remembered.view);
  const [filter, setFilter] = useState(remembered.filter);
  const [newestFirst, setNewestFirst] = useState(remembered.newestFirst);
  const [sessionId, setSessionId] = useState(remembered.sessionId);
  const [dialog, setDialog] = useState<(EntryDialogRequest & { key: number }) | null>(null);

  useEffect(() => {
    Object.assign(remembered, { view, filter, newestFirst, sessionId });
  }, [view, filter, newestFirst, sessionId]);

  const edit = useCallback((entry: ChronicleEntry) => setDialog({ mode: 'edit', entry, key: Date.now() }), []);
  const openSession = useCallback((id: string) => {
    setSessionId(id);
    setView('sessions');
  }, []);
  const backfill = (forSession?: string) => {
    if (!forSession) return setDialog({ mode: 'new', key: Date.now() });
    // Nachtrag zu einer Session: an ihr Ende, bei der laufenden auf jetzt.
    const span = sessionSpans(data).find((s) => s.session.id === forSession);
    setDialog({
      mode: 'new',
      sessionId: forSession,
      at: Math.min(span?.to ?? data.state.now, data.state.now),
      key: Date.now(),
    });
  };

  return (
    <div className="wf-page wf-chronik">
      <header className="wf-page__head wf-chronik-head">
        <h1 className="wf-page__title">Chronik</h1>
        <Tabs<View>
          tabs={[
            { id: 'verlauf', label: 'Verlauf', count: Object.keys(data.chronicle).length },
            { id: 'sessions', label: 'Sessions', count: Object.keys(data.sessions).length },
          ]}
          value={view}
          onChange={setView}
        />
        <span className="wf-grow" />
        <Button icon={<History />} onClick={() => backfill()} title="Etwas Vergangenes mit frei wählbarem Zeitpunkt in die Chronik schreiben">
          Eintrag nachtragen
        </Button>
      </header>
      <div className="wf-chronik-body">
        {view === 'verlauf' ? (
          <Verlauf
            filter={filter}
            onFilter={setFilter}
            newestFirst={newestFirst}
            onNewestFirst={setNewestFirst}
            onEdit={edit}
            onBackfill={() => backfill()}
            onOpenSession={openSession}
          />
        ) : (
          <Sessions selectedId={sessionId} onSelect={setSessionId} onEdit={edit} onBackfill={backfill} />
        )}
      </div>
      {dialog && <EntryDialog key={dialog.key} request={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}
