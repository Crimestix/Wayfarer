/**
 * Rechts neben der Karte: was das Werkzeug braucht, was am Gewählten steht (Raum, Tür, Falle,
 * Etagenwechsel, Markierung) und – ohne Auswahl – was auf der Ebene liegt und was noch nicht
 * zusammenpasst.
 */
import { ArrowDown, ArrowUp, CornerDownRight, Crosshair, Trash2, Unlink } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import {
  BEHAVE_LABEL,
  EDGE_LABEL,
  edgeName,
  edgeRun,
  patchDweller,
  patchEdgeRun,
  removeDweller,
  removeEdgeRun,
  SAVE_LABEL,
  STAIR_LABEL,
  THING_LABEL,
  TILE_LABEL,
  TRAP_SPOT_RANGE,
  areaWords,
  cellsOfEdge,
  dissolveRoom,
  dungeonNotes,
  extendRoom,
  findStair,
  isFloor,
  levelBeside,
  linkWords,
  levelsSorted,
  moveLevel,
  patchMarker,
  patchRoomEverywhere,
  patchStair,
  patchTrap,
  removeLevel,
  removeMarker,
  removeStair,
  removeTrap,
  roomAnchor,
  roomCells,
  roomSize,
  roomSpan,
  roundOf,
  stairLine,
  thingName,
  toggleMarkerLink,
  trapLine,
  unlinkStair,
  withLevel,
} from '../../domain/dungeon';
import {
  DUNGEON_BEHAVES,
  DUNGEON_EDGES,
  DUNGEON_SAVES,
  DUNGEON_STAIRS,
  DUNGEON_THINGS,
  DUNGEON_TILES,
  type DungeonDweller,
  type DungeonEdge,
  type DungeonEdgeKind,
  type DungeonLevel,
  type DungeonMarker,
  type DungeonRoom,
  type DungeonStair,
  type DungeonTrap,
} from '../../domain/schema';
import {
  Button,
  Checkbox,
  Field,
  IconButton,
  Input,
  Panel,
  Select,
  Written,
  confirmDialog,
  useHoldDraft,
} from '../../ui';
import { PICK_MODE_TEXT, TOOL_HINT, TOOL_LABEL, hasSize, type DungeonEditor } from './editor';

// ── Bausteine ──────────────────────────────────────────────────────────────

/** Eine Zahl (SG), geschrieben beim Verlassen des Feldes; leer = nicht festgelegt. */
function DcField({
  label,
  value,
  onSave,
}: {
  label: string;
  value: number | null;
  onSave: (value: number | null) => void;
}) {
  const shown = value === null ? '' : String(value);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  useHoldDraft(text !== shown, 'dungeon-dc');
  const commit = () => {
    const clean = text.trim();
    const parsed = clean === '' ? null : Math.max(0, Math.min(40, Math.round(Number(clean))));
    if (parsed !== null && Number.isNaN(parsed)) {
      setText(shown);
      return;
    }
    if (parsed !== value) onSave(parsed);
    else setText(shown);
  };
  return (
    <Field label={label} className="wf-dungeon-dc">
      <Input
        inputMode="numeric"
        value={text}
        placeholder="–"
        aria-label={label}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </Field>
  );
}

