import { describe, expect, it } from 'vitest';
import { demoCampaign } from '../../../data/__fixtures__/demoWorld';
import type { SyncProbeResult } from '../../../data/platform';
import { SyncFailure } from '../../../data/platform';
import { gitSha } from '../fake';
import * as model from '../model';
import {
  asideRunText,
  canApply,
  conflictCard,
  entryLabel,
  fieldLabel,
  firstSyncText,
  incomingText,
  keyErrorText,
  keyFormProblem,
  needsInfo,
  numberText,
  offlineText,
  probeOutcome,
  probeText,
  reopenedText,
  resultLine,
  signOf,
  skippedText,
  statusLine,
  tokenPageUrl,
  valueWords,
  whenText,
} from '../model';
import { INITIAL_VIEW, type RawConflict, type SyncView } from '../state';

const data = demoCampaign();
const person = Object.values(data.entities).find((e) => e.kind === 'person')!;
const place = Object.values(data.entities).find((e) => e.kind === 'place')!;
const NOW = new Date(2026, 10, 15, 22, 0);
const at = (d: number, h: number, m: number) => new Date(2026, 10, d, h, m).toISOString();

const view = (change: Partial<SyncView>): SyncView => ({
  ...INITIAL_VIEW,
  link: {
    owner: 'spielleiter',
    repo: 'spielstand-elaris',
    branch: 'main',
    device: 'Windows-PC',
    root: '/kampagne',
  },
  ...change,
});

describe('Zahlen und Zeiten', () => {
  it('Tausender mit schmalem Abstand', () => {
    expect(numberText(3480)).toBe('3 480');
    expect(numberText(14)).toBe('14');
  });

  it('heute, gestern, Wochentag, Datum', () => {
    expect(whenText(at(15, 21, 40), NOW)).toBe('heute, 21:40 Uhr');
    expect(whenText(at(14, 23, 58), NOW)).toBe('gestern, 23:58 Uhr');
    expect(whenText(at(12, 21, 40), NOW)).toBe('Donnerstag, 21:40 Uhr');
    expect(whenText(at(1, 9, 5), NOW)).toBe('1. November 2026, 09:05 Uhr');
    expect(whenText(null, NOW)).toBe('');
  });
});

describe('Zeichen in der Leiste', () => {
  it('ohne Verbindung und ohne Schlüssel steht nichts da', () => {
    expect(signOf(view({ phase: 'off' }), NOW)).toBeNull();
  });

  it('Abgeglichen – mit Zeiten und dem anderen Rechner', () => {
    const sign = signOf(
      view({
        phase: 'synced',
        syncedAt: at(15, 21, 40),
        other: { device: 'MacBook', pushedAt: at(14, 23, 58) },
      }),
      NOW,
    )!;
    expect(sign.label).toBe('Abgeglichen');
    expect(sign.dot).toBe('ok');
    expect(sign.title).toBe(
      'Zuletzt abgeglichen: heute, 21:40 Uhr. Letzter Stand vom MacBook: gestern, 23:58 Uhr. Klick: jetzt abgleichen.',
    );
    expect(sign.click).toBe('sync');
  });

  it('hier gibt es Neues: goldener Rand und ein Satz davor', () => {
    const sign = signOf(view({ phase: 'synced', due: true }), NOW)!;
    expect(sign.dot).toBe('due');
    expect(sign.title.startsWith('Hier gibt es Änderungen, die gleich hochgeladen werden.')).toBe(
      true,
    );
  });

  it('der andere Rechner braucht die neue Version', () => {
    const sign = signOf(view({ phase: 'synced', otherNeedsUpdate: 'MacBook' }), NOW)!;
    expect(sign.note).toBe('MacBook braucht die neue Version');
  });

  it('läuft, kein Netz, braucht dich, nicht verbunden', () => {
    expect(signOf(view({ phase: 'running' }), NOW)!.label).toBe('Gleicht ab …');
    const off = signOf(
      view({
        phase: 'offline',
        offline: { why: 'net' },
        other: { device: 'MacBook', pushedAt: at(12, 21, 40) },
      }),
      NOW,
    )!;
    expect(off.label).toBe('Kein Netz');
    expect(off.title).toContain(
      'Stand vom MacBook: Donnerstag, 21:40 Uhr. Klick: jetzt versuchen.',
    );
    const needs = signOf(view({ phase: 'needsYou', needs: { why: 'conflicts' } }), NOW)!;
    expect(needs.label).toBe('Abgleich braucht dich');
    expect(needs.click).toBe('decide');
    const key = signOf(view({ phase: 'needsYou', needs: { why: 'key' } }), NOW)!;
    expect(key.click).toBe('settings');
    expect(key.title).toContain('Der Zugangsschlüssel gilt nicht mehr');
    expect(signOf(view({ phase: 'unlinked' }), NOW)!.label).toBe('Abgleich nicht verbunden');
  });

  it('nie rot: kein Zustand trägt die Farbe der Gefahr', () => {
    const dots = (['unlinked', 'running', 'offline', 'needsYou', 'synced'] as const).map(
      (phase) => signOf(view({ phase, needs: { why: 'key' } }), NOW)!.dot,
    );
    expect(dots).not.toContain('error');
  });
});

