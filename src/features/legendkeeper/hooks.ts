/** Laden mit Abbruch: was nicht mehr gebraucht wird, wird verworfen statt angezeigt. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { LkError, isAborted, transportError } from './errors';

export type Load<T> =
  | { status: 'loading'; data: T | null }
  | { status: 'ready'; data: T; at: number }
  | { status: 'failed'; error: LkError; data: null };

export interface LoadOptions {
  signal: AbortSignal;
  /** Gemerktes übergehen („Aktualisieren“). */
  force: boolean;
}

interface Slot<T> {
  key: string | null;
  load: Load<T>;
}

/**
 * Lädt etwas zu einem Schlüssel und lädt neu, wenn der Schlüssel wechselt. Beim Aktualisieren
 * bleibt das Bisherige sichtbar; scheitert das Aktualisieren, bleibt es ebenfalls stehen und
 * `onRefreshError` erfährt den Grund.
 */
export function useLoad<T>(
  key: string | null,
  loader: (options: LoadOptions) => Promise<T>,
  onRefreshError?: (error: LkError) => void,
): { load: Load<T>; reload: () => void; refreshing: boolean } {
  const [slot, setSlot] = useState<Slot<T>>({ key, load: { status: 'loading', data: null } });
  const [round, setRound] = useState(0);
  const force = useRef(false);
  const loaderRef = useRef(loader);
  const errorRef = useRef(onRefreshError);
  loaderRef.current = loader;
  errorRef.current = onRefreshError;

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    const forced = force.current;
    force.current = false;
    setSlot((previous) => ({
      key,
      load: { status: 'loading', data: previous.key === key ? previous.load.data : null },
    }));
    loaderRef.current({ signal: controller.signal, force: forced }).then(
      (data) => {
        if (!controller.signal.aborted) setSlot({ key, load: { status: 'ready', data, at: Date.now() } });
      },
      (cause: unknown) => {
        if (controller.signal.aborted || isAborted(cause)) return;
        const error = transportError(cause);
        setSlot((previous) => {
          const kept = previous.key === key ? previous.load.data : null;
          if (kept === null) return { key, load: { status: 'failed', error, data: null } };
          errorRef.current?.(error);
          return { key, load: { status: 'ready', data: kept, at: Date.now() } };
        });
      },
    );
    return () => controller.abort();
  }, [key, round]);

  const reload = useCallback(() => {
    force.current = true;
    setRound((value) => value + 1);
  }, []);

  // Zwischen dem Wechsel des Schlüssels und dem Start des Ladens gilt: noch nichts da.
  const load: Load<T> = slot.key === key ? slot.load : { status: 'loading', data: null };
  return { load, reload, refreshing: load.status === 'loading' && load.data !== null };
}

/** Gibt einen Wert erst weiter, wenn er sich eine Weile nicht geändert hat (Tippen im Suchfeld). */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
