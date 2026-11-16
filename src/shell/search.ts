/**
 * Die Suche über alles, was der Spielleiter angelegt hat: Einträge der Welt, Artikel, Geschichten
 * und Fäden, Uhren, Abläufe, Termine, Wesen, Begegnungen, Bestände, Karten, Fortschrittsleisten,
 * Handouts, Bastionen (mit ihren Einrichtungen), Beute, Vermutungen der Spieler, Läden (auch
 * nach ihren Waren), Fortbewegungsmittel, die Blätter der Abende (nach dem, was darauf steht) und
 * die Regeln des Tisches. Reine Funktion –
 * wohin ein Treffer führt, steht dabei; Symbole wählt die Oberfläche.
 */
import { KIND_LABEL, normalize, occurrencesOf, searchEntities } from '../domain/derive';
import { HANDOUT_KIND_LABEL } from '../domain/handout';
import { formatGold } from '../domain/loot';
import { magicTag } from '../domain/magicItem';
import { MOUNT_CONDITION_LABEL, MOUNT_KIND_LABEL, ownerText } from '../domain/mounts';
import { GUESS_TRUTH_LABEL } from '../domain/playerBook';
import { prepTexts, prepsNewestFirst } from '../domain/prep';
import { scheduleText } from '../domain/runs';
import { shopPlaceId, shopTitle } from '../domain/shop';
import { TABLE_RULES_TITLE, rulesLine } from '../domain/tableRules';
import type { CampaignData, Entity, MountKind } from '../domain/schema';
import { THREAD_STATE_LABEL, storyOfClock } from '../domain/story';
import { MINUTES_PER_DAY, dayIndexOf, formatDayMonth, startOfDay } from '../domain/time/calendar';
import type { Focus } from './focus';

export type SearchSort =
  | 'entity'
  | 'article'
  | 'story'
  | 'thread'
  | 'clock'
  | 'run'
  | 'event'
  | 'creature'
  | 'encounter'
  | 'stock'
  | 'map'
  | 'net'
  | 'track'
  | 'handout'
  | 'bastion'
  | 'loot'
  | 'guess'
  | 'shop'
  | 'mount'
  | 'prep'
  | 'rules';

export interface SearchHit {
  key: string;
  sort: SearchSort;
  label: string;
  /** Was es ist und das Wichtigste dazu: „Geschichte · Die Aalfischer“. */
  sub: string;
  /** Der Eintrag der Welt, wenn es einer ist – die Oberfläche weiß, wo er zu Hause ist. */
  entity?: Entity;
  /** Die Seite, auf der der Treffer steht. */
  href: string;
  /** Was diese Seite gleich zeigen soll. */
  focus?: Focus;
  /** Bei einem Fortbewegungsmittel: Reittier, Fahrzeug oder Schiff – für das Symbol. */
  mountKind?: MountKind;
}

/** 0 = genau der Name, 1 = beginnt so, 2 = kommt im Namen vor, 3 = nur im Beiwerk; 9 = kein Treffer. */
function score(q: string, name: string, ...more: string[]): number {
  const n = normalize(name);
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.includes(q)) return 2;
  return more.some((text) => normalize(text).includes(q)) ? 3 : 9;
}

const ENTITY_LIMIT = 30;
const OTHER_LIMIT = 30;
/** So weit voraus sucht die Suche nach dem nächsten Mal eines Termins. */
const AHEAD_DAYS = 400;

