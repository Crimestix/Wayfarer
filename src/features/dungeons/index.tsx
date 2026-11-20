/**
 * Dungeons: Orte mit Räumen und Ebenen, gebaut auf einem Raster von fünf Fuß. Links die Liste,
 * in der Mitte die Karte mit Werkzeugleiste, rechts Werkzeug und Gewähltes. Der Bereich steht
 * vorerst für sich (Wunsch des Spielleiters, 18. 11. 2026) – die Verbindung zur Welt folgt.
 */
import { MaterialBack } from '../welt/MaterialBox';
import { currentSession } from '../../domain/derive';
import { currentWorkView, localWorkView } from '../../shell/workView';
import {
  BrickWall,
  DoorClosed,
  DoorOpen,
  Eraser,
  Layers,
  LayersPlus,
  MapPin,
  Maximize,
  Mountain,
  MousePointer2,
  Paintbrush,
  Plus,
  Redo2,
  Shapes,
  Skull,
  Slash,
  SquareDashed,
  Zap,
  ChartNoAxesColumn,
  Square,
  Trash2,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useData, useDb } from '../../data/hooks';
import {
  addLevel,
  levelLine,
  levelsSorted,
  removeDweller,
  removeZone,
  removeEdgeRun,
  removeMarker,
  removeStair,
  removeTrap,
  dissolveRoom,
} from '../../domain/dungeon';
import type { Dungeon, DungeonPlay } from '../../domain/schema';
import {
  Button,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Written,
  confirmDialog,
  toast,
} from '../../ui';
import { newDungeon, patchDungeon, removeDungeon } from './actions';
import { DungeonCanvas } from './DungeonCanvas';
import {
  TOOL_GROUPS,
  TOOL_HINT,
  TOOL_KEY,
  TOOL_LABEL,
  hasSize,
  isTyping,
  toolOfKey,
  useDungeonEditor,
  type DungeonEditor,
  type Tool,
} from './editor';
import { LevelPanel, NotesPanel, PickBanner, SelectionPanel, ToolPanel } from './Inspector';
import { PlayPanel } from './PlayPanel';
import { usePlay, type DungeonPlayer } from './usePlay';
import './dungeons.css';

const TOOL_ICON: Record<Tool, ReactNode> = {
  select: <MousePointer2 />,
  room: <Square />,
  floor: <Paintbrush />,
  rock: <Mountain />,
  area: <Shapes />,
  wall: <BrickWall />,
  door: <DoorClosed />,
  trap: <TriangleAlert />,
  stair: <Layers />,
  marker: <MapPin />,
  dweller: <Skull />,
  zone: <Zap />,
  height: <ChartNoAxesColumn />,
  corner: <Slash />,
  region: <SquareDashed />,
  erase: <Eraser />,
};

const byName = (a: Dungeon, b: Dungeon) => a.name.localeCompare(b.name, 'de');

