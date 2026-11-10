import { describe, expect, it } from 'vitest';
import {
  articleUrl,
  createLkClient,
  queryString,
  type LkMode,
  type LkQuery,
  type LkRawResponse,
  type LkTransport,
} from '../client';
import { LkError } from '../errors';
import type { LkPage, LkResourceListItem } from '../types';
import { fixtureText } from './fixtures';

interface Call {
  path: string;
  query: LkQuery | undefined;
  signal: AbortSignal;
  answer: (response: LkRawResponse) => void;
  fail: (cause: unknown) => void;
}

/** Nachgestellter Weg zur API: merkt sich jede Anfrage; die Antwort gibt der Test. */
function fakeTransport(mode: LkMode = 'desktop') {
  const calls: Call[] = [];
  const transport: LkTransport = {
    mode,
    get: (path, query, signal) =>
      new Promise<LkRawResponse>((resolve, reject) => {
        calls.push({ path, query, signal, answer: resolve, fail: reject });
      }),
  };
  return { transport, calls };
}

/** Weg, der sofort aus einer Tabelle antwortet. */
function scriptedTransport(answers: Record<string, LkRawResponse>, mode: LkMode = 'desktop') {
  const seen: string[] = [];
  const transport: LkTransport = {
    mode,
    async get(path, query) {
      const key = `${path}${queryString(query)}`;
      seen.push(key);
      const answer = answers[key];
      if (!answer) throw new Error(`Unerwartete Anfrage: ${key}`);
      return answer;
    },
  };
  return { transport, seen };
}

const ok = (body: string): LkRawResponse => ({ status: 200, body });
const kindOf = async (work: Promise<unknown>) => {
  try {
    await work;
    return 'kein Fehler';
  } catch (error) {
    return error instanceof LkError ? error.kind : `fremd: ${String(error)}`;
  }
};
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('Abfrageparameter', () => {
  it('sortiert Namen, wiederholt Listen und lässt Leeres weg', () => {
    expect(queryString({ limit: 100, cursor: null, q: 'a b&c', tag: ['x', 'y'], flag: true })).toBe(
      '?flag=true&limit=100&q=a+b%26c&tag=x&tag=y',
    );
    expect(queryString(undefined)).toBe('');
    expect(queryString({ cursor: null })).toBe('');
  });
});

describe('Zwischenspeicher', () => {
  it('fragt dieselbe Adresse innerhalb der Ablaufzeit nur einmal ab', async () => {
    let time = 1_000;
    const { transport, seen } = scriptedTransport({
      '/projects?limit=1': ok(fixtureText('projects.json')),
    });
    const client = createLkClient(transport, () => time);
    await client.get('/projects', { limit: 1 }, { maxAgeMs: 5_000 });
    time += 4_000;
    await client.get('/projects', { limit: 1 }, { maxAgeMs: 5_000 });
    expect(seen).toHaveLength(1);
    time += 2_000;
    await client.get('/projects', { limit: 1 }, { maxAgeMs: 5_000 });
    expect(seen).toHaveLength(2);
  });

  it('weiß, wann eine gemerkte Antwort wirklich geholt wurde', async () => {
    let time = 1_000;
    const { transport } = scriptedTransport({ '/a?limit=1': ok('{"n":1}') });
    const client = createLkClient(transport, () => time);
    expect(client.fetchedAt('/a', { limit: 1 })).toBeUndefined();
    await client.get('/a', { limit: 1 });
    time += 90_000;
    // Aus dem Gemerkten bedient: der Zeitpunkt bleibt der des echten Abrufs.
    await client.get('/a', { limit: 1 });
    expect(client.fetchedAt('/a', { limit: 1 })).toBe(1_000);
    await client.get('/a', { limit: 1 }, { force: true });
    expect(client.fetchedAt('/a', { limit: 1 })).toBe(91_000);
    client.forget();
    expect(client.fetchedAt('/a', { limit: 1 })).toBeUndefined();
  });

  it('holt auf Wunsch frisch und vergisst gezielt', async () => {
    const { transport, seen } = scriptedTransport({
      '/a': ok('{"n":1}'),
      '/projects/p/resources/r1': ok('{"n":2}'),
      '/projects/p/resources/r1/docs/d/blocks': ok('{"n":3}'),
      '/projects/p/resources/r10': ok('{"n":4}'),
    });
    const client = createLkClient(transport);
    await client.get('/a');
    await client.get('/a', undefined, { force: true });
    expect(seen.filter((key) => key === '/a')).toHaveLength(2);

    for (const path of [
      '/projects/p/resources/r1',
      '/projects/p/resources/r1/docs/d/blocks',
      '/projects/p/resources/r10',
    ])
      await client.get(path);
    client.forget((path) => path.endsWith('/resources/r1') || path.includes('/resources/r1/'));
    for (const path of [
      '/projects/p/resources/r1',
      '/projects/p/resources/r1/docs/d/blocks',
      '/projects/p/resources/r10',
    ])
      await client.get(path);
    expect(seen.filter((key) => key === '/projects/p/resources/r1')).toHaveLength(2);
    expect(seen.filter((key) => key === '/projects/p/resources/r1/docs/d/blocks')).toHaveLength(2);
    expect(seen.filter((key) => key === '/projects/p/resources/r10')).toHaveLength(1);
  });

  it('merkt sich keine Fehler', async () => {
    let count = 0;
    const transport: LkTransport = {
      mode: 'desktop',
      async get() {
        count += 1;
        return count === 1 ? { status: 503, body: '' } : ok('{"gut":true}');
      },
    };
    const client = createLkClient(transport);
    expect(await kindOf(client.get('/a'))).toBe('server');
    expect(await client.get('/a')).toEqual({ gut: true });
  });

  it('merkt sich nach „alles vergessen“ keine Antwort von davor', async () => {
    const { transport, calls } = fakeTransport();
    const client = createLkClient(transport);
    const pending = client.get('/a');
    client.forget();
    expect(calls[0]?.signal.aborted).toBe(true);
    calls[0]?.answer(ok('{"alt":true}'));
    await pending.catch(() => undefined);
    void client.get('/a');
    expect(calls).toHaveLength(2);
  });
});