describe('Störungen in Worten', () => {
  it('Pause mit Uhrzeit', () => {
    expect(offlineText({ offline: { why: 'limit', until: at(15, 21, 55) } })).toBe(
      'GitHub bittet um eine Pause. Wayfarer versucht es um 21:55 Uhr wieder.',
    );
    expect(offlineText({ offline: { why: 'behind' } })).toContain('älteren Stand');
  });

  it('Schlüssel ungültig → „Zugangsschlüssel ersetzen“', () => {
    for (const why of ['key', 'denied', 'nokey'] as const)
      expect(needsInfo(view({ phase: 'needsYou', needs: { why } }), NOW)!.action).toBe(
        'replaceKey',
      );
    expect(needsInfo(view({ phase: 'needsYou', needs: { why: 'key' } }), NOW)!.text).toBe(
      'GitHub nimmt den Zugangsschlüssel nicht mehr an – er wurde gelöscht oder ist abgelaufen. Dein Spielstand ist davon nicht berührt.',
    );
  });

  it('Ablage weg, Schlüsselbund, Kopie, Version, erster Abgleich', () => {
    expect(needsInfo(view({ phase: 'needsYou', needs: { why: 'missing' } }), NOW)!.text).toContain(
      'spielleiter/spielstand-elaris',
    );
    expect(needsInfo(view({ phase: 'needsYou', needs: { why: 'keychain' } }), NOW)!.action).toBe(
      'retryKeychain',
    );
    expect(needsInfo(view({ phase: 'needsYou', needs: { why: 'moved' } }), NOW)!.title).toBe(
      'Dieser Ordner ist eine Kopie oder wurde verschoben',
    );
    expect(
      needsInfo(
        view({
          phase: 'needsYou',
          needs: { why: 'version' },
          other: { device: 'Windows-PC', pushedAt: null },
          link: { owner: 'a', repo: 'b', branch: 'main', device: 'MacBook', root: '/x' },
        }),
        NOW,
      )!.text.startsWith('Der Windows-PC arbeitet mit einer neueren Version.'),
    ).toBe(true);
    const first = view({
      phase: 'needsYou',
      needs: { why: 'firstSync' },
      firstSync: {
        same: 1,
        onlyLocal: [],
        onlyRemote: [],
        different: ['state.json'],
        remoteEmpty: false,
        restored: true,
      },
    });
    expect(needsInfo(first, NOW)!.title).toBe('Du hast hier einen ganzen Stand eingespielt');
  });

  it('Warten auf Entscheidungen: Zahl und seit wann', () => {
    const info = needsInfo(
      view({
        phase: 'needsYou',
        needs: { why: 'conflicts' },
        conflicts: [{} as RawConflict, {} as RawConflict],
        heldSince: at(12, 22, 10),
      }),
      NOW,
    )!;
    expect(info.title).toBe('2 Einträge warten auf deine Entscheidung');
    expect(info.text).toContain(
      'Seit Donnerstag, 22:10 Uhr kommen diese Einträge nicht in die Ablage.',
    );
  });
});

