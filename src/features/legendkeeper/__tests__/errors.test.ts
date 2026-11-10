import { describe, expect, it } from 'vitest';
import { LkError, describeError, parseRetryAfter, readResponse, transportError, type LkErrorKind } from '../errors';
import { fixtureText } from './fixtures';

const kindOf = (run: () => unknown): LkErrorKind | 'kein Fehler' => {
  try {
    run();
    return 'kein Fehler';
  } catch (error) {
    return error instanceof LkError ? error.kind : 'kein Fehler';
  }
};

describe('Antworten der API auswerten', () => {
  it('liest eine gültige Antwort', () => {
    const page = readResponse<{ data: { id: string }[] }>(200, fixtureText('projects.json'));
    expect(page.data[0]?.id).toBe('cbeispielprojekt000000001');
  });

  it('unterscheidet abgelehnten Key, fehlende Rechte und fehlenden Tarif', () => {
    expect(kindOf(() => readResponse(401, fixtureText('error-401.json')))).toBe('unauthorized');
    expect(kindOf(() => readResponse(403, '{"message":"x","code":"WRONG_PROJECT","requestId":"r"}'))).toBe('forbidden');
    expect(kindOf(() => readResponse(402, '{"message":"x","code":"PAID_PLAN_REQUIRED","requestId":"r"}'))).toBe('plan');
  });

  it('erkennt „gibt es nicht“ nur, wenn die API es selbst sagt', () => {
    expect(kindOf(() => readResponse(404, fixtureText('error-404.json')))).toBe('not-found');
    // Adressen außerhalb der API beantwortet LegendKeeper mit einer Webseite.
    expect(kindOf(() => readResponse(404, fixtureText('not-api.html')))).toBe('unexpected');
  });

  it('hält eine Webseite mit Status 200 nicht für Inhalt', () => {
    expect(kindOf(() => readResponse(200, fixtureText('not-api.html')))).toBe('unexpected');
    expect(kindOf(() => readResponse(200, ''))).toBe('unexpected');
    expect(kindOf(() => readResponse(200, '"nur ein Wort"'))).toBe('unexpected');
  });

  it('meldet zu viele Anfragen mit Wartezeit', () => {
    try {
      readResponse(429, fixtureText('error-429.json'), 17);
      throw new Error('hätte scheitern müssen');
    } catch (error) {
      expect(error).toBeInstanceOf(LkError);
      const lk = error as LkError;
      expect(lk.kind).toBe('rate-limited');
      expect(lk.retryAfterSec).toBe(17);
      expect(lk.code).toBe('RATE_LIMITED');
    }
  });

  it('ordnet Störungen und Zeitüberschreitungen des Servers ein', () => {
    expect(kindOf(() => readResponse(500, '{"message":"x","code":"INTERNAL","requestId":"r"}'))).toBe('server');
    expect(kindOf(() => readResponse(503, ''))).toBe('server');
    expect(kindOf(() => readResponse(504, ''))).toBe('timeout');
    expect(kindOf(() => readResponse(400, '{"message":"x","code":"KIND_MISMATCH","requestId":"r"}'))).toBe('unexpected');
  });

  it('liest „Retry-After“ nur als Sekundenzahl', () => {
    expect(parseRetryAfter('12')).toBe(12);
    expect(parseRetryAfter(' 0.4 ')).toBe(1);
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT')).toBeUndefined();
    expect(parseRetryAfter('-3')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});

describe('Fehler ohne Antwort einordnen', () => {
  it('versteht die Sätze der App-Seite', () => {
    expect(transportError('Es ist noch kein LegendKeeper-Key hinterlegt.').kind).toBe('not-configured');
    expect(transportError('LegendKeeper hat nicht rechtzeitig geantwortet. Bitte später erneut versuchen.').kind).toBe('timeout');
    expect(transportError('LegendKeeper ist nicht erreichbar. Besteht eine Internetverbindung?').kind).toBe('offline');
  });

  it('reicht einen unbekannten Satz der App-Seite zur Anzeige weiter', () => {
    const error = transportError('Die Antwort von LegendKeeper ist unerwartet groß und wurde verworfen.');
    expect(error.kind).toBe('offline');
    expect(describeError(error).text).toContain('unerwartet groß');
  });

  it('versteht Fehler des Browsers', () => {
    expect(transportError(new TypeError('Failed to fetch')).kind).toBe('offline');
    expect(transportError(new DOMException('abgebrochen', 'AbortError')).kind).toBe('aborted');
    const same = new LkError('timeout');
    expect(transportError(same)).toBe(same);
  });
});

describe('Fehler erklären', () => {
  const kinds: LkErrorKind[] = [
    'not-configured', 'preview', 'unauthorized', 'forbidden', 'plan', 'not-found', 'rate-limited',
    'offline', 'timeout', 'server', 'unexpected', 'aborted',
  ];

  it('hat für jeden Fehler Überschrift und ganzen Satz', () => {
    for (const kind of kinds) {
      const view = describeError(new LkError(kind));
      expect(view.title.length).toBeGreaterThan(5);
      expect(view.text).toMatch(/[.?!]$/);
    }
  });

  it('führt bei fehlendem oder abgelehntem Key in die Einstellungen', () => {
    expect(describeError(new LkError('not-configured')).action).toBe('settings');
    expect(describeError(new LkError('unauthorized')).action).toBe('settings');
    expect(describeError(new LkError('preview')).action).toBe('settings');
    expect(describeError(new LkError('offline')).action).toBe('retry');
  });

  it('nennt die Wartezeit bei zu vielen Anfragen', () => {
    expect(describeError(new LkError('rate-limited', { retryAfterSec: 30 })).text).toContain('in 30 Sekunden');
    expect(describeError(new LkError('rate-limited', { retryAfterSec: 240 })).text).toContain('4 Minuten');
    expect(describeError(new LkError('rate-limited')).text).toContain('etwa einer Minute');
  });

  it('erklärt einen Key aus einem anderen Projekt eigens', () => {
    expect(describeError(new LkError('forbidden', { code: 'WRONG_PROJECT' })).text).toContain('anderen LegendKeeper-Projekt');
  });

  it('rät bei einem verschwundenen Artikel zum Neuverknüpfen', () => {
    expect(describeError(new LkError('not-found'), 'article').text).toContain('Verknüpfung');
  });
});