describe('Gleiche und veraltete Anfragen', () => {
  it('legt gleichzeitige gleiche Anfragen zusammen', async () => {
    const { transport, calls } = fakeTransport();
    const client = createLkClient(transport);
    const first = client.get('/a');
    const second = client.get('/a');
    expect(calls).toHaveLength(1);
    calls[0]?.answer(ok('{"n":1}'));
    expect(await first).toEqual({ n: 1 });
    expect(await second).toEqual({ n: 1 });
  });

  it('bricht ab, sobald niemand mehr wartet', async () => {
    const { transport, calls } = fakeTransport();
    const client = createLkClient(transport);
    const stale = new AbortController();
    const pending = client.get('/search', { q: 'dor' }, { signal: stale.signal });
    stale.abort();
    expect(await kindOf(pending)).toBe('aborted');
    expect(calls[0]?.signal.aborted).toBe(true);
    // Die nächste Anfrage beginnt neu statt an der abgebrochenen zu hängen.
    void client.get('/search', { q: 'dor' });
    expect(calls).toHaveLength(2);
  });

  it('bricht nicht ab, solange ein anderer noch wartet', async () => {
    const { transport, calls } = fakeTransport();
    const client = createLkClient(transport);
    const impatient = new AbortController();
    const gone = client.get('/a', undefined, { signal: impatient.signal });
    const stays = client.get('/a');
    impatient.abort();
    expect(await kindOf(gone)).toBe('aborted');
    expect(calls[0]?.signal.aborted).toBe(false);
    calls[0]?.answer(ok('{"n":1}'));
    expect(await stays).toEqual({ n: 1 });
  });

  it('beginnt gar nicht erst, wenn schon abgebrochen wurde', async () => {
    const { transport, calls } = fakeTransport();
    const client = createLkClient(transport);
    const controller = new AbortController();
    controller.abort();
    expect(await kindOf(client.get('/a', undefined, { signal: controller.signal }))).toBe(
      'aborted',
    );
    expect(calls).toHaveLength(0);
  });

  it('meldet einen Fehler ohne Zuhörer nicht als unbehandelt', async () => {
    const { transport, calls } = fakeTransport();
    const client = createLkClient(transport);
    const controller = new AbortController();
    const pending = client.get('/a', undefined, { signal: controller.signal });
    controller.abort();
    calls[0]?.fail('LegendKeeper ist nicht erreichbar. Besteht eine Internetverbindung?');
    expect(await kindOf(pending)).toBe('aborted');
    await tick();
  });
});

describe('Fehler unterscheiden', () => {
  const failing = (response: LkRawResponse | (() => never), mode: LkMode = 'desktop') =>
    createLkClient({
      mode,
      async get() {
        return typeof response === 'function' ? response() : response;
      },
    });

  it('installierte App: fehlender Key, abgelehnter Key, keine Verbindung, Zeitüberschreitung, zu viele Anfragen', async () => {
    const thrown = (cause: unknown) =>
      failing(() => {
        throw cause;
      });
    expect(
      await kindOf(thrown('Es ist noch kein LegendKeeper-Key hinterlegt.').get('/projects')),
    ).toBe('not-configured');
    expect(
      await kindOf(failing({ status: 401, body: fixtureText('error-401.json') }).get('/projects')),
    ).toBe('unauthorized');
    expect(
      await kindOf(
        thrown('LegendKeeper ist nicht erreichbar. Besteht eine Internetverbindung?').get(
          '/projects',
        ),
      ),
    ).toBe('offline');
    expect(
      await kindOf(
        thrown(
          'LegendKeeper hat nicht rechtzeitig geantwortet. Bitte später erneut versuchen.',
        ).get('/projects'),
      ),
    ).toBe('timeout');
    expect(
      await kindOf(
        failing({ status: 429, body: fixtureText('error-429.json'), retryAfterSec: 9 }).get(
          '/projects',
        ),
      ),
    ).toBe('rate-limited');
    expect(
      await kindOf(failing({ status: 404, body: fixtureText('not-api.html') }).get('/resources')),
    ).toBe('unexpected');
  });

  it('Vorschau: ohne Zugang heißt es „nur in der installierten App“, nicht „Key abgelehnt“', async () => {
    expect(
      await kindOf(
        failing({ status: 401, body: fixtureText('error-401.json') }, 'preview').get('/projects'),
      ),
    ).toBe('preview');
    // Ohne Entwicklungs-Proxy antwortet der Webserver mit der App selbst.
    expect(
      await kindOf(failing(ok('<!doctype html><html></html>'), 'preview').get('/projects')),
    ).toBe('preview');
    expect(
      await kindOf(
        failing({ status: 404, body: fixtureText('not-api.html') }, 'preview').get('/projects'),
      ),
    ).toBe('preview');
    // Der Proxy erreicht LegendKeeper nicht.
    expect(await kindOf(failing({ status: 500, body: '' }, 'preview').get('/projects'))).toBe(
      'offline',
    );
    // Mit Zugang bleiben echte Fehler echte Fehler.
    expect(
      await kindOf(
        failing({ status: 404, body: fixtureText('error-404.json') }, 'preview').get(
          '/projects/p/resources/x',
        ),
      ),
    ).toBe('not-found');
  });
});

