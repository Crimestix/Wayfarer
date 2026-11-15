/**
 * Naht TypeScript ↔ Rust: Die Vorlagen in `src-tauri/src/sync/contract/*.json` beschreiben jede
 * Ein- und Ausgabe der Befehle. Rust ruft die Befehle mit denselben Vorlagen über `invoke` auf
 * (`tests_sync.rs`); hier wird geprüft, dass sie zu den Typen in `data/platform.ts` passen und
 * dass die Attrappe (`fake.ts`) dieselbe Gestalt liefert.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type {
  ApplyBeginInput,
  AsideRun,
  MarkInput,
  PushInput,
  SyncScan,
  SyncStateInfo,
} from '../../../data/platform';
import { MemoryStore } from '../../../data/store';
import { FakeRepo, MemoryPort } from './fake';

const DIR = join(__dirname, '../../../../src-tauri/src/sync/contract');
const template = (name: string): unknown =>
  JSON.parse(readFileSync(join(DIR, name), 'utf8').replaceAll('"<root>"', '"/kampagne"'));

const sha = z.string().regex(/^[0-9a-f]{40}$/);
const link = z.strictObject({
  owner: z.string(),
  repo: z.string(),
  branch: z.string(),
  device: z.string(),
  root: z.string(),
});
const decision = z.strictObject({
  choice: z.enum(['local', 'remote', 'ok', 'back']),
  remote: sha.nullable(),
  fields: z.array(z.array(z.string())).nullable(),
});
const file = z.strictObject({ path: z.string(), sha, size: z.number() });
const marker = z.strictObject({
  datenstand: z.number(),
  gestalt: z.string(),
  geraete: z.record(z.string(), z.number()),
});
const kind = z.enum(['empty', 'fresh', 'wayfarer', 'foreign']);

const state = z.strictObject({
  key: z.enum(['yes', 'no', 'denied']),
  link: link.nullable(),
  moved: z.boolean(),
  hasBase: z.boolean(),
  pending: z.enum(['run', 'adopt', 'remoteWins']).nullable(),
  older: z.boolean(),
  syncedAt: z.string().nullable(),
  device: z.string().nullable(),
  pushedAt: z.string().nullable(),
  aside: z.number(),
}) satisfies z.ZodType<SyncStateInfo>;

const scan = z.strictObject({
  link: link.nullable(),
  base: z.record(z.string(), sha).nullable(),
  decided: z.record(z.string(), decision),
  local: z.array(file),
  frozen: z.array(
    z.strictObject({ path: z.string(), reason: z.enum(['case', 'encoding', 'size', 'locked']) }),
  ),
  settled: z.number(),
  maxVersion: z.number(),
  olderEdits: z.boolean(),
  remote: z
    .strictObject({
      live: z.boolean(),
      kind,
      isPrivate: z.boolean(),
      behind: z.boolean(),
      head: sha.nullable(),
      tree: sha.nullable(),
      files: z.array(file),
      marker: marker.nullable(),
      device: z.string().nullable(),
      pushedAt: z.string().nullable(),
    })
    .nullable(),
}) satisfies z.ZodType<SyncScan>;

const applyBegin = z.strictObject({
  root: z.string(),
  kind: z.enum(['run', 'adopt', 'remoteWins']),
  head: sha.nullable(),
  reason: z.enum(['abgleich', 'entscheidung', 'erster-abgleich', 'eingespielt', 'zurueckholen']),
  writes: z.array(
    z.union([
      z.strictObject({ path: z.string(), expect: sha.nullable(), base: sha.nullable(), sha }),
      z.strictObject({
        path: z.string(),
        expect: sha.nullable(),
        base: sha.nullable(),
        content: z.string(),
      }),
    ]),
  ),
  deletes: z.array(z.strictObject({ path: z.string(), expect: sha })),
  keep: z.array(z.strictObject({ path: z.string(), sha })),
  link: link.optional(),
  baseAll: z.record(z.string(), sha).optional(),
}) satisfies z.ZodType<ApplyBeginInput>;

const mark = z.strictObject({
  root: z.string(),
  base: z.array(z.strictObject({ path: z.string(), sha: sha.nullable() })).optional(),
  decided: z.record(z.string(), decision.nullable()).optional(),
  synced: z.boolean().optional(),
  dropBase: z.boolean().optional(),
  olderEdits: z.boolean().optional(),
}) satisfies z.ZodType<MarkInput>;

const push = z.strictObject({
  root: z.string(),
  head: sha.nullable(),
  tree: sha.nullable(),
  changes: z.array(z.strictObject({ path: z.string(), sha: sha.nullable() })),
  dataVersion: z.number(),
  dataShape: z.string(),
  counts: z.strictObject({ changed: z.number(), added: z.number(), removed: z.number() }),
  link: link.optional(),
}) satisfies z.ZodType<PushInput>;

const aside = z.array(
  z.strictObject({
    run: z.number(),
    at: z.string(),
    reason: z.enum(['abgleich', 'entscheidung', 'erster-abgleich', 'eingespielt', 'zurueckholen']),
    entries: z.array(
      z.strictObject({ side: z.enum(['hier', 'dort']), path: z.string(), sha, title: z.string() }),
    ),
  }),
) satisfies z.ZodType<AsideRun[]>;

const error = z.strictObject({
  kind: z.enum([
    'offline',
    'server',
    'limit',
    'key',
    'nokey',
    'keychain',
    'denied',
    'missing',
    'moved',
    'busy',
    'local',
    'input',
  ]),
  message: z.string(),
  retryAfter: z.number().nullable(),
});

describe('Vorlagen der Befehle', () => {
  it('passen zu den Typen in platform.ts', () => {
    for (const [name, schema] of [
      ['state.output.json', state],
      ['scan.output.json', scan],
      ['apply_begin.input.json', applyBegin],
      ['mark.input.json', mark],
      ['push.input.json', push],
      ['aside.output.json', aside],
      ['error.json', error],
      ['link.input.json', z.strictObject({ root: z.string(), link })],
      ['apply_begin.output.json', z.strictObject({ run: z.number(), busy: z.array(z.string()) })],
      [
        'apply_end.output.json',
        z.strictObject({ done: z.array(z.string()), left: z.array(z.string()) }),
      ],
      [
        'recover.output.json',
        z.strictObject({
          finished: z.number(),
          left: z.array(z.strictObject({ path: z.string(), sha })),
        }),
      ],
    ] as const) {
      const parsed = (schema as z.ZodType).safeParse(template(name));
      expect(parsed.success, `${name}: ${parsed.error?.message}`).toBe(true);
    }
  });

  it('die Attrappe liefert dieselbe Gestalt wie die Rust-Seite', async () => {
    const store = new MemoryStore([{ path: 'state.json', content: 'hello\n' }]);
    const port = new MemoryPort(new FakeRepo(), store);
    await port.link(
      '/kampagne',
      link.parse((template('link.input.json') as { link: unknown }).link),
    );
    await port.mark(mark.parse(template('mark.input.json')));
    expect(state.safeParse(await port.state('/kampagne', 1)).success).toBe(true);
    const scanned = await port.scan('/kampagne', false);
    expect(scan.safeParse(scanned).success).toBe(true);
    expect(scanned.local).toEqual([
      { path: 'state.json', sha: 'ce013625030ba8dba906f756967f9e9ca394464a', size: 6 },
    ]);
    const fresh = new MemoryPort(new FakeRepo(), new MemoryStore());
    const remote = await fresh.scan(
      '/neu',
      true,
      undefined,
      link.parse((template('link.input.json') as { link: unknown }).link),
    );
    expect(scan.safeParse(remote).success).toBe(true);
    expect(remote.remote?.kind).toBe('empty');
    await port.asidePut('/kampagne', ['state.json'], 'zurueckholen');
    expect(aside.safeParse(await port.asideList()).success).toBe(true);
  });
});
