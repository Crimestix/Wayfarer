/**
 * Berufe vorschlagen und annehmen. Was im Geschriebenen vorkommt, liest `domain/professions.ts`;
 * hier kommen die Artikel des Wikis dazu, und hier wird angelegt und verbunden – nur, was der
 * Spielleiter ausgewählt hat. Nie still.
 */
import type { CampaignDb } from '../../data/db';
import {
  professionSuggestions,
  type ProfessionSuggestions,
  type WrittenSource,
} from '../../domain/professions';
import { createEntity, createRelation, type CampaignData } from '../../domain/schema';
import { articleFacts, factField, worldIndex } from '../wiki/facts';
import { searchIndex } from '../wiki/model';

/** Die Artikel des Wikis als Geschriebenes: Steckbrief-Zeilen „Beruf“ und „Rolle“, dazu der Text. */
export function writtenSources(data: Pick<CampaignData, 'entities' | 'articles'>): WrittenSource[] {
  const index = worldIndex(data);
  return searchIndex(data.articles).map(({ article, plain }) => {
    const facts = articleFacts(data.articles, article);
    const owner = index.byArticle
      .get(article.id)
      ?.find((entity) => entity.kind === 'person' || entity.kind === 'character');
    return {
      id: article.id,
      title: article.title,
      ownerId: owner?.id ?? null,
      professionLines: facts
        .filter((fact) => factField('person', fact.label) === 'profession')
        .map((fact) => fact.text),
      roleLines: facts
        .filter((fact) => factField('person', fact.label) === 'role')
        .map((fact) => fact.text),
      text: plain,
    };
  });
}

/** Die Vorschläge für die Welt: Einträge und Artikel zusammen. */
export function worldProfessionSuggestions(data: CampaignData): ProfessionSuggestions {
  return professionSuggestions(data, writtenSources(data));
}

export interface ProfessionPick {
  name: string;
  category: string;
  tool: string;
  /** Den Beruf gibt es schon; dann wird nur verbunden. */
  professionId: string | null;
  /** Personen, die ihn ausüben sollen. */
  peopleIds: string[];
}

export interface AcceptResult {
  created: number;
  linked: number;
  undo: () => void;
}

/**
 * Übernimmt die ausgewählten Vorschläge: legt Berufe an (nur Name, Einordnung, Werkzeug) und
 * verbindet Personen über „übt aus“. Einen Namen, den es schon gibt, legt es nie ein zweites Mal an.
 */
export function acceptProfessions(db: CampaignDb, picks: readonly ProfessionPick[]): AcceptResult {
  const createdIds: string[] = [];
  const relationIds: string[] = [];
  db.batch(() => {
    for (const pick of picks) {
      const data = db.getSnapshot();
      const name = pick.name.replace(/\s+/g, ' ').trim();
      let professionId =
        pick.professionId && data.entities[pick.professionId] ? pick.professionId : null;
      if (!professionId) {
        if (!name) continue;
        const same = Object.values(data.entities).find(
          (e) =>
            e.kind === 'profession' &&
            [e.name, ...e.aliases].some(
              (n) => n.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'),
            ),
        );
        if (same) professionId = same.id;
        else {
          const created = db.put(
            'entities',
            createEntity({
              kind: 'profession',
              name,
              profession: { category: pick.category.trim(), tool: pick.tool.trim() },
            }),
          );
          createdIds.push(created.id);
          professionId = created.id;
        }
      }
      for (const personId of new Set(pick.peopleIds)) {
        const current = db.getSnapshot();
        if (!current.entities[personId]) continue;
        const exists = Object.values(current.relations).some(
          (r) => !r.ended && r.type === 'practises' && r.from === personId && r.to === professionId,
        );
        if (exists) continue;
        relationIds.push(
          db.put(
            'relations',
            createRelation({ from: personId, to: professionId, type: 'practises' }),
          ).id,
        );
      }
    }
  });
  return {
    created: createdIds.length,
    linked: relationIds.length,
    undo: () =>
      db.batch(() => {
        for (const id of relationIds)
          if (db.getSnapshot().relations[id]) db.remove('relations', id);
        for (const id of createdIds) {
          const data = db.getSnapshot();
          if (!data.entities[id]) continue;
          // Nur zurücknehmen, wenn seither nichts daran hängt.
          if (Object.values(data.relations).some((r) => r.from === id || r.to === id)) continue;
          db.remove('entities', id);
        }
      }),
  };
}
