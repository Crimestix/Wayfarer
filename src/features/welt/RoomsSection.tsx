/**
 * „Räume“ auf der Seite eines Ortes: Name, eine Zeile, Stand – aufklappbar mit den Notizen. Räume
 * stehen nicht einzeln in der Welt und im Wiki (`domain/rooms.ts`).
 */
import { SUGGESTION } from '../../domain/dismiss';
import { useState } from 'react';
import { Link } from 'wouter';
import { ChevronDown, ChevronRight, DoorOpen, Footprints, Plus } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { roomCandidates, roomText, roomsOf } from '../../domain/rooms';
import type { Place } from '../../domain/schema';
import { Badge, Button, DismissButton, Input, TextArea, cx, entityHref, toast } from '../../ui';
import { addRooms, setRoomState, setRooms } from './rooms';
import { Hint, Section } from './parts';

export function RoomsSection({ place }: { place: Place }) {
  const db = useDb();
  const data = useData();
  const rooms = roomsOf(data, place.id);
  const candidates = roomCandidates(data, place.id);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [lines, setLines] = useState('');

  const add = () => {
    const made = addRooms(db, place.id, lines);
    setLines('');
    setAdding(false);
    if (made.length)
      toast({ title: made.length === 1 ? 'Raum angelegt' : `${made.length} Räume angelegt` });
  };
  const convert = () => {
    const undo = setRooms(
      db,
      candidates.map((p) => p.id),
      true,
    );
    toast({
      title:
        candidates.length === 1
          ? `„${candidates[0]!.name}“ ist jetzt ein Raum`
          : `${candidates.length} Orte sind jetzt Räume`,
      body: 'Sie stehen nur noch hier, nicht mehr einzeln in der Welt und im Wiki.',
      action: { label: 'Rückgängig', run: undo },
    });
  };
  const unRoom = (room: Place) => {
    const undo = setRooms(db, [room.id], false);
    toast({
      title: `${room.name} ist ein eigener Eintrag`,
      action: { label: 'Rückgängig', run: undo },
    });
  };

  if (!rooms.length && !candidates.length && !adding)
    return (
      <Section title="Räume">
        <Hint
          action={
            <Button size="sm" icon={<Plus />} onClick={() => setAdding(true)}>
              Räume eintragen
            </Button>
          }
        >
          Hat dieser Ort Räume – eine Festung, ein Verlies, ein Haus? Sie stehen dann hier statt
          einzeln in der Welt.
        </Hint>
      </Section>
    );

  return (
    <Section
      title="Räume"
      count={rooms.length || undefined}
      action={
        <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setAdding(true)}>
          Räume
        </Button>
      }
    >
      {candidates.length > 0 && (
        <div className="wf-welt-rooms__offer">
          <span>
            {candidates.length === 1
              ? `„${candidates[0]!.name}“ sieht aus wie ein Raum dieses Ortes.`
              : `${candidates.length} Orte darunter sehen aus wie Räume (${candidates[0]!.place.category}).`}{' '}
            Als Räume führen, stehen sie nur noch hier.
          </span>
          <Button size="sm" onClick={convert}>
            Als Räume führen
          </Button>
          <DismissButton suggestionKey={SUGGESTION.room(place.id)} what="Vorschlag „Räume“" />
        </div>
      )}
      {adding && (
        <div className="wf-welt-rooms__add">
          <TextArea
            autoFocus
            rows={4}
            value={lines}
            placeholder={'Eine Zeile je Raum:\n1 Torhaus – Fallgitter, zwei Wachen\n2 Große Halle'}
            onChange={(event) => setLines(event.target.value)}
          />
          <div className="wf-welt-rooms__add-bar">
            <Button size="sm" onClick={() => setAdding(false)}>
              Abbrechen
            </Button>
            <Button size="sm" icon={<Plus />} disabled={!lines.trim()} onClick={add}>
              Eintragen
            </Button>
          </div>
        </div>
      )}
      <div className="wf-welt-rooms">
        {rooms.map((room) => {
          const shown = open === room.id;
          return (
            <div key={room.id} className={cx('wf-welt-room', shown && 'wf-welt-room--open')}>
              <button
                type="button"
                className="wf-welt-room__head"
                aria-expanded={shown}
                onClick={() => setOpen(shown ? null : room.id)}
              >
                {shown ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
                <span className="wf-welt-room__name">{room.name}</span>
                {room.tagline && <span className="wf-welt-room__line">{room.tagline}</span>}
                <span className="wf-grow" />
                {room.id === data.state.placeId && (
                  <Badge tone="gold" icon={<Footprints />}>
                    Gruppe
                  </Badge>
                )}
                {room.place.roomState && (
                  <span className="wf-welt-room__state">{room.place.roomState}</span>
                )}
              </button>
              {shown && (
                <div className="wf-welt-room__body">
                  {roomText(data, room) ? (
                    <p className="wf-welt-room__notes">{roomText(data, room)}</p>
                  ) : (
                    <p className="wf-welt-room__notes wf-mute">
                      Noch keine Notizen zu diesem Raum.
                    </p>
                  )}
                  <label className="wf-welt-room__state-edit">
                    <span>Stand</span>
                    <Input
                      defaultValue={room.place.roomState}
                      placeholder="frei, verschlossen, eingestürzt, Falle …"
                      onBlur={(event) => setRoomState(db, room.id, event.target.value)}
                    />
                  </label>
                  <div className="wf-welt-room__links">
                    <Link href={entityHref(room)} className="wf-welt-room__link">
                      <DoorOpen aria-hidden /> Seite des Raums
                    </Link>
                    <button
                      type="button"
                      className="wf-welt-room__link"
                      onClick={() => unRoom(room)}
                    >
                      Zum eigenen Eintrag machen
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
