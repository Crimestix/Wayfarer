/**
 * Das Fadenbrett: eine Pinnwand. Geschichten liegen als Karten darauf, daneben die Personen, Orte
 * und Fraktionen, an denen sie hängen – verbunden durch Fäden. Wo zwei Karten am selben Namen
 * hängen, berühren sich ihre Geschichten. Alles lässt sich frei legen; was der Spielleiter nicht
 * hingelegt hat, legt Wayfarer aus. Lose Fäden stehen in der Liste daneben (`LooseDrawer`) – aufs
 * Brett kommt einer nur, wenn der Spielleiter ihn hinlegt oder ins Spiel nimmt; von dort (und aus
 * der Liste) lässt er sich auf eine Geschichte ziehen. Die Rechnung steht in `domain/story.ts`
 * und `domain/looseThreads.ts`.
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { useLocation } from 'wouter';
import {
  BookOpen,
  Frame,
  Eye,
  EyeOff,
  Flag,
  Check,
  DoorOpen,
  LayoutGrid,
  Link2,
  Maximize,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  TriangleAlert,
  Waypoints,
} from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { looseThreads, threadTwins } from '../../domain/looseThreads';
import {
  BOARD_CARD,
  ENTRY_STANDING_LABEL,
  NEARNESS_LABEL,
  PACE_LABEL,
  THREAD_STATE_LABEL,
  boardCards,
  boardLayout,
  entryFit,
  hitOnBoard,
  insideOnBoard,
  looseClocks,
  reputeOf,
  threadLive,
  threadWarning,
  touchReason,
  touches,
  untilText,
  type BoardCard,
  type BoardPin,
  type BoardView,
  type Spot,
  type Touch,
} from '../../domain/story';
import {
  THREAD_STATES,
  type Clock,
  type Entity,
  type Story,
  type Thread,
  type ThreadState,
} from '../../domain/schema';
import { dropSuggestions, pinExists } from '../../domain/threadWeb';
import {
  boardPiece,
  cardNames,
  freeSpot,
  frameReadiness,
  thingFace,
  linkOffers,
  stringPath,
  whiteboardCards,
  type BoardBox,
  type LinkOffer,
  type ThingFace,
} from '../../domain/whiteboard';
import { useMediaSrc } from '../../data/media';
import { searchWorld } from '../../shell/search';
import { areaAround, insideArea, type BoardArea } from '../../domain/boardAreas';
import { articleExcerpt } from '../tisch/wiki';
import { formatDayMonth } from '../../domain/time/calendar';
import { isNear } from '../../domain/weight';
import { openAttitude } from '../../shell/commands';
import { useFocus } from '../../shell/focus';
import {
  AttitudeBadge,
  Button,
  Checkbox,
  EmptyState,
  EntityPicker,
  IconButton,
  KindIcon,
  MenuItem,
  NamesHint,
  Popover,
  Select,
  Written,
  cx,
  entityHref,
  toast,
} from '../../ui';
import { useBoard } from '../../ui/board';
import { ClockDialog } from '../kalender/ClockDialog';
import {
  applyLinkOffer,
  bringOntoBoard,
  takeOffWhiteboard,
  patchStory,
  addBoardArea,
  addSubStory,
  setStoryParent,
  connectOnBoard,
  moveBoardArea,
  patchBoardArea,
  removeBoardArea,
  moveThread,
  newStory,
  pinToCard,
  placeManyOnBoard,
  placeOnBoard,
  takeFreeOffBoard,
  writeLinkedThread,
  writeOnBoard,
  writeThingOnBoard,
  removeBoardLink,
  setBoardLinkDir,
  setBoardLinkWord,
  setBoardNow,
  setBoardNote,
  setBoardStart,
  setAreaStory,
  setBoardPlayed,
  patchThread,
  setStringsHidden,
  setThreadOnBoard,
  setThreadState,
  storyFromClock,
  tidyBoard,
} from './actions';
import { RelationQuick } from '../welt/RelationQuick';
import { ThreadWeb, findHint } from './WebParts';
import { useHoldDraft } from '../../ui/drafts';
import { boardFinds, exactFind } from './finds';
import { FACT_LABEL, factKindOf } from '../../domain/boardFacts';
import { addFromWriting } from '../welt/writing';
import { KIND_LABEL } from '../../domain/derive';
import { CREATE_KINDS } from '../../domain/pick';
import type { EntityKind } from '../../domain/schema';
import { ThreadDialog } from './Dialogs';
import { AttachDialog } from './LooseDialogs';
import { LooseDrawer, THREAD_DRAG } from './LooseDrawer';
import './faeden.css';

/** Mit etwas Abstand zueinander, wenn mehrere Fäden auf einmal aufs Brett gezogen werden. */
const DROP_STEP = 36;

const upper = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

type OpenDialog =
  | { type: 'thread'; thread: Thread | null; storyId: string | null }
  /** Die Uhr einer Geschichte – `before`: welche Uhren es beim Öffnen schon gab. */
  | { type: 'clock'; clock: Clock | null; storyId: string; before: ReadonlySet<string> }
  /** Lose Fäden an eine Geschichte hängen. */
  | { type: 'attach'; ids: string[] }
  | null;