/** Treffer zu einem Suchwort: erst die Einträge der Welt, dann alles Übrige nach Güte. */
export function searchWorld(data: CampaignData, query: string): SearchHit[] {
  const q = normalize(query.trim());
  if (!q) return [];
  const name = (id: string | null) => (id ? data.entities[id]?.name : undefined);
  const sub = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' · ');

  const entities: SearchHit[] = searchEntities(data, query, { limit: ENTITY_LIMIT }).map(
    (entity) => ({
      key: entity.id,
      sort: 'entity',
      label: entity.name,
      // Bei Gegenständen „magisch · selten“ – zum Finden am Tisch.
      sub: sub(KIND_LABEL[entity.kind], magicTag(entity), entity.tagline),
      entity,
      href: '',
    }),
  );

  const rest: { hit: SearchHit; score: number }[] = [];
  const add = (points: number, hit: SearchHit) => {
    if (points < 9) rest.push({ hit, score: points });
  };

  // Artikel, die keinen Eintrag in der Welt haben – die anderen stehen schon oben.
  const owned = new Set(Object.values(data.entities).map((entity) => entity.lk?.resourceId));
  for (const article of Object.values(data.articles)) {
    if (article.template || owned.has(article.id)) continue;
    add(score(q, article.title, ...article.aliases), {
      key: `article:${article.id}`,
      sort: 'article',
      label: article.title,
      sub: 'Artikel',
      href: `/wiki/${article.id}`,
    });
  }
  for (const story of Object.values(data.stories))
    add(score(q, story.title, story.summary, story.needs, story.stakes, story.memo, story.text), {
      key: `story:${story.id}`,
      sort: 'story',
      label: story.title,
      sub: sub('Geschichte', name(story.ownerId), story.closed && 'zu Ende erzählt'),
      href: `/geschichte/${story.id}`,
    });
  for (const thread of Object.values(data.threads)) {
    const story = thread.storyId ? data.stories[thread.storyId] : undefined;
    add(score(q, thread.title, thread.truth), {
      key: `thread:${thread.id}`,
      sort: 'thread',
      label: thread.title,
      sub: sub('Faden', THREAD_STATE_LABEL[thread.state], story?.title),
      href: '/faeden',
      // Ein Faden einer Geschichte liegt auf deren Karte.
      focus: { type: 'card', key: story ? `story:${story.id}` : `thread:${thread.id}` },
    });
  }
  for (const clock of Object.values(data.clocks)) {
    // Die Uhr einer Geschichte ist ein Teil von ihr: Ihre Schritte führen zum Blatt.
    const story = storyOfClock(data, clock.id);
    const points = score(q, clock.title, ...clock.steps.map((step) => step.text));
    if (story && normalize(story.title).includes(q)) continue;
    add(points, {
      key: `clock:${clock.id}`,
      sort: 'clock',
      label: clock.title,
      sub: sub(story ? 'Uhr einer Geschichte' : 'Uhr', name(clock.ownerId), name(clock.placeId)),
      href: story ? `/geschichte/${story.id}` : '/geschehen',
      focus: story ? undefined : { type: 'clock', id: clock.id },
    });
  }
  for (const run of Object.values(data.runs))
    add(score(q, run.name, run.carrier), {
      key: `run:${run.id}`,
      sort: 'run',
      label: run.name,
      sub: sub(
        'Ablauf',
        `${name(run.fromId) ?? '?'} → ${name(run.toId) ?? '?'}`,
        scheduleText(run),
      ),
      href: '/geschehen',
      focus: { type: 'run', id: run.id },
    });
  const cal = data.campaign.calendar;
  const today = startOfDay(data.state.now);
  for (const event of Object.values(data.events)) {
    const points = score(q, event.title, event.details);
    if (points === 9) continue;
    // Das nächste Mal – sonst der Tag, an dem der Termin steht.
    const next = occurrencesOf(cal, event, today, today + AHEAD_DAYS * MINUTES_PER_DAY)[0];
    const at = next?.at ?? event.at;
    add(points, {
      key: `event:${event.id}`,
      sort: 'event',
      label: event.title,
      sub: sub('Termin', formatDayMonth(cal, at), name(event.placeId)),
      href: '/kalender',
      focus: { type: 'day', day: dayIndexOf(at) },
    });
  }
  for (const creature of Object.values(data.creatures))
    add(score(q, creature.name), {
      key: `creature:${creature.id}`,
      sort: 'creature',
      label: creature.name,
      sub: 'Wesen',
      href: `/bestiarium/${creature.id}`,
    });
  for (const encounter of Object.values(data.encounters))
    add(score(q, encounter.name), {
      key: `encounter:${encounter.id}`,
      sort: 'encounter',
      label: encounter.name,
      sub: sub('Begegnung', name(encounter.placeId)),
      href: `/begegnungen/${encounter.id}`,
    });
  for (const stock of Object.values(data.stocks))
    add(score(q, stock.name), {
      key: `stock:${stock.id}`,
      sort: 'stock',
      label: stock.name,
      sub: sub('Bestand', name(stock.placeId)),
      href: `/bestaende/${stock.id}`,
    });
  for (const map of Object.values(data.maps))
    add(score(q, map.name), {
      key: `map:${map.id}`,
      sort: 'map',
      label: map.name,
      sub: sub('Karte', name(map.placeId)),
      href: `/karten/${map.id}`,
    });

  for (const net of Object.values(data.nets))
    add(score(q, net.name, net.note), {
      key: `net:${net.id}`,
      sort: 'net',
      label: net.name,
      sub: sub('Wegenetz', net.points.length === 1 ? '1 Punkt' : `${net.points.length} Punkte`),
      href: `/wegenetze/${net.id}`,
    });

  for (const track of Object.values(data.tracks))
    add(score(q, track.name, track.note, ...track.stages), {
      key: `track:${track.id}`,
      sort: 'track',
      label: track.name,
      sub: sub('Fortschritt', name(track.ownerId) ?? 'Gruppe', track.done && 'abgeschlossen'),
      href: '/fortschritt',
    });
  for (const handout of Object.values(data.handouts)) {
    const title = handout.title.trim() || HANDOUT_KIND_LABEL[handout.kind];
    add(score(q, title, handout.text, handout.signature), {
      key: `handout:${handout.id}`,
      sort: 'handout',
      label: title,
      sub: sub(
        'Handout',
        HANDOUT_KIND_LABEL[handout.kind],
        handout.givenAt !== null && 'übergeben',
      ),
      href: '/handouts',
      focus: { type: 'handout', id: handout.id },
    });
  }
  for (const bastion of Object.values(data.bastions)) {
    add(score(q, bastion.name), {
      key: `bastion:${bastion.id}`,
      sort: 'bastion',
      label: bastion.name,
      sub: sub('Bastion', name(bastion.placeId)),
      href: '/bastion',
      focus: { type: 'bastion', id: bastion.id },
    });
    for (const facility of bastion.facilities)
      add(score(q, facility.name, facility.hirelings, facility.notes), {
        key: `facility:${facility.id}`,
        sort: 'bastion',
        label: facility.name,
        sub: sub('Einrichtung', bastion.name, name(facility.ownerId)),
        href: '/bastion',
        focus: { type: 'bastion', id: bastion.id },
      });
  }
  for (const loot of Object.values(data.loot)) {
    const label =
      loot.text.trim() || name(loot.itemId) || (loot.gold > 0 ? formatGold(loot.gold) : '');
    if (!label) continue;
    add(score(q, label, loot.source), {
      key: `loot:${loot.id}`,
      sort: 'loot',
      label,
      sub: sub(
        'Beute',
        loot.given ? `bekommen: ${name(loot.toId) ?? 'die Gruppe'}` : 'liegt bereit',
        loot.source,
      ),
      href: '/beute',
    });
  }
  for (const guess of Object.values(data.guesses)) {
    const about = guess.refs.map((id) => name(id) ?? data.stories[id]?.title).filter(Boolean);
    add(score(q, guess.text, guess.note), {
      key: `guess:${guess.id}`,
      sort: 'guess',
      label: guess.text,
      sub: sub('Vermutung', GUESS_TRUTH_LABEL[guess.truth], about.join(', ')),
      href: '/spielerbuch',
      focus: { type: 'guess', id: guess.id },
    });
  }

  for (const shop of Object.values(data.shops)) {
    const title = shopTitle(data, shop);
    const placeId = shopPlaceId(data, shop);
    const home = shop.placeId && data.entities[shop.placeId] ? shop.placeId : shop.keeperId;
    const goods = shop.stock.map((line) => line.text || name(line.entityId) || '');
    add(score(q, title, shop.kind, shop.notes, ...goods), {
      key: `shop:${shop.id}`,
      sort: 'shop',
      label: title,
      sub: sub(
        shop.market ? 'Handelsplatz' : 'Laden',
        !title.includes(shop.kind.trim()) && shop.kind,
        name(placeId),
      ),
      href: home && data.entities[home] ? `/welt/${home}` : '/welt',
      focus: { type: 'shop', id: shop.id },
    });
  }

  for (const mount of Object.values(data.mounts)) {
    const entity = mount.entityId ? data.entities[mount.entityId] : undefined;
    add(score(q, mount.name, mount.notes, entity?.name ?? ''), {
      key: `mount:${mount.id}`,
      sort: 'mount',
      label: mount.name,
      sub: sub(
        MOUNT_KIND_LABEL[mount.kind],
        ownerText(data, mount),
        mount.condition !== 'ready' && MOUNT_CONDITION_LABEL[mount.condition],
        data.state.travelBy === mount.id && 'damit reist die Gruppe',
      ),
      href: '/gruppe',
      focus: { type: 'mount', id: mount.id },
      mountKind: mount.kind,
    });
  }

  // Die Blätter der Abende: gefunden über eine Zeile, die darauf steht – je Blatt ein Treffer.
  for (const prep of prepsNewestFirst(data)) {
    const session = prep.sessionId ? data.sessions[prep.sessionId] : undefined;
    if (prep.sessionId && !session) continue;
    const lines = prepTexts(prep).flatMap((text) => text.split(/\r?\n/));
    const line = lines.find((row) => normalize(row).includes(q));
    if (!line) continue;
    const current = !session || session.id === data.state.sessionId;
    add(3, {
      key: `prep:${prep.id}`,
      sort: 'prep',
      label: line.trim(),
      sub: sub(
        'Abend-Blatt',
        session
          ? `Session ${session.number}${session.id === data.state.sessionId ? ' (läuft)' : ''}`
          : 'nächster Abend',
      ),
      href: current ? '/abend' : '/chronik',
      focus:
        session && !current
          ? { type: 'sheet', sessionId: session.id }
          : { type: 'prep', which: session ? 'now' : 'next' },
    });
  }

  // Die Regeln des Tisches: ein Blatt – gefunden über seinen Namen oder eine Zeile daraus.
  const rules = data.campaign.tableRules;
  const ruleLine = rulesLine(rules, query);
  add(score(q, TABLE_RULES_TITLE, ruleLine ?? ''), {
    key: 'rules',
    sort: 'rules',
    label: TABLE_RULES_TITLE,
    sub: sub('Hausregeln und Absprachen', ruleLine ?? undefined),
    href: '/',
    focus: { type: 'rules' },
  });

  rest.sort((a, b) => a.score - b.score || a.hit.label.localeCompare(b.hit.label, 'de'));
  // Was genau so heißt wie gesucht, steht ganz oben – auch vor den Einträgen der Welt.
  const exact = rest.filter((entry) => entry.score === 0).map((entry) => entry.hit);
  const others = rest.filter((entry) => entry.score > 0).map((entry) => entry.hit);
  const exactEntities = entities.filter((hit) => normalize(hit.label) === q);
  return [
    ...exactEntities,
    ...exact,
    ...entities.filter((hit) => !exactEntities.includes(hit)),
    ...others,
  ].slice(0, ENTITY_LIMIT + OTHER_LIMIT);
}
