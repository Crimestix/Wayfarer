/**
 * „Noch offen“: was die Gruppe angestoßen und nie zu Ende gebracht hat – offene Abmachungen,
 * ungeprüfte Gerüchte, Wünsche der Spieler, Orte, an denen sie nie ankam, und alles, was der
 * Spielleiter in der Chronik angeheftet hat. Die Rechnung steht in `domain/looseEnds.ts`.
 */
import { useMemo } from 'react';
import { Check, Pin } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import {
  LOOSE_REASON_LABEL,
  looseEnds,
  looseGroups,
  sinceText,
  type LooseEnd,
} from '../../domain/looseEnds';
import { ChronicleItem, EmptyState, IconButton, Panel, toast } from '../../ui';
import './offen.css';

export default function OffenPage() {
  const data = useData();
  const ends = useMemo(() => looseEnds(data), [data]);
  const here = ends.filter((end) => end.here);
  const groups = looseGroups(ends.filter((end) => !end.here));
  return (
    <div className="wf-page">
      <header className="wf-page__head">
        <h1 className="wf-page__title wf-grow">Noch offen</h1>
        {ends.length > 0 && (
          <span className="wf-mute">
            {ends.length === 1 ? 'Eine Sache hängt' : `${ends.length} Dinge hängen`} noch offen
          </span>
        )}
      </header>
      <div className="wf-page__body wf-offen-body">
        {ends.length === 0 ? (
          <EmptyState icon={<Pin />} title="Nichts hängt offen">
            Hier erscheint, was die Gruppe angestoßen und nie beendet hat: offene Abmachungen,
            Gerüchte, die niemand geprüft hat, Wünsche der Spieler, entdeckte Orte, an denen sie nie
            war – und alles, was du an einem Eintrag der Chronik mit der Nadel anheftest.
          </EmptyState>
        ) : (
          <div className="wf-offen-groups">
            {here.length > 0 && (
              <Panel title="Hier, am Ort der Gruppe" count={here.length} flush>
                {here.map((end) => (
                  <LooseItem key={end.entry.id} end={end} showReason />
                ))}
              </Panel>
            )}
            {groups.map((group) => (
              <Panel
                key={group.reason}
                title={LOOSE_REASON_LABEL[group.reason]}
                count={group.ends.length}
                flush
              >
                {group.ends.map((end) => (
                  <LooseItem key={end.entry.id} end={end} />
                ))}
              </Panel>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LooseItem({ end, showReason }: { end: LooseEnd; showReason?: boolean }) {
  const db = useDb();
  const { entry } = end;
  const settle = () => {
    const before = entry.loose;
    db.patch('chronicle', entry.id, { loose: 'settled' });
    toast({
      title: 'Erledigt',
      body: entry.text.slice(0, 120),
      action: {
        label: 'Rückgängig',
        run: () => db.patch('chronicle', entry.id, { loose: before }),
      },
    });
  };
  return (
    <div className="wf-offen-item">
      <div className="wf-offen-item__why">
        {showReason && <span>{LOOSE_REASON_LABEL[end.reason]}</span>}
        <span>{sinceText(end)}</span>
        {/* Abmachungen hakt man an ihnen selbst ab: eingelöst oder gescheitert. */}
        {entry.kind !== 'promise' && (
          <IconButton
            label="Erledigt – nicht mehr offen"
            size="sm"
            variant="ghost"
            className="wf-offen-item__settle"
            onClick={settle}
          >
            <Check />
          </IconButton>
        )}
      </div>
      <ChronicleItem entry={entry} showDate />
    </div>
  );
}
