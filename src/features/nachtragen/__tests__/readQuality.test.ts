/**
 * Lesen wie in echten Kladden: Fehler, die beim Durchsehen langer Notizen auffielen – Namen auf
 * „-s“ oder „-ik“, ein verschriebenes „das“, Kämpfe ohne Kampfwort, Beute im Satz, Tote aus der
 * Beuteliste, Vorgeschichte. Alles mit der erfundenen Welt aus `readWorld`.
 */
import { describe, expect, it } from 'vitest';
import type { ReadProposal, SessionReading } from '../../../domain/schema';
import { unknownNames } from '../readNames';
import { readSession } from '../readSession';
import { at, noted, readWorld, withSessions } from './readWorld';

const READ_AT = '2026-11-13T10:00:00.000Z';

function read(text: string, later?: string) {
  const w = readWorld();
  const s1 = noted(1, text, at(3, 1, 701, 9), at(5, 1, 701, 22));
  const extra = later ? [noted(2, later, at(6, 1, 701, 9), at(6, 1, 701, 22))] : [];
  const data = withSessions(w, s1, ...extra);
  return { w, reading: readSession(data, s1, { readAt: READ_AT }) };
}

const of = (reading: SessionReading, kind: ReadProposal['kind']) =>
  reading.proposals.filter((p) => p.kind === kind);
const outcome = (p: ReadProposal | undefined) =>
  (p?.payload.fight as { outcome?: string } | undefined)?.outcome;

describe('Fragen zu unbekannten Namen', () => {
  const ask = (...lines: string[]) =>
    unknownNames(
      readWorld().data,
      lines.map((text, line) => ({ text, line })),
    ).map((q) => `${q.name} ×${q.count}`);

  it('nimmt Namen auf „-s“ als sie selbst, nicht als Genitiv', () => {
    expect(
      ask(
        'Odo glaubt, dass Fabius den Zoll betrügt.',
        'Am Hafen wartete Mira auf Fabius, den Zöllner.',
      ),
    ).toEqual(['Fabius ×2']);
  });

  it('nimmt den Genitiv weg, wenn der Name auch für sich dasteht', () => {
    expect(ask('Mira sah Wido am Tor.', 'In Widos Haus brannte Licht, und Wido lachte.')).toEqual([
      'Wido ×3',
    ]);
  });

  it('fragt nach Namen auf „-ik“ (Henrik), nicht nach „Musik“', () => {
    expect(ask('Mira traf Henrik am Hafen.', 'Odo und Henrik spielten Musik. Musik half.')).toEqual(
      ['Henrik ×2'],
    );
  });

  it('ein verschriebenes „das“ macht einen Namen nicht zum Hauptwort – „die Tür“ schon', () => {
    expect(
      ask(
        'Lando hörte das Ulmar im Norden herrscht.',
        'Odo betet zu Ulmar. Für Ulmar zog er in den Krieg, und Lando fürchtet Ulmar.',
      ),
    ).toEqual(['Ulmar ×4']);
    expect(
      ask('Lando öffnete die Tür.', 'Mira sah, wie Tür und Tor brannten. Odo mag Tür.'),
    ).toEqual([]);
  });

  it('„das es Berden war“ ist kein Begleiter mit Beiwort', () => {
    expect(
      ask(
        'Im Moor ruht der Schädel von Berden.',
        'Mira meint das es Berden war, und Odo mag Berden.',
      ),
    ).toEqual(['Berden ×3']);
  });

  it('zeigt die häufigste Schreibweise', () => {
    expect(ask('Odo traf Fabbius.', 'Mira sah Fabius, und Lando mied Fabius.')).toEqual([
      'Fabius ×3',
    ]);
  });

  it('ein langer Name, der einmal dasteht, zählt zum wiederholten Teil („Wido Brechts Laden“)', () => {
    expect(ask('Vor Wido Brechts Laden stand Odo.', 'Mira ahnt, dass Wido Brecht lügt.')).toEqual([
      'Wido Brecht ×2',
    ]);
  });

  it('fragt nicht nach „Handouts“', () => {
    expect(ask('Mira las die Handouts.', 'Odo fand Handouts, und Lando verlor Handouts.')).toEqual(
      [],
    );
  });
});

describe('Kämpfe', () => {
  it('tötet die Gruppe ein Wesen, ist es ein gewonnener Kampf', () => {
    const { reading } = read(
      'Haben den Grubenwurm getötet und sind weitergezogen.\nDie Gruppe tötete den Keiler im Unterholz.',
    );
    const fights = of(reading, 'fight');
    expect(fights).toHaveLength(2);
    expect(fights.map(outcome)).toEqual(['won', 'won']);
  });

  it('ein Absatz, ein Kampf – mit dem Ausgang aus dem späteren Satz', () => {
    const { reading } = read(
      'Am Steg griffen Schmuggler die Gruppe an. Im Kampf am Wasser konnte die Gruppe den Hauptmann töten.',
    );
    const fights = of(reading, 'fight');
    expect(fights).toHaveLength(1);
    expect(outcome(fights[0])).toBe('won');
  });

  it('wer gegeneinander kämpft, ist nicht die Gruppe; wer allein flieht, auch nicht', () => {
    const { reading } = read(
      'Auf dem Hof kämpften Tessa und Wido gegeneinander, Lando schaute zu.\nLando drohte dem Wirt mit der Faust. Der Kerl floh durch die Hintertür.',
    );
    expect(of(reading, 'fight')).toEqual([]);
  });

  it('„keine Gelegenheit zur Flucht“ ist keine Flucht', () => {
    const { reading } = read(
      'Odo Kessler sagte, für die Wachen gab es keine Gelegenheit zur Flucht.',
    );
    expect(of(reading, 'fight')).toEqual([]);
  });
});

