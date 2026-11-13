/**
 * Beute: was die Gruppe bekommt. Wayfarer führt kein Inventar – das tun die Spieler –, sondern
 * ein Beute-Buch: jede Ausgabe mit Abend, Ort, Herkunft und Empfänger (ein Gefährte oder die
 * Gruppe), damit nichts verloren geht. Beute lässt sich vorbereiten („liegt bereit“) und am
 * Tisch mit einem Klick ausgeben. Geschrieben wird alles vom Spielleiter. Reine Funktionen.
 */
import { activeParty, sessionsSorted } from './derive';
import type { CampaignData, Character, Loot, Session } from './schema';

/** „20 GM“ – Gold in Goldmünzen, ohne Nachkommastellen, wo keine sind. */
export function formatGold(gold: number): string {
  const rounded = Math.round(gold * 100) / 100;
  return `${rounded.toLocaleString('de-DE')} GM`;
}

/** Was ein Eintrag ist, in einer Zeile: „Kompass, der nach unten zeigt · 20 GM“. */
export function lootLine(data: Pick<CampaignData, 'entities'>, loot: Loot): string {
  const item = loot.itemId ? data.entities[loot.itemId]?.name : undefined;
  const what = loot.text.trim() || item || '';
  return [
    // Der Gegenstand der Welt steht dabei, wenn die Zeile ihn nicht schon nennt.
    what,
    item && what !== item && !what.includes(item) ? item : '',
    loot.gold > 0 ? formatGold(loot.gold) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Wer es bekommt: der Name des Gefährten – oder „die Gruppe“. */
export function lootRecipient(data: Pick<CampaignData, 'entities'>, loot: Loot): string {
  const entity = loot.toId ? data.entities[loot.toId] : undefined;
  return entity ? entity.name : 'die Gruppe';
}

const newestFirst = (a: Loot, b: Loot) =>
  (b.at ?? 0) - (a.at ?? 0) || b.created.localeCompare(a.created);

/** Beute, die bereitliegt – für eine Geschichte, für keine (`null`) oder überhaupt. */
export function readyLoot(data: Pick<CampaignData, 'loot'>, storyId?: string | null): Loot[] {
  return (
    Object.values(data.loot)
      .filter((loot) => !loot.given && (storyId === undefined || loot.storyId === storyId))
      // Gleichzeitig Angelegtes bleibt in der Reihenfolge, in der es entstand.
      .sort((a, b) => a.created.localeCompare(b.created))
  );
}

/**
 * Bereitliegende Beute, die am Spieltisch unter „Dieser Abend“ steht: alles, was nicht an einer
 * Geschichte im Spiel hängt – das steht bei seiner Geschichte.
 */
export function eveningLoot(data: Pick<CampaignData, 'loot' | 'stories'>): Loot[] {
  return readyLoot(data).filter((loot) => {
    const story = loot.storyId ? data.stories[loot.storyId] : undefined;
    // Eine abgeschlossene Geschichte steht nicht mehr im Spiel – ihre Beute dann hier.
    return !story || !story.inPlay || story.closed;
  });
}

/**
 * Liest Gold, wie man es schreibt: „20“, „12,5“, „1.250“, „1.250,50“. Leer heißt 0; was keine
 * Zahl ist oder unter null liegt, gibt null.
 */
export function parseGold(text: string): number | null {
  const raw = text.trim().replace(/\s+/g, '').replace(/GM$/i, '');
  if (raw === '') return 0;
  let normal: string;
  if (raw.includes(',')) {
    // Mit Komma: Punkte trennen Tausender.
    if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(raw)) return null;
    normal = raw.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
    // „1.250“ – Punkte vor genau drei Ziffern trennen Tausender.
    normal = raw.replace(/\./g, '');
  } else if (/^\d+(\.\d+)?$/.test(raw)) {
    normal = raw;
  } else return null;
  const value = Number(normal);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Was ein Gefährte bekommen hat: sein Gold und die Einträge, das Neueste zuerst. */
export function receivedBy(
  data: Pick<CampaignData, 'loot'>,
  characterId: string,
): { gold: number; items: Loot[] } {
  const items = Object.values(data.loot)
    .filter((loot) => loot.given && loot.toId === characterId)
    .sort(newestFirst);
  return { items, gold: items.reduce((sum, loot) => sum + loot.gold, 0) };
}

export interface LootShare {
  /** Der Gefährte – null = die Gruppenkasse. */
  character: Character | null;
  gold: number;
  /** Was er bekommen hat, das Neueste zuerst. */
  items: Loot[];
}

export interface LootBook {
  /** Was bereitliegt und noch nicht ausgegeben ist. */
  ready: Loot[];
  /** Was ausgegeben wurde, nach Abenden – der jüngste zuerst; ohne Abend zuletzt. */
  sessions: { session: Session | null; entries: Loot[]; gold: number }[];
  /** Wer was bekommen hat: erst die Gruppe, dann die Gefährten. */
  shares: LootShare[];
  /** Alles Gold, das je ausgegeben wurde. */
  gold: number;
}

/** Das Beute-Buch: was bereitliegt, was an welchem Abend ausgegeben wurde und wer was hat. */
export function lootBook(data: CampaignData): LootBook {
  const all = Object.values(data.loot);
  const given = all.filter((loot) => loot.given).sort(newestFirst);
  const sessions: LootBook['sessions'] = [];
  for (const session of [...sessionsSorted(data)].reverse()) {
    const entries = given.filter((loot) => loot.sessionId === session.id);
    if (entries.length)
      sessions.push({ session, entries, gold: entries.reduce((sum, loot) => sum + loot.gold, 0) });
  }
  const loose = given.filter((loot) => !loot.sessionId || !data.sessions[loot.sessionId]);
  if (loose.length)
    sessions.push({
      session: null,
      entries: loose,
      gold: loose.reduce((sum, loot) => sum + loot.gold, 0),
    });

  const shareOf = (character: Character | null): LootShare => {
    const items = given.filter((loot) =>
      character ? loot.toId === character.id : !loot.toId || !data.entities[loot.toId],
    );
    return { character, items, gold: items.reduce((sum, loot) => sum + loot.gold, 0) };
  };
  // Wer etwas bekommen hat, steht da – auch wenn er nicht mehr zur aktiven Gruppe gehört.
  const holders = new Set(given.map((loot) => loot.toId));
  const characters = Object.values(data.entities).filter(
    (entity): entity is Character =>
      entity.kind === 'character' && (entity.character.active || holders.has(entity.id)),
  );
  characters.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return {
    ready: readyLoot(data),
    sessions,
    shares: [shareOf(null), ...characters.map(shareOf)],
    gold: given.reduce((sum, loot) => sum + loot.gold, 0),
  };
}

/**
 * „Heute erhalten“: was an einem Abend ausgegeben wurde, als Text zum Weitergeben an die Spieler
 * – je Empfänger eine Zeile. Leer, wenn es nichts gab.
 */
export function receivedText(data: CampaignData, sessionId: string): string {
  const session = data.sessions[sessionId];
  const entries = Object.values(data.loot)
    .filter((loot) => loot.given && loot.sessionId === sessionId)
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || a.created.localeCompare(b.created));
  if (!session || !entries.length) return '';
  const order = ['die Gruppe', ...activeParty(data).map((character) => character.name)];
  const groups = new Map<string, string[]>();
  for (const loot of entries) {
    const who = lootRecipient(data, loot);
    groups.set(who, [...(groups.get(who) ?? []), lootLine(data, loot)]);
  }
  const names = [...groups.keys()].sort(
    (a, b) =>
      (order.indexOf(a) + 1 || order.length + 1) - (order.indexOf(b) + 1 || order.length + 1) ||
      a.localeCompare(b, 'de'),
  );
  return [
    `Beute – Session ${session.number}`,
    ...names.map(
      (who) => `${who === 'die Gruppe' ? 'Die Gruppe' : who}: ${groups.get(who)!.join('; ')}`,
    ),
  ].join('\n');
}
