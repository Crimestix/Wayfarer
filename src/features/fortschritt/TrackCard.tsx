/** Eine Fortschrittsleiste als Zeile: Name, Leiste, Stand, vor und zurück. */
import { useState } from 'react';
import { Link } from 'wouter';
import { Check, ChevronLeft, ChevronRight, Pencil, Plus } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { PARTY_ID, type Track } from '../../domain/schema';
import { trackView, tracksOf } from '../../domain/track';
import { DOWNTIME_LABEL } from '../../domain/downtime';
import { Button, EntityLink, IconButton, Panel, cx, entityHref, toast } from '../../ui';
import { moveTrack, setTrackDone } from './actions';
import { TrackDialog } from './TrackDialog';
import './fortschritt.css';

export function TrackCard({ track, showOwner }: { track: Track; showOwner?: boolean }) {
  const db = useDb();
  const data = useData();
  const [editing, setEditing] = useState(false);
  const view = trackView(track);
  const owner =
    showOwner && track.ownerId && track.ownerId !== PARTY_ID
      ? data.entities[track.ownerId]
      : undefined;
  const move = (direction: 1 | -1) => {
    const undo = moveTrack(db, track.id, direction);
    if (undo)
      toast({
        title: track.name,
        body: trackView(db.getSnapshot().tracks[track.id]!).current,
        action: { label: 'Rückgängig', run: undo },
      });
  };
  return (
    <div className={cx('wf-fortschritt-card', track.done && 'wf-fortschritt-card--done')}>
      <div className="wf-fortschritt-card__head">
        <span className="wf-fortschritt-card__name">{track.name}</span>
        {owner && (
          <Link href={entityHref(owner)} className="wf-fortschritt-card__owner">
            {owner.name}
          </Link>
        )}
        <span className="wf-grow" />
        <IconButton label="Ändern" size="sm" variant="ghost" onClick={() => setEditing(true)}>
          <Pencil />
        </IconButton>
      </div>
      {track.downtime && (
        <div className="wf-fortschritt-card__sub">
          Freie Zeit · {DOWNTIME_LABEL[track.downtime.activity]}
          {track.downtime.itemId && data.entities[track.downtime.itemId] && (
            <>
              {' · '}
              <EntityLink id={track.downtime.itemId} icon={false} />
            </>
          )}
        </div>
      )}
      {view.pips.length > 0 ? (
        <div
          className={cx(
            'wf-fortschritt-pips',
            track.kind === 'stages' && 'wf-fortschritt-pips--named',
          )}
        >
          {view.pips.map((on, index) => (
            <span
              key={index}
              className={cx('wf-fortschritt-pip', on && 'wf-fortschritt-pip--on')}
              title={track.kind === 'stages' ? track.stages[index] : undefined}
            >
              {track.kind === 'stages' ? track.stages[index] : null}
            </span>
          ))}
        </div>
      ) : (
        <div className="wf-fortschritt-bar" aria-hidden>
          <i style={{ width: `${Math.round(view.ratio * 100)}%` }} />
        </div>
      )}
      <div className="wf-fortschritt-card__foot">
        <IconButton label="Einen Schritt zurück" size="sm" onClick={() => move(-1)}>
          <ChevronLeft />
        </IconButton>
        <span className="wf-fortschritt-card__now">
          {view.current}
          {view.next && <em> · als Nächstes {view.next}</em>}
        </span>
        <IconButton label="Einen Schritt weiter" size="sm" onClick={() => move(1)}>
          <ChevronRight />
        </IconButton>
        {view.reached && !track.done && (
          <Button size="sm" icon={<Check />} onClick={() => setTrackDone(db, track.id, true)}>
            Abschließen
          </Button>
        )}
        {track.done && (
          <button
            type="button"
            className="wf-fortschritt-card__reopen"
            onClick={() => setTrackDone(db, track.id, false)}
          >
            abgeschlossen – wieder öffnen
          </button>
        )}
      </div>
      {track.note && <p className="wf-fortschritt-card__note">{track.note}</p>}
      {editing && <TrackDialog track={track} onClose={() => setEditing(false)} />}
    </div>
  );
}

/** Die Leisten eines Eintrags oder der Gruppe – für Seiten von Gefährten, Personen, Orten. */
export function TracksPanel({
  ownerId,
  title = 'Fortschritt',
}: {
  ownerId: string;
  title?: string;
}) {
  const data = useData();
  const [creating, setCreating] = useState(false);
  const tracks = tracksOf(data, ownerId);
  return (
    <Panel
      title={title}
      count={tracks.length || undefined}
      flush
      actions={
        <Button size="sm" icon={<Plus />} onClick={() => setCreating(true)}>
          Leiste
        </Button>
      }
    >
      {tracks.length === 0 ? (
        <p className="wf-fortschritt-none">
          Noch keine Leiste. Ein Ausbildungsweg, eine Schuld, eine Studie – was sich Schritt für
          Schritt bewegt.
        </p>
      ) : (
        tracks.map((track) => <TrackCard key={track.id} track={track} />)
      )}
      {creating && <TrackDialog ownerId={ownerId} onClose={() => setCreating(false)} />}
    </Panel>
  );
}