describe('Zeilen', () => {
  it('Rückmeldung nach „Jetzt abgleichen“', () => {
    expect(resultLine(view({ phase: 'synced' }), NOW)).toBe('Abgeglichen – nichts Neues.');
    expect(
      resultLine(
        view({
          phase: 'synced',
          last: {
            down: { changed: 10, added: 4, removed: 0 },
            up: { changed: 3, added: 0, removed: 0 },
            from: 'MacBook',
          },
        }),
        NOW,
      ),
    ).toBe('Abgeglichen – 14 Einträge vom MacBook übernommen, 3 hochgeladen.');
  });

  it('Zustandszeile des Abschnitts', () => {
    const line = statusLine(
      view({
        phase: 'synced',
        syncedAt: at(15, 21, 40),
        other: { device: 'MacBook', pushedAt: at(14, 23, 58) },
      }),
      NOW,
    );
    expect(line.head).toBe('Abgeglichen');
    expect(line.rest).toBe(
      'verbunden mit spielleiter/spielstand-elaris · dieser Rechner: Windows-PC · zuletzt heute, 21:40 Uhr · letzter Stand vom MacBook: gestern, 23:58 Uhr',
    );
  });

  it('ruhige Zeile nur, wenn etwas kommt', () => {
    expect(incomingText({ phase: 'running', incoming: { count: 14, from: 'MacBook' } })).toBe(
      'Vom MacBook kommt Neues (14 Einträge) – gleich da.',
    );
    expect(incomingText({ phase: 'running', incoming: null })).toBeNull();
    expect(incomingText({ phase: 'synced', incoming: { count: 3, from: 'MacBook' } })).toBeNull();
  });

  it('wieder offen nach der Wahl der Weltzeit', () => {
    expect(reopenedText({ reopened: { events: 2, steps: 1, timers: 0 }, merged: 1 })).toBe(
      'Wieder offen: 2 Termine, 1 Schritt einer Uhr · zusammengelegt: 1 Termin',
    );
    expect(reopenedText({ reopened: { events: 0, steps: 0, timers: 0 }, merged: 0 })).toBeNull();
  });

  it('ausgelassene Einträge mit Art, Name und Grund – gesperrte still', () => {
    const text = skippedText(
      [
        { path: `entities/${person.id}.json`, why: 'size', title: null },
        { path: 'events/x.json', why: 'locked', title: null },
      ],
      data,
    );
    expect(text).toBe(`1 Eintrag lässt der Abgleich aus: Person „${person.name}“ (zu groß)`);
  });
});

