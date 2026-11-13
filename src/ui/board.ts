/**
 * Ein Blatt, auf dem man Dinge frei auslegt: verschieben mit der Maus, vergrößern mit dem Rad,
 * einzelne Stücke ziehen. Grundlage für das Wegenetz und das Fadenbrett.
 *
 * Das Blatt ist ein Kasten (`ref`) mit einer Ebene darin, die über `transform` verschoben und
 * vergrößert wird; was auf der Ebene liegt, rechnet in den Maßen des Blatts.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';

export interface BoardView {
  /** Verschiebung der Ebene im Kasten, in Bildpunkten. */
  x: number;
  y: number;
  /** Vergrößerung. */
  k: number;
}

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2;
/** Erst ab so vielen Bildpunkten gilt eine Bewegung als Ziehen, nicht als Klick. */
const DRAG_THRESHOLD = 4;

const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

export interface DragHandlers {
  /** Die Bewegung seit dem Start, in den Maßen des Blatts. */
  onMove: (dx: number, dy: number) => void;
  /** `moved` = es wurde gezogen (sonst war es ein Klick). */
  onEnd: (moved: boolean, dx: number, dy: number) => void;
}

export function useBoard(ref: RefObject<HTMLElement | null>, start?: BoardView) {
  const [view, setView] = useState<BoardView>(start ?? { x: 0, y: 0, k: 1 });
  const live = useRef(view);
  live.current = view;

  // Das Rad vergrößert um die Stelle unter der Maus. Nicht passiv, sonst rollt die Seite mit.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const [px, py] = [event.clientX - rect.left, event.clientY - rect.top];
      setView((current) => {
        const k = clampZoom(current.k * Math.exp(-event.deltaY * 0.0015));
        const ratio = k / current.k;
        return { k, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [ref]);

  /** Die Stelle auf dem Blatt unter einem Punkt des Fensters. */
  const toBoard = useCallback(
    (clientX: number, clientY: number) => {
      const rect = ref.current?.getBoundingClientRect();
      const current = live.current;
      return {
        x: (clientX - (rect?.left ?? 0) - current.x) / current.k,
        y: (clientY - (rect?.top ?? 0) - current.y) / current.k,
      };
    },
    [ref],
  );

  /** Beginnt ein Ziehen – eines Stücks auf dem Blatt oder (mit `pan`) des Blatts selbst. */
  const drag = useCallback((event: PointerEvent, handlers: DragHandlers) => {
    if (event.button !== 0) return;
    const [startX, startY] = [event.clientX, event.clientY];
    let moved = false;
    const delta = (e: globalThis.PointerEvent) => {
      const k = live.current.k;
      return [(e.clientX - startX) / k, (e.clientY - startY) / k] as const;
    };
    const onMove = (e: globalThis.PointerEvent) => {
      if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
      moved = true;
      handlers.onMove(...delta(e));
    };
    const onUp = (e: globalThis.PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      handlers.onEnd(moved, ...delta(e));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, []);

  /** Verschiebt das Blatt; `onClick` meldet einen Klick ins Leere. */
  const pan = useCallback(
    (event: PointerEvent, onClick?: () => void) => {
      const from = live.current;
      drag(event, {
        onMove: (dx, dy) => setView({ ...from, x: from.x + dx * from.k, y: from.y + dy * from.k }),
        onEnd: (moved) => {
          if (!moved) onClick?.();
        },
      });
    },
    [drag],
  );

  /** Zeigt alles: rückt und verkleinert so, dass die genannten Stellen ins Bild passen. */
  const fit = useCallback(
    (spots: readonly { x: number; y: number }[], pad = 120) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect || !spots.length) return setView({ x: pad, y: pad, k: 1 });
      const xs = spots.map((spot) => spot.x);
      const ys = spots.map((spot) => spot.y);
      const [minX, maxX, minY, maxY] = [
        Math.min(...xs),
        Math.max(...xs),
        Math.min(...ys),
        Math.max(...ys),
      ];
      const k = clampZoom(
        Math.min(
          1,
          (rect.width - 2 * pad) / Math.max(1, maxX - minX),
          (rect.height - 2 * pad) / Math.max(1, maxY - minY),
        ),
      );
      setView({
        k,
        x: rect.width / 2 - ((minX + maxX) / 2) * k,
        y: rect.height / 2 - ((minY + maxY) / 2) * k,
      });
    },
    [ref],
  );

  const zoom = useCallback(
    (factor: number) => {
      const rect = ref.current?.getBoundingClientRect();
      const [px, py] = [(rect?.width ?? 0) / 2, (rect?.height ?? 0) / 2];
      setView((current) => {
        const k = clampZoom(current.k * factor);
        const ratio = k / current.k;
        return { k, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
      });
    },
    [ref],
  );

  return {
    view,
    setView,
    toBoard,
    drag,
    pan,
    fit,
    zoom,
    /** Für die Ebene im Kasten. */
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
  };
}
