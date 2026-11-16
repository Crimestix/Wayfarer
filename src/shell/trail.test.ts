import { describe, expect, it } from 'vitest';
import { emptyCampaign } from '../data/seed';
import { createEntity, type CampaignData } from '../domain/schema';
import { ELARIS_CALENDAR, ELARIS_START } from '../domain/time/elaris';
import { backLink, cameFrom, stepTrail } from './trail';

describe('Zurück in der Welt', () => {
  it('überspringt Adressen, die nur auf dieselbe Seite weiterleiten', () => {
    let trail: string[] = [];
    for (const step of ['/faeden', '/wiki/text', '/welt/mira']) trail = stepTrail(trail, step);
    // „/wiki/text“ leitet zur Seite von Mira – zurück geht es zum Fadenbrett, nicht im Kreis.
    expect(cameFrom(trail, '/welt/mira', (step) => step === '/wiki/text')).toBe('/faeden');
    expect(cameFrom(trail, '/welt/mira')).toBe('/wiki/text');
    expect(cameFrom(['/wiki/text', '/welt/mira'], '/welt/mira', () => true)).toBeNull();
  });

  it('führt ohne bekannte Herkunft zur gewünschten Seite und nennt weitere Bereiche', () => {
    const base = emptyCampaign('Testwelt', ELARIS_CALENDAR, ELARIS_START) as CampaignData;
    const mira = createEntity({ kind: 'person', name: 'Mira Tannhaus' });
    const data = { ...base, entities: { [mira.id]: mira } };
    const overview = { href: '/welt', label: 'Übersicht der Welt' };
    expect(backLink(data, null, overview)).toEqual(overview);
    expect(backLink(data, '/welt/gibtsnicht', overview)).toEqual(overview);
    expect(backLink(data, `/welt/${mira.id}`, overview).label).toBe('Mira Tannhaus');
    expect(backLink(data, '/bestiarium', overview)).toEqual({
      href: '/bestiarium',
      label: 'Bestiarium',
    });
    // Ohne Vorgabe bleibt es beim Fadenbrett.
    expect(backLink(data, null)).toEqual({ href: '/faeden', label: 'Fadenbrett' });
  });
});