export default function FaedenPage() {
  const db = useDb();
  const data = useData();
  const [view, setView] = useState<BoardView>('truth');
  const truth = view === 'truth';
  /** Die gewählte Karte (`story:…`, `thread:…`) oder der gewählte Name (`node:…`, `article:…`). */
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);

  const cards = useMemo(() => boardCards(data, view), [data, view]);
  /** Was auf dem Whiteboard liegt: Geschichten, hingelegte Fäden – nichts hängt von selbst daran. */
  const board = useMemo(() => whiteboardCards(data, cards, view), [data, cards, view]);
  const open = useMemo(() => board.filter((card) => !card.closed), [board]);
  const links = useMemo(() => touches(cards.filter((c) => !c.closed && c.onBoard)), [cards]);
  const closed = cards.filter((card) => card.closed);
  /** Die losen Fäden – sie stehen in der Liste neben dem Brett. */
  const loose = useMemo(() => looseThreads(data, view, cards), [data, view, cards]);
  const twins = useMemo(() => threadTwins(data), [data]);
  const looseCount = loose.filter((row) => !row.resting).length;
  /** Uhren, die zu keiner Geschichte gehören – sie lassen sich zu einer machen. */
  const orphans = useMemo(() => looseClocks(data), [data]);
  const current =
    board.find((card) => card.key === selected) ??
    cards.find((card) => card.key === selected) ??
    null;
  /** Der Seitenteil: die gewählte Karte – oder die Liste der losen Fäden. */
  const [side, setSide] = useState<'card' | 'loose'>(() => (loose.length ? 'loose' : 'card'));
  const [looseFocus, setLooseFocus] = useState<string | null>(null);
  const [looseQuery, setLooseQuery] = useState('');
  const [loosePicked, setLoosePicked] = useState<ReadonlySet<string>>(new Set());
  const showCard = () => {
    setSide('card');
    setLooseFocus(null);
  };
  const showLoose = (threadId: string) => {
    setLooseFocus(threadId);
    setLooseQuery('');
    setSide('loose');
  };
  /** Wählt eine Karte. Ein loser Faden, der nicht auf dem Brett liegt, steht in der Liste. */
  const select = (key: string | null) => {
    const card = key ? cards.find((entry) => entry.key === key) : undefined;
    const lying = key ? board.some((entry) => entry.key === key) : false;
    if (card && !card.story && !card.closed && !lying) {
      showLoose(card.threads[0]!.id);
      setSelected(null);
      return;
    }
    setSelected(key);
    if (key) showCard();
  };
  useFocus(['card'], (focus) => select(focus.key));

  // Die Pinnwand: frei verschieben, vergrößern, Karten und Namen ziehen.
  const frame = useRef<HTMLDivElement>(null);
  const wall = useBoard(frame);
  /** Was gerade gezogen wird – je Stück seine Stelle, bis es losgelassen wird. */
  const [moving, setMoving] = useState<Record<string, Spot> | null>(null);
  /** Mehrere gewählte Stücke (Umschalt-Klick, Rahmen) – sie ziehen gemeinsam. */
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  /** Die gewählte Schnur (`state.boardLinks`). */
  const [lineKey, setLineKey] = useState<string | null>(null);
  const [band, setBand] = useState<{ a: Spot; b: Spot } | null>(null);
  /** Hier wird gerade ein Faden hingeschrieben (Doppelklick ins Leere). */
  const [drafting, setDrafting] = useState<Spot | null>(null);
  /** Was ein Doppelklick ins Leere zuletzt hingelegt hat – das nächste Mal dasselbe. */
  const [draftKind, setDraftKind] = useState<DraftKind>('note');
  /** Die Karte, auf der gerade geschrieben wird (Doppelklick auf die Karte). */
  const [editing, setEditing] = useState<string | null>(null);
  /** Wie groß Karten und Namen gerade sind – Pfeile enden an ihrem Rand. */
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});
  const [areaSel, setAreaSel] = useState<string | null>(null);
  /** „Nur diesen Rahmen zeigen“: alles außerhalb tritt zurück (Ansicht, nie Spielstand). */
  const [onlyArea, setOnlyArea] = useState<string | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [areaMove, setAreaMove] = useState<BoardArea | null>(null);
  /** Eine Schnur ins Leere: Hier wird gesucht, was an ihr Ende kommt. */
  const [dropAsk, setDropAsk] = useState<{ from: string; at: Spot } | null>(null);
  /** Zwei Namen: das Fenster für eine Beziehung der Welt. */
  const [relating, setRelating] = useState<{ self: Entity; otherId: string } | null>(null);
  /** Eine Schnur, die gerade gezogen wird – von wo, bis wohin. */
  const [linking, setLinking] = useState<{ from: string; start: Spot; end: Spot } | null>(null);
  const clearPicks = () => {
    setPicked(new Set());
    setLineKey(null);
    setAreaSel(null);
  };
  const [, navigate] = useLocation();
  /**
   * Eine neue Geschichte: Sie entsteht auf dem Brett, in der Mitte des Bildes, und man schreibt
   * gleich auf ihrer Karte – das Blatt öffnet sich erst auf Wunsch (Rundgang 17. 11.: „+ Geschichte“
   * führte vom Brett weg).
   */
  const write = () => {
    const story = newStory(db);
    const key = `story:${story.id}`;
    const at = freeSpot(
      [
        ...layout.pins,
        ...Object.values(layout.cards).map((card) => ({ x: card.x, y: card.y + 80 })),
      ],
      viewCenter(),
    );
    placeOnBoard(db, key, at.x, at.y);
    clearPicks();
    setSelected(key);
    showCard();
    setEditing(key);
    toast({
      slot: 'fadenbrett',
      title: 'Neue Geschichte auf dem Brett',
      body: 'Schreib Überschrift und ein paar Sätze auf die Karte.',
      action: { label: 'Blatt öffnen', run: () => navigate(`/geschichte/${story.id}`) },
    });
  };
  const placed = data.state.board;
  /** Namen und Artikel, die eine Stelle haben – sie liegen auf dem Brett. */
  const free = useMemo(
    () => Object.keys(placed).filter((key) => pinExists(data, key)),
    [placed, data],
  );
  const layout = useMemo(
    () => boardLayout(board, moving ? { ...placed, ...moving } : placed, [], free, placed),
    [board, placed, moving, free],
  );
  const pin = layout.pins.find((entry) => entry.key === selected) ?? null;
  /** Wo eine Schnur ansetzt: an einer Karte oben, an einem Namen in der Mitte. */
  const anchorOf = (key: string): Spot | null => {
    const card = layout.cards[key];
    if (card) return { x: card.x, y: card.y + 56 };
    const at = layout.pins.find((entry) => entry.key === key);
    return at ? { x: at.x, y: at.y } : null;
  };
  const spotOf = (key: string): Spot | null =>
    layout.cards[key] ?? layout.pins.find((entry) => entry.key === key) ?? null;
  /** Die Mitte dessen, was gerade im Bild ist – dort entsteht Neues. */
  const viewCenter = (): Spot => {
    const rect = frame.current?.getBoundingClientRect();
    return rect
      ? wall.toBoard(rect.left + rect.width / 2, rect.top + rect.height / 2)
      : { x: 0, y: 0 };
  };

  /** Eine Schnur vom Griff ziehen: auf ein Stück = verbunden; ins Leere = Suche dort. */
  const startLink = (key: string) => (event: PointerEvent) => {
    event.stopPropagation();
    const start = anchorOf(key);
    if (!start || !truth) return;
    const grip = wall.toBoard(event.clientX, event.clientY);
    wall.drag(event, {
      onMove: (dx, dy) => setLinking({ from: key, start, end: { x: grip.x + dx, y: grip.y + dy } }),
      onEnd: (moved, dx, dy) => {
        setLinking(null);
        if (!moved) return;
        const end = { x: grip.x + dx, y: grip.y + dy };
        const target = hitOnBoard(layout, end);
        if (!target) {
          setDropAsk({ from: key, at: end });
          return;
        }
        if (target === key) return;
        const result = connectOnBoard(db, key, target);
        if (result.done)
          toast({
            slot: 'fadenbrett',
            title: result.title,
            body: result.body,
            action: { label: 'Rückgängig', run: result.undo },
          });
        else if (result.note)
          toast({ slot: 'fadenbrett', title: 'Schon verbunden', body: result.note });
      },
    });
  };

  const showAll = (least?: number) =>
    wall.fit(
      [
        ...Object.values(layout.cards).flatMap((at) => [
          at,
          { x: at.x, y: at.y + BOARD_CARD.height },
        ]),
        ...layout.pins,
        ...data.state.boardAreas.flatMap((area) => [
          { x: area.x, y: area.y },
          { x: area.x + area.w, y: area.y + area.h },
        ]),
      ],
      140,
      least,
    );
  useLayoutEffect(() => showAll(0.62), []);
  const [arriving, setArriving] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!arriving || !layout.cards[arriving]) return;
    showAll();
    setArriving(null);
  }, [arriving, layout]);

  /** Der Kasten eines Stücks auf dem Brett – gemessen, sonst geschätzt. */
  const boxOf = (key: string): BoardBox | null => {
    const card = layout.cards[key];
    if (card) {
      const h = sizes[key]?.h ?? BOARD_CARD.height;
      return { cx: card.x, cy: card.y + h / 2, w: BOARD_CARD.width, h };
    }
    const at = layout.pins.find((entry) => entry.key === key);
    if (!at) return null;
    const size = sizes[key] ?? { w: 150, h: 34 };
    return { cx: at.x, cy: at.y, w: size.w, h: size.h };
  };
  // Größen messen, sobald etwas auf dem Brett anders aussieht.
  const layer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = layer.current;
    if (!root) return;
    const next: Record<string, { w: number; h: number }> = {};
    root.querySelectorAll<HTMLElement>('[data-card], [data-pin]').forEach((el) => {
      const key = el.dataset.card ?? el.dataset.pin;
      if (key) next[key] = { w: el.offsetWidth, h: el.offsetHeight };
    });
    const same =
      Object.keys(next).length === Object.keys(sizes).length &&
      Object.entries(next).every(
        ([key, size]) => sizes[key]?.w === size.w && sizes[key]?.h === size.h,
      );
    if (!same) setSizes(next);
  });

  /** Die Schnüre des Whiteboards – nur die, die der Spielleiter gezogen hat. */
  const linkStrings = data.state.boardLinks.flatMap((link) => {
    if (!truth) return [];
    const [a, b] = [boxOf(link.a), boxOf(link.b)];
    if (!a || !b) return [];
    return [{ link, ...stringPath(a, b, link.dir === 'to' ? 7 : 0) }];
  });
  /** Was zum Gewählten gehört – über seine Schnüre. Alles andere tritt zurück. */
  const related = useMemo(() => {
    if (!selected) return null;
    const keys = new Set([selected]);
    for (const link of data.state.boardLinks)
      if (link.a === selected || link.b === selected) {
        keys.add(link.a);
        keys.add(link.b);
      }
    return keys;
  }, [selected, data.state.boardLinks]);
  const chosen = linkStrings.find(({ link }) => link.id === lineKey) ?? null;
  const pickLine = (id: string) => (event: PointerEvent) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    setAreaSel(null);
    setSelected(null);
    setPicked(new Set());
    setLineKey(lineKey === id ? null : id);
  };
  const dropLine = (id: string) => {
    const undo = removeBoardLink(db, id);
    setLineKey(null);
    if (undo)
      toast({
        slot: 'fadenbrett',
        title: 'Schnur gelöst',
        body: 'Nur die Schnur – was du in der Welt eingetragen hast, bleibt.',
        action: { label: 'Rückgängig', run: undo },
      });
  };

  /** Nimmt die gewählten Stücke vom Brett – nie aus der Welt. */
  const takeOff = (keys: readonly string[]) => {
    const result = takeOffWhiteboard(db, keys);
    clearPicks();
    setSelected(null);
    toast({
      slot: 'fadenbrett',
      title: result.taken === 1 ? 'Vom Brett genommen' : `${result.taken} vom Brett genommen`,
      body: 'Nur vom Brett – in der Welt bleibt alles. Über die Suche oben links holst du es zurück.',
      ...(result.undo ? { action: { label: 'Rückgängig', run: result.undo } } : {}),
    });
  };
  // Entf (am Mac die Löschtaste): Schnur lösen oder Gewähltes vom Brett nehmen. Escape hebt auf.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'Escape') {
        clearPicks();
        setDrafting(null);
        setDropAsk(null);
        return;
      }
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (!truth) return;
      if (areaSel) {
        event.preventDefault();
        dropArea(areaSel);
        return;
      }
      if (lineKey) {
        event.preventDefault();
        dropLine(lineKey);
        return;
      }
      const keys = picked.size ? [...picked] : selected ? [selected] : [];
      if (!keys.length) return;
      event.preventDefault();
      takeOff(keys);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /** Ziehen legt hin, ein Klick wählt, Umschalt-Klick wählt dazu. Mehrere ziehen gemeinsam. */
  const grab = (key: string, at: Spot) => (event: PointerEvent) => {
    event.stopPropagation();
    setLineKey(null);
    setAreaSel(null);
    const shift = event.shiftKey;
    const group = picked.has(key) && picked.size > 1 ? [...picked] : [key];
    const base: Record<string, Spot> = {};
    for (const each of group) {
      const spot = each === key ? at : spotOf(each);
      if (spot) base[each] = { x: spot.x, y: spot.y };
    }
    const shifted = (dx: number, dy: number) =>
      Object.fromEntries(
        Object.entries(base).map(([each, spot]) => [each, { x: spot.x + dx, y: spot.y + dy }]),
      );
    wall.drag(event, {
      onMove: (dx, dy) => setMoving(shifted(dx, dy)),
      onEnd: (moved, dx, dy) => {
        setMoving(null);
        if (!moved) {
          if (shift) {
            const next = new Set(picked);
            if (selected && !next.size) next.add(selected);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            setPicked(next);
            setSelected(next.size === 1 ? [...next][0]! : null);
            return;
          }
          setPicked(new Set());
          select(key === selected ? null : key);
          return;
        }
        placeManyOnBoard(db, shifted(dx, dy));
      },
    });
  };

  const allAreas = data.state.boardAreas.map((area) =>
    areaMove && areaMove.id === area.id ? areaMove : area,
  );
  const shownArea = onlyArea ? (allAreas.find((area) => area.id === onlyArea) ?? null) : null;
  /** Was im gezeigten Rahmen liegt – null, wenn alles gezeigt wird. */
  const shownKeys = shownArea ? new Set(insideArea(layout, shownArea)) : null;
  const areas = shownArea ? [shownArea] : allAreas;
  const newArea = (keys: readonly string[]) => {
    const { area, undo } = addBoardArea(db, areaAround(layout, keys, viewCenter()));
    setSelected(null);
    setPicked(new Set());
    setLineKey(null);
    setAreaSel(area.id);
    setNaming(area.id);
    toast({
      slot: 'fadenbrett',
      title: 'Bereich angelegt',
      body: 'Gib ihm einen Namen – verschiebst du ihn, zieht mit, was darin liegt.',
      action: { label: 'Rückgängig', run: undo },
    });
  };
  const dropArea = (id: string) => {
    const area = data.state.boardAreas.find((entry) => entry.id === id);
    const undo = removeBoardArea(db, id);
    setAreaSel(null);
    if (undo)
      toast({
        slot: 'fadenbrett',
        title: 'Bereich weggenommen',
        body: `„${area?.title || 'Bereich ohne Namen'}“ – was darin lag, bleibt, wo es ist.`,
        action: { label: 'Rückgängig', run: undo },
      });
  };
  const grabArea = (area: BoardArea) => (event: PointerEvent) => {
    event.stopPropagation();
    if (naming === area.id) return;
    const inside = insideArea(layout, area);
    const base: Record<string, Spot> = {};
    for (const key of inside) {
      const spot = spotOf(key);
      if (spot) base[key] = { x: spot.x, y: spot.y };
    }
    const shifted = (dx: number, dy: number) =>
      Object.fromEntries(
        Object.entries(base).map(([key, spot]) => [key, { x: spot.x + dx, y: spot.y + dy }]),
      );
    wall.drag(event, {
      onMove: (dx, dy) => {
        setAreaMove({ ...area, x: area.x + dx, y: area.y + dy });
        setMoving(shifted(dx, dy));
      },
      onEnd: (moved, dx, dy) => {
        setAreaMove(null);
        setMoving(null);
        if (moved && truth) {
          moveBoardArea(db, area.id, { x: area.x + dx, y: area.y + dy }, shifted(dx, dy));
          return;
        }
        setSelected(null);
        setPicked(new Set());
        setLineKey(null);
        setAreaSel(area.id);
      },
    });
  };
  const resizeArea = (area: BoardArea) => (event: PointerEvent) => {
    event.stopPropagation();
    wall.drag(event, {
      onMove: (dx, dy) =>
        setAreaMove({ ...area, w: Math.max(220, area.w + dx), h: Math.max(140, area.h + dy) }),
      onEnd: (moved, dx, dy) => {
        setAreaMove(null);
        if (moved) patchBoardArea(db, area.id, { w: area.w + dx, h: area.h + dy });
      },
    });
  };
  const startBand = (event: PointerEvent) => {
    const a = wall.toBoard(event.clientX, event.clientY);
    wall.drag(event, {
      onMove: (dx, dy) => setBand({ a, b: { x: a.x + dx, y: a.y + dy } }),
      onEnd: (moved, dx, dy) => {
        setBand(null);
        if (!moved) return;
        const keys = insideOnBoard(layout, a, { x: a.x + dx, y: a.y + dy });
        setLineKey(null);
        setPicked(new Set(keys));
        setSelected(keys.length === 1 ? keys[0]! : null);
        if (keys.length) showCard();
      },
    });
  };
  /** Lose Fäden aus der Liste aufs Brett ziehen – sie liegen dort, wo sie losgelassen werden. */
  const dragged = (event: DragEvent): boolean => event.dataTransfer.types.includes(THREAD_DRAG);
  const drop = (event: DragEvent) => {
    if (!dragged(event)) return;
    event.preventDefault();
    let ids: string[] = [];
    try {
      ids = (JSON.parse(event.dataTransfer.getData(THREAD_DRAG)) as string[]).filter(
        (id) => data.threads[id] !== undefined,
      );
    } catch {
      return;
    }
    if (!ids.length) return;
    const at = wall.toBoard(event.clientX, event.clientY);
    const undos = db.batch(() =>
      ids.map((id, index) =>
        setThreadOnBoard(db, id, true, {
          x: at.x + index * DROP_STEP,
          y: at.y + index * DROP_STEP,
        }),
      ),
    );
    toast({
      slot: 'fadenbrett',
      title: ids.length === 1 ? 'Aufs Brett gelegt' : `${ids.length} Fäden aufs Brett gelegt`,
      body: 'Zieh eine Schnur von ihm weg – was sie bedeutet, wählst du an der Schnur.',
      action: {
        label: 'Rückgängig',
        run: () => db.batch(() => [...undos].reverse().forEach((undo) => undo?.())),
      },
    });
  };
  const tidy = () => {
    const undo = tidyBoard(db);
    requestAnimationFrame(() => showAll());
    toast({
      slot: 'fadenbrett',
      title: 'Brett aufgeräumt',
      body: 'Wayfarer hat die Geschichten neu ausgelegt; was du einzeln hingelegt hast, bleibt.',
      action: { label: 'Rückgängig', run: undo },
    });
  };
  /** Holt etwas aufs Brett (Suche) – in die Mitte des Bildes – und wählt es. */
  const bring = (key: string) => {
    const at = freeSpot(
      [
        ...layout.pins,
        ...Object.values(layout.cards).map((card) => ({ x: card.x, y: card.y + 80 })),
      ],
      viewCenter(),
    );
    const undo = bringOntoBoard(db, key, at);
    clearPicks();
    setSelected(key);
    showCard();
    if (undo)
      toast({
        slot: 'fadenbrett',
        title: 'Aufs Brett geholt',
        body: 'Zieh am Griff rechts eine Schnur zu etwas anderem.',
        action: { label: 'Rückgängig', run: undo },
      });
  };
  const hiddenStories = data.state.boardHidden.filter((key) => key.startsWith('story:'));
  const isEmpty = view === 'party' && cards.length === 0 && free.length === 0;

  return (
    <div className="wf-page wf-faden">
      <header className="wf-page__head wf-faden-head">
        <h1 className="wf-page__title">Fadenbrett</h1>
        <span className="wf-faden-head__sub">
          {count(open.filter((card) => card.story).length, 'Geschichte', 'Geschichten')} ·{' '}
          {count(looseCount, 'loser Faden', 'lose Fäden')}
        </span>
        <span className="wf-grow" />
        <div className="wf-btn-group" role="group" aria-label="Sicht">
          <Button
            icon={<Eye />}
            aria-pressed={view === 'truth'}
            title="Alles, was du weißt"
            onClick={() => setView('truth')}
          >
            Wahrheit
          </Button>
          <Button
            icon={<EyeOff />}
            aria-pressed={view === 'party'}
            title="Nur die Fäden, die die Gruppe kennt, und die Hinweise, die sie hat"
            onClick={() => setView('party')}
          >
            Was die Gruppe weiß
          </Button>
        </div>
        <Button
          icon={<Plus />}
          onClick={() => setDialog({ type: 'thread', thread: null, storyId: null })}
        >
          Faden
        </Button>
        <Button
          variant="primary"
          icon={<Plus />}
          onClick={write}
          title="Eine neue Geschichte schreiben"
        >
          Geschichte
        </Button>
      </header>

      {isEmpty ? (
        <div className="wf-faden-blank">
          <EmptyState
            icon={<Waypoints aria-hidden />}
            title={
              view === 'party' ? 'Die Gruppe kennt noch keinen Faden' : 'Noch keine Geschichte'
            }
          >
            {view === 'party'
              ? 'Sobald die Gruppe einen Faden kennt oder einen Hinweis findet, steht er hier.'
              : 'Das Fadenbrett ist dein Whiteboard: Leg Geschichten, Fäden, Personen und Orte hin und zieh Schnüre dazwischen. Was eine Schnur bedeutet, wählst du, wenn du willst.'}
          </EmptyState>
        </div>
      ) : (
        <div className="wf-faden-body" data-side={side}>
          <div
            ref={frame}
            className="wf-faden-wall"
            onPointerDown={(event) => {
              if (event.shiftKey) return startBand(event);
              wall.pan(event, () => {
                setSelected(null);
                clearPicks();
              });
            }}
            onDoubleClick={(event) => {
              if (truth) setDrafting(wall.toBoard(event.clientX, event.clientY));
            }}
            onDragOver={(event) => {
              if (!truth || !dragged(event)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }}
            onDrop={drop}
          >
            <div ref={layer} className="wf-faden-layer" style={{ transform: wall.transform }}>
              {areas.map((area) => (
                <AreaFrame
                  key={area.id}
                  area={area}
                  selected={areaSel === area.id}
                  naming={naming === area.id}
                  editable={truth}
                  onGrab={grabArea(area)}
                  onResize={resizeArea(area)}
                  onName={() => truth && setNaming(area.id)}
                  onNamed={(title) => {
                    if (title !== null) patchBoardArea(db, area.id, { title });
                    setNaming(null);
                  }}
                />
              ))}
              <svg className="wf-faden-strings" aria-hidden>
                <defs>
                  {/* Die Spitze eines Pfeils „führt zu“ – gewöhnlich und gewählt */}
                  <marker
                    id="wf-faden-arrow"
                    className="wf-faden-arrow"
                    viewBox="0 0 10 10"
                    refX="7"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" />
                  </marker>
                  <marker
                    id="wf-faden-arrow-chosen"
                    className="wf-faden-arrow wf-faden-arrow--chosen"
                    viewBox="0 0 10 10"
                    refX="7"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" />
                  </marker>
                </defs>
                {linkStrings.map(({ link, d }) => (
                  <path
                    display={
                      shownKeys && !(shownKeys.has(link.a) && shownKeys.has(link.b))
                        ? 'none'
                        : undefined
                    }
                    key={`link:${link.id}`}
                    d={d}
                    data-web="link"
                    data-arrow={link.dir === 'to' || undefined}
                    markerEnd={
                      link.dir === 'to'
                        ? lineKey === link.id
                          ? 'url(#wf-faden-arrow-chosen)'
                          : 'url(#wf-faden-arrow)'
                        : undefined
                    }
                    data-chosen-link={lineKey === link.id || undefined}
                    data-dim={related !== null && !(related.has(link.a) && related.has(link.b))}
                  />
                ))}
                {linking && (
                  <path
                    d={`M ${linking.start.x} ${linking.start.y} L ${linking.end.x} ${linking.end.y}`}
                    data-linking
                  />
                )}
                {/* Breite, unsichtbare Spuren über den Schnüren: Daran klickt man sie an. */}
                {truth &&
                  linkStrings
                    .filter(
                      ({ link }) => !shownKeys || (shownKeys.has(link.a) && shownKeys.has(link.b)),
                    )
                    .map(({ link, d }) => (
                      <path
                        key={`hit:${link.id}`}
                        className="wf-faden-hit"
                        d={d}
                        onPointerDown={pickLine(link.id)}
                      />
                    ))}
              </svg>
              {band && (
                <div
                  className="wf-faden-band"
                  style={{
                    left: Math.min(band.a.x, band.b.x),
                    top: Math.min(band.a.y, band.b.y),
                    width: Math.abs(band.a.x - band.b.x),
                    height: Math.abs(band.a.y - band.b.y),
                  }}
                />
              )}
              {linkStrings
                .filter(({ link }) => link.word)
                .filter(
                  ({ link }) => !shownKeys || (shownKeys.has(link.a) && shownKeys.has(link.b)),
                )
                .map(({ link, mid }) => (
                  <span
                    key={`word:${link.id}`}
                    className="wf-faden-webword"
                    data-web="link"
                    style={{ left: mid.x, top: mid.y }}
                  >
                    {link.word}
                  </span>
                ))}
              {chosen && (
                <LinkMenu
                  link={chosen.link}
                  at={chosen.mid}
                  onRelate={(fromId, toId) => {
                    const self = data.entities[fromId];
                    if (self) setRelating({ self, otherId: toId });
                  }}
                  onDrop={() => dropLine(chosen.link.id)}
                  onClose={() => setLineKey(null)}
                />
              )}
              {dropAsk && (
                <DropSearch
                  ask={dropAsk}
                  pins={layout.pins}
                  onPick={(pinKey) => {
                    const { at, from } = dropAsk;
                    setDropAsk(null);
                    const there = layout.pins.some((entry) => entry.key === pinKey);
                    if (!there) placeOnBoard(db, pinKey, at.x, at.y);
                    const result = connectOnBoard(db, from, pinKey);
                    if (result.done)
                      toast({
                        slot: 'fadenbrett',
                        title: result.title,
                        body: result.body,
                        action: {
                          label: 'Rückgängig',
                          run: () =>
                            db.batch(() => {
                              result.undo();
                              if (!there) takeFreeOffBoard(db, [pinKey]);
                            }),
                        },
                      });
                  }}
                  onThread={(title) => {
                    const { at, from } = dropAsk;
                    setDropAsk(null);
                    const made = writeLinkedThread(db, from, title, at);
                    if (made)
                      toast({
                        slot: 'fadenbrett',
                        title: 'Faden geschrieben',
                        body: `„${made.thread.title}“ liegt am Ende der Schnur.`,
                        action: { label: 'Rückgängig', run: made.undo },
                      });
                  }}
                  onCancel={() => setDropAsk(null)}
                />
              )}
              {drafting && (
                <BoardDraft
                  at={drafting}
                  kind={draftKind}
                  onKind={setDraftKind}
                  onPick={(key) => {
                    const at = drafting;
                    setDrafting(null);
                    const undo = bringOntoBoard(db, key, at);
                    select(key);
                    if (undo)
                      toast({
                        slot: 'fadenbrett',
                        title: 'Aufs Brett geholt',
                        body: 'Zieh am Griff rechts einen Faden zu etwas anderem.',
                        action: { label: 'Rückgängig', run: undo },
                      });
                    else
                      toast({
                        slot: 'fadenbrett',
                        title: 'Liegt schon auf dem Brett',
                        body: 'Es ist jetzt gewählt.',
                      });
                  }}
                  onDone={(title) => {
                    const at = drafting;
                    setDrafting(null);
                    if (draftKind !== 'note') {
                      const thing = writeThingOnBoard(db, title, draftKind, at);
                      if (!thing) return;
                      select(thing.key);
                      toast({
                        slot: 'fadenbrett',
                        title: thing.created ? 'Hingelegt' : 'Gibt es schon',
                        body: thing.created
                          ? `„${thing.entity.name}“ liegt als Platzhalter auf dem Brett – fertig geschrieben wird später.`
                          : `„${thing.entity.name}“ (${KIND_LABEL[thing.entity.kind]}) ist schon in der Welt – genommen, kein zweiter.`,
                        action: { label: 'Rückgängig', run: thing.undo },
                      });
                      return;
                    }
                    const written = writeOnBoard(db, title, { x: at.x, y: at.y - 20 });
                    if (!written) return;
                    select(`thread:${written.thread.id}`);
                    setEditing(`thread:${written.thread.id}`);
                    toast({
                      slot: 'fadenbrett',
                      title: 'Karte hingelegt',
                      body: `„${written.thread.title}“ – zieh am Griff eine Schnur von ihm weg.`,
                      action: { label: 'Rückgängig', run: written.undo },
                    });
                  }}
                  onCancel={() => setDrafting(null)}
                />
              )}
              {layout.pins.map((entry) => {
                if (shownKeys && !shownKeys.has(entry.key)) return null;
                const face = thingFace(data, entry.key);
                if (!face) return null;
                const entity = entry.article ? undefined : data.entities[entry.id];
                return (
                  <ThingCard
                    key={entry.key}
                    face={face}
                    kind={entity?.kind ?? null}
                    at={entry}
                    dim={related !== null && !related.has(entry.key)}
                    selected={entry.key === selected || picked.has(entry.key)}
                    isNow={data.state.boardNow.includes(entry.key)}
                    onGrab={grab(entry.key, entry)}
                    onLink={truth ? startLink(entry.key) : undefined}
                    onWrite={truth ? () => setEditing(entry.key) : undefined}
                  />
                );
              })}
              {open
                .filter((card) => !shownKeys || shownKeys.has(card.key))
                .map((card) => (
                  <Card
                    key={card.key}
                    card={card}
                    at={layout.cards[card.key]!}
                    selected={card.key === selected || picked.has(card.key)}
                    dim={related !== null && !related.has(card.key)}
                    drop={false}
                    lifted={moving !== null && moving[card.key] !== undefined}
                    isNow={data.state.boardNow.includes(card.key)}
                    played={data.state.boardPlayed.includes(card.key)}
                    onGrab={grab(card.key, layout.cards[card.key]!)}
                    onLink={truth ? startLink(card.key) : undefined}
                    onWrite={truth ? () => setEditing(card.key) : undefined}
                  />
                ))}
              {editing && layout.cards[editing] && (
                <CardWriter
                  cardKey={editing}
                  at={layout.cards[editing]!}
                  onDone={() => setEditing(null)}
                />
              )}
              {editing && !layout.cards[editing] && (
                <NoteWriter
                  cardKey={editing}
                  at={layout.pins.find((entry) => entry.key === editing) ?? null}
                  onDone={() => setEditing(null)}
                />
              )}
            </div>
            {open.length === 0 && free.length === 0 && (
              <p className="wf-faden-wall__none">
                {truth
                  ? 'Noch liegt nichts auf dem Brett. Ein Doppelklick ins Leere schreibt eine Karte – etwa „Die Spieler kommen in die Stadt“. Oben links holst du Geschichten, Personen und Orte dazu.'
                  : 'Von dem, was auf dem Brett liegt, kennt die Gruppe noch nichts.'}
              </p>
            )}
            {truth && <BoardSearch pins={layout.pins} lying={board} onPick={bring} />}
            {shownArea && (
              <div className="wf-faden-only" onPointerDown={(event) => event.stopPropagation()}>
                Nur „{shownArea.title || 'Bereich ohne Namen'}“
                <button type="button" className="wf-faden-link" onClick={() => setOnlyArea(null)}>
                  Alles zeigen
                </button>
              </div>
            )}
            <div className="wf-faden-tools" onPointerDown={(event) => event.stopPropagation()}>
              {truth && (
                <IconButton
                  label="Bereich – ein benannter Rahmen zum Ordnen (um die Auswahl, wenn mehrere gewählt sind)"
                  size="sm"
                  onClick={() =>
                    newArea(picked.size > 1 ? [...picked] : selected ? [selected] : [])
                  }
                >
                  <Frame />
                </IconButton>
              )}
              {truth && hiddenStories.length > 0 && (
                <IconButton
                  label={`Weggelegte Geschichten zurückholen (${hiddenStories.length})`}
                  size="sm"
                  onClick={() => {
                    const undo = setStringsHidden(db, hiddenStories, false);
                    if (undo)
                      toast({
                        slot: 'fadenbrett',
                        title: 'Geschichten zurück',
                        body: 'Alle weggelegten Geschichten liegen wieder auf dem Brett.',
                        action: { label: 'Rückgängig', run: undo },
                      });
                  }}
                >
                  <Eye />
                </IconButton>
              )}
              <IconButton label="Größer" size="sm" onClick={() => wall.zoom(1.25)}>
                <Plus />
              </IconButton>
              <IconButton label="Kleiner" size="sm" onClick={() => wall.zoom(0.8)}>
                <Minus />
              </IconButton>
              <IconButton label="Alles zeigen" size="sm" onClick={() => showAll()}>
                <Maximize />
              </IconButton>
              <IconButton
                label="Aufräumen – Wayfarer legt die Geschichten neu aus"
                size="sm"
                disabled={Object.keys(placed).length === 0}
                onClick={tidy}
              >
                <LayoutGrid />
              </IconButton>
            </div>
            <div
              className="wf-faden-shelf"
              onPointerDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              {truth && orphans.length > 0 && (
                <details className="wf-faden-closed">
                  <summary title="Uhren aus der Zeit, als sie im Kalender angelegt wurden">
                    Uhren ohne Geschichte · {orphans.length}
                  </summary>
                  {orphans.map((clock) => (
                    <button
                      key={clock.id}
                      type="button"
                      className="wf-faden-closed__row"
                      title="Eine Geschichte daraus machen und ihr Blatt öffnen"
                      onClick={() => {
                        const story = storyFromClock(db, clock.id);
                        if (story) navigate(`/geschichte/${story.id}`);
                      }}
                    >
                      {clock.title}
                      <span>Geschichte daraus machen</span>
                    </button>
                  ))}
                </details>
              )}
              {closed.length > 0 && (
                <details className="wf-faden-closed">
                  <summary>Abgeschlossen · {closed.length}</summary>
                  {closed.map((card) => (
                    <button
                      key={card.key}
                      type="button"
                      className="wf-faden-closed__row"
                      onClick={() => select(card.key)}
                    >
                      {card.title}
                      <span>
                        {card.story ? 'Geschichte' : THREAD_STATE_LABEL[card.threads[0]!.state]}
                      </span>
                    </button>
                  ))}
                </details>
              )}
            </div>
          </div>
          <div className="wf-faden-sidecol">
            <div className="wf-btn-group wf-faden-sidetabs" role="group" aria-label="Seitenteil">
              <Button
                size="sm"
                aria-pressed={side === 'card'}
                title="Alles zur gewählten Karte des Bretts"
                onClick={showCard}
              >
                Gewählte Karte
              </Button>
              <Button
                size="sm"
                aria-pressed={side === 'loose'}
                title="Fäden, die zu keiner Geschichte gehören"
                onClick={() => setSide('loose')}
              >
                Lose Fäden · {looseCount}
              </Button>
            </div>
            {side === 'loose' ? (
              <LooseDrawer
                rows={loose}
                twins={twins}
                view={view}
                focusId={looseFocus}
                query={looseQuery}
                onQuery={setLooseQuery}
                picked={loosePicked}
                onPicked={setLoosePicked}
                onEdit={(thread) => setDialog({ type: 'thread', thread, storyId: thread.storyId })}
                onShow={setArriving}
              />
            ) : picked.size > 1 ? (
              <PickedSide
                count={picked.size}
                loose={picked.size}
                onTakeOff={() => takeOff([...picked])}
                onArea={() => newArea([...picked])}
                onClear={clearPicks}
              />
            ) : areaSel &&
              !selected &&
              data.state.boardAreas.some((area) => area.id === areaSel) ? (
              <AreaSide
                area={data.state.boardAreas.find((area) => area.id === areaSel)!}
                inside={insideArea(
                  layout,
                  data.state.boardAreas.find((area) => area.id === areaSel)!,
                )}
                only={onlyArea === areaSel}
                onOnly={(on) => {
                  setOnlyArea(on ? areaSel : null);
                  if (on) setArriving(null);
                }}
                onSelect={select}
                onName={() => setNaming(areaSel)}
                onDrop={() => dropArea(areaSel)}
              />
            ) : pin ? (
              <PinSide
                pin={pin}
                cards={cards}
                onSelect={select}
                onTakeOff={() => takeOff([pin.key])}
              />
            ) : (
              <Side
                card={current}
                view={view}
                links={links}
                cards={cards}
                onSelect={select}
                onEdit={setDialog}
                onPlace={(key) => bring(key)}
              />
            )}
          </div>
        </div>
      )}

      {dialog?.type === 'thread' && (
        <ThreadDialog
          thread={dialog.thread}
          storyId={dialog.storyId}
          onClose={() => setDialog(null)}
          onSaved={(thread) => {
            setDialog(null);
            if (thread.storyId) select(`story:${thread.storyId}`);
            else if (thread.inPlay || thread.onBoard) select(`thread:${thread.id}`);
            else showLoose(thread.id);
          }}
        />
      )}
      {relating && (
        <RelationQuick
          self={relating.self}
          otherId={relating.otherId}
          onClose={() => setRelating(null)}
        />
      )}
      {dialog?.type === 'attach' && (
        <AttachDialog
          ids={dialog.ids}
          onClose={() => setDialog(null)}
          onDone={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'clock' && (
        <ClockDialog
          key={dialog.clock?.id ?? 'neu'}
          clock={dialog.clock}
          onClose={() => {
            const now = db.getSnapshot();
            const fresh = Object.keys(now.clocks).filter((id) => !dialog.before.has(id));
            if (fresh.length === 1 && now.stories[dialog.storyId])
              db.patch('stories', dialog.storyId, { clockId: fresh[0]! });
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

/** Eine Karte auf dem Brett: das Wichtigste auf einen Blick – alles Weitere steht im Seitenteil. */
function Card({
  card,
  at,
  selected,
  dim,
  drop,
  lifted,
  isNow,
  played,
  onGrab,
  onLink,
  onWrite,
}: {
  card: BoardCard;
  at: Spot;
  selected: boolean;
  dim: boolean;
  /** Hier steht die Gruppe gerade (`state.boardNow`). */
  isNow: boolean;
  /** Die Gruppe war schon hier (gespielter Weg). */
  played: boolean;
  /** Doppelklick: auf der Karte schreiben (nur in der Sicht „Wahrheit“). */
  onWrite?: (() => void) | undefined;
  /** Ein loser Faden wird gerade auf diese Geschichte gezogen. */
  drop: boolean;
  /** Die Karte wird gerade gezogen: Sie liegt über allen anderen. */
  lifted: boolean;
  onGrab: (event: PointerEvent) => void;
  /** Eine Schnur von dieser Karte ziehen (nur in der Sicht „Wahrheit“). */
  onLink?: ((event: PointerEvent) => void) | undefined;
}) {
  const data = useData();
  const now = data.state.now;
  const owner = card.story?.ownerId ? data.entities[card.story.ownerId] : undefined;
  const repute = owner ? reputeOf(data, owner.id).party : null;
  const lone = card.story ? null : card.threads[0]!;
  const live = card.threads.filter(threadLive);
  const warnings = card.threads.filter((thread) => threadWarning(thread)).length;
  const found = lone ? lone.hints.filter((hint) => hint.found).length : 0;
  const text = card.story ? card.story.text : (data.threads[lone!.id]?.text ?? '');
  const names = lone ? cardNames(data, lone.id).slice(0, 4) : [];
  return (
    <button
      type="button"
      className={cx('wf-faden-card', !card.story && 'wf-faden-card--thread')}
      data-now={isNow || undefined}
      data-played={played || undefined}
      style={{ left: at.x, top: at.y }}
      data-card={card.key}
      data-near={card.nearness}
      data-dim={dim}
      data-drop={drop}
      data-lifted={lifted}
      aria-pressed={selected}
      title={onWrite ? 'Doppelklick: auf der Karte schreiben' : undefined}
      onPointerDown={onGrab}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onWrite?.();
      }}
    >
      {isNow && (
        <span className="wf-faden-card__now">
          <Flag aria-hidden />
          Hier steht die Gruppe
        </span>
      )}
      {data.state.boardStarts.includes(card.key) && (
        <span className="wf-faden-card__now wf-faden-card__start">
          <DoorOpen aria-hidden />
          Einstieg
        </span>
      )}
      <span className="wf-faden-card__top">
        <span className="wf-faden-card__sort">
          {card.story ? 'Geschichte' : card.of ? `Faden · ${card.of.title}` : 'Loser Faden'} ·{' '}
          {played ? 'gespielt' : NEARNESS_LABEL[card.nearness]}
        </span>
        {card.story ? (
          card.pace !== 'none' && (
            <span className={`wf-faden-pace wf-faden-pace--${card.pace}`}>
              {PACE_LABEL[card.pace]}
            </span>
          )
        ) : (
          <span className={`wf-faden-state wf-faden-state--${lone!.state}`}>
            {THREAD_STATE_LABEL[lone!.state]}
          </span>
        )}
      </span>
      <span className="wf-faden-card__title wf-clamp-2">{card.title}</span>
      {text.trim() && (
        <span className={cx('wf-faden-card__text', card.story ? 'wf-clamp-3' : 'wf-clamp-5')}>
          {text}
        </span>
      )}
      {names.length > 0 && (
        <span className="wf-faden-card__names">
          {names.map((entity) => (
            <span key={entity.id} className="wf-faden-card__name">
              <KindIcon kind={entity.kind} />
              <span className="wf-clamp-1">{entity.name}</span>
            </span>
          ))}
        </span>
      )}
      {card.partOf && (
        <span className="wf-faden-card__part wf-clamp-1">Teil von {card.partOf.title}</span>
      )}
      {card.parts > 0 && (
        <span className="wf-faden-card__part">
          {card.parts === 1 ? '1 Teil' : `${card.parts} Teile`}
          {card.story?.partsFolded ? ' – eingeklappt' : ''}
        </span>
      )}
      {owner && (
        <span className="wf-faden-card__owner">
          <span className="wf-clamp-1">Treibt an: {owner.name}</span>
          {repute !== null && (
            <span className="wf-faden-card__repute" title={`Ruf der Gruppe bei ${owner.name}`}>
              <AttitudeBadge value={repute} />
            </span>
          )}
        </span>
      )}
      {card.clock && (
        <span className="wf-faden-clock">
          <span className="wf-faden-clock__pips" aria-hidden>
            {card.clock.steps.map((step) => (
              <i key={step.step.id} data-state={step.state} />
            ))}
          </span>
          <span className="wf-faden-clock__next wf-clamp-2">
            {card.clock.next
              ? `${card.clock.paused ? 'Angehalten vor' : upper(untilText(card.clock.next.at - now))}: ${card.clock.next.step.text}`
              : 'Alles ist geschehen.'}
          </span>
        </span>
      )}
      {card.story && live.length > 0 && (
        <span className="wf-faden-card__owner">
          {live.length === 1 ? '1 Faden' : `${live.length} Fäden`}
          {warnings > 0 && (
            <>
              <TriangleAlert aria-hidden />
              {warnings === 1 ? '1 Warnung' : `${warnings} Warnungen`}
            </>
          )}
        </span>
      )}
      {lone && lone.hints.length > 0 && (
        <span className="wf-faden-card__owner">
          {found} von {lone.hints.length} Hinweisen gefunden
          {threadWarning(lone) && <TriangleAlert aria-label="Warnung" />}
        </span>
      )}
      {onLink && (
        <span
          className="wf-faden-handle wf-faden-handle--card"
          title="Schnur ziehen: auf einen Faden, eine Geschichte oder einen Namen"
          onPointerDown={onLink}
        />
      )}
    </button>
  );
}

/** Schalter „Einstieg“: Diese Karte ist ein Weg in eine Geschichte (`state.boardStarts`). */
function StartToggle({ cardKey }: { cardKey: string }) {
  const db = useDb();
  const data = useData();
  const on = data.state.boardStarts.includes(cardKey);
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={<DoorOpen />}
      aria-pressed={on}
      title="Ein Weg hinein: Hier stößt die Gruppe auf die Geschichte"
      onClick={() => {
        const undo = setBoardStart(db, cardKey, !on);
        toast({
          slot: 'fadenbrett',
          title: on ? 'Kein Einstieg mehr' : 'Einstieg',
          body: on
            ? 'Die Karte ist kein Einstieg mehr.'
            : 'Liegt sie im Rahmen einer Geschichte, zählt sie dort als Weg hinein.',
          action: { label: 'Rückgängig', run: undo },
        });
      }}
    >
      {on ? 'Einstieg ✓' : 'Einstieg'}
    </Button>
  );
}

/**
 * Ein Ding der Welt als Karte auf der Pinnwand: Name, Kategorie mit eigenem Wort, leiser Zustand,
 * auf Wunsch das Bild und die eigene Notiz der Karte. Doppelklick schreibt die Notiz.
 */
function ThingCard({
  face,
  kind,
  at,
  dim,
  selected,
  isNow,
  onGrab,
  onLink,
  onWrite,
}: {
  face: ThingFace;
  kind: EntityKind | null;
  at: Spot;
  dim: boolean;
  selected: boolean;
  isNow: boolean;
  onGrab: (event: PointerEvent) => void;
  onLink?: ((event: PointerEvent) => void) | undefined;
  onWrite?: (() => void) | undefined;
}) {
  const src = useMediaSrc()(face.image);
  const start = useData().state.boardStarts.includes(face.key);
  return (
    <button
      type="button"
      className={cx('wf-faden-thing', !kind && 'wf-faden-thing--article')}
      style={{ left: at.x, top: at.y }}
      data-pin={face.key}
      data-dim={dim}
      data-now={isNow || undefined}
      aria-pressed={selected}
      title={onWrite ? 'Doppelklick: eine Notiz auf die Karte schreiben' : face.name}
      onPointerDown={onGrab}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onWrite?.();
      }}
    >
      {isNow && (
        <span className="wf-faden-card__now">
          <Flag aria-hidden />
          Hier steht die Gruppe
        </span>
      )}
      {start && (
        <span className="wf-faden-card__now wf-faden-card__start">
          <DoorOpen aria-hidden />
          Einstieg
        </span>
      )}
      {src && <img className="wf-faden-thing__image" src={src} alt="" draggable={false} />}
      <span className="wf-faden-thing__head">
        {kind ? <KindIcon kind={kind} /> : <BookOpen aria-hidden />}
        <span className="wf-faden-thing__name wf-clamp-2">{face.name}</span>
      </span>
      <span className="wf-faden-thing__sort wf-clamp-1">
        {face.sort}
        {face.marks.length > 0 && <em> · {face.marks.join(' · ')}</em>}
      </span>
      {face.note && <span className="wf-faden-thing__note wf-clamp-5">{face.note}</span>}
      {onLink && (
        <span
          className="wf-faden-handle wf-faden-handle--card"
          title="Faden ziehen – auf etwas anderes oder ins Leere"
          onPointerDown={onLink}
        />
      )}
    </button>
  );
}

/** Die Notiz einer Karte schreiben, an Ort und Stelle – sie gehört zur Karte, nicht zum Ding. */
function NoteWriter({
  cardKey,
  at,
  onDone,
}: {
  cardKey: string;
  at: Spot | null;
  onDone: () => void;
}) {
  const db = useDb();
  const data = useData();
  const face = thingFace(data, cardKey);
  const start = face?.note ?? '';
  const [text, setText] = useState(start);
  useHoldDraft(text !== start, `fadenbrett-notiz-${cardKey}`);
  const done = useRef(false);
  const save = () => {
    if (done.current) return;
    done.current = true;
    if (text.trim() !== start) setBoardNote(db, cardKey, { text });
    onDone();
  };
  if (!face || !at) return null;
  return (
    <div
      className="wf-faden-writer"
      style={{ left: at.x, top: at.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
          event.preventDefault();
          save();
        }
      }}
    >
      <span className="wf-faden-writer__name">{face.name}</span>
      <textarea
        className="wf-faden-writer__text"
        aria-label={`Notiz zu ${face.name} auf dem Brett`}
        value={text}
        autoFocus
        placeholder="Was hier gerade wichtig ist – nur auf dieser Karte, nicht im Artikel …"
        onChange={(event) => setText(event.target.value)}
        onBlur={save}
      />
      <span className="wf-faden-writer__hint">Fertig: Escape oder daneben klicken</span>
    </div>
  );
}

/**
 * Auf einer Karte schreiben: Überschrift und Text, an Ort und Stelle. Geschrieben wird beim
 * Verlassen, mit Strg+Eingabe oder Escape – ein „Speichern“ gibt es nicht.
 */
function CardWriter({ cardKey, at, onDone }: { cardKey: string; at: Spot; onDone: () => void }) {
  const db = useDb();
  const data = useData();
  const isStory = cardKey.startsWith('story:');
  const id = cardKey.slice(cardKey.indexOf(':') + 1);
  const start = isStory ? data.stories[id] : data.threads[id];
  const [title, setTitle] = useState(start?.title ?? '');
  const [text, setText] = useState(start?.text ?? '');
  /** Eine eben angelegte Karte: erst die Überschrift, schon markiert zum Überschreiben. */
  const fresh = !!start && !start.text.trim() && /^Neue (Geschichte|Notiz)$/.test(start.title);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!fresh) return;
    titleRef.current?.focus();
    titleRef.current?.select();
    // Nur beim Öffnen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const changed = !!start && (title !== start.title || text !== start.text);
  useHoldDraft(changed, `fadenbrett-karte-${cardKey}`);
  const box = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const save = () => {
    if (done.current) return;
    done.current = true;
    if (start && changed) {
      if (isStory) patchStory(db, id, { title, text });
      else patchThread(db, id, { title, text });
    }
    onDone();
  };
  if (!start) return null;
  return (
    <div
      ref={box}
      className="wf-faden-writer"
      style={{ left: at.x, top: at.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={(event) => {
        if (!box.current?.contains(event.relatedTarget as Node | null)) save();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
          event.preventDefault();
          save();
        }
      }}
    >
      <input
        ref={titleRef}
        className="wf-faden-writer__title"
        aria-label="Überschrift"
        value={title}
        placeholder="Überschrift"
        onChange={(event) => setTitle(event.target.value)}
      />
      <textarea
        className="wf-faden-writer__text"
        aria-label="Was hier geschieht"
        value={text}
        autoFocus={!fresh}
        placeholder={
          isStory
            ? 'Die Geschichte in deinen Worten …'
            : 'Was hier geschieht – in deinen Worten, so lang du willst …'
        }
        onChange={(event) => setText(event.target.value)}
      />
      <span className="wf-faden-writer__hint">Fertig: Escape oder daneben klicken</span>
    </div>
  );
}

/**
 * Der Seitenteil zu einem Namen oder Artikel auf dem Brett: was er ist, der Anfang seines Textes,
 * welche Karten an ihm hängen – oder dass er frei liegt.
 */
function PinSide({
  pin,
  cards,
  onSelect,
  onTakeOff,
}: {
  pin: BoardPin;
  cards: BoardCard[];
  onSelect: (key: string) => void;
  onTakeOff: () => void;
}) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const face = thingFace(data, pin.key);
  const entity = pin.article ? undefined : data.entities[pin.id];
  const article = pin.article
    ? data.articles[pin.id]
    : entity?.lk
      ? data.articles[entity.lk.resourceId]
      : undefined;
  const name = entity?.name ?? article?.title;
  if (!name) return null;
  const excerpt = article ? articleExcerpt(data.articles, article) : null;
  const hanging = pin.cards
    .map((key) => cards.find((card) => card.key === key))
    .filter((card): card is BoardCard => !!card);
  const href = entity ? entityHref(entity) : article ? `/wiki/${article.id}` : null;
  return (
    <aside className="wf-faden-side">
      <div className="wf-faden-side__head">
        <span className="wf-faden-card__sort">
          {pin.article ? 'Artikel' : 'Auf dem Brett'} ·{' '}
          {hanging.length > 1
            ? 'hier berühren sich Geschichten'
            : hanging.length === 1
              ? 'hängt an einer Karte'
              : 'liegt frei'}
        </span>
        {href && (
          <Button size="sm" onClick={() => navigate(href)}>
            {pin.article ? 'Artikel öffnen' : 'Seite öffnen'}
          </Button>
        )}
      </div>
      <h2 className="wf-faden-side__title">{name}</h2>
      {face && <p className="wf-faden-side__sort">{face.sort}</p>}
      {entity?.tagline && <p className="wf-prose">{entity.tagline}</p>}
      {face && (
        <Written
          className="wf-faden-side__story"
          label="Notiz auf der Karte"
          grow
          value={face.note}
          placeholder="Notiz auf der Karte – was hier gerade wichtig ist …"
          onSave={(text) => setBoardNote(db, pin.key, { text })}
        />
      )}
      {face?.hasImage && (
        <Checkbox
          checked={!!data.state.boardNotes[pin.key]?.image}
          onChange={(on) => setBoardNote(db, pin.key, { image: on })}
        >
          Bild auf der Karte zeigen
        </Checkbox>
      )}
      {face && (
        <div className="wf-faden-side__acts">
          <StartToggle cardKey={pin.key} />
        </div>
      )}
      {excerpt && excerpt.paragraphs.length > 0 && (
        <section className="wf-faden-side__text">
          {excerpt.paragraphs.map((text, index) => (
            <p key={index} className="wf-prose">
              {text}
            </p>
          ))}
          {excerpt.more && href && (
            <button type="button" className="wf-faden-link" onClick={() => navigate(href)}>
              Weiterlesen …
            </button>
          )}
        </section>
      )}
      {hanging.length > 0 ? (
        <section>
          <h3 className="wf-faden-side__sub">
            {pin.article ? 'Gehört zu' : 'Karten an diesem Namen'}
          </h3>
          {hanging.map((card) => (
            <button
              key={card.key}
              type="button"
              className="wf-faden-touchrow"
              onClick={() => onSelect(card.key)}
            >
              <span>{card.title}</span>
              <em>{card.story ? 'Geschichte' : 'Loser Faden'}</em>
            </button>
          ))}
        </section>
      ) : (
        <>
          <p className="wf-mute">
            Zieh am Griff einen Faden zu etwas anderem – auf dem Faden steht, wie es dazugehört.
            Legst du es in einen Rahmen, der eine Geschichte ist, gehört es zu ihr.
          </p>
          <div className="wf-faden-side__acts">
            <Button size="sm" variant="ghost" onClick={onTakeOff} title="Auch mit der Löschtaste">
              Vom Brett nehmen
            </Button>
          </div>
        </>
      )}
    </aside>
  );
}

/**
 * Das Suchfeld auf dem Brett: jeden Eintrag der Welt und jeden Artikel ohne Eintrag dazuholen.
 * Was schon daliegt, wird gewählt; das Neue liegt in der Mitte des Bildes.
 */
function BoardSearch({
  pins,
  lying,
  onPick,
}: {
  pins: readonly BoardPin[];
  /** Was schon als Karte daliegt. */
  lying: readonly BoardCard[];
  onPick: (key: string) => void;
}) {
  const data = useData();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const hits = useMemo(
    () =>
      searchWorld(data, query)
        .filter(
          (hit) =>
            hit.sort === 'entity' ||
            hit.sort === 'article' ||
            hit.sort === 'story' ||
            hit.sort === 'thread',
        )
        .slice(0, 9),
    [data, query],
  );
  const keyOf = (hit: (typeof hits)[number]) => (hit.entity ? `node:${hit.entity.id}` : hit.key);
  const pick = (index: number) => {
    const hit = hits[index];
    if (!hit) return;
    onPick(keyOf(hit));
    setQuery('');
    setActive(0);
  };
  return (
    <div
      className="wf-faden-search"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <input
        className="wf-input"
        value={query}
        placeholder="Geschichte, Faden, Person, Ort, Artikel aufs Brett holen …"
        aria-label="Einen Eintrag oder Artikel aufs Brett holen"
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((index) => Math.min(hits.length - 1, index + 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          } else if (event.key === 'Enter') pick(active);
          else if (event.key === 'Escape') setQuery('');
        }}
      />
      {query.trim() && (
        <div className="wf-faden-search__hits" role="listbox">
          {hits.length === 0 && <span className="wf-faden-search__none">Nichts gefunden.</span>}
          {hits.map((hit, index) => {
            const there =
              pins.some((entry) => entry.key === keyOf(hit)) ||
              lying.some((card) => card.key === keyOf(hit));
            return (
              <button
                key={hit.key}
                type="button"
                role="option"
                aria-selected={index === active}
                className="wf-faden-search__hit"
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(index)}
              >
                {hit.entity ? (
                  <KindIcon kind={hit.entity.kind} />
                ) : hit.sort === 'article' ? (
                  <BookOpen aria-hidden />
                ) : (
                  <Waypoints aria-hidden />
                )}
                <span className="wf-clamp-1">{hit.label}</span>
                <em className="wf-clamp-1">{there ? 'liegt schon da' : hit.sub}</em>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Das Seltene an einer Karte: „Doch nicht gespielt“, „Vom Brett nehmen“ – hinter „…“. */
function CardMore({ card, lone }: { card: BoardCard; lone: Thread | null }) {
  const db = useDb();
  const data = useData();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const played = data.state.boardPlayed.includes(card.key);
  const canTakeOff = !!lone && card.onBoard && !card.closed;
  if (!played && !canTakeOff) return null;
  return (
    <>
      <IconButton
        ref={anchor}
        label="Mehr zu dieser Karte"
        size="sm"
        variant="ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((on) => !on)}
      >
        <MoreHorizontal />
      </IconButton>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} width={260}>
        {played && (
          <MenuItem
            onClick={() => {
              setOpen(false);
              const undo = setBoardPlayed(db, card.key, false);
              toast({
                slot: 'fadenbrett',
                title: 'Nicht mehr gespielt',
                body: 'Die Karte gilt wieder als Möglichkeit.',
                action: { label: 'Rückgängig', run: undo },
              });
            }}
          >
            Doch nicht gespielt
          </MenuItem>
        )}
        {canTakeOff && lone && (
          <MenuItem
            disabled={lone.inPlay}
            onClick={() => {
              setOpen(false);
              const undo = setThreadOnBoard(db, lone.id, false);
              if (undo)
                toast({
                  slot: 'fadenbrett',
                  title: 'Vom Brett genommen',
                  body: `„${lone.title}“ steht nur noch in der Liste „Lose Fäden“.`,
                  action: { label: 'Rückgängig', run: undo },
                });
            }}
          >
            {lone.inPlay
              ? 'Vom Brett nehmen – erst, wenn er nicht im Spiel ist'
              : 'Vom Brett nehmen (Löschtaste)'}
          </MenuItem>
        )}
      </Popover>
    </>
  );
}

/** Der Seitenteil: alles zur gewählten Karte – Uhr, Fäden mit Hinweisen, Einstiege, Berührungen. */
function Side({
  card,
  view,
  links,
  cards,
  onSelect,
  onEdit,
  onPlace,
}: {
  /** Ein Stück aufs Brett holen (einen Faden der Geschichte als eigene Karte). */
  onPlace: (key: string) => void;
  card: BoardCard | null;
  view: BoardView;
  links: Touch[];
  cards: BoardCard[];
  onSelect: (key: string) => void;
  onEdit: (dialog: OpenDialog) => void;
}) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const cal = data.campaign.calendar;
  const truth = view === 'truth';

  if (!card)
    return (
      <aside className="wf-faden-side wf-faden-side--blank">
        <p>
          Dein Storyboard: Fang dort an, wo die Spieler ankommen – und schreib, wohin es führen
          kann.
        </p>
        {/* Ein Spickzettel statt einer Anleitung: Handgriff links, Wirkung rechts. */}
        <dl className="wf-faden-grips">
          <dt>Doppelklick ins Leere</dt>
          <dd>Karte schreiben – oder finden, was es schon gibt</dd>
          <dt>Doppelklick auf eine Karte</dt>
          <dd>weiterschreiben</dd>
          <dt>Griff rechts an der Karte ziehen</dt>
          <dd>Pfeil „führt zu“ – ins Leere gezogen: dort suchen oder anlegen</dd>
          <dt>Klick auf einen Pfeil</dt>
          <dd>Wort, Richtung, was er in der Welt bedeutet</dd>
          <dt>Suche oben links</dt>
          <dd>Geschichten, Fäden, Personen, Orte, Artikel hinlegen</dd>
          <dt>Umschalt-Klick · Rahmen unten rechts</dt>
          <dd>mehrere wählen · Bereich anlegen</dd>
          <dt>Löschtaste</dt>
          <dd>vom Brett nehmen, nie aus der Welt</dd>
        </dl>
        <p className="wf-mute">
          Am Tisch: Eine Karte als „Hier steht die Gruppe“ markieren – der Spieltisch zeigt, wohin
          ihre Pfeile führen.
        </p>
      </aside>
    );

  const story = card.story;
  /** Der lose Faden dieser Karte – wie er gespeichert ist. */
  const lone = story ? null : (data.threads[card.threads[0]?.id ?? ''] ?? null);
  const owner = story?.ownerId ? data.entities[story.ownerId] : undefined;
  const repute = owner ? reputeOf(data, owner.id) : { party: null, members: [] };
  const link = (id: string | null | undefined) => {
    const entity = id ? data.entities[id] : undefined;
    return entity ? (
      <button type="button" className="wf-faden-link" onClick={() => navigate(entityHref(entity))}>
        {entity.name}
      </button>
    ) : null;
  };
  const touching = links
    .filter((entry) => entry.a === card.key || entry.b === card.key)
    .map((entry) => ({
      entry,
      other: cards.find((other) => other.key === (entry.a === card.key ? entry.b : entry.a)),
    }))
    .filter((row) => row.other);

  return (
    <aside className="wf-faden-side">
      <div className="wf-faden-side__head">
        <span className="wf-faden-card__sort">
          {story ? 'Geschichte' : card.of ? `Faden · ${card.of.title}` : 'Loser Faden'} ·{' '}
          {NEARNESS_LABEL[card.nearness]}
        </span>
        {truth && story && (
          <Button
            size="sm"
            icon={<Pencil />}
            onClick={() => navigate(`/geschichte/${story.id}`)}
            title="Die Geschichte auf ihrem Blatt schreiben"
          >
            Schreiben
          </Button>
        )}
      </div>
      <h2 className="wf-faden-side__title">{card.title}</h2>
      {story?.summary && truth && <p className="wf-prose">{story.summary}</p>}
      {story && truth && (
        <Written
          className="wf-faden-side__story"
          label="Die Geschichte in deinen Worten"
          grow
          value={story.text}
          placeholder="Die Geschichte in deinen Worten – schreib einfach drauflos …"
          onSave={(text) => patchStory(db, story.id, { text })}
        />
      )}
      {truth && lone && (
        <Written
          className="wf-faden-side__story"
          label="Was hier geschieht"
          grow
          value={lone.text}
          placeholder="Was hier geschieht – in deinen Worten, so lang du willst …"
          onSave={(text) => patchThread(db, lone.id, { text })}
        />
      )}
      {truth && lone && (
        <NamesHint
          texts={[lone.title, lone.text]}
          attached={lone.refs}
          ignored={lone.notMeant}
          storyId={lone.storyId}
          onAdd={(entityId) => {
            const now = db.getSnapshot().threads[lone.id];
            if (now) patchThread(db, lone.id, { refs: [...now.refs, entityId] });
          }}
          onRemove={(entityId) => {
            const now = db.getSnapshot().threads[lone.id];
            if (now) patchThread(db, lone.id, { refs: now.refs.filter((id) => id !== entityId) });
          }}
          onIgnore={(key) => {
            const now = db.getSnapshot().threads[lone.id];
            if (now && !now.notMeant.includes(key))
              patchThread(db, lone.id, { notMeant: [...now.notMeant, key] });
          }}
        />
      )}
      {/* Eine Zeile Handgriffe: was zu dieser Art Karte passt; Seltenes hinter „…“. */}
      {truth && (
        <div className="wf-faden-side__acts">
          <Button
            size="sm"
            variant="ghost"
            icon={<Flag />}
            aria-pressed={data.state.boardNow.includes(card.key)}
            title="Am Spieltisch stehen dann diese Karte und wohin ihre Pfeile führen"
            onClick={() => {
              const here = data.state.boardNow.includes(card.key);
              const undo = setBoardNow(db, card.key, !here);
              toast({
                slot: 'fadenbrett',
                title: here ? 'Markierung entfernt' : 'Hier steht die Gruppe',
                body: here
                  ? 'Keine Karte ist mehr markiert.'
                  : 'Am Spieltisch siehst du diese Karte und wohin ihre Pfeile führen.',
                action: { label: 'Rückgängig', run: undo },
              });
            }}
          >
            {data.state.boardNow.includes(card.key)
              ? 'Hier steht die Gruppe ✓'
              : 'Hier steht die Gruppe'}
          </Button>
          <StartToggle cardKey={card.key} />
          {lone && (
            <Button
              size="sm"
              icon={<Link2 />}
              title="Als Frage, Hinweis oder Einstieg – oder zieh die Karte auf eine Geschichte"
              onClick={() => onEdit({ type: 'attach', ids: [lone.id] })}
            >
              An Geschichte hängen …
            </Button>
          )}
          <CardMore card={card} lone={lone} />
        </div>
      )}
      {owner && (
        <p>
          <span className="wf-mute">Treibt an:</span> {link(owner.id)}
        </p>
      )}
      {!truth && (
        <p className="wf-faden-side__note">
          Sicht der Gruppe: nur, was sie kennt. Zum Ändern auf „Wahrheit“ wechseln.
        </p>
      )}

      {truth && story && !card.clock && (
        <section>
          <h3 className="wf-faden-side__sub">
            Wenn niemand eingreift
            <Button
              size="sm"
              icon={<Plus />}
              onClick={() =>
                onEdit({
                  type: 'clock',
                  clock: null,
                  storyId: story.id,
                  before: new Set(Object.keys(data.clocks)),
                })
              }
            >
              Uhr
            </Button>
          </h3>
          <p className="wf-mute">
            Noch keine Uhr. Sie sagt Schritt für Schritt, was geschieht, wenn die Gruppe nichts tut.
          </p>
        </section>
      )}
      {card.clock && (
        <section>
          <h3 className="wf-faden-side__sub">
            Wenn niemand eingreift
            <span className={`wf-faden-pace wf-faden-pace--${card.pace}`}>
              {PACE_LABEL[card.pace]}
            </span>
            {truth && story && (
              <Button
                size="sm"
                icon={<Pencil />}
                onClick={() =>
                  onEdit({
                    type: 'clock',
                    clock: card.clock!.clock,
                    storyId: story.id,
                    before: new Set(Object.keys(data.clocks)),
                  })
                }
              >
                Uhr
              </Button>
            )}
          </h3>
          <ol className="wf-faden-steps">
            {card.clock.steps.map((step) => (
              <li key={step.step.id} data-state={step.state}>
                <i aria-hidden />
                <span>{step.step.text}</span>
                <em>
                  {step.state === 'prevented'
                    ? 'verhindert'
                    : step.state === 'done'
                      ? formatDayMonth(cal, step.at)
                      : card.clock!.paused
                        ? 'angehalten'
                        : formatDayMonth(cal, step.at)}
                </em>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section>
        <h3 className="wf-faden-side__sub">
          {story ? 'Fäden' : 'Der Faden'}
          {truth && story && (
            <Button
              size="sm"
              icon={<Plus />}
              onClick={() => onEdit({ type: 'thread', thread: null, storyId: story.id })}
            >
              Faden
            </Button>
          )}
        </h3>
        {card.threads.length === 0 && (
          <p className="wf-mute">
            Noch kein Faden. Ein Faden ist eine Frage, die diese Geschichte stellt.
          </p>
        )}
        {card.threads.map((thread) => {
          const warning = truth ? threadWarning(thread) : null;
          const stored = data.threads[thread.id] ?? thread;
          return (
            <div key={thread.id} className={`wf-faden-block wf-faden-thread--${thread.state}`}>
              <div className="wf-faden-block__head">
                <i aria-hidden />
                <span className="wf-faden-block__title">{thread.title}</span>
                {truth && (
                  <button
                    type="button"
                    className="wf-faden-link"
                    onClick={() =>
                      onEdit({ type: 'thread', thread: stored, storyId: stored.storyId })
                    }
                  >
                    Ändern
                  </button>
                )}
                {truth && story && (
                  <button
                    type="button"
                    className="wf-faden-link"
                    title="Als eigene Karte aufs Brett legen – dann kannst du Schnüre von ihm ziehen"
                    onClick={() => onPlace(`thread:${thread.id}`)}
                  >
                    Aufs Brett
                  </button>
                )}
                {truth && story && (
                  <button
                    type="button"
                    className="wf-faden-link"
                    title="Von der Geschichte lösen – er wird ein loser Faden"
                    onClick={() => {
                      const undo = moveThread(db, thread.id, null);
                      if (undo)
                        toast({
                          slot: 'fadenbrett',
                          title: 'Von der Geschichte gelöst',
                          body: `„${thread.title}“ steht jetzt unter „Lose Fäden“.`,
                          action: { label: 'Rückgängig', run: undo },
                        });
                    }}
                  >
                    Lösen
                  </button>
                )}
              </div>
              <div className="wf-faden-block__meta">
                {truth ? (
                  <Select
                    value={thread.state}
                    aria-label="Zustand des Fadens"
                    onChange={(event) =>
                      setThreadState(db, thread.id, event.target.value as ThreadState)
                    }
                  >
                    {THREAD_STATES.map((state) => (
                      <option key={state} value={state}>
                        {THREAD_STATE_LABEL[state]}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <span>{THREAD_STATE_LABEL[thread.state]}</span>
                )}
                {truth && !thread.known && <span>Die Gruppe kennt ihn nicht</span>}
              </div>
              {thread.truth && <p className="wf-faden-block__truth">{thread.truth}</p>}
              {warning && (
                <p className="wf-faden-block__warn">
                  <TriangleAlert aria-hidden /> {warning}
                </p>
              )}
              {thread.hints.map((hint) => (
                <div key={hint.id} className="wf-faden-hint" data-found={hint.found}>
                  {truth ? (
                    <Checkbox
                      checked={hint.found}
                      onChange={(found) => findHint(db, thread.id, hint.id, found)}
                    >
                      {hint.text}
                    </Checkbox>
                  ) : (
                    <span>{hint.text}</span>
                  )}
                  {(hint.placeId || hint.sourceId) && (
                    <span className="wf-faden-hint__where">
                      {hint.placeId && <>in {link(hint.placeId)}</>}
                      {hint.placeId && hint.sourceId && ' · '}
                      {hint.sourceId && <>weiß {link(hint.sourceId)}</>}
                      {hint.placeId && isNear(data, hint.placeId) && !hint.found && (
                        <b> – liegt hier bereit</b>
                      )}
                    </span>
                  )}
                </div>
              ))}
              {truth && thread.hints.length === 0 && threadLive(thread) && !warning && (
                <p className="wf-mute">Noch keine Hinweise eingetragen.</p>
              )}
              {truth && lone && <ThreadWeb thread={stored} />}
            </div>
          );
        })}
      </section>

      {truth && owner && (
        <section>
          <h3 className="wf-faden-side__sub">
            Ruf · {owner.name}
            <Button size="sm" onClick={() => openAttitude({ fromId: owner.id })}>
              {repute.party === null ? 'Festlegen' : 'Ändern'}
            </Button>
          </h3>
          <div className="wf-faden-repute">
            <span>Die Gruppe</span>
            {repute.party === null ? (
              <em>noch nicht festgelegt</em>
            ) : (
              <AttitudeBadge value={repute.party} />
            )}
          </div>
          {repute.members.map((member) => (
            <div key={member.id} className="wf-faden-repute">
              <span>{member.name}</span>
              <AttitudeBadge value={member.value} />
            </div>
          ))}
          <p className="wf-mute">
            Der Ruf ändert nicht die Geschichte – nur, wie die Gruppe hineinkommt.
          </p>
        </section>
      )}

      {truth && story && story.entries.length > 0 && (
        <section>
          <h3 className="wf-faden-side__sub">Einstiege</h3>
          {story.entries.map((entry) => {
            const fit = entryFit(data, story, entry);
            return (
              <div key={entry.id} className="wf-faden-hint" data-found={!fit.fits}>
                <span>{entry.text}</span>
                <span className="wf-faden-hint__where wf-faden-hint__where--flat">
                  {entry.placeId && <>in {link(entry.placeId)}</>}
                  {entry.placeId && isNear(data, entry.placeId) && <b> – die Gruppe ist hier</b>}
                  {entry.standing !== 'any' && (
                    <>
                      {entry.placeId && ' · '}
                      {ENTRY_STANDING_LABEL[entry.standing]}: {fit.note}
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </section>
      )}

      {story && (truth || card.parts > 0 || card.partOf) && (
        <StoryPartsSide story={story} card={card} editable={truth} onSelect={onSelect} />
      )}

      {touching.length > 0 && (
        <section>
          <h3 className="wf-faden-side__sub">Berührt</h3>
          {touching.map(({ entry, other }) => (
            <button
              key={other!.key}
              type="button"
              className="wf-faden-touchrow"
              onClick={() => onSelect(other!.key)}
            >
              <span>{other!.title}</span>
              <em>{touchReason(data, entry)}</em>
            </button>
          ))}
        </section>
      )}

      {(card.nodes.length > 0 || truth) && (
        <section>
          <h3 className="wf-faden-side__sub">Hängt an</h3>
          <div className="wf-faden-card__nodes">
            {card.nodes.map((id) => (
              <span key={id} className="wf-faden-node">
                {link(id)}
              </span>
            ))}
            {card.articles.map((id) => (
              <span key={id} className="wf-faden-node">
                <button
                  type="button"
                  className="wf-faden-link"
                  onClick={() => navigate(`/wiki/${id}`)}
                >
                  {data.articles[id]?.title ?? ''}
                </button>
              </span>
            ))}
          </div>
          {truth && (
            <EntityPicker
              value={null}
              onChange={(id) => {
                if (id) pinToCard(db, card.key, id);
              }}
              kinds={['person', 'place', 'faction', 'family', 'item']}
              exclude={card.nodes}
              placeholder="Person, Ort oder Fraktion anheften …"
              create={{ storyId: card.story?.id ?? null }}
            />
          )}
        </section>
      )}
    </aside>
  );
}

/** Ein Faden, gleich auf dem Brett geschrieben: Eingabetaste legt ihn hin, Escape verwirft. */
/** Was ein Doppelklick ins Leere hinlegt: eine Notiz oder ein Ding der Welt. */
type DraftKind = 'note' | EntityKind;
/** Die Arten, die der Doppelklick gleich anbietet; alle übrigen stehen unter „Andere …“. */
const DRAFT_FIRST: readonly DraftKind[] = ['note', 'person', 'place', 'item', 'faction'];

function BoardDraft({
  at,
  kind,
  onKind,
  onDone,
  onPick,
  onCancel,
}: {
  at: Spot;
  kind: DraftKind;
  onKind: (kind: DraftKind) => void;
  onDone: (title: string) => void;
  /** Etwas Vorhandenes gewählt (Artikel, Eintrag, Geschichte, Faden) – es kommt an diese Stelle. */
  onPick: (key: string) => void;
  onCancel: () => void;
}) {
  const data = useData();
  const [text, setText] = useState('');
  useHoldDraft(text.trim() !== '', 'fadenbrett-faden');
  const box = useRef<HTMLDivElement>(null);
  const label = (entry: DraftKind) => (entry === 'note' ? 'Notiz' : KIND_LABEL[entry]);
  const more = CREATE_KINDS.filter((entry) => !DRAFT_FIRST.includes(entry));
  // Beim Tippen: was es schon gibt – Artikel, Einträge, Geschichten, Fäden.
  const hits = useMemo(() => boardFinds(data, text), [data, text]);
  // Die Eingabetaste nimmt den genauen Namen; sonst entsteht Neues. Pfeiltasten wählen.
  const exact = exactFind(hits, text);
  const [active, setActive] = useState<number | null>(null);
  const chosen = active ?? exact;
  const create = () => (text.trim() ? onDone(text) : onCancel());
  const enter = () => (chosen >= 0 && hits[chosen] ? onPick(hits[chosen]!.key) : create());
  return (
    <div
      ref={box}
      className="wf-faden-draft"
      style={{ left: at.x, top: at.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={(event) => {
        if (box.current?.contains(event.relatedTarget as Node | null)) return;
        // Eine angefangene Notiz bleibt liegen; ein Name ohne Wahl wird nicht still angelegt.
        if (text.trim() && kind === 'note' && exact < 0) onDone(text);
        else onCancel();
      }}
    >
      <span className="wf-btn-group wf-faden-draft__kinds" role="group" aria-label="Was es ist">
        {DRAFT_FIRST.map((entry) => (
          <button
            key={entry}
            type="button"
            className="wf-btn wf-btn--sm"
            aria-pressed={kind === entry}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onKind(entry)}
          >
            {label(entry)}
          </button>
        ))}
        <Select
          className="wf-faden-draft__more"
          aria-label="Andere Art"
          value={DRAFT_FIRST.includes(kind) ? '' : kind}
          onChange={(event) => event.target.value && onKind(event.target.value as EntityKind)}
        >
          <option value="">Andere …</option>
          {more.map((entry) => (
            <option key={entry} value={entry}>
              {KIND_LABEL[entry]}
            </option>
          ))}
        </Select>
      </span>
      <input
        // Der Doppelklick hat den Platz gewählt: Hier wird jetzt geschrieben oder gesucht.
        autoFocus
        className="wf-input"
        value={text}
        placeholder={
          kind === 'note'
            ? 'Suchen oder eine Notiz schreiben …'
            : `Suchen oder neu – ${label(kind)}`
        }
        aria-label="Suchen oder neu auf dem Brett"
        onChange={(event) => {
          setText(event.target.value);
          setActive(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive(Math.min(hits.length - 1, (chosen < 0 ? -1 : chosen) + 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            // Über dem ersten Treffer steht wieder „neu“.
            setActive(chosen <= 0 ? -1 : chosen - 1);
          } else if (event.key === 'Enter') enter();
          else if (event.key === 'Escape') onCancel();
        }}
      />
      {text.trim() && (
        <div className="wf-faden-draft__finds" role="listbox" aria-label="Gefunden">
          {exact < 0 && (
            <button
              type="button"
              role="option"
              aria-selected={chosen < 0}
              className="wf-faden-search__hit"
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(-1)}
              onClick={create}
            >
              <Plus aria-hidden />
              <span className="wf-clamp-1">„{text.trim()}“</span>
              <em>{kind === 'note' ? 'als Notiz' : `neu als ${label(kind)}`}</em>
            </button>
          )}
          {hits.map((hit, index) => (
            <button
              key={hit.key}
              type="button"
              role="option"
              aria-selected={index === chosen}
              className="wf-faden-search__hit"
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => onPick(hit.key)}
            >
              {hit.entity ? (
                <KindIcon kind={hit.entity.kind} />
              ) : hit.sort === 'article' ? (
                <BookOpen aria-hidden />
              ) : (
                <Waypoints aria-hidden />
              )}
              <span className="wf-clamp-1">{hit.label}</span>
              <em className="wf-clamp-1">{hit.sub}</em>
            </button>
          ))}
        </div>
      )}
      <span className="wf-faden-draft__hint">
        {chosen >= 0 && hits[chosen]
          ? `Eingabetaste holt „${hits[chosen]!.label}“ hierher`
          : kind === 'note'
            ? 'Eingabetaste legt die Notiz hin · ↑ ↓ wählt · Escape verwirft'
            : 'Eingabetaste legt es als Platzhalter hin · ↑ ↓ wählt · Escape verwirft'}
      </span>
    </div>
  );
}

/** Der Seitenteil, wenn mehrere Stücke gewählt sind. */
function PickedSide({
  count,
  loose,
  onTakeOff,
  onArea,
  onClear,
}: {
  count: number;
  loose: number;
  onTakeOff: () => void;
  onArea: () => void;
  onClear: () => void;
}) {
  return (
    <aside className="wf-faden-side">
      <div className="wf-faden-side__head">
        <span className="wf-faden-card__sort">Auswahl</span>
      </div>
      <h2 className="wf-faden-side__title">{count} gewählt</h2>
      <p className="wf-mute">
        Zieh eines davon – die anderen ziehen mit. Umschalt-Klick nimmt eines dazu oder heraus.
      </p>
      <div className="wf-faden-side__acts">
        <Button size="sm" icon={<Frame />} onClick={onArea}>
          Bereich darum legen
        </Button>
        {loose > 0 && (
          <Button size="sm" onClick={onTakeOff} title="Auch mit der Löschtaste">
            {loose === 1 ? 'Losen Faden vom Brett nehmen' : `${loose} lose Fäden vom Brett nehmen`}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onClear}>
          Auswahl aufheben
        </Button>
      </div>
    </aside>
  );
}

/**
 * Ein Bereich auf dem Brett: ein benannter Rahmen. Am Namen zieht man ihn (mit allem darin), die
 * Ecke unten rechts macht ihn größer, ein Doppelklick auf den Namen benennt ihn um. Die Fläche
 * selbst lässt Klicks durch – man arbeitet darin wie auf dem Brett.
 */
function AreaFrame({
  area,
  selected,
  naming,
  editable,
  onGrab,
  onResize,
  onName,
  onNamed,
}: {
  area: BoardArea;
  selected: boolean;
  naming: boolean;
  editable: boolean;
  onGrab: (event: PointerEvent) => void;
  onResize: (event: PointerEvent) => void;
  onName: () => void;
  /** null = abgebrochen. */
  onNamed: (title: string | null) => void;
}) {
  const [text, setText] = useState(area.title);
  useHoldDraft(naming && text !== area.title, `fadenbrett-bereich-${area.id}`);
  return (
    <div
      className="wf-faden-area"
      data-selected={selected}
      style={{ left: area.x, top: area.y, width: area.w, height: area.h }}
    >
      <div
        className="wf-faden-area__bar"
        onPointerDown={onGrab}
        onDoubleClick={(event) => {
          event.stopPropagation();
          onName();
        }}
        title={
          editable
            ? 'Ziehen verschiebt den Bereich mit allem darin · Doppelklick benennt ihn'
            : undefined
        }
      >
        {naming ? (
          <input
            autoFocus
            className="wf-input wf-faden-area__name"
            value={text}
            placeholder="Name des Bereichs"
            aria-label="Name des Bereichs"
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onNamed(text);
              if (event.key === 'Escape') {
                setText(area.title);
                onNamed(null);
              }
            }}
            onBlur={() => onNamed(text)}
          />
        ) : (
          <span className="wf-faden-area__title">{area.title || 'Bereich ohne Namen'}</span>
        )}
      </div>
      {editable && (
        <span
          className="wf-faden-area__resize"
          title="Größer oder kleiner ziehen"
          onPointerDown={onResize}
        />
      )}
    </div>
  );
}

/** Der Stand der Geschichte im Rahmen – in Brett-Worten, nur ein Hinweis. */
function FrameReady({ storyId }: { storyId: string }) {
  const data = useData();
  const ready = frameReadiness(data, storyId);
  if (!ready) return null;
  const row = (done: boolean, text: string) => (
    <li className={cx(done && 'is-done')}>
      {done ? <Check aria-hidden /> : <span aria-hidden>·</span>}
      {text}
    </li>
  );
  return (
    <section className="wf-faden-ready">
      <span className="wf-caps">{ready.playable ? 'Spielbar' : 'Auf dem Weg zum Spielen'}</span>
      <ul>
        {row(
          ready.starts.length > 0,
          ready.starts.length > 1 ? `${ready.starts.length} Einstiege` : 'Ein Einstieg',
        )}
        {row(ready.places > 0, ready.places > 1 ? `${ready.places} Orte` : 'Ein Ort')}
        {row(
          ready.found > 0,
          ready.found > 0
            ? `${ready.found}× „liegt in“ – der Spieltisch weiß, was wo zu finden ist`
            : 'Etwas, das an einem Ort zu finden ist',
        )}
        {ready.core &&
          row(
            ready.leads >= 3,
            `${ready.leads} ${ready.leads === 1 ? 'Faden führt' : 'Fäden führen'} zu „${ready.coreName}“`,
          )}
      </ul>
      {ready.missing.length > 0 && <p className="wf-mute">{ready.missing[0]}</p>}
    </section>
  );
}

/**
 * Der Seitenteil eines Rahmens: ob er eine Geschichte ist (dann gehört zu ihr, was darin liegt),
 * nur ihn zeigen, was darin liegt.
 */
function AreaSide({
  area,
  inside,
  only,
  onOnly,
  onSelect,
  onName,
  onDrop,
}: {
  area: BoardArea;
  inside: string[];
  only: boolean;
  onOnly: (on: boolean) => void;
  onSelect: (key: string) => void;
  onName: () => void;
  onDrop: () => void;
}) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const story = area.storyId ? data.stories[area.storyId] : undefined;
  const stories = Object.values(data.stories)
    .filter((entry) => !entry.closed || entry.id === area.storyId)
    .sort((a, b) => a.title.localeCompare(b.title, 'de'));
  const bind = (storyId: string | null | 'new') => {
    const done = setAreaStory(db, area.id, storyId);
    if (!done) return;
    toast({
      slot: 'fadenbrett',
      title: done.story ? 'Rahmen ist eine Geschichte' : 'Nur ein Rahmen',
      body: done.story
        ? `Was darin liegt, gehört zu „${done.story.title}“ – am Spieltisch, bei den Gefährten, unter „Kommt vor in“.`
        : 'Er ordnet nur noch das Brett.',
      action: { label: 'Rückgängig', run: done.undo },
    });
  };
  const names = inside.flatMap((key) => {
    const face = thingFace(data, key);
    if (face) return [{ key, label: face.name, sort: face.sort }];
    const piece = boardPiece(data, key);
    return piece
      ? [{ key, label: piece.title, sort: piece.sort === 'story' ? 'Geschichte' : 'Karte' }]
      : [];
  });
  return (
    <aside className="wf-faden-side">
      <div className="wf-faden-side__head">
        <span className="wf-faden-card__sort">Rahmen{story ? ' · Geschichte' : ''}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={onName}
          title="Auch mit Doppelklick auf den Namen"
        >
          Umbenennen
        </Button>
      </div>
      <h2 className="wf-faden-side__title">{area.title || 'Bereich ohne Namen'}</h2>
      <label className="wf-faden-side__field">
        <span className="wf-mute">Dieser Rahmen ist</span>
        <Select
          value={area.storyId ?? ''}
          onChange={(event) => bind(event.target.value || null)}
          aria-label="Geschichte des Rahmens"
        >
          <option value="">nur ein Rahmen zum Ordnen</option>
          {stories.map((entry) => (
            <option key={entry.id} value={entry.id}>
              die Geschichte „{entry.title}“
            </option>
          ))}
        </Select>
      </label>
      {!story && (
        <Button size="sm" onClick={() => bind('new')}>
          Als neue Geschichte „{area.title.trim() || 'Neue Geschichte'}“
        </Button>
      )}
      {story && (
        <p className="wf-mute">
          Was in diesem Rahmen liegt, gehört zu „{story.title}“ – ohne dass du etwas zuordnen musst.{' '}
          <button
            type="button"
            className="wf-faden-link"
            onClick={() => navigate(`/geschichte/${story.id}`)}
          >
            Blatt öffnen
          </button>
        </p>
      )}
      {story && <FrameReady storyId={story.id} />}
      <div className="wf-faden-side__acts">
        <Button size="sm" icon={only ? <Eye /> : <EyeOff />} onClick={() => onOnly(!only)}>
          {only ? 'Alles zeigen' : 'Nur diesen Rahmen zeigen'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDrop} title="Was darin liegt, bleibt">
          Rahmen entfernen
        </Button>
      </div>
      <section>
        <h3 className="wf-faden-side__sub">Darin ({names.length})</h3>
        {names.length === 0 ? (
          <p className="wf-mute">Noch liegt nichts darin. Zieh Karten hinein.</p>
        ) : (
          names.map((row) => (
            <button
              key={row.key}
              type="button"
              className="wf-faden-touchrow"
              onClick={() => onSelect(row.key)}
            >
              <span>{row.label}</span>
              <em>{row.sort}</em>
            </button>
          ))
        )}
      </section>
    </aside>
  );
}

/**
 * „Teile“ einer Geschichte im Seitenteil: zu welcher großen sie gehört (herauslösbar), ihre
 * Teilgeschichten (anklickbar), ein- und ausklappen auf dem Brett, eine neue Teilgeschichte.
 */
function StoryPartsSide({
  story,
  card,
  editable,
  onSelect,
}: {
  story: Story;
  card: BoardCard;
  editable: boolean;
  onSelect: (key: string) => void;
}) {
  const db = useDb();
  const data = useData();
  const [name, setName] = useState('');
  useHoldDraft(name.trim() !== '', `fadenbrett-teil-${story.id}`);
  const parts = Object.values(data.stories)
    .filter((part) => part.parentId === story.id && part.id !== story.id)
    .sort((a, b) => Number(a.closed) - Number(b.closed) || a.title.localeCompare(b.title, 'de'));
  const parent = story.parentId ? data.stories[story.parentId] : undefined;
  const add = () => {
    const made = addSubStory(db, story.id, name);
    setName('');
    if (!made) return;
    toast({
      slot: 'fadenbrett',
      title: 'Teilgeschichte angelegt',
      body: `„${made.story.title}“ ist Teil von „${story.title}“. Schreiben kannst du sie auf ihrem Blatt.`,
      action: { label: 'Rückgängig', run: made.undo },
    });
  };
  return (
    <section>
      <h3 className="wf-faden-side__sub">Teile</h3>
      {parent && card.partOf && (
        <p>
          <span className="wf-mute">Teil von </span>
          <button
            type="button"
            className="wf-faden-link"
            onClick={() => onSelect(`story:${parent.id}`)}
          >
            {parent.title}
          </button>
          {editable && (
            <>
              {' · '}
              <button
                type="button"
                className="wf-faden-link"
                onClick={() => {
                  const undo = setStoryParent(db, story.id, null);
                  if (undo)
                    toast({
                      slot: 'fadenbrett',
                      title: 'Herausgelöst',
                      body: `„${story.title}“ steht jetzt für sich.`,
                      action: { label: 'Rückgängig', run: undo },
                    });
                }}
              >
                herauslösen
              </button>
            </>
          )}
        </p>
      )}
      {parts.map((part) => (
        <button
          key={part.id}
          type="button"
          className="wf-faden-touchrow"
          onClick={() => onSelect(`story:${part.id}`)}
        >
          <span>{part.title}</span>
          <em>{part.closed ? 'zu Ende' : 'Teilgeschichte'}</em>
        </button>
      ))}
      {editable && (
        <input
          className="wf-input"
          value={name}
          placeholder="+ Teilgeschichte: Name …"
          aria-label={`Neue Teilgeschichte von „${story.title}“`}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add();
            if (event.key === 'Escape') setName('');
          }}
        />
      )}
      {editable && parts.length === 0 && !parent && (
        <p className="wf-mute">
          Eine große Geschichte hat Teile – etwa die Geschichte einer Familie oder eines Volkes, die
          in ihr mitläuft. Zieh eine Geschichte auf diese Karte oder schreib hier einen Namen.
        </p>
      )}
    </section>
  );
}

/** Was sich aus einer Schnur ins Leere neu anlegen lässt – die häufigsten Arten zuerst. */
const DROP_KINDS: EntityKind[] = ['person', 'place', 'faction', 'family', 'item'];

/**
 * Die Suche am Ende einer Schnur, die ins Leere gezogen wurde: Vorschläge aus dem Text (bevor
 * getippt wird), dann jeder Eintrag und Artikel, dazu „neu als Person, Ort …“ (als Platzhalter)
 * und „als neuen Faden“. Was gewählt wird, liegt am Ende der Schnur und ist gleich verbunden.
 */
function DropSearch({
  ask,
  pins,
  onPick,
  onThread,
  onCancel,
}: {
  ask: { from: string; at: Spot };
  pins: readonly BoardPin[];
  onPick: (pinKey: string) => void;
  onThread: (title: string) => void;
  onCancel: () => void;
}) {
  const db = useDb();
  const data = useData();
  const [query, setQuery] = useState('');
  useHoldDraft(query.trim() !== '', 'fadenbrett-schnur-suche');
  const suggestions = useMemo(() => dropSuggestions(data, ask.from), [data, ask.from]);
  const hits = useMemo(
    () =>
      searchWorld(data, query)
        .filter((hit) => hit.sort === 'entity' || hit.sort === 'article')
        .slice(0, 7),
    [data, query],
  );
  const name = query.replace(/\s+/g, ' ').trim();
  const exact = hits.some(
    (hit) => hit.label.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'),
  );
  const storyId = ask.from.startsWith('story:') ? ask.from.slice(6) : null;
  const rows: { key: string; label: string; sub: string; icon: ReactNode; run: () => void }[] = [];
  if (!name)
    for (const entity of suggestions)
      rows.push({
        key: `s:${entity.id}`,
        label: entity.name,
        sub: 'steht im Text',
        icon: <KindIcon kind={entity.kind} />,
        run: () => onPick(`node:${entity.id}`),
      });
  for (const hit of hits) {
    const key = hit.entity ? `node:${hit.entity.id}` : hit.key;
    rows.push({
      key,
      label: hit.label,
      sub: pins.some((entry) => entry.key === key) ? 'liegt schon da' : hit.sub,
      icon: hit.entity ? <KindIcon kind={hit.entity.kind} /> : <BookOpen aria-hidden />,
      run: () => onPick(key),
    });
  }
  if (name && !exact)
    for (const kind of DROP_KINDS)
      rows.push({
        key: `neu:${kind}`,
        label: `„${name}“ neu als ${KIND_LABEL[kind]}`,
        sub: 'Platzhalter – fertig geschrieben wird später',
        icon: <Plus aria-hidden />,
        run: () => {
          const made = addFromWriting(db, { name, kind, storyId });
          if (made) onPick(`node:${made.entity.id}`);
        },
      });
  if (name)
    rows.push({
      key: 'faden',
      label: `„${name}“ als neuen Faden`,
      sub: 'eine Frage, eine Spur – gleich verbunden',
      icon: <Waypoints aria-hidden />,
      run: () => onThread(name),
    });
  const [active, setActive] = useState(0);
  const pick = (index: number) => rows[index]?.run();
  return (
    <div
      className="wf-faden-search wf-faden-dropsearch"
      style={{ left: ask.at.x, top: ask.at.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <input
        autoFocus
        className="wf-input"
        value={query}
        placeholder="Wer oder was hängt daran? Suchen oder neu …"
        aria-label="Was ans Ende der Schnur kommt"
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((index) => Math.min(rows.length - 1, index + 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          } else if (event.key === 'Enter') pick(active);
          else if (event.key === 'Escape') onCancel();
        }}
      />
      <div className="wf-faden-search__hits" role="listbox">
        {rows.length === 0 && (
          <span className="wf-faden-search__none">
            Tippe einen Namen – Person, Ort, Artikel – oder einen neuen Faden.
          </span>
        )}
        {rows.map((row, index) => (
          <button
            key={row.key}
            type="button"
            role="option"
            aria-selected={index === active}
            className="wf-faden-search__hit"
            onMouseEnter={() => setActive(index)}
            onClick={() => pick(index)}
          >
            {row.icon}
            <span className="wf-clamp-1">{row.label}</span>
            <em className="wf-clamp-1">{row.sub}</em>
          </button>
        ))}
        <button
          type="button"
          className="wf-faden-search__hit wf-faden-dropsearch__cancel"
          onClick={onCancel}
        >
          <span />
          <span>Abbrechen</span>
          <em />
        </button>
      </div>
    </div>
  );
}

/**
 * Das Menü an einer Schnur: ihr Wort, was sie in der Welt bedeuten könnte (`linkOffers` – jedes
 * nur auf Klick, abwählbar), und „Schnur lösen“ (nur die Schnur).
 */
function LinkMenu({
  link,
  at,
  onRelate,
  onDrop,
  onClose,
}: {
  link: { id: string; a: string; b: string; word: string; dir: 'to' | 'none' };
  at: Spot;
  onRelate: (fromId: string, toId: string) => void;
  onDrop: () => void;
  onClose: () => void;
}) {
  const db = useDb();
  const data = useData();
  const name = (key: string): string => {
    const id = key.slice(key.indexOf(':') + 1);
    if (key.startsWith('node:')) return data.entities[id]?.name ?? '';
    if (key.startsWith('article:')) return data.articles[id]?.title ?? '';
    if (key.startsWith('story:')) return data.stories[id]?.title ?? '';
    return data.threads[id]?.title ?? '';
  };
  const offers = linkOffers(data, link.a, link.b);
  const meaning =
    factKindOf(link.word) ?? (!link.word.trim() && link.dir === 'to' ? 'leads' : null);
  const apply = (offer: LinkOffer, title: string) => {
    const undo = applyLinkOffer(db, offer);
    if (undo)
      toast({
        slot: 'fadenbrett',
        title,
        body: 'Die Schnur bleibt.',
        action: { label: 'Rückgängig', run: undo },
      });
  };
  const story = (id: string) => data.stories[id]?.title ?? '';
  const thread = (id: string) => data.threads[id]?.title ?? '';
  const entity = (id: string) => data.entities[id]?.name ?? '';
  const rows: { key: string; on: boolean; label: string; run: () => void }[] = [];
  offers.forEach((offer, index) => {
    const key = `${offer.kind}:${index}`;
    switch (offer.kind) {
      case 'cast':
        rows.push({
          key,
          on: offer.on,
          label: offer.on
            ? `${entity(offer.entityId)} gehört zu „${story(offer.storyId)}“ – herausnehmen`
            : `${entity(offer.entityId)} zu den Beteiligten von „${story(offer.storyId)}“`,
          run: () => apply(offer, offer.on ? 'Herausgenommen' : 'Eingetragen'),
        });
        break;
      case 'pin':
        rows.push({
          key,
          on: offer.on,
          label: offer.on
            ? `${entity(offer.entityId)} hängt am Faden – lösen`
            : `${entity(offer.entityId)} an den Faden „${thread(offer.threadId)}“ heften`,
          run: () => apply(offer, offer.on ? 'Gelöst' : 'Angeheftet'),
        });
        break;
      case 'relate':
        rows.push({
          key,
          on: offer.label !== '',
          label: offer.label ? `Beziehung: ${offer.label} – ändern …` : 'Beziehung eintragen …',
          run: () => onRelate(offer.fromId, offer.toId),
        });
        break;
      case 'question':
        rows.push({
          key,
          on: offer.on,
          label: offer.on
            ? `Faden von „${story(offer.storyId)}“ – lösen`
            : `Zum Faden von „${story(offer.storyId)}“ machen`,
          run: () => apply(offer, offer.on ? 'Gelöst' : 'Gehört jetzt zur Geschichte'),
        });
        break;
      case 'part':
        if (offer.allowed || offer.on)
          rows.push({
            key,
            on: offer.on,
            label: offer.on
              ? `„${story(offer.partId)}“ ist Teil von „${story(offer.wholeId)}“ – herauslösen`
              : `„${story(offer.partId)}“ ist Teil von „${story(offer.wholeId)}“`,
            run: () => apply(offer, offer.on ? 'Herausgelöst' : 'Als Teilgeschichte eingehängt'),
          });
        break;
      case 'tie':
        rows.push({
          key,
          on: offer.on,
          label: offer.on
            ? 'Fäden verbunden – lösen'
            : 'Fäden verbinden – am Spieltisch „ein Schritt weiter“',
          run: () => apply(offer, offer.on ? 'Verbindung gelöst' : 'Fäden verbunden'),
        });
        break;
      case 'article':
        rows.push({
          key,
          on: offer.on,
          label: offer.on
            ? 'Artikel ist zugeordnet – lösen'
            : `Artikel „${data.articles[offer.articleId]?.title ?? ''}“ zuordnen`,
          run: () => apply(offer, offer.on ? 'Zuordnung gelöst' : 'Artikel zugeordnet'),
        });
        break;
    }
  });
  return (
    <div
      className="wf-faden-linemenu"
      style={{ left: at.x, top: at.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <span className="wf-faden-linemenu__what">
        „{name(link.a)}“ {link.dir === 'to' ? '→' : '–'} „{name(link.b)}“
      </span>
      <span className="wf-btn-group wf-faden-linemenu__dir" role="group" aria-label="Richtung">
        <button
          type="button"
          className="wf-btn wf-btn--sm"
          aria-pressed={link.dir === 'to'}
          title={`„${name(link.a)}“ führt zu „${name(link.b)}“`}
          onClick={() => setBoardLinkDir(db, link.id, 'to')}
        >
          Pfeil
        </button>
        <button
          type="button"
          className="wf-btn wf-btn--sm"
          title="Der Pfeil zeigt in die andere Richtung"
          onClick={() => setBoardLinkDir(db, link.id, 'flip')}
        >
          Umdrehen
        </button>
        <button
          type="button"
          className="wf-btn wf-btn--sm"
          aria-pressed={link.dir === 'none'}
          title="Nur eine Schnur, ohne Richtung"
          onClick={() => setBoardLinkDir(db, link.id, 'none')}
        >
          Ohne Pfeil
        </button>
      </span>
      <Written
        className="wf-faden-linemenu__word"
        label="Was sie verbindet"
        wrap
        value={link.word}
        placeholder="was sie verbindet …"
        onSave={(word) => setBoardLinkWord(db, link.id, word)}
      />
      <span className="wf-faden-linemenu__note">
        {meaning
          ? `Wayfarer liest: ${FACT_LABEL[meaning]}`
          : 'Wayfarer versteht „liegt in“, „weiß von“ und „führt zu“ – sonst bleibt es eine Schnur.'}
      </span>
      {rows.length > 0 && (
        <span className="wf-faden-linemenu__offers">
          <span className="wf-faden-linemenu__note">Wenn du willst, auch in der Welt:</span>
          {rows.map((row) => (
            <button
              key={row.key}
              type="button"
              className="wf-faden-linemenu__offer"
              data-on={row.on}
              onClick={row.run}
            >
              {row.on ? '✓ ' : '+ '}
              {row.label}
            </button>
          ))}
        </span>
      )}
      <span className="wf-faden-linemenu__acts">
        <Button size="sm" onClick={onDrop} title="Auch mit der Löschtaste">
          Schnur lösen
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Schließen
        </Button>
      </span>
    </div>
  );
}