describe('Karten im Dialog', () => {
  const story = {
    id: 'st1',
    title: 'Die Salzgrotte',
    summary: 'Hier geschrieben',
    scenes: [{ id: 'sc1', text: 'Der Überfall', done: true }],
    updated: at(14, 21, 40),
  };
  const remoteStory = {
    ...story,
    summary: 'Dort geschrieben',
    scenes: [{ id: 'sc1', text: 'Der Überfall', done: false }],
    updated: at(15, 0, 12),
  };

  it('Angaben in Worten: Name statt Kennung, ja/nein, Listenelement mit Titel', () => {
    expect(valueWords(person.id, 'ownerId', { data })).toBe(`„${person.name}“`);
    expect(valueWords(true, 'done', { data })).toBe('ja');
    expect(valueWords(null, 'x', { data })).toBe('leer');
    expect(fieldLabel(['scenes', 'sc1', 'done'], story)).toBe('Szene „Der Überfall“ – erledigt');
    expect(fieldLabel(['geheimesFeld'], story)).toBe('Angabe ohne Namen');
    expect(fieldLabel(['inneres', 'summary'], story)).toBe('Zusammenfassung');
  });

  it('Karte „beide haben dieselbe Angabe verschieden geändert“', () => {
    const card = conflictCard(
      {
        id: 'stories/st1.json',
        path: 'stories/st1.json',
        kind: 'fields',
        local: { json: story, at: story.updated },
        remote: { json: remoteStory, at: remoteStory.updated, device: 'MacBook' },
        fields: [
          { at: ['summary'], local: 'Hier geschrieben', remote: 'Dort geschrieben' },
          { at: ['scenes', 'sc1', 'done'], local: true, remote: false },
        ],
      },
      { data },
    );
    expect(card.heading).toBe('Geschichte „Die Salzgrotte“');
    expect(card.stamps).toBe(
      'Eintrag zuletzt geändert – hier: 14. November 2026, 21:40 Uhr · MacBook: 15. November 2026, 00:12 Uhr',
    );
    expect(card.rows).toEqual([
      {
        label: 'Zusammenfassung',
        here: 'Hier geschrieben',
        there: 'Dort geschrieben',
        long: false,
      },
      { label: 'Szene „Der Überfall“ – erledigt', here: 'ja', there: 'nein', long: false },
    ]);
    expect(card.options.map((o) => o.label)).toEqual([
      'Fassung von hier behalten',
      'Fassung vom MacBook nehmen',
    ]);
  });

  it('nichts Lesbares → Wahl über die ganze Fassung', () => {
    const card = conflictCard(
      {
        id: 'stories/st1.json',
        path: 'stories/st1.json',
        kind: 'fields',
        local: { json: story, at: null },
        remote: { json: remoteStory, at: null, device: 'MacBook' },
        fields: [{ at: ['raster'], local: { a: 1 }, remote: { a: 2 } }],
      },
      { data },
    );
    expect(card.rows).toEqual([]);
    expect(card.options.map((o) => o.label)).toEqual(['Fassung von hier', 'Fassung vom MacBook']);
  });

  it('Weltzeit: Knöpfe nach Inhalt, Ort nur wenn verschieden', () => {
    const cal = data.campaign.calendar;
    const card = conflictCard(
      {
        id: 'state.json',
        path: 'state.json',
        kind: 'time',
        local: { json: { now: data.state.now + 60, placeId: place.id }, at: null },
        remote: { json: { now: data.state.now, placeId: person.id }, at: null, device: 'MacBook' },
        fields: [],
      },
      { data },
    );
    expect(card.heading).toBe('An beiden Rechnern ist Zeit vergangen');
    expect(card.options[0]!.label.startsWith('Weltzeit von hier: ')).toBe(true);
    expect(card.options[0]!.label).toContain(`· in ${place.name}`);
    expect(card.options[1]!.label.startsWith('Weltzeit vom MacBook: ')).toBe(true);
    expect(cal.months.length).toBeGreaterThan(0);
  });

  it('gelöscht gegen geändert: „Behalten“ vorgewählt; umgekehrt „Zurückholen“', () => {
    const there = conflictCard(
      {
        id: `entities/${person.id}.json`,
        path: `entities/${person.id}.json`,
        kind: 'deletedThere',
        local: { json: person as never, at: at(14, 21, 40) },
        remote: { json: null, at: null, device: 'MacBook' },
        fields: [],
      },
      { data },
    );
    expect(there.lead).toBe(
      'Am MacBook gelöscht – hier inzwischen geändert (14. November 2026, 21:40 Uhr).',
    );
    expect(there.preset).toBe('local');
    expect(there.note).toContain('kommt durch „Behalten“ nicht von selbst zurück');
    const here = conflictCard(
      {
        id: 'stories/st1.json',
        path: 'stories/st1.json',
        kind: 'deletedHere',
        local: { json: null, at: null },
        remote: { json: remoteStory, at: null, device: 'MacBook' },
        fields: [],
      },
      { data },
    );
    expect(here.options.map((o) => o.label)).toEqual(['Zurückholen', 'Gelöscht lassen']);
    expect(here.preset).toBe('remote');
  });

  it('sehr viel auf einmal und unlesbare Fassung', () => {
    const mass = conflictCard(
      {
        id: '*mass:deleteHere:1',
        path: 'events/a.json',
        kind: 'mass',
        local: { json: null, at: null },
        remote: { json: null, at: null, device: 'MacBook' },
        fields: [],
        mass: {
          kind: 'deleteHere',
          paths: Array.from({ length: 240 }, (_, i) => `events/e${i}.json`),
          key: 'k',
        },
      },
      { data },
    );
    expect(
      mass.lead!.startsWith(
        'Seit dem letzten Abgleich fehlen hier 240 Einträge (zum Beispiel: Termin',
      ),
    ).toBe(true);
    expect(mass.options.map((o) => o.choice)).toEqual(['ok', 'back']);
    const unreadable = conflictCard(
      {
        id: 'stories/st1.json',
        path: 'stories/st1.json',
        kind: 'whole',
        why: 'unreadable',
        local: { json: story, at: null },
        remote: { json: null, at: null, device: 'MacBook' },
        fields: [],
      },
      { data },
    );
    expect(unreadable.options.map((o) => o.label)).toEqual(['Fassung von hier hochladen']);
  });

  it('Anwenden geht, sobald eine Karte eine Wahl hat', () => {
    expect(canApply({})).toBe(false);
    expect(canApply({ a: undefined, b: 'local' })).toBe(true);
  });
});

describe('Zwei Spielstände', () => {
  it('Zahlen, Gruppen, Titel nach eingespielter Sicherung', () => {
    const text = firstSyncText(
      {
        same: 3480,
        onlyLocal: [`entities/${person.id}.json`],
        onlyRemote: ['events/x.json'],
        different: ['state.json'],
        remoteEmpty: false,
        restored: true,
      },
      data,
      { device: 'MacBook', pushedAt: at(15, 0, 12) },
      false,
    );
    expect(text.title).toBe('Du hast hier einen ganzen Stand eingespielt');
    expect(text.counts).toBe('Gleich: 3 480 · nur hier: 1 · nur dort: 1 · verschieden: 1');
    expect(text.groups[0]!.items).toEqual([`Person „${person.name}“`]);
    expect(text.local.text).toContain('(2 Einträge)');
    expect(text.remote.text).toContain('Wayfarer startet dafür einmal neu.');
    expect(text.lead).toContain('zuletzt vom MacBook, 15. November 2026, 00:12 Uhr');
  });
});