export default function DungeonsPage() {
  const data = useData();
  const db = useDb();
  const { id } = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const [creating, setCreating] = useState(false);
  const dungeons = useMemo(() => Object.values(data.dungeons).sort(byName), [data.dungeons]);
  const dungeon = id ? data.dungeons[id] : dungeons[0];

  return (
    <div className="wf-dungeon">
      <aside className="wf-dungeon-side" aria-label="Dungeons">
        <div className="wf-dungeon-side__head">
          <span className="wf-dungeon-side__title">Dungeons</span>
          <Button size="sm" icon={<Plus />} onClick={() => setCreating(true)}>
            Neu
          </Button>
        </div>
        <div className="wf-dungeon-side__list">
          {dungeons.length === 0 && (
            <p className="wf-dungeon-side__none">Hier stehen später deine Dungeons.</p>
          )}
          {dungeons.map((d) => (
            <Link
              key={d.id}
              href={`/dungeons/${d.id}`}
              className="wf-dungeon-item"
              aria-current={d.id === dungeon?.id ? 'page' : undefined}
            >
              <span className="wf-dungeon-item__name wf-clamp-1">{d.name}</span>
              <span className="wf-dungeon-item__sub wf-clamp-1">
                {d.levels.length === 1 ? '1 Ebene' : `${d.levels.length} Ebenen`}
              </span>
            </Link>
          ))}
        </div>
      </aside>

      {dungeon ? (
        <DungeonView key={dungeon.id} dungeon={dungeon} />
      ) : (
        <div className="wf-dungeon-empty">
          <EmptyState
            icon={<DoorOpen />}
            title={id ? 'Diesen Dungeon gibt es nicht mehr' : 'Noch kein Dungeon'}
            action={
              <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
                Dungeon anlegen
              </Button>
            }
          >
            Ein Dungeon ist jeder Ort mit Räumen und Ebenen – ein Haus, eine Gruft, eine Bucht mit
            Lagerhallen. Du baust ihn auf einem Raster von fünf Fuß: Räume, Gänge, Türen,
            Geheimtüren, Fallen und Wege zwischen den Ebenen.
          </EmptyState>
        </div>
      )}

      {creating && (
        <CreateDialog
          onClose={() => setCreating(false)}
          onCreate={(name) => {
            const made = newDungeon(db, name);
            if (made) navigate(`/dungeons/${made.id}`);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

function CreateDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState('');
  return (
    <Dialog
      open
      title="Neuer Dungeon"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={() => onCreate(name)}>
            Anlegen
          </Button>
        </>
      }
    >
      <Field label="Name" hint="Gebaut wird gleich danach – mit einer ersten, leeren Ebene.">
        <Input
          autoFocus
          value={name}
          placeholder="Wie heißt er?"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && name.trim()) onCreate(name);
          }}
        />
      </Field>
    </Dialog>
  );
}

/** Die Tasten des Editors: Werkzeuge, Rückgängig, Pinselgröße, Ebenen, Löschen. */
function useEditorKeys(editor: DungeonEditor, on: boolean) {
  useEffect(() => {
    if (!on) return;
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      // Ein offener Dialog hat die Tasten für sich.
      if (document.querySelector('[role="dialog"]')) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key;
      if (mod && key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) editor.redo();
        else editor.undo();
        return;
      }
      if (mod && key.toLowerCase() === 'y') {
        event.preventDefault();
        editor.redo();
        return;
      }
      if (mod || event.altKey) return;
      if (key === 'Escape') {
        if (editor.pickMode) editor.setPickMode(null);
        else editor.setSelection(null);
        return;
      }
      if ((key === 'Delete' || key === 'Backspace') && editor.selection && editor.level) {
        event.preventDefault();
        const pick = editor.selection;
        const levelId = editor.level.id;
        if (pick.type === 'stair')
          editor.apply((d) => removeStair(d, { levelId, stairId: pick.id }));
        else if (pick.type === 'trap') editor.applyLevel((lv) => removeTrap(lv, pick.id));
        else if (pick.type === 'marker') editor.applyLevel((lv) => removeMarker(lv, pick.id));
        else if (pick.type === 'dweller') editor.applyLevel((lv) => removeDweller(lv, pick.id));
        else if (pick.type === 'zone') editor.applyLevel((lv) => removeZone(lv, pick.id));
        else if (pick.type === 'edge') editor.applyLevel((lv) => removeEdgeRun(lv, pick.key));
        else editor.applyLevel((lv) => dissolveRoom(lv, pick.id));
        editor.setSelection(null);
        return;
      }
      if (key === ',' && hasSize(editor.tool)) return editor.setSize(Math.max(1, editor.size - 1));
      if (key === '.' && hasSize(editor.tool)) return editor.setSize(Math.min(5, editor.size + 1));
      if (key === 'PageUp' || key === 'PageDown') {
        const sorted = levelsSorted(editor.dungeon);
        const index = sorted.findIndex((level) => level.id === editor.level?.id);
        const next = sorted[key === 'PageUp' ? index - 1 : index + 1];
        if (next) {
          event.preventDefault();
          editor.openLevel(next.id);
        }
        return;
      }
      if (key.length !== 1) return;
      const found = toolOfKey(key);
      if (!found) return;
      editor.setTool(found.tool);
      if (found.edgeKind) editor.setEdgeKind(found.edgeKind);
      else if (found.tool === 'door' && editor.edgeKind === 'secret') editor.setEdgeKind('door');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor, on]);
}

