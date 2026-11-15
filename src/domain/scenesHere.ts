/**
 * Szenen am Ort der Gruppe: Was auf dem Blatt des Abends oder in einer Geschichte als mögliche
 * Szene an einen Ort geheftet ist, steht am Spieltisch, sobald die Gruppe dort (oder in einem Ort
 * darüber bzw. darunter) ist. Gespielte Szenen und abgeschlossene Geschichten fallen weg.
 */
import { prepView, sceneOnSheet } from './prep';
import type { CampaignData, SceneOdds } from './schema';
import { isNear } from './weight';

export interface SceneHere {
  /** Schlüssel für Listen. */
  key: string;
  text: string;
  placeId: string;
  /** Vom Blatt des Abends (abhakbar) oder aus einer Geschichte. */
  from: 'prep' | 'story';
  sceneId: string;
  storyId: string | null;
  storyTitle: string;
  storyInPlay: boolean;
  encounterId: string | null;
  odds: SceneOdds;
}

const ODDS_ORDER: SceneOdds[] = ['sure', 'maybe', 'unlikely'];

export function scenesHere(data: CampaignData): SceneHere[] {
  if (!data.state.placeId) return [];
  const out: SceneHere[] = [];
  const { content } = prepView(data);
  for (const scene of content.scenes)
    if (!scene.done && scene.text.trim() && scene.placeId && isNear(data, scene.placeId)) {
      const story = scene.storyId ? data.stories[scene.storyId] : undefined;
      out.push({
        key: `prep:${scene.id}`,
        text: scene.text.trim(),
        placeId: scene.placeId,
        from: 'prep',
        sceneId: scene.id,
        storyId: story?.id ?? null,
        storyTitle: story?.title ?? '',
        storyInPlay: !!story?.inPlay && !story.closed,
        encounterId:
          scene.encounterId && data.encounters[scene.encounterId] ? scene.encounterId : null,
        odds: 'maybe',
      });
    }
  for (const story of Object.values(data.stories)) {
    if (story.closed) continue;
    for (const scene of story.scenes) {
      if (scene.done || !scene.placeId || !isNear(data, scene.placeId)) continue;
      // Liegt sie auf dem Blatt des Abends, steht sie dort schon – abhakbar.
      if (sceneOnSheet(content, story.id, scene.id)) continue;
      const encounter = scene.encounterId ? data.encounters[scene.encounterId] : undefined;
      const text = scene.text.trim() || encounter?.name || '';
      if (!text) continue;
      out.push({
        key: `story:${story.id}:${scene.id}`,
        text,
        placeId: scene.placeId,
        from: 'story',
        sceneId: scene.id,
        storyId: story.id,
        storyTitle: story.title,
        storyInPlay: story.inPlay,
        encounterId: encounter ? encounter.id : null,
        odds: scene.odds,
      });
    }
  }
  // Was sicher kommt und zu einer Geschichte im Spiel gehört, zuerst.
  return out.sort(
    (a, b) =>
      ODDS_ORDER.indexOf(a.odds) - ODDS_ORDER.indexOf(b.odds) ||
      Number(b.storyInPlay) - Number(a.storyInPlay) ||
      Number(a.from === 'story') - Number(b.from === 'story'),
  );
}
