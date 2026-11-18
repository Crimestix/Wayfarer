/**
 * „Räume“ auf der Seite eines Ortes: seine Etagen von oben nach unten, darunter ihre Räume – Name,
 * eine Zeile, Art, Stand, aufklappbar mit den Notizen. Räume und Etagen stehen bei ihrem Ort
 * (`domain/rooms.ts`: `houseOf`); was für ein Raum es ist, sagt seine Unterkategorie.
 */
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronDown,
  ChevronRight,
  DoorOpen,
  Footprints,
  Plus,
} from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { SUGGESTION } from '../../domain/dismiss';
import { ownKindOf } from '../../domain/ownKind';
import {
  floorCandidates,
  houseOf,
  roomCandidates,
  roomSources,
  roomText,
  type HouseFloor,
} from '../../domain/rooms';
import type { Place } from '../../domain/schema';
import {
  Badge,
  Button,
  DismissButton,
  IconButton,
  Input,
  Select,
  TextArea,
  cx,
  entityHref,
  toast,
} from '../../ui';
import { Hint, Section } from './parts';
import { RoomSourcesDialog } from './RoomSourcesDialog';
import { addRooms, moveFloor, moveRoom, setFloors, setRoomState, setRooms } from './rooms';

export function RoomsSection({ place }: { place: Place }) {
  const db = useDb();
  const data = useData();
  const house = houseOf(data, place.id);
  const candidates = roomCandidates(data, place.id);
  const floorLike = floorCandidates(data, place.id);
  const written = useMemo(() => roomSources(data, place.id).length, [data, place.id]);
  const [open, setOpen] = useState<string | null>(null);
  const [shut, setShut] = useState<ReadonlySet<string>>(() => new Set());
  const [adding, setAdding] = useState(false);
  const [taking, setTaking] = useState(false);
  const [lines, setLines] = useState('');

  const add = () => {
    const made = addRooms(db, place.id, lines);
    setLines('');
    setAdding(false);
    const floors = made.filter((entry) => entry.place.floor).length;
    const rooms = made.length - floors;
    if (made.length)
      toast({
        title: [
          floors && (floors === 1 ? 'eine Etage' : `${floors} Etagen`),
          rooms && (rooms === 1 ? 'ein Raum' : `${rooms} Räume`),
        ]
          .filter(Boolean)
          .join(' und ')
          .replace(/^./, (first) => first.toLocaleUpperCase('de'))
          .concat(' angelegt'),
      });
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
      body: 'Sie stehen jetzt hier bei ihrem Ort, nicht mehr einzeln zwischen den Orten der Welt.',
      action: { label: 'Rückgängig', run: undo },
    });
  };
  const convertFloors = () => {
    const undo = setFloors(
      db,
      floorLike.map((p) => p.id),
    );
    toast({
      title:
        floorLike.length === 1
          ? `„${floorLike[0]!.name}“ ist jetzt eine Etage`
          : `${floorLike.length} Orte sind jetzt Etagen`,
      body: 'Ihre Räume stehen hier unter ihnen. Die Reihenfolge änderst du mit den Pfeilen.',
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

  const fromWritten = written > 0 && (
    <Button
      size="sm"
      variant="ghost"
      icon={<BookOpen />}
      title="Was unter diesem Ort schon geschrieben steht, wird zu seinen Etagen und Räumen"
      onClick={() => setTaking(true)}
    >
      Aus Artikeln …
    </Button>
  );
  const dialog = taking && <RoomSourcesDialog place={place} onClose={() => setTaking(false)} />;

  if (!house.total && !house.hasFloors && !candidates.length && !floorLike.length && !adding)
    return (
      <Section title="Räume">
        <Hint
          action={
            <>
              {fromWritten}
              <Button size="sm" icon={<Plus />} onClick={() => setAdding(true)}>
                Räume eintragen
              </Button>
            </>
          }
        >
          Hat dieser Ort Räume oder Etagen – eine Festung, ein Verlies, ein Haus? Sie stehen dann
          hier bei ihm.
        </Hint>
        {dialog}
      </Section>
    );

  const roomRow = (room: Place, entry: HouseFloor) => {
    const shown = open === room.id;
    const kind = ownKindOf(data, room)?.name ?? room.place.category.trim();
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
          {kind && <span className="wf-welt-room__kind">{kind}</span>}
          {room.place.roomState && (
            <span className="wf-welt-room__state">{room.place.roomState}</span>
          )}
        </button>
        {shown && (
          <div className="wf-welt-room__body">
            {roomText(data, room) ? (
              <p className="wf-welt-room__notes">{roomText(data, room)}</p>
            ) : (
              <p className="wf-welt-room__notes wf-mute">Noch keine Notizen zu diesem Raum.</p>
            )}
            <label className="wf-welt-room__state-edit">
              <span>Stand</span>
              <Input
                defaultValue={room.place.roomState}
                placeholder="frei, verschlossen, eingestürzt, Falle …"
                onBlur={(event) => setRoomState(db, room.id, event.target.value)}
              />
            </label>
            {house.hasFloors && (
              <label className="wf-welt-room__state-edit">
                <span>Etage</span>
                <Select
                  value={entry.floor?.id ?? ''}
                  aria-label={`Etage von ${room.name}`}
                  onChange={(event) => moveRoom(db, room.id, event.target.value || place.id)}
                >
                  <option value="">ohne Etage</option>
                  {house.floors.map(
                    ({ floor }) =>
                      floor && (
                        <option key={floor.id} value={floor.id}>
                          {floor.name}
                        </option>
                      ),
                  )}
                </Select>
              </label>
            )}
            <div className="wf-welt-room__links">
              <Link href={entityHref(room)} className="wf-welt-room__link">
                <DoorOpen aria-hidden /> Seite des Raums
              </Link>
              <button type="button" className="wf-welt-room__link" onClick={() => unRoom(room)}>
                Zum eigenen Eintrag machen
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <Section
      title="Räume"
      count={house.total || undefined}
      action={
        <span className="wf-row" style={{ gap: 'var(--s-1)' }}>
          {fromWritten}
          <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setAdding(true)}>
            Räume
          </Button>
        </span>
      }
    >
      {floorLike.length > 0 && (
        <div className="wf-welt-rooms__offer">
          <span>
            {floorLike.length === 1
              ? `„${floorLike[0]!.name}“ sieht aus wie eine Etage dieses Ortes.`
              : `${floorLike.length} Orte darunter sehen aus wie Etagen (${floorLike
                  .slice(0, 3)
                  .map((p) => p.name)
                  .join(', ')}${floorLike.length > 3 ? ' …' : ''}).`}{' '}
            Als Etagen stehen sie hier, mit ihren Räumen darunter.
          </span>
          <Button size="sm" onClick={convertFloors}>
            Als Etagen führen
          </Button>
          <DismissButton suggestionKey={SUGGESTION.floor(place.id)} what="Vorschlag „Etagen“" />
        </div>
      )}
      {candidates.length > 0 && (
        <div className="wf-welt-rooms__offer">
          <span>
            {candidates.length === 1
              ? `„${candidates[0]!.name}“ sieht aus wie ein Raum dieses Ortes.`
              : `${candidates.length} Orte darunter sehen aus wie Räume (${candidates[0]!.place.category}).`}{' '}
            Als Räume stehen sie hier bei ihrem Ort.
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
            rows={6}
            value={lines}
            placeholder={
              'Eine Zeile je Raum:\n1 Torhaus – Fallgitter, zwei Wachen\n2 Große Halle\n\nKeller:\nWeinkeller\nGruft – noch nicht betreten'
            }
            onChange={(event) => setLines(event.target.value)}
          />
          <p className="wf-welt-rooms__add-hint">
            Für eine Etage: ihr Name mit Doppelpunkt („Keller:“), darunter ihre Räume. Eine
            Leerzeile beendet sie. Etagen stehen in der Reihenfolge, in der du sie schreibst – von
            oben nach unten.
          </p>
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
        {house.floors.map((entry, index) => {
          const { floor, rooms } = entry;
          if (!floor)
            return (
              <div key="ohne" className="wf-welt-floor">
                {house.hasFloors && (
                  <div className="wf-welt-floor__head wf-welt-floor__head--plain">
                    <span className="wf-welt-floor__name">Ohne Etage</span>
                    <span className="wf-welt-floor__count">{rooms.length}</span>
                  </div>
                )}
                {rooms.map((room) => roomRow(room, entry))}
              </div>
            );
          const closed = shut.has(floor.id);
          const last = house.floors.filter((other) => other.floor).length - 1;
          return (
            <div key={floor.id} className="wf-welt-floor">
              <div className="wf-welt-floor__head">
                <button
                  type="button"
                  className="wf-welt-floor__toggle"
                  aria-expanded={!closed}
                  onClick={() =>
                    setShut((current) => {
                      const next = new Set(current);
                      if (closed) next.delete(floor.id);
                      else next.add(floor.id);
                      return next;
                    })
                  }
                >
                  {closed ? <ChevronRight aria-hidden /> : <ChevronDown aria-hidden />}
                  <span className="wf-welt-floor__name">{floor.name}</span>
                  <span className="wf-welt-floor__count">{rooms.length}</span>
                  {floor.tagline && <span className="wf-welt-room__line">{floor.tagline}</span>}
                </button>
                {floor.id === data.state.placeId && (
                  <Badge tone="gold" icon={<Footprints />}>
                    Gruppe
                  </Badge>
                )}
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={`${floor.name} nach oben rücken`}
                  disabled={index === 0}
                  onClick={() => moveFloor(db, floor.id, -1)}
                >
                  <ArrowUp />
                </IconButton>
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={`${floor.name} nach unten rücken`}
                  disabled={index >= last}
                  onClick={() => moveFloor(db, floor.id, 1)}
                >
                  <ArrowDown />
                </IconButton>
                <Link
                  href={entityHref(floor)}
                  className="wf-welt-room__link"
                  title="Seite der Etage"
                >
                  <DoorOpen aria-hidden /> Seite
                </Link>
              </div>
              {!closed &&
                (rooms.length ? (
                  rooms.map((room) => roomRow(room, entry))
                ) : (
                  <p className="wf-welt-floor__empty">
                    Noch kein Raum auf dieser Etage – über „+ Räume“ („{floor.name}:“ und darunter
                    ihre Räume) oder am Raum unter „Etage“.
                  </p>
                ))}
            </div>
          );
        })}
      </div>
      {dialog}
    </Section>
  );
}