describe('Einrichten', () => {
  const info = (over: Partial<SyncProbeResult['repos'][number]> = {}) => ({
    owner: 'spielleiter',
    repo: 'spielstand-elaris',
    branch: 'main',
    isPrivate: true,
    canPush: true,
    archived: false,
    kind: null,
    ...over,
  });

  it('Ergebnisse der Prüfung', () => {
    const found = probeOutcome({
      login: 'spielleiter',
      repos: [],
      found: {
        info: info(),
        kind: 'wayfarer',
        files: 12,
        marker: null,
        device: 'Windows-PC',
        pushedAt: null,
        campaign: 'Elaris',
        state: null,
      },
    });
    expect(probeText(found)).toBe(
      'Angemeldet als spielleiter. Gefunden: die private Ablage spielleiter/spielstand-elaris.',
    );
    expect(probeOutcome({ login: 'x', repos: [], found: null }).kind).toBe('none');
    expect(
      probeOutcome({ login: 'x', repos: [info(), info({ repo: 'b' })], found: null }).kind,
    ).toBe('choose');
    const pub = probeOutcome({
      login: 'x',
      repos: [],
      found: {
        info: info({ isPrivate: false }),
        kind: 'wayfarer',
        files: 1,
        marker: null,
        device: null,
        pushedAt: null,
        campaign: null,
        state: null,
      },
    });
    expect(probeText(pub)).toContain('ist öffentlich');
  });

  it('Schlüssel der älteren Art wird nicht gespeichert; Fehler in Worten', () => {
    expect(keyFormProblem('ghp_abc')).toContain('älteren Art');
    expect(keyFormProblem('github_pat_abc')).toBeNull();
    expect(keyErrorText(new SyncFailure('key', 'x'))).toContain('beginnt mit github_pat_');
    expect(keyErrorText(new SyncFailure('offline', 'x'))).toContain(
      'Der Schlüssel ist gespeichert',
    );
  });

  it('Seite für den Schlüssel ist vorbelegt', () => {
    expect(tokenPageUrl('Windows-PC')).toBe(
      'https://github.com/settings/personal-access-tokens/new?name=Wayfarer+Windows-PC&description=Abgleich+des+Spielstands&expires_in=none&contents=write',
    );
  });
});

describe('Beiseitegelegtes', () => {
  it('Lauf in Worten', () => {
    expect(
      asideRunText(
        {
          at: at(14, 23, 5),
          reason: 'entscheidung',
          entries: [{ side: 'dort' }, { side: 'dort' }],
        },
        'MacBook',
      ),
    ).toBe(
      '14. November 2026, 23:05 Uhr – deine Entscheidung: 2 Fassungen vom MacBook nicht gewählt',
    );
    expect(
      asideRunText(
        {
          at: at(12, 19, 10),
          reason: 'erster-abgleich',
          entries: Array(15).fill({ side: 'hier' }),
        },
        'MacBook',
      ),
    ).toBe('12. November 2026, 19:10 Uhr – erster Abgleich: 15 Einträge von hier');
  });

  it('Name eines Eintrags aus dem Spielstand', () => {
    expect(entryLabel(`entities/${person.id}.json`, null, data)).toBe(`Person „${person.name}“`);
    expect(entryLabel('state.json', null, data)).toBe('Stand am Spieltisch');
  });
});

describe('Wörter', () => {
  it('keine Wörter aus der Entwicklung in festen Texten', () => {
    const texts = Object.values(model)
      .flatMap((v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v : []))
      .filter((v): v is string => typeof v === 'string' && !v.startsWith('https://'));
    expect(texts.length).toBeGreaterThan(10);
    // GitHubs eigene Beschriftungen stehen in Anführungszeichen und zählen nicht.
    const plain = texts.map((t) => t.replace(/„[^“]*“/g, ''));
    for (const t of plain)
      expect(t).not.toMatch(/\b(Commit|Push|Pull|Merge|Token|Sync|Branch|Hash)\b/i);
  });

  it('die Kennungen der Attrappe sind die von Git', () => {
    expect(gitSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
    expect(gitSha('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  });
});
