import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { dismissSuggestion } from '../../data/actions';
import { newEntry } from '../../features/welt/writing';
import { forgetPageTemplate, rememberPageTemplate } from '../../features/wiki/actions';
import { SUGGESTION } from '../dismiss';
import { pageQuestions, templateFor, templateKey, templateOfText } from '../pageTemplate';
import { placeScale, scaleOfWord } from '../placeScale';
import { createEntity, type Place } from '../schema';

const TAVERN = [
  '> [!steckbrief]',
  '> Art: Taverne',
  '> Wirt: Brann',
  '> Preise: günstig',
  '',
  'Ein lauter Ort am Hafen, voller Seeleute.',
  '',
  '## Gerüchte',
  'Man erzählt sich, im Keller …',
  'Wer trinkt hier umsonst?',
].join('\n');

describe('Vorlagen durch Merken', () => {
  it('behält die Form einer Seite: Steckbrief ohne Werte, Überschriften, eigene Fragen', () => {
    expect(templateOfText(TAVERN)).toBe(
      [
        '> [!steckbrief]',
        '> Art: ',
        '> Wirt: ',
        '> Preise: ',
        '',
        '## Gerüchte',
        '',
        'Wer trinkt hier umsonst?',
      ].join('\n'),
    );
    expect(templateOfText('Nur Text ohne Form.')).toBe('');
  });

  it('merkt sie für Kategorie und Wort und bietet sie beim Anlegen an', async () => {
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    const undo = rememberPageTemplate(db, 'place', ' Taverne ', TAVERN)!;
    const campaign = db.getSnapshot().campaign;
    expect(templateFor(campaign, 'place', 'taverne')).toMatchObject({ word: 'Taverne' });
    expect(templateFor(campaign, 'person', 'Taverne')).toBeNull();
    const made = newEntry(db, {
      name: 'Zum Roten Anker',
      kind: 'place',
      withText: true,
      word: 'Taverne',
      template: templateFor(campaign, 'place', 'Taverne')!.text,
    })!;
    const entity = db.getSnapshot().entities[made.entity!.id]!;
    expect(entity.kind === 'place' && entity.place.category).toBe('Taverne');
    const text = made.article!.docs.find((doc) => doc.kind === 'page')!.text;
    expect(text).toContain('> Wirt: ');
    expect(text).toContain('Wer trinkt hier umsonst?');
    expect(text).not.toContain('Seeleute');
    expect(forgetPageTemplate(db, templateKey('place', 'Taverne'))).not.toBeNull();
    expect(db.getSnapshot().campaign.pageTemplates).toEqual({});
    undo();
  });

  it('zeigt Leitfragen nur ohne eigene Fragen und ohne Weggeklicktes', async () => {
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    const questions = pageQuestions(db.getSnapshot(), 'place', '');
    expect(questions.length).toBeGreaterThan(0);
    dismissSuggestion(db, SUGGESTION.question('place', questions[0]!));
    expect(pageQuestions(db.getSnapshot(), 'place', '')).not.toContain(questions[0]);
    expect(pageQuestions(db.getSnapshot(), 'place', TAVERN)).toEqual([]);
  });
});

describe('Größe eines Ortes', () => {
  it('liest sie aus dem Wort, aus den Orten darin oder nimmt die festgelegte', async () => {
    expect(scaleOfWord('Fischerdorf')).toBe('settlement');
    expect(scaleOfWord('Taverne')).toBe('building');
    expect(scaleOfWord('Nebelwald')).toBe('region');
    expect(scaleOfWord('Lichtung des Mondes')).toBeNull();
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    const place = (name: string, more: Partial<Place['place']> = {}) =>
      db.put('entities', createEntity({ kind: 'place', name, place: more })) as Place;
    const open = place('Grauwacht');
    expect(placeScale(db.getSnapshot(), open)).toBeNull();
    place('Markt', { parentId: open.id });
    expect(placeScale(db.getSnapshot(), open)).toBe('settlement');
    expect(placeScale(db.getSnapshot(), place('Halle', { scale: 'building' }))).toBe('building');
    expect(placeScale(db.getSnapshot(), place('Kammer', { room: true }))).toBe('room');
  });
});