describe('Projekt und seitenweises Laden', () => {
  it('ermittelt das Projekt des Keys', async () => {
    const { transport } = scriptedTransport({
      '/projects?limit=1': ok(fixtureText('projects.json')),
    });
    expect(await createLkClient(transport).project()).toEqual({
      id: 'cbeispielprojekt000000001',
      name: 'Elaris (Beispielwelt)',
    });
  });

  it('meldet einen Key ohne Projekt verständlich', async () => {
    const { transport } = scriptedTransport({
      '/projects?limit=1': ok('{"data":[],"hasMore":false,"nextCursor":null}'),
    });
    try {
      await createLkClient(transport).project();
      throw new Error('hätte scheitern müssen');
    } catch (error) {
      expect((error as LkError).kind).toBe('unexpected');
      expect((error as LkError).detail).toContain('kein LegendKeeper-Projekt');
    }
  });

  it('lädt alle Seiten einer Liste und meldet den Fortschritt', async () => {
    const { transport, seen } = scriptedTransport({
      '/projects/p/resources?limit=100': ok(fixtureText('resources-1.json')),
      '/projects/p/resources?cursor=cursor-seite-2&limit=100': ok(fixtureText('resources-2.json')),
    });
    const progress: number[] = [];
    const items = await createLkClient(transport).list<LkResourceListItem>(
      '/projects/p/resources',
      {},
      { onPage: (n) => progress.push(n) },
    );
    expect(items).toHaveLength(15);
    expect(progress).toEqual([7, 15]);
    expect(seen).toHaveLength(2);
  });

  it('hört auf, wenn sich der Verweis auf die nächste Seite nicht ändert, und an der Obergrenze', async () => {
    const stuck: LkPage<{ id: string }> = {
      data: [{ id: 'x' }],
      hasMore: true,
      nextCursor: 'immer-gleich',
    };
    const { transport, seen } = scriptedTransport({
      '/l?limit=100': ok(JSON.stringify(stuck)),
      '/l?cursor=immer-gleich&limit=100': ok(JSON.stringify(stuck)),
    });
    expect(await createLkClient(transport).list('/l')).toHaveLength(2);
    expect(seen).toHaveLength(2);

    let n = 0;
    const endless: LkTransport = {
      mode: 'desktop',
      async get() {
        n += 1;
        return ok(JSON.stringify({ data: [{ id: `i${n}` }], hasMore: true, nextCursor: `c${n}` }));
      },
    };
    expect(await createLkClient(endless).list('/l', {}, { maxPages: 5 })).toHaveLength(5);
  });

  it('bricht das Laden einer Liste mittendrin ab', async () => {
    const { transport, calls } = fakeTransport();
    const controller = new AbortController();
    const pending = createLkClient(transport).list('/l', {}, { signal: controller.signal });
    calls[0]?.answer(ok(JSON.stringify({ data: [{ id: 'a' }], hasMore: true, nextCursor: 'c1' })));
    await tick();
    expect(calls).toHaveLength(2);
    controller.abort();
    expect(await kindOf(pending)).toBe('aborted');
    expect(calls[1]?.signal.aborted).toBe(true);
  });

  it('weist eine Antwort zurück, die keine Liste ist', async () => {
    const { transport } = scriptedTransport({ '/l?limit=100': ok('{"data":"nein"}') });
    expect(await kindOf(createLkClient(transport).list('/l'))).toBe('unexpected');
  });
});

describe('Adresse in LegendKeeper', () => {
  it('führt zum Artikel und auf Wunsch zur Seite', () => {
    expect(articleUrl('proj1', 'res1')).toBe('https://www.legendkeeper.com/p/proj1/res1/');
    expect(articleUrl('proj1', 'res1', 'doc1')).toBe(
      'https://www.legendkeeper.com/p/proj1/res1/doc1/',
    );
    expect(articleUrl('a/b', 'c d')).toBe('https://www.legendkeeper.com/p/a%2Fb/c%20d/');
  });
});
