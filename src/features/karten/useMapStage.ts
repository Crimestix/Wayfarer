/**
 * Die Bühne einer gezeichneten Karte: Zeichenfläche, Ausschnitt (ziehen, Mausrad), Formen und
 * Farben. Die Zeichenfläche zum Zeichnen und die Ansicht am Spieltisch teilen sie sich.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useData } from '../../data/hooks';
import type { GameMap } from '../../domain/schema';
import { drawMap, makeTextures, paletteOf, type Palette, type Scene, type Textures } from './draw';
import { clampView, fitView, toMap, zoomView, type View } from './model';
import { shapesOf } from './shapes';

/** Was über die Karte hinaus zu zeichnen ist – wird bei jedem Zeichnen neu gefragt. */
export type StageExtras = Pick<Scene, 'draft' | 'selected' | 'brush' | 'here'>;

export function useMapStage(map: GameMap, extras: () => StageExtras) {
  const data = useData();
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textures = useRef<{ level: GameMap['level']; paper: Textures } | null>(null);
  const palette = useRef<{ level: GameMap['level']; colors: Palette } | null>(null);
  const view = useRef<View | null>(null);
  const size = useRef({ width: 0, height: 0, dpr: 1 });
  const frame = map.frame ?? { width: 1000, height: 700 };

  /** Die Formen der Karte – neu gerechnet, sobald sich Gelände oder Gänge ändern. */
  const shapes = useMemo(
    () => shapesOf(map),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map.id, map.strokes, map.lines, map.ground, map.level, map.frame],
  );
  const labels = useMemo(() => {
    const names = new Map<string, string>();
    for (const marker of map.markers) {
      const name = (marker.entityId && data.entities[marker.entityId]?.name) || marker.label;
      if (name) names.set(marker.id, name);
    }
    return names;
  }, [map.markers, data.entities]);

  /** Zeichnet die Karte neu – sofort, ohne auf das nächste Bild zu warten. */
  const paint = () => {
    const element = canvas.current;
    const ctx = element?.getContext('2d');
    if (!element || !ctx || !view.current || !size.current.width) return;
    if (palette.current?.level !== map.level)
      palette.current = { level: map.level, colors: paletteOf(element, map.level) };
    if (textures.current?.level !== map.level)
      textures.current = { level: map.level, paper: makeTextures(map.level) };
    drawMap(
      ctx,
      textures.current.paper,
      { map, view: view.current, ...size.current, shapes, labels, ...extras() },
      palette.current.colors,
    );
  };
  const paintNow = useRef(paint);
  paintNow.current = paint;
  useLayoutEffect(() => paint());

  // Größe der Zeichenfläche: folgt ihrem Platz; beim ersten Mal die ganze Karte zeigen.
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size.current = { width: box.width, height: box.height, dpr };
      if (canvas.current) {
        canvas.current.width = Math.round(box.width * dpr);
        canvas.current.height = Math.round(box.height * dpr);
      }
      if (box.width && box.height)
        view.current = view.current
          ? clampView(view.current, frame, box.width, box.height)
          : fitView(frame, box.width, box.height);
      paintNow.current();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame.width, frame.height]);

  // Mausrad vergrößert um die Stelle unter dem Zeiger.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!view.current) return;
      const box = element.getBoundingClientRect();
      view.current = zoomView(
        view.current,
        Math.exp(-event.deltaY * 0.0015),
        event.clientX - box.left,
        event.clientY - box.top,
        frame,
        size.current.width,
        size.current.height,
      );
      paintNow.current();
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame.width, frame.height]);

  /** Stelle des Zeigers auf der Zeichenfläche, in Bildschirmpunkten. */
  const local = (event: { clientX: number; clientY: number }): [number, number] => {
    const box = canvas.current!.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  };
  /** Stelle des Zeigers auf der Karte. */
  const mapPoint = (event: { clientX: number; clientY: number }): [number, number] | null =>
    view.current ? toMap(view.current, ...local(event)) : null;
  const zoomBy = (factor: number) => {
    if (!view.current) return;
    const { width, height } = size.current;
    view.current = zoomView(view.current, factor, width / 2, height / 2, frame, width, height);
    paint();
  };
  const fit = () => {
    view.current = fitView(frame, size.current.width, size.current.height);
    paint();
  };
  /** Verschiebt den Ausschnitt: `from` ist der Ausschnitt zu Beginn des Ziehens. */
  const panFrom = (from: View, dx: number, dy: number) => {
    view.current = clampView(
      { zoom: from.zoom, x: from.x - dx / from.zoom, y: from.y - dy / from.zoom },
      frame,
      size.current.width,
      size.current.height,
    );
  };

  return { stage, canvas, view, size, frame, paint, local, mapPoint, zoomBy, fit, panFrom };
}