describe('Vorgeschichte', () => {
  it('„als Kind begegnete …“ ist keine Begegnung dieses Abends', () => {
    const { reading } = read('Schon als Kind begegnete Mira Odo Kessler am Brunnen.');
    expect(of(reading, 'meeting')).toEqual([]);
  });

  it('eine Zeile, die eine Lebensgeschichte erzählt, trägt keine Entscheidung', () => {
    const { reading } = read(
      'Am Feuer schilderte Odo Kessler seine Lebensgeschichte. Er entschied sich gegen das Kloster.',
    );
    expect(of(reading, 'decision')).toEqual([]);
  });
});

describe('Beute im Satz', () => {
  it('nimmt, was jemand an sich nimmt, behält, findet oder geschenkt bekommt', () => {
    const { w, reading } = read(
      [
        'Haben im Stollen den Grubenwurm getötet und danach eine Laterne an sich genommen.',
        'Mira Tannhaus hat den Kerzenhalter behalten.',
        'Lando hat einen Kompass aus Messing gefunden.',
        'Odo Kessler gab Brann einen Stadtplan von Hohenfurt.',
      ].join('\n'),
    );
    const loot = of(reading, 'loot').map((p) => ({
      text: p.payload.text,
      toId: p.payload.toId,
      source: p.payload.source,
    }));
    expect(loot).toEqual([
      { text: 'Laterne', toId: null, source: '' },
      { text: 'Kerzenhalter', toId: w.mira.id, source: '' },
      { text: 'Kompass', toId: w.lando.id, source: '' },
      { text: 'Stadtplan von Hohenfurt', toId: w.brann.id, source: 'Odo Kessler' },
    ]);
  });

  it('nicht, was die Gruppe bloß findet, wem „ihnen“ gilt, oder was ein Name der Welt ist', () => {
    const { reading } = read(
      [
        'Haben das alte Mosaik gefunden.',
        'Tessa gab ihnen einen Apfel.',
        'Mira hat den Krummzahn gefunden.',
        'Lando fand in der Truhe nichts.',
      ].join('\n'),
    );
    expect(of(reading, 'loot')).toEqual([]);
  });
});

describe('Tote aus der Beuteliste', () => {
  const LIST = `Nach dem Gefecht plünderten sie die Gefallenen:
Hagen Brack
12 Goldmünzen
Rostiger Dolch


Wido
3 Goldmünzen`;

  it('wessen Leiche geplündert wird, der ist tot – nur Namen der Welt', () => {
    const { w, reading } = read(LIST);
    const fates = of(reading, 'fate');
    expect(fates).toHaveLength(1);
    expect(fates[0]).toMatchObject({
      refs: [w.hagen.id],
      payload: { fate: { entityId: w.hagen.id, status: 'dead' } },
    });
  });

  it('kein Widerspruch, wenn er später nur als Leiche „von A und B“ vorkommt', () => {
    const { reading } = read(
      LIST,
      'Im Tempel bahrten sie die Leichen von Odo und Hagen Brack auf.',
    );
    expect(of(reading, 'fate')[0]!.hints).toEqual([]);
  });

  it('eine Beuteliste ohne Tote macht niemanden tot', () => {
    const { reading } = read('Loot:\nHagen Brack\n12 Goldmünzen\nRostiger Dolch');
    expect(of(reading, 'fate')).toEqual([]);
  });
});

describe('Schriftstück und Wandlung', () => {
  it('der Absender „von Hagen“ meint Hagen Brack', () => {
    const { w, reading } = read(`Der Bote brachte eine Nachricht von Hagen.
Mira,
kommt nicht in die Grotte. Dort wartet die Bande.
Grüße, Hagen`);
    const writing = of(reading, 'writing')[0];
    expect(writing?.refs).toEqual([w.hagen.id]);
  });

  it('eine Wandlung im Nebensatz („genau wie Lando, der seine Flügel … bekommen hat“)', () => {
    const { w, reading } = read(
      'Mira hat Hörner aus Bernstein bekommen, genau wie Lando, der seine Flügel aus Rauch bekommen hat.',
    );
    expect(of(reading, 'transformation').map((p) => p.refs[0])).toEqual([w.mira.id, w.lando.id]);
  });
});
