/**
 * „Übernehmen“: aus den Entwürfen werden Sessions – neue werden angelegt, vorhandene bekommen die
 * Notizen. Die Notizen stehen wörtlich an der Session (`session.source`); nichts stellt Zeit vor,
 * nichts löst Termine, Uhren oder Abläufe aus.
 */
import { addPastSession, deleteSession } from '../../data/actions';
import type { CampaignDb } from '../../data/db';
import type { Session } from '../../domain/schema';
import type { TakeOverPlan } from './model';
import { storeReading } from './readActions';

export interface TakeOverResult {
  /** Neu angelegte Sessions. */
  created: string[];
  /** Vorhandene Sessions, die die Notizen bekamen. */
  attached: string[];
  /** Nimmt alles zurück: Neue werden gelöscht, Vorhandene bekommen ihren vorigen Stand. */
  undo: () => void;
}

/**
 * Führt einen Plan aus `takeOverPlan` aus – nur, wenn nichts hindert (`plan.ready`); sonst
 * geschieht nichts und `null` kommt zurück. Alles in einem Schritt.
 */
export function takeOverSessions(db: CampaignDb, plan: TakeOverPlan): TakeOverResult | null {
  if (!plan.ready) return null;
  const created: string[] = [];
  const attached: string[] = [];
  const before = new Map<
    string,
    Pick<Session, 'source' | 'title' | 'realDate' | 'reading' | 'recap'>
  >();
  db.batch(() => {
    for (const item of plan.items) {
      if (item.action === 'create' && item.number !== null) {
        const session = addPastSession(db, {
          number: item.number,
          title: item.title,
          realDate: item.realDate,
          startAt: item.startAt,
          endAt: item.endAt,
        });
        db.patch('sessions', session.id, { source: item.source });
        created.push(session.id);
      } else if (item.action === 'attach' && item.sessionId) {
        const session = db.getSnapshot().sessions[item.sessionId];
        if (!session) continue;
        before.set(session.id, {
          source: session.source,
          title: session.title,
          realDate: session.realDate,
          reading: session.reading,
          recap: session.recap,
        });
        // Was an der Session fehlt, kommt aus den Notizen; was dort steht, bleibt.
        db.patch('sessions', session.id, {
          source: item.source,
          ...(session.title.trim() ? {} : { title: item.title }),
          ...(session.realDate ? {} : { realDate: item.realDate }),
        });
        // War sie schon gelesen, gehören Stellen und Vorschläge zu den alten Notizen: neu lesen –
        // Entschiedenes bleibt (`mergeReading`), Verschwundenes steht als veraltet da.
        if (session.reading) storeReading(db, session.id);
        attached.push(session.id);
      }
    }
  });
  const undo = () => {
    db.batch(() => {
      for (const id of created) deleteSession(db, id);
      for (const [id, previous] of before)
        if (db.getSnapshot().sessions[id]) db.patch('sessions', id, previous);
    });
  };
  return { created, attached, undo };
}
