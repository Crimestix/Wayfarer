/** Namen aus LegendKeeper nachtragen – mit dem vollen Fixture der alten Version (Inhalte erfunden). */
import { describe, expect, it } from 'vitest';
import { COLLECTION_SCHEMAS, type CampaignData, type Entity } from '../../../domain/schema';
import fullBackup from '../__fixtures__/v157-voll.json';
import { applyNameFixes, nameFixes, unnamedFromLk, withLkNames, type LkNames } from '../lknames';
import {
  MISSING_NAME_TAG,
  MISSING_NAME_TAGLINE,
  placeholderName,
  previewV157Backup,
} from '../v157';

const imported = () => previewV157Backup(structuredClone(fullBackup));
const NAMES: LkNames = new Map([
  ['lkres-zoellner', { title: 'Zöllner Brand', aliases: ['Der Zöllner', 'zöllner brand'] }],
  ['lkres-fremder', { title: '  Der Fremde  ' }],
  ['lkres-hohenfurt', { title: 'Hohenfurt (Stadt)' }],
]);
const byLk = (data: CampaignData, resourceId: string): Entity =>
  Object.values(data.entities).find((e) => e.lk?.resourceId === resourceId)!;

describe('unnamedFromLk', () => {
  it('findet genau die Personen, die nur als Verweis auf LegendKeeper ankamen', () => {
    const { data } = imported();
    const waiting = unnamedFromLk(data);
    expect(waiting.map((e) => e.lk?.resourceId).sort()).toEqual([
      'lkres-bote',
      'lkres-fremder',
      'lkres-zoellner',
    ]);
    for (const e of waiting) {
      expect(e.name).toBe(placeholderName(e.lk!.resourceId));
      expect(e.tagline).toBe(MISSING_NAME_TAGLINE);
    }
  });

  it('ist leer, wenn niemand auf einen Namen wartet', () => {
    const { data } = imported();
    const fixed = applyNameFixes(
      data,
      nameFixes(
        data,
        new Map(unnamedFromLk(data).map((e) => [e.lk!.resourceId, { title: `Name ${e.id}` }])),
      ),
    );
    expect(unnamedFromLk(fixed)).toEqual([]);
  });
});

describe('nameFixes', () => {
  it('trägt Namen und Zweitnamen ein, entfernt Schlagwort und Platzhaltertext', () => {
    const { data } = imported();
    const fixes = nameFixes(data, NAMES);
    expect(fixes.named).toBe(2);
    expect(fixes.notFound).toBe(1);
    const next = applyNameFixes(data, fixes);
    const brand = byLk(next, 'lkres-zoellner');
    expect(brand).toMatchObject({
      name: 'Zöllner Brand',
      aliases: ['Der Zöllner'],
      tagline: '',
      lk: { resourceId: 'lkres-zoellner', title: 'Zöllner Brand' },
    });
    expect(brand.tags).not.toContain(MISSING_NAME_TAG);
    expect(byLk(next, 'lkres-fremder').name).toBe('Der Fremde');
    // Ohne Artikel im Verzeichnis bleibt alles, wie es war.
    expect(byLk(next, 'lkres-bote')).toBe(byLk(data, 'lkres-bote'));
  });

  it('lässt alles Übrige an den Personen stehen und ergibt gültige Einträge', () => {
    const { data } = imported();
    const before = byLk(data, 'lkres-fremder');
    const fixes = nameFixes(data, NAMES);
    const after = fixes.changed.find((e) => e.id === before.id)!;
    expect(after).toMatchObject({ id: before.id, kind: 'person', notes: before.notes });
    expect(after.kind === 'person' && before.kind === 'person' && after.person).toEqual(
      before.kind === 'person' && before.person,
    );
    for (const e of fixes.changed)
      expect(COLLECTION_SCHEMAS.entities.safeParse(e).success).toBe(true);
  });

  it('ergänzt bei schon benannten Einträgen nur den fehlenden Artikeltitel', () => {
    const { data } = imported();
    const place = byLk(data, 'lkres-hohenfurt');
    expect(place).toMatchObject({ name: 'Hohenfurt', lk: { title: '' } });
    const next = applyNameFixes(data, nameFixes(data, NAMES));
    expect(byLk(next, 'lkres-hohenfurt')).toMatchObject({
      name: 'Hohenfurt',
      aliases: place.aliases,
      lk: { title: 'Hohenfurt (Stadt)' },
    });
  });

  it('überschreibt keinen von Hand vergebenen Namen; der Artikeltitel wird Zweitname', () => {
    const { data } = imported();
    const waiting = byLk(data, 'lkres-zoellner');
    const renamed: CampaignData = {
      ...data,
      entities: {
        ...data.entities,
        [waiting.id]: { ...waiting, name: 'Brand vom Zoll', tagline: 'Nimmt es genau.' },
      },
    };
    const next = applyNameFixes(renamed, nameFixes(renamed, NAMES));
    const brand = byLk(next, 'lkres-zoellner');
    expect(brand).toMatchObject({
      name: 'Brand vom Zoll',
      tagline: 'Nimmt es genau.',
      aliases: ['Zöllner Brand', 'Der Zöllner'],
    });
    expect(brand.tags).not.toContain(MISSING_NAME_TAG);
  });

  it('ändert nichts, wenn das Verzeichnis leer ist oder nur leere Titel kennt', () => {
    const { data } = imported();
    expect(nameFixes(data, new Map())).toEqual({ changed: [], named: 0, notFound: 3 });
    const blank = nameFixes(data, new Map([['lkres-bote', { title: '   ' }]]));
    expect(blank).toEqual({ changed: [], named: 0, notFound: 3 });
    expect(applyNameFixes(data, blank)).toBe(data);
  });

  it('ein zweiter Durchlauf findet nichts mehr zu tun', () => {
    const { data } = imported();
    const once = applyNameFixes(data, nameFixes(data, NAMES));
    expect(nameFixes(once, NAMES)).toEqual({ changed: [], named: 0, notFound: 1 });
  });
});