/** Die Tasten am Tisch: Zurück, Auswahl aufheben, Zug beenden, Ebenen. */
function usePlayKeys(player: DungeonPlayer, editor: DungeonEditor, on: boolean) {
  useEffect(() => {
    if (!on) return;
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || document.querySelector('[role="dialog"]')) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        player.back();
        return;
      }
      if (mod || event.altKey) return;
      if (event.key === 'Escape') {
        if (player.placing) player.setPlacing(null);
        else if (player.pick) player.setPick(null);
        else player.setSelected([]);
      } else if (event.key === 'Enter' && player.play?.rounds) {
        event.preventDefault();
        player.endTurn();
      } else if (event.key === 'PageUp' || event.key === 'PageDown') {
        const sorted = levelsSorted(editor.dungeon);
        const index = sorted.findIndex((level) => level.id === editor.level?.id);
        const next = sorted[event.key === 'PageUp' ? index - 1 : index + 1];
        if (next) {
          event.preventDefault();
          editor.openLevel(next.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player, editor, on]);
}

function ToolRail({ editor }: { editor: DungeonEditor }) {
  return (
    <div className="wf-dungeon-rail">
      <IconButton
        label="Rückgängig (Strg+Z)"
        size="sm"
        disabled={!editor.canUndo}
        onClick={editor.undo}
      >
        <Undo2 />
      </IconButton>
      <IconButton
        label="Wiederholen (Strg+Y)"
        size="sm"
        disabled={!editor.canRedo}
        onClick={editor.redo}
      >
        <Redo2 />
      </IconButton>
      {TOOL_GROUPS.map((group, index) => (
        <div key={index} className="wf-dungeon-rail__group" role="group">
          {group.map((tool) => (
            <button
              key={tool}
              type="button"
              className="wf-dungeon-rail__tool"
              aria-pressed={editor.tool === tool}
              aria-label={`${TOOL_LABEL[tool]} (${TOOL_KEY[tool]})`}
              title={`${TOOL_LABEL[tool]} (${TOOL_KEY[tool]}) – ${TOOL_HINT[tool]}`}
              onClick={() => editor.setTool(tool)}
            >
              {TOOL_ICON[tool]}
              <kbd>{TOOL_KEY[tool]}</kbd>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Der Stand am Tisch, der während eines Probelaufs beiseite liegt – je Dungeon. Nur im
 * Arbeitsspeicher: Der Probelauf endet beim Verlassen der Seite und legt ihn wieder hin.
 */
const trialStash = new Map<string, DungeonPlay | null>();

function DungeonView({ dungeon: stored }: { dungeon: Dungeon }) {
  const db = useDb();
  const [, navigate] = useLocation();
  const editor = useDungeonEditor(db, stored);
  // Beginnt passend zur Arbeitsansicht (F13); umschalten lässt sich jederzeit.
  const [mode, setMode] = useState<'prep' | 'play'>(() =>
    localWorkView(currentWorkView(currentSession(db.getSnapshot()) !== null), true),
  );
  const playing = mode === 'play';
  const player = usePlay(db, editor.dungeon, editor);
  const [trial, setTrial] = useState(() => trialStash.has(stored.id));
  const startTrial = () => {
    trialStash.set(stored.id, editor.dungeon.play);
    db.patch('dungeons', stored.id, { play: null });
    setTrial(true);
    setMode('play');
  };
  const endTrial = () => {
    if (!trialStash.has(stored.id)) return;
    db.patch('dungeons', stored.id, { play: trialStash.get(stored.id) ?? null });
    trialStash.delete(stored.id);
    setTrial(false);
    setMode('prep');
  };
  // Wer die Seite mitten im Probelauf verlässt, findet den Stand am Tisch wieder vor.
  useEffect(
    () => () => {
      if (!trialStash.has(stored.id)) return;
      db.patch('dungeons', stored.id, { play: trialStash.get(stored.id) ?? null });
      trialStash.delete(stored.id);
    },
    [db, stored.id],
  );
  useEditorKeys(editor, !playing);
  usePlayKeys(player, editor, playing);
  const { dungeon, level } = editor;
  const sorted = levelsSorted(dungeon);

  const addLevelAt = (where: 'above' | 'below') => {
    let levelId = '';
    editor.apply((d) => {
      const made = addLevel(d, where);
      levelId = made.level.id;
      return made.dungeon;
    });
    if (levelId) editor.openLevel(levelId);
  };

  const remove = async () => {
    const ok = await confirmDialog({
      title: `„${dungeon.name}“ löschen?`,
      body: 'Der Dungeon verschwindet mit allen Ebenen.',
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    const undo = removeDungeon(db, dungeon.id);
    navigate('/dungeons');
    if (undo)
      toast({
        title: `„${dungeon.name}“ gelöscht.`,
        action: {
          label: 'Rückgängig',
          run: () => {
            undo();
            navigate(`/dungeons/${dungeon.id}`);
          },
        },
      });
  };

  return (
    <>
      <section className="wf-dungeon-stage">
        <header className="wf-dungeon-head">
          <div className="wf-dungeon-head__main">
            <Written
              className="wf-dungeon-head__name"
              label="Name des Dungeons"
              value={dungeon.name}
              onSave={(name) => patchDungeon(db, dungeon.id, { name })}
            />
            <p className="wf-dungeon-head__facts">
              {level ? `${level.name || 'Ebene'} · ${levelLine(level)}` : ''} · ein Feld ={' '}
              {dungeon.cellFeet} Fuß
            </p>
            <MaterialBack refTo={{ type: 'dungeon', id: dungeon.id }} />
          </div>
          <div className="wf-dungeon-head__tools">
            <div className="wf-btn-group" role="group" aria-label="Ansicht">
              <Button size="sm" aria-pressed={!playing} onClick={() => setMode('prep')}>
                Vorbereiten
              </Button>
              <Button size="sm" aria-pressed={playing} onClick={() => setMode('play')}>
                Spielen
              </Button>
            </div>
            {trial ? (
              <Button
                size="sm"
                title="Beendet den Probelauf. Der Stand am Tisch liegt danach wieder da wie vorher."
                onClick={endTrial}
              >
                Probelauf beenden
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                title="Den Dungeon einmal durchgehen, ohne den Stand am Tisch anzurühren."
                onClick={startTrial}
              >
                Probelauf
              </Button>
            )}
            <Button
              size="sm"
              aria-pressed={editor.ghost}
              disabled={sorted.length < 2}
              title="Die Ebene darunter (sonst die darüber) scheint blass durch – zum Ausrichten von Treppen."
              onClick={() => editor.setGhost(!editor.ghost)}
            >
              Nachbarebene zeigen
            </Button>
            <IconButton label="Alles ins Bild" size="sm" onClick={editor.fit}>
              <Maximize />
            </IconButton>
            <IconButton label="Dungeon löschen" size="sm" variant="ghost" onClick={remove}>
              <Trash2 />
            </IconButton>
          </div>
        </header>

        <div className="wf-dungeon-levels" role="tablist" aria-label="Ebenen">
          <IconButton
            label="Neue Ebene darüber"
            size="sm"
            variant="ghost"
            onClick={() => addLevelAt('above')}
          >
            <LayersPlus />
          </IconButton>
          {sorted.map((lv) => (
            <button
              key={lv.id}
              type="button"
              role="tab"
              className="wf-dungeon-level"
              aria-selected={lv.id === level?.id}
              title={levelLine(lv)}
              onClick={() => editor.openLevel(lv.id)}
            >
              {lv.name.trim() || 'Ebene'}
            </button>
          ))}
          <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => addLevelAt('below')}>
            Ebene darunter
          </Button>
        </div>

        <div className="wf-dungeon-work" data-mode={mode}>
          {/* Die Leiste bleibt auch am Tisch stehen: So liegt die Karte beim Umschalten an derselben Stelle. */}
          <aside className="wf-dungeon-work__rail" aria-label={playing ? 'Am Tisch' : 'Werkzeuge'}>
            {playing ? (
              <div className="wf-dungeon-rail">
                <IconButton
                  label="Zurück (Strg+Z)"
                  size="sm"
                  disabled={!player.canBack}
                  onClick={player.back}
                >
                  <Undo2 />
                </IconButton>
              </div>
            ) : (
              <ToolRail editor={editor} />
            )}
          </aside>
          <div className="wf-dungeon-map">
            {!playing && <PickBanner editor={editor} />}
            {level && <DungeonCanvas editor={editor} play={playing ? player.control : null} />}
            <div className="wf-dungeon-keys" aria-hidden>
              {playing
                ? 'Feld anklicken: dorthin gehen · Figur ziehen: von Hand versetzen · Strg+Z: zurück · rechte Maustaste: Karte verschieben'
                : 'Rad: vergrößern · Leertaste oder rechte Maustaste: verschieben · Bild auf/ab: Ebene'}
            </div>
          </div>
        </div>
      </section>

      <aside className="wf-dungeon-detail">
        {playing ? (
          <PlayPanel player={player} editor={editor} />
        ) : (
          <>
            <ToolPanel editor={editor} />
            <SelectionPanel editor={editor} />
            {!editor.selection && <LevelPanel editor={editor} />}
            <NotesPanel editor={editor} />
          </>
        )}
      </aside>
    </>
  );
}