function Segments<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { id: T; label: string; title?: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="wf-btn-group wf-dungeon-segments" role="group" aria-label={label}>
      {options.map((option) => (
        <Button
          key={option.id}
          size="sm"
          aria-pressed={value === option.id}
          title={option.title}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

function SizePick({ editor }: { editor: DungeonEditor }) {
  return (
    <span className="wf-dungeon-size" role="group" aria-label="Pinselgröße">
      {[1, 2, 3, 4, 5].map((size) => (
        <button
          key={size}
          type="button"
          aria-pressed={editor.size === size}
          title={`${size} × ${size} Felder`}
          onClick={() => editor.setSize(size)}
        >
          {size}
        </button>
      ))}
    </span>
  );
}

const EDGE_CHOICES: readonly DungeonEdgeKind[] = [
  'door',
  'open',
  'gate',
  'secret',
  'window',
  'curtain',
  'false',
];

// ── Das Werkzeug ───────────────────────────────────────────────────────────

export function ToolPanel({ editor }: { editor: DungeonEditor }) {
  const { tool, level } = editor;
  return (
    <Panel
      title={TOOL_LABEL[tool]}
      actions={hasSize(tool) ? <SizePick editor={editor} /> : undefined}
    >
      <div className="wf-dungeon-toolpanel">
        <p className="wf-dungeon-hint">{TOOL_HINT[tool]}</p>
        {tool === 'room' && (
          <Segments
            label="Form des Raums"
            value={editor.roomShape}
            onChange={editor.setRoomShape}
            options={[
              { id: 'rect', label: 'Eckig' },
              {
                id: 'round',
                label: 'Rund',
                title: 'Kreis oder Oval – je nachdem, wie du aufziehst',
              },
            ]}
          />
        )}
        {tool === 'marker' && (
          <div className="wf-dungeon-tiles" role="group" aria-label="Was hingestellt wird">
            {DUNGEON_THINGS.map((kind) => (
              <button
                key={kind}
                type="button"
                className="wf-dungeon-tile"
                aria-pressed={editor.markerKind === kind}
                onClick={() => editor.setMarkerKind(kind)}
              >
                {THING_LABEL[kind]}
              </button>
            ))}
          </div>
        )}
        {tool === 'floor' && (
          <div className="wf-dungeon-tiles" role="group" aria-label="Was gemalt wird">
            {DUNGEON_TILES.map((tile) => (
              <button
                key={tile}
                type="button"
                className="wf-dungeon-tile"
                data-tile={tile}
                aria-pressed={editor.tile === tile}
                onClick={() => editor.setTile(tile)}
              >
                <span className="wf-dungeon-tile__swatch" aria-hidden />
                {TILE_LABEL[tile]}
              </button>
            ))}
          </div>
        )}
        {tool === 'door' && (
          <Segments
            label="Was auf die Kante kommt"
            value={editor.edgeKind}
            onChange={editor.setEdgeKind}
            options={EDGE_CHOICES.map((kind) => ({ id: kind, label: EDGE_LABEL[kind] }))}
          />
        )}
        {tool === 'stair' && (
          <Field label="Art">
            <Select
              value={editor.stairKind}
              onChange={(event) =>
                editor.setStairKind(event.target.value as (typeof DUNGEON_STAIRS)[number])
              }
            >
              {DUNGEON_STAIRS.map((kind) => (
                <option key={kind} value={kind}>
                  {STAIR_LABEL[kind]}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {tool === 'area' && level && (
          <Field label="Raum" hint="„kein Raum“ nimmt den Boden aus seinem Raum heraus.">
            <Select
              value={editor.areaRoomId ?? ''}
              onChange={(event) => editor.setAreaRoomId(event.target.value || null)}
            >
              <option value="">kein Raum</option>
              {level.rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name.trim() || 'Raum ohne Namen'}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </Panel>
  );
}

// ── Das Gewählte ───────────────────────────────────────────────────────────

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <IconButton label={label} size="sm" variant="ghost" onClick={onClick}>
      <Trash2 />
    </IconButton>
  );
}

function RoomBox({
  editor,
  level,
  room,
}: {
  editor: DungeonEditor;
  level: DungeonLevel;
  room: DungeonRoom;
}) {
  const cells = roomCells(level, room.id);
  const feet = editor.dungeon.cellFeet;
  const round = roundOf(level, room);
  const span = roomSpan(editor.dungeon, room);
  const patch = (change: Partial<Pick<DungeonRoom, 'name' | 'note'>>) =>
    editor.apply((d) => patchRoomEverywhere(d, level.id, room.id, change));
  const extend = (dir: 'up' | 'down') => {
    let made: { levelId: string; roomId: string } | null = null;
    editor.apply((d) => {
      const result = extendRoom(d, level.id, room.id, dir);
      if (!result) return d;
      made = { levelId: result.levelId, roomId: result.roomId };
      return result.dungeon;
    });
    const target = made as { levelId: string; roomId: string } | null;
    if (target)
      editor.reveal(target.levelId, { type: 'room', id: target.roomId }, roomAnchor(cells));
  };
  const reaches = (dir: 'up' | 'down') => {
    const beside = levelBeside(editor.dungeon, level.id, dir);
    return !!beside && span.some((other) => other.level.id === beside.id);
  };
  return (
    <Panel
      title={round ? 'Runder Raum' : 'Raum'}
      actions={
        <RemoveButton
          label="Raum auflösen – der Boden bleibt"
          onClick={() => {
            editor.applyLevel((lv) => dissolveRoom(lv, room.id));
            editor.setSelection(null);
          }}
        />
      }
    >
      <div className="wf-dungeon-form">
        <Field label="Name">
          <Written
            label="Name des Raums"
            value={room.name}
            placeholder="Wie heißt der Raum?"
            selectAll
            onSave={(name) => patch({ name })}
          />
        </Field>
        <p className="wf-dungeon-fact">
          {[
            round
              ? `${round.w * feet} × ${round.h * feet} Fuß im Durchmesser`
              : roomSize(cells, feet),
            areaWords(cells.length, feet),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <Field label="Nur für dich">
          <Written
            label="Notiz zum Raum"
            grow
            value={room.note}
            placeholder="Was ist hier? Was fällt auf?"
            onSave={(note) => patch({ note })}
          />
        </Field>
        <Button
          size="sm"
          onClick={() => {
            editor.setAreaRoomId(room.id);
            editor.setTool('area');
          }}
        >
          Fläche ändern
        </Button>

        <div className="wf-dungeon-span">
          <h4 className="wf-section-title">Über mehrere Ebenen</h4>
          {span.length === 0 ? (
            <p className="wf-dungeon-hint">
              Eine Halle mit Galerie, ein Turm, ein Schacht: Setz den Raum auf der Ebene darüber
              oder darunter fort – er bleibt ein Raum.
            </p>
          ) : (
            span.map((other) => (
              <Row
                key={other.room.id}
                sub="derselbe Raum"
                onClick={() =>
                  editor.reveal(
                    other.level.id,
                    { type: 'room', id: other.room.id },
                    roomAnchor(roomCells(other.level, other.room.id)),
                  )
                }
              >
                {other.level.name.trim() || 'Ebene'}
              </Row>
            ))
          )}
          <div className="wf-dungeon-span__actions">
            <Button
              size="sm"
              icon={<ArrowUp />}
              disabled={reaches('up')}
              title="Auf der Ebene darüber entsteht Luftraum über diesem Raum – man sieht hinab."
              onClick={() => extend('up')}
            >
              Nach oben
            </Button>
            <Button
              size="sm"
              icon={<ArrowDown />}
              disabled={reaches('down')}
              title="Auf der Ebene darunter entsteht derselbe Raum als Boden."
              onClick={() => extend('down')}
            >
              Nach unten
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function EdgeBox({
  editor,
  level,
  edgeKey,
  edge,
}: {
  editor: DungeonEditor;
  level: DungeonLevel;
  edgeKey: string;
  edge: DungeonEdge;
}) {
  // Eine Doppeltür ist eine Tür: Was hier steht, gilt auf ganzer Breite.
  const width = edgeRun(level, edgeKey).length;
  const patch = (change: Partial<DungeonEdge>) =>
    editor.applyLevel((lv) => patchEdgeRun(lv, edgeKey, change));
  const { a, b } = cellsOfEdge(edgeKey);
  const intoRock = !(isFloor(level, a) && isFloor(level, b));
  const closes = edge.kind === 'door' || edge.kind === 'gate' || edge.kind === 'secret';
  return (
    <Panel
      title={edgeName(edge.kind, width)}
      actions={
        <RemoveButton
          label="Entfernen"
          onClick={() => {
            editor.applyLevel((lv) => removeEdgeRun(lv, edgeKey));
            editor.setSelection(null);
          }}
        />
      }
    >
      <div className="wf-dungeon-form">
        <Field label="Art">
          <Select
            value={edge.kind}
            onChange={(event) => patch({ kind: event.target.value as DungeonEdgeKind })}
          >
            {DUNGEON_EDGES.map((kind) => (
              <option key={kind} value={kind}>
                {EDGE_LABEL[kind]}
              </option>
            ))}
          </Select>
        </Field>
        {width > 1 && (
          <p className="wf-dungeon-fact">{width * editor.dungeon.cellFeet} Fuß breit</p>
        )}
        {intoRock && !['wall', 'window', 'false'].includes(edge.kind) && (
          <p className="wf-dungeon-warn">Führt in den Fels – dahinter ist noch kein Boden.</p>
        )}
        {closes && (
          <>
            <div className="wf-dungeon-checks">
              {edge.kind !== 'secret' && (
                <Checkbox checked={edge.opened} onChange={(opened) => patch({ opened })}>
                  steht offen
                </Checkbox>
              )}
              <Checkbox checked={edge.locked} onChange={(locked) => patch({ locked })}>
                verschlossen
              </Checkbox>
            </div>
            <div className="wf-dungeon-dcs">
              {edge.kind === 'secret' && (
                <DcField
                  label="Finden SG"
                  value={edge.findDc}
                  onSave={(findDc) => patch({ findDc })}
                />
              )}
              {edge.locked && (
                <DcField
                  label="Schloss SG"
                  value={edge.lockDc}
                  onSave={(lockDc) => patch({ lockDc })}
                />
              )}
              <DcField
                label="Aufbrechen SG"
                value={edge.breakDc}
                onSave={(breakDc) => patch({ breakDc })}
              />
            </div>
          </>
        )}
        <Field label="Nur für dich">
          <Written
            label="Notiz"
            grow
            value={edge.note}
            placeholder={
              edge.kind === 'secret'
                ? 'Wie öffnet sie sich? Woran erkennt man sie?'
                : 'Wer hat den Schlüssel? Was ist dahinter?'
            }
            onSave={(note) => patch({ note })}
          />
        </Field>
      </div>
    </Panel>
  );
}

function TrapBox({ editor, trap }: { editor: DungeonEditor; trap: DungeonTrap }) {
  const patch = (change: Partial<Omit<DungeonTrap, 'id'>>) =>
    editor.applyLevel((lv) => patchTrap(lv, trap.id, change));
  const mode = editor.pickMode;
  const picking = (type: 'trap-cells' | 'trap-spots') =>
    mode?.type === type && mode.trapId === trap.id;
  const togglePick = (type: 'trap-cells' | 'trap-spots') =>
    editor.setPickMode(picking(type) ? null : { type, trapId: trap.id });
  const line = trapLine(trap);
  return (
    <Panel
      title="Falle"
      actions={
        <RemoveButton
          label="Falle entfernen"
          onClick={() => {
            editor.setPickMode(null);
            editor.applyLevel((lv) => removeTrap(lv, trap.id));
            editor.setSelection(null);
          }}
        />
      }
    >
      <div className="wf-dungeon-form">
        <Field label="Name">
          <Written
            label="Name der Falle"
            value={trap.name}
            placeholder="Was für eine Falle ist das?"
            onSave={(name) => patch({ name })}
          />
        </Field>
        {line && <p className="wf-dungeon-fact">{line}</p>}

        <div className="wf-dungeon-pickrow">
          <span>
            Löst aus auf {trap.cells.length === 1 ? '1 Feld' : `${trap.cells.length} Feldern`}
          </span>
          <Button
            size="sm"
            aria-pressed={picking('trap-cells')}
            onClick={() => togglePick('trap-cells')}
          >
            {picking('trap-cells') ? 'Fertig' : 'Felder wählen'}
          </Button>
        </div>
        <div className="wf-dungeon-pickrow">
          <span>
            Zu bemerken{' '}
            {trap.spots.length === 0
              ? `von ringsum (${TRAP_SPOT_RANGE * editor.dungeon.cellFeet} Fuß)`
              : trap.spots.length === 1
                ? 'von 1 Feld'
                : `von ${trap.spots.length} Feldern`}
          </span>
          <span className="wf-dungeon-pickrow__actions">
            {trap.spots.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => patch({ spots: [] })}>
                ringsum
              </Button>
            )}
            <Button
              size="sm"
              aria-pressed={picking('trap-spots')}
              onClick={() => togglePick('trap-spots')}
            >
              {picking('trap-spots') ? 'Fertig' : 'Felder wählen'}
            </Button>
          </span>
        </div>

        <div className="wf-dungeon-dcs">
          <DcField label="Bemerken SG" value={trap.findDc} onSave={(findDc) => patch({ findDc })} />
          <DcField
            label="Entschärfen SG"
            value={trap.disarmDc}
            onSave={(disarmDc) => patch({ disarmDc })}
          />
        </div>
        <div className="wf-dungeon-dcs wf-dungeon-dcs--wide">
          <Field label="Rettungswurf">
            <Select
              value={trap.save}
              onChange={(event) => patch({ save: event.target.value as DungeonTrap['save'] })}
            >
              {DUNGEON_SAVES.map((save) => (
                <option key={save} value={save}>
                  {save === 'none' ? 'keiner' : SAVE_LABEL[save]}
                </option>
              ))}
            </Select>
          </Field>
          {trap.save !== 'none' && (
            <DcField label="SG" value={trap.saveDc} onSave={(saveDc) => patch({ saveDc })} />
          )}
        </div>
        <Field label="Schaden">
          <Written
            label="Schaden"
            value={trap.damage}
            placeholder="2W10 Stich"
            onSave={(damage) => patch({ damage })}
          />
        </Field>
        <Field label="Was geschieht">
          <Written
            label="Was geschieht"
            grow
            value={trap.effect}
            placeholder="Was löst sie aus – in deinen Worten?"
            onSave={(effect) => patch({ effect })}
          />
        </Field>
        <Checkbox checked={trap.once} onChange={(once) => patch({ once })}>
          löst nur einmal aus
        </Checkbox>
        <Field label="Nur für dich">
          <Written
            label="Notiz zur Falle"
            grow
            value={trap.note}
            placeholder="Wie lässt sie sich umgehen?"
            onSave={(note) => patch({ note })}
          />
        </Field>
      </div>
    </Panel>
  );
}

function StairBox({
  editor,
  level,
  stair,
}: {
  editor: DungeonEditor;
  level: DungeonLevel;
  stair: DungeonStair;
}) {
  const ref = { levelId: level.id, stairId: stair.id };
  const patch = (change: Partial<Omit<DungeonStair, 'id'>>) =>
    editor.applyLevel((lv) => patchStair(lv, stair.id, change));
  const partner = findStair(editor.dungeon, stair.to);
  const picking = editor.pickMode?.type === 'stair-target';
  return (
    <Panel
      title="Etagenwechsel"
      actions={
        <RemoveButton
          label="Etagenwechsel entfernen"
          onClick={() => {
            editor.setPickMode(null);
            editor.apply((d) => removeStair(d, ref));
            editor.setSelection(null);
          }}
        />
      }
    >
      <div className="wf-dungeon-form">
        <div className="wf-dungeon-dcs">
          <Field label="Art">
            <Select
              value={stair.kind}
              onChange={(event) => patch({ kind: event.target.value as DungeonStair['kind'] })}
            >
              {DUNGEON_STAIRS.map((kind) => (
                <option key={kind} value={kind}>
                  {STAIR_LABEL[kind]}
                </option>
              ))}
            </Select>
          </Field>
          {stair.kind !== 'portal' && (
            <Field label="Führt">
              <Select
                value={stair.dir}
                disabled={!!partner && partner.level.order !== level.order}
                title={partner ? 'Folgt der Lage der beiden Ebenen' : undefined}
                onChange={(event) => patch({ dir: event.target.value as 'up' | 'down' })}
              >
                <option value="up">hinauf</option>
                <option value="down">hinab</option>
              </Select>
            </Field>
          )}
        </div>

        <div className="wf-dungeon-target">
          <span className="wf-dungeon-target__label">Ziel</span>
          {partner ? (
            <>
              <span className="wf-dungeon-target__name">
                {partner.level.name.trim() || 'Ebene'}
                {partner.level.id === level.id ? ' (diese Ebene)' : ''}
              </span>
              <IconButton
                label="Dorthin springen"
                size="sm"
                onClick={() =>
                  editor.reveal(
                    partner.level.id,
                    { type: 'stair', id: partner.stair.id },
                    { x: partner.stair.x, y: partner.stair.y },
                  )
                }
              >
                <CornerDownRight />
              </IconButton>
              <IconButton
                label="Verbindung lösen"
                size="sm"
                variant="ghost"
                onClick={() => editor.apply((d) => unlinkStair(d, ref))}
              >
                <Unlink />
              </IconButton>
            </>
          ) : (
            <span className="wf-dungeon-warn">noch keines</span>
          )}
        </div>
        <Button
          size="sm"
          icon={<Crosshair />}
          aria-pressed={picking}
          onClick={() => editor.setPickMode(picking ? null : { type: 'stair-target', from: ref })}
        >
          {picking ? 'Abbrechen' : partner ? 'Anderes Ziel wählen' : 'Ziel wählen'}
        </Button>

        <div className="wf-dungeon-checks">
          <Checkbox checked={!stair.usable} onChange={(only) => patch({ usable: !only })}>
            nur Ankunft – von hier führt kein Weg zurück
          </Checkbox>
          <Checkbox checked={stair.locked} onChange={(locked) => patch({ locked })}>
            verschlossen
          </Checkbox>
          <Checkbox checked={stair.secret} onChange={(secret) => patch({ secret })}>
            verborgen, bis gefunden
          </Checkbox>
        </div>
        {stair.secret && (
          <div className="wf-dungeon-dcs">
            <DcField
              label="Finden SG"
              value={stair.findDc}
              onSave={(findDc) => patch({ findDc })}
            />
          </div>
        )}
        <Field label="Nur für dich">
          <Written
            label="Notiz zum Etagenwechsel"
            grow
            value={stair.note}
            placeholder="Wie tief? Was hört man von unten?"
            onSave={(note) => patch({ note })}
          />
        </Field>
      </div>
    </Panel>
  );
}

function MarkerBox({ editor, marker }: { editor: DungeonEditor; marker: DungeonMarker }) {
  const patch = (change: Partial<Omit<DungeonMarker, 'id'>>) =>
    editor.applyLevel((lv) => patchMarker(lv, marker.id, change));
  const linking = editor.pickMode?.type === 'marker-link' && editor.pickMode.markerId === marker.id;
  return (
    <Panel
      title={THING_LABEL[marker.kind]}
      actions={
        <RemoveButton
          label="Entfernen"
          onClick={() => {
            editor.applyLevel((lv) => removeMarker(lv, marker.id));
            editor.setSelection(null);
          }}
        />
      }
    >
      <div className="wf-dungeon-form">
        <Field label="Was ist es">
          <Select
            value={marker.kind}
            onChange={(event) => patch({ kind: event.target.value as DungeonMarker['kind'] })}
          >
            {DUNGEON_THINGS.map((kind) => (
              <option key={kind} value={kind}>
                {THING_LABEL[kind]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Beschriftung">
          <Written
            label="Beschriftung"
            value={marker.label}
            placeholder="Steht neben dem Zeichen auf der Karte"
            autoFocus={!marker.label && marker.kind === 'note'}
            onSave={(label) => patch({ label })}
          />
        </Field>
        <div className="wf-dungeon-span">
          <h4 className="wf-section-title">Wirkt auf</h4>
          {marker.links.length === 0 ? (
            <p className="wf-dungeon-hint">
              Ein Hebel, eine Druckplatte, ein Rad: Wähle, was geschieht, wenn jemand es benutzt.
            </p>
          ) : (
            marker.links.map((link) => (
              <div key={`${link.kind}:${link.levelId}:${link.ref}`} className="wf-dungeon-pickrow">
                <span>{linkWords(editor.dungeon, link) ?? 'gibt es nicht mehr'}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => editor.applyLevel((lv) => toggleMarkerLink(lv, marker.id, link))}
                >
                  lösen
                </Button>
              </div>
            ))
          )}
          <Button
            size="sm"
            icon={<Crosshair />}
            aria-pressed={linking}
            onClick={() =>
              editor.setPickMode(linking ? null : { type: 'marker-link', markerId: marker.id })
            }
          >
            {linking ? 'Fertig' : 'Ziel wählen'}
          </Button>
        </div>
        <Field label="Nur für dich">
          <Written
            label="Notiz zur Markierung"
            grow
            value={marker.note}
            placeholder="Was ist damit?"
            onSave={(note) => patch({ note })}
          />
        </Field>
      </div>
    </Panel>
  );
}

function DwellerBox({ editor, dweller }: { editor: DungeonEditor; dweller: DungeonDweller }) {
  const patch = (change: Partial<Omit<DungeonDweller, 'id'>>) =>
    editor.applyLevel((lv) => patchDweller(lv, dweller.id, change));
  const routing =
    editor.pickMode?.type === 'dweller-route' && editor.pickMode.dwellerId === dweller.id;
  return (
    <Panel
      title="Bewohner"
      actions={
        <RemoveButton
          label="Bewohner entfernen"
          onClick={() => {
            editor.setPickMode(null);
            editor.applyLevel((lv) => removeDweller(lv, dweller.id));
            editor.setSelection(null);
          }}
        />
      }
    >
      <div className="wf-dungeon-form">
        <Field label="Name">
          <Written
            label="Name des Bewohners"
            value={dweller.name}
            selectAll
            onSave={(name) => patch({ name })}
          />
        </Field>
        <Field label="Was er tut">
          <Select
            value={dweller.behave}
            onChange={(event) => patch({ behave: event.target.value as DungeonDweller['behave'] })}
          >
            {DUNGEON_BEHAVES.map((behave) => (
              <option key={behave} value={behave}>
                {BEHAVE_LABEL[behave]}
              </option>
            ))}
          </Select>
        </Field>
        {dweller.behave === 'patrol' && (
          <div className="wf-dungeon-pickrow">
            <span>
              {dweller.route.length === 0
                ? 'Noch ohne Wegpunkte'
                : dweller.route.length === 1
                  ? 'Runde über 1 Wegpunkt'
                  : `Runde über ${dweller.route.length} Wegpunkte`}
            </span>
            <span className="wf-dungeon-pickrow__actions">
              {dweller.route.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => patch({ route: [] })}>
                  leeren
                </Button>
              )}
              <Button
                size="sm"
                aria-pressed={routing}
                onClick={() =>
                  editor.setPickMode(
                    routing ? null : { type: 'dweller-route', dwellerId: dweller.id },
                  )
                }
              >
                {routing ? 'Fertig' : 'Wegpunkte wählen'}
              </Button>
            </span>
          </div>
        )}
        <div className="wf-dungeon-dcs">
          <DcField
            label="Bewegung"
            value={dweller.speed}
            onSave={(speed) => patch({ speed: Math.min(300, speed ?? 30) })}
          />
          <DcField
            label="Trefferpunkte"
            value={dweller.hp}
            onSave={(hp) => patch({ hp: hp || null })}
          />
        </div>
        <div className="wf-dungeon-dcs">
          <DcField
            label="Initiative +"
            value={dweller.initBonus}
            onSave={(initBonus) => patch({ initBonus: Math.min(20, initBonus ?? 0) })}
          />
        </div>
        <Field label="Nur für dich">
          <Written
            label="Notiz zum Bewohner"
            grow
            value={dweller.note}
            placeholder="Was will er? Wie reagiert er auf die Gruppe?"
            onSave={(note) => patch({ note })}
          />
        </Field>
      </div>
    </Panel>
  );
}

/** Was gewählt ist – oder nichts, wenn nichts gewählt ist. */
export function SelectionPanel({ editor }: { editor: DungeonEditor }) {
  const { level, selection } = editor;
  if (!level || !selection) return null;
  if (selection.type === 'room') {
    const room = level.rooms.find((r) => r.id === selection.id);
    return room ? <RoomBox key={room.id} editor={editor} level={level} room={room} /> : null;
  }
  if (selection.type === 'edge') {
    const edge = level.edges[selection.key];
    return edge ? (
      <EdgeBox
        key={selection.key}
        editor={editor}
        level={level}
        edgeKey={selection.key}
        edge={edge}
      />
    ) : null;
  }
  if (selection.type === 'trap') {
    const trap = level.traps.find((t) => t.id === selection.id);
    return trap ? <TrapBox key={trap.id} editor={editor} trap={trap} /> : null;
  }
  if (selection.type === 'stair') {
    const stair = level.stairs.find((s) => s.id === selection.id);
    return stair ? <StairBox key={stair.id} editor={editor} level={level} stair={stair} /> : null;
  }
  if (selection.type === 'dweller') {
    const dweller = level.dwellers.find((d) => d.id === selection.id);
    return dweller ? <DwellerBox key={dweller.id} editor={editor} dweller={dweller} /> : null;
  }
  const marker = level.markers.find((m) => m.id === selection.id);
  return marker ? <MarkerBox key={marker.id} editor={editor} marker={marker} /> : null;
}

/** Die Zeile über der Karte, solange Felder oder ein Ziel gewählt werden. */
export function PickBanner({ editor }: { editor: DungeonEditor }) {
  const mode = editor.pickMode;
  if (!mode) return null;
  return (
    <div className="wf-dungeon-banner" role="status">
      <span>{PICK_MODE_TEXT[mode.type]}</span>
      <Button size="sm" onClick={() => editor.setPickMode(null)}>
        {mode.type === 'stair-target' ? 'Abbrechen' : 'Fertig'}
      </Button>
    </div>
  );
}

// ── Die Ebene im Überblick ─────────────────────────────────────────────────

function Row({
  children,
  sub,
  onClick,
}: {
  children: ReactNode;
  sub?: string | undefined;
  onClick: () => void;
}) {
  return (
    <button type="button" className="wf-dungeon-row" onClick={onClick}>
      <span className="wf-dungeon-row__name wf-clamp-1">{children}</span>
      {sub && <span className="wf-dungeon-row__sub wf-clamp-1">{sub}</span>}
    </button>
  );
}

export function LevelPanel({ editor }: { editor: DungeonEditor }) {
  const { level, dungeon } = editor;
  if (!level) return null;
  const sorted = levelsSorted(dungeon);
  const index = sorted.findIndex((l) => l.id === level.id);
  const rename = (name: string) =>
    editor.apply((d) => withLevel(d, level.id, (lv) => ({ ...lv, name: name.trim() || lv.name })));
  const remove = async () => {
    const ok = await confirmDialog({
      title: `„${level.name || 'Ebene'}“ löschen?`,
      body: 'Die Ebene verschwindet mit allem, was darauf liegt. Strg+Z holt sie zurück.',
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (ok) editor.apply((d) => removeLevel(d, level.id));
  };
  const empty =
    level.rooms.length +
      level.traps.length +
      level.stairs.length +
      level.markers.length +
      level.dwellers.length ===
    0;
  return (
    <Panel
      title="Diese Ebene"
      actions={
        <span className="wf-dungeon-levelactions">
          <IconButton
            label="Weiter nach oben"
            size="sm"
            variant="ghost"
            disabled={index <= 0}
            onClick={() => editor.apply((d) => moveLevel(d, level.id, 'up'))}
          >
            <ArrowUp />
          </IconButton>
          <IconButton
            label="Weiter nach unten"
            size="sm"
            variant="ghost"
            disabled={index >= sorted.length - 1}
            onClick={() => editor.apply((d) => moveLevel(d, level.id, 'down'))}
          >
            <ArrowDown />
          </IconButton>
          <IconButton
            label="Ebene löschen"
            size="sm"
            variant="ghost"
            disabled={sorted.length <= 1}
            onClick={remove}
          >
            <Trash2 />
          </IconButton>
        </span>
      }
    >
      <div className="wf-dungeon-form">
        <Field label="Name">
          <Written label="Name der Ebene" value={level.name} selectAll onSave={rename} />
        </Field>
        <Checkbox
          checked={level.lit}
          onChange={(lit) => editor.apply((d) => withLevel(d, level.id, (lv) => ({ ...lv, lit })))}
        >
          hier ist es hell (Tageslicht, Fackeln an den Wänden)
        </Checkbox>
        {empty && (
          <p className="wf-dungeon-hint">
            Noch leer. Zieh mit „Raum“ einen ersten Raum auf oder male mit „Boden“ einen Gang.
          </p>
        )}
        {level.rooms.length > 0 && (
          <div className="wf-dungeon-list">
            <h4 className="wf-section-title">Räume</h4>
            {level.rooms.map((room) => {
              const cells = roomCells(level, room.id);
              return (
                <Row
                  key={room.id}
                  sub={
                    roomSize(cells, dungeon.cellFeet) ?? areaWords(cells.length, dungeon.cellFeet)
                  }
                  onClick={() =>
                    editor.reveal(level.id, { type: 'room', id: room.id }, roomAnchor(cells))
                  }
                >
                  {room.name.trim() || 'Raum ohne Namen'}
                </Row>
              );
            })}
          </div>
        )}
        {level.traps.length > 0 && (
          <div className="wf-dungeon-list">
            <h4 className="wf-section-title">Fallen</h4>
            {level.traps.map((trap) => (
              <Row
                key={trap.id}
                sub={trapLine(trap) || undefined}
                onClick={() =>
                  editor.reveal(level.id, { type: 'trap', id: trap.id }, trap.cells[0] ?? null)
                }
              >
                {trap.name.trim() || 'Falle ohne Namen'}
              </Row>
            ))}
          </div>
        )}
        {level.stairs.length > 0 && (
          <div className="wf-dungeon-list">
            <h4 className="wf-section-title">Etagenwechsel</h4>
            {level.stairs.map((stair) => (
              <Row
                key={stair.id}
                onClick={() =>
                  editor.reveal(
                    level.id,
                    { type: 'stair', id: stair.id },
                    { x: stair.x, y: stair.y },
                  )
                }
              >
                {stairLine(dungeon, stair)}
              </Row>
            ))}
          </div>
        )}
        {level.dwellers.length > 0 && (
          <div className="wf-dungeon-list">
            <h4 className="wf-section-title">Bewohner</h4>
            {level.dwellers.map((dweller) => (
              <Row
                key={dweller.id}
                sub={BEHAVE_LABEL[dweller.behave]}
                onClick={() =>
                  editor.reveal(
                    level.id,
                    { type: 'dweller', id: dweller.id },
                    { x: dweller.x, y: dweller.y },
                  )
                }
              >
                {dweller.name.trim() || 'Bewohner'}
              </Row>
            ))}
          </div>
        )}
        {level.markers.length > 0 && (
          <div className="wf-dungeon-list">
            <h4 className="wf-section-title">Einrichtung und Notizen</h4>
            {level.markers.map((marker) => (
              <Row
                key={marker.id}
                onClick={() =>
                  editor.reveal(
                    level.id,
                    { type: 'marker', id: marker.id },
                    { x: marker.x, y: marker.y },
                  )
                }
              >
                {thingName(marker)}
              </Row>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

/** Was noch nicht zusammenpasst – über alle Ebenen, nur als Hinweis. */
export function NotesPanel({ editor }: { editor: DungeonEditor }) {
  const notes = dungeonNotes(editor.dungeon);
  if (notes.length === 0) return null;
  const nameOf = (levelId: string) =>
    editor.dungeon.levels.find((level) => level.id === levelId)?.name.trim() || 'Ebene';
  return (
    <Panel title="Passt noch nicht" count={notes.length}>
      <div className="wf-dungeon-list">
        {notes.map((note) => (
          <Row
            key={note.key}
            sub={editor.dungeon.levels.length > 1 ? nameOf(note.levelId) : undefined}
            onClick={() => editor.reveal(note.levelId, note.pick, note.cell)}
          >
            {note.text}
          </Row>
        ))}
      </div>
    </Panel>
  );
}
