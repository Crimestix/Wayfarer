import { describe, expect, it } from 'vitest';
import { LkError } from '../errors';
import {
  RECHECK_AFTER_MS,
  clockTime,
  shouldRecheck,
  statusView,
  type StatusInput,
} from '../status';

const base: StatusInput = {
  phase: 'ready',
  projectName: 'Elaris',
  desktop: true,
  catalog: { status: 'idle', loaded: 0 },
};
const at = new Date(2026, 10, 10, 14, 5).getTime();

describe('Zustand der Verbindung', () => {
  it('nennt Projekt, Artikelzahl und Zeitpunkt der Prüfung', () => {
    const view = statusView({ ...base, catalog: { status: 'ready', loaded: 1637 }, checkedAt: at });
    expect(view).toEqual({
      tone: 'ok',
      title: 'Verbunden mit „Elaris“',
      text: '1.637 Artikel im Verzeichnis · geprüft um 14:05',
    });
  });

  it('zeigt den Fortschritt beim Laden des Verzeichnisses', () => {
    expect(statusView({ ...base, catalog: { status: 'loading', loaded: 300 } }).text).toBe(
      'Verzeichnis wird geladen – bisher 300 Artikel',
    );
    expect(statusView({ ...base, catalog: { status: 'loading', loaded: 0 } }).text).toBe(
      'Verzeichnis wird geladen …',
    );
    expect(statusView({ ...base, catalog: { status: 'ready', loaded: 1 } }).text).toBe(
      '1 Artikel im Verzeichnis',
    );
  });

  it('sagt in der Vorschau ehrlich, woher der Zugang kommt', () => {
    expect(statusView({ ...base, desktop: false }).text).toContain('Entwicklungsumgebung');
  });

  it('unterscheidet „nicht eingerichtet“ von einem Problem', () => {
    expect(
      statusView({ ...base, phase: 'failed', error: new LkError('not-configured') }),
    ).toMatchObject({
      tone: 'off',
      title: 'Noch nicht eingerichtet',
    });
    expect(
      statusView({ ...base, phase: 'failed', desktop: false, error: new LkError('preview') }).tone,
    ).toBe('off');
    expect(
      statusView({ ...base, phase: 'failed', error: new LkError('unauthorized') }),
    ).toMatchObject({
      tone: 'problem',
      title: 'LegendKeeper lehnt den Schlüssel ab',
    });
    expect(statusView({ ...base, phase: 'failed', error: new LkError('offline') }).tone).toBe(
      'problem',
    );
  });

  it('zeigt während der Prüfung, dass geprüft wird', () => {
    expect(statusView({ ...base, phase: 'checking' }).tone).toBe('busy');
    expect(statusView({ ...base, phase: 'idle' }).tone).toBe('busy');
  });

  it('schreibt Uhrzeiten zweistellig', () => {
    expect(clockTime(new Date(2026, 0, 1, 7, 3).getTime())).toBe('07:03');
  });
});

describe('Von selbst noch einmal prüfen', () => {
  const failed = (kind: ConstructorParameters<typeof LkError>[0], checkedAt = 0) => ({
    phase: 'failed',
    error: new LkError(kind),
    checkedAt,
  });

  it('prüft nach einer vorübergehenden Störung erneut, sobald etwas Zeit vergangen ist', () => {
    for (const kind of ['offline', 'timeout', 'server', 'rate-limited'] as const) {
      expect(shouldRecheck(failed(kind), RECHECK_AFTER_MS), kind).toBe(true);
      expect(shouldRecheck(failed(kind), RECHECK_AFTER_MS - 1), kind).toBe(false);
    }
  });

  it('prüft nicht von selbst, wenn nur der Spielleiter etwas ändern kann', () => {
    for (const kind of [
      'not-configured',
      'unauthorized',
      'forbidden',
      'plan',
      'preview',
    ] as const) {
      expect(shouldRecheck(failed(kind), 10 * RECHECK_AFTER_MS), kind).toBe(false);
    }
  });

  it('lässt eine stehende oder laufende Verbindung in Ruhe', () => {
    expect(shouldRecheck({ phase: 'ready', checkedAt: 0 }, 10 * RECHECK_AFTER_MS)).toBe(false);
    expect(shouldRecheck({ phase: 'checking' }, 10 * RECHECK_AFTER_MS)).toBe(false);
    expect(shouldRecheck({ phase: 'idle' }, 10 * RECHECK_AFTER_MS)).toBe(false);
  });
});