describe('withLkNames', () => {
  it('trägt die Namen schon in der Vorschau ein und sagt es im Bericht an passender Stelle', () => {
    const plain = imported();
    const result = withLkNames(plain, NAMES);
    expect(byLk(result.data, 'lkres-zoellner').name).toBe('Zöllner Brand');
    const at = result.sections.adopted.findIndex((s) => s.includes('„Name fehlt“'));
    expect(result.sections.adopted[at + 1]).toBe(
      'Davon haben 2 Personen den Namen gleich aus dem Artikelverzeichnis von LegendKeeper erhalten und brauchen das Schlagwort nicht mehr; zu 1 weiteren gibt es dort keinen Artikel.',
    );
    expect(result.sections.adopted).toHaveLength(plain.sections.adopted.length + 1);
    expect(result.report).toEqual([
      ...result.sections.adopted,
      ...result.sections.hints,
      ...result.sections.omitted,
      ...result.sections.skipped,
    ]);
    // Die Vorlage bleibt unberührt.
    expect(byLk(plain.data, 'lkres-zoellner').name).toBe(placeholderName('lkres-zoellner'));
  });

  it('spricht bei einer einzelnen Person in der Einzahl', () => {
    const result = withLkNames(imported(), new Map([['lkres-bote', { title: 'Bote Jorin' }]]));
    expect(result.sections.adopted).toContain(
      'Davon hat 1 Person den Namen gleich aus dem Artikelverzeichnis von LegendKeeper erhalten und braucht das Schlagwort nicht mehr; zu 2 weiteren gibt es dort keinen Artikel.',
    );
  });

  it('ersetzt den Satz über das Schlagwort, wenn alle ihren Namen bekommen', () => {
    const plain = imported();
    const all: LkNames = new Map([...NAMES, ['lkres-bote', { title: 'Bote Jorin' }]]);
    const result = withLkNames(plain, all);
    expect(unnamedFromLk(result.data)).toEqual([]);
    expect(result.sections.adopted).toHaveLength(plain.sections.adopted.length);
    expect(result.report.join(' ')).not.toContain('„Name fehlt“');
    expect(result.sections.adopted).toContain(
      '3 Personen kannte die alte Version nur als Verweis auf einen LegendKeeper-Artikel. Sie wurden mit dieser Verknüpfung angelegt; ihre Namen stammen aus dem Artikelverzeichnis von LegendKeeper.',
    );
  });

  it('gibt das Ergebnis unverändert zurück, wenn kein Name zu holen ist', () => {
    const plain = imported();
    expect(withLkNames(plain, new Map())).toBe(plain);
  });
});
