/**
 * Drei Fächer des Blatts einer Geschichte: „Wen es persönlich betrifft“ (je Gefährte sein eigener
 * Grund, daneben sein Ziel und seine offenen Wünsche), „Einstiege“ und „Szenen und Begegnungen“
 * (zum Abhaken). Neue Zeilen entstehen mit dem ersten Wort.
 */
import { Link, useLocation } from 'wouter';
import { Swords, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { entitiesOfKind } from '../../domain/derive';
import { openWishes } from '../../domain/heroArc';
import {
  ENTRY_STANDINGS,
  SCENE_ODDS,
  newId,
  type EntryStanding,
  type SceneOdds,
  type Story,
  type StoryEntry,
  type StoryScene,
} from '../../domain/schema';
import { ENTRY_STANDING_LABEL, heroesOf } from '../../domain/story';
import {
  Checkbox,
  EntityPicker,
  IconButton,
  NewLine,
  Select,
  SheetSection,
  Written,
  entityHref,
  toast,
  useDraftList,
} from '../../ui';
import { newEncounter } from '../bestiarium/encounterActions';
import { patchStory, tieHero, untieHero } from './actions';
import { useStoryMention } from './storyMention';

const SCENE_ODDS_LABEL: Record<SceneOdds, string> = {
  sure: 'kommt sicher',
  maybe: 'vielleicht',
  unlikely: 'eher nicht',
};

// ── Wen es persönlich betrifft ─────────────────────────────────────────────

export function StoryHeroes({ story }: { story: Story }) {
  const db = useDb();
  const data = useData();
  const mention = useStoryMention(story);
  const rows = heroesOf(data, story);
  const others = entitiesOfKind(data, 'character')
    .filter((character) => !rows.some((row) => row.character.id === character.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return (
    <SheetSection
      id="heroes"
      title="Wen es persönlich betrifft"
      hint="Warum mischt sich gerade dieser Gefährte ein? Dann ist es mehr als ein Auftrag."
    >
      {rows.map(({ hero, character }) => {
        const goal = character.character.goal.trim();
        const wishes = openWishes(data, character.id);
        return (
          <div key={hero.id} className="wf-sheet-list__row wf-sheet-list__row--hero">
            <Link href={entityHref(character)} className="wf-faden-held wf-clamp-1">
              {character.name}
            </Link>
            <div className="wf-faden-held__why">
              <Written
                label={`Warum es ${character.name} betrifft`}
                wrap
                value={hero.why}
                placeholder="Warum mischt sich gerade er ein?"
                mention={mention}
                onSave={(why) =>
                  patchStory(db, story.id, {
                    heroes: story.heroes.map((entry) =>
                      entry.id === hero.id ? { ...entry, why: why.trim() } : entry,
                    ),
                  })
                }
              />
              {goal && <span className="wf-faden-held__goal">Ziel: {goal}</span>}
              {wishes.map((wish) => (
                <span key={wish.id} className="wf-faden-held__goal">
                  Offener Wunsch: {wish.text}
                </span>
              ))}
            </div>
            <IconButton
              label={`${character.name} von der Geschichte lösen`}
              size="sm"
              variant="ghost"
              onClick={() => untieHero(db, story.id, character.id)}
            >
              <X />
            </IconButton>
          </div>
        );
      })}
      {others.length > 0 && (
        <Select
          className="wf-faden-held__add"
          value=""
          aria-label="Gefährten an die Geschichte heften"
          onChange={(event) => {
            if (event.target.value) tieHero(db, story.id, event.target.value);
          }}
        >
          <option value="">Gefährten hinzufügen …</option>
          {others.map((character) => (
            <option key={character.id} value={character.id}>
              {character.name}
            </option>
          ))}
        </Select>
      )}
      {others.length === 0 && rows.length === 0 && (
        <p className="wf-sheet__none">Noch gibt es keine Gefährten.</p>
      )}
    </SheetSection>
  );
}

// ── Einstiege ──────────────────────────────────────────────────────────────

export function StoryEntries({ story }: { story: Story }) {
  const db = useDb();
  const mention = useStoryMention(story);
  const list = useDraftList<StoryEntry>(
    story.entries,
    (entries) => patchStory(db, story.id, { entries }),
    (entry) => !entry.text.trim(),
  );
  return (
    <SheetSection
      id="entries"
      title="Einstiege"
      hint="Wo und wie stößt die Gruppe darauf? Zwei an verschiedenen Orten sind sicherer als einer."
    >
      {list.items.map((entry) => (
        <div key={entry.id} className="wf-sheet-list__row wf-sheet-list__row--entry">
          <Written
            label="Einstieg"
            wrap
            value={entry.text}
            mention={mention}
            onSave={(text) => list.set(entry.id, { text })}
          />
          <EntityPicker
            value={entry.placeId}
            onChange={(placeId) => list.set(entry.id, { placeId })}
            kinds={['place']}
            placeholder="Wo?"
            create={{ storyId: story.id, onlyKinds: true }}
          />
          <Select
            value={entry.standing}
            aria-label="Wann der Einstieg passt"
            onChange={(event) =>
              list.set(entry.id, { standing: event.target.value as EntryStanding })
            }
          >
            {ENTRY_STANDINGS.map((standing) => (
              <option key={standing} value={standing}>
                {ENTRY_STANDING_LABEL[standing]}
              </option>
            ))}
          </Select>
          <IconButton
            label="Einstieg entfernen"
            size="sm"
            variant="ghost"
            onClick={() => list.remove(entry.id)}
          >
            <X />
          </IconButton>
        </div>
      ))}
      <NewLine
        label="Neuer Einstieg"
        placeholder={
          story.entries.length ? 'Ein weiterer Weg hinein' : 'Wie stößt die Gruppe darauf?'
        }
        mention={mention}
        onAdd={(text) =>
          patchStory(db, story.id, {
            entries: [...story.entries, { id: newId(), text, placeId: null, standing: 'any' }],
          })
        }
      />
    </SheetSection>
  );
}

// ── Szenen und Begegnungen ─────────────────────────────────────────────────

export function StoryScenes({ story }: { story: Story }) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const mention = useStoryMention(story);
  const list = useDraftList<StoryScene>(
    story.scenes,
    (scenes) => patchStory(db, story.id, { scenes }),
    (scene) => !scene.text.trim() && !scene.encounterId,
  );
  const encounters = Object.values(data.encounters).sort((a, b) =>
    a.name.localeCompare(b.name, 'de'),
  );
  const prepare = (scene: StoryScene) => {
    const encounter = newEncounter(db, scene.text.trim().slice(0, 60) || story.title);
    list.set(scene.id, { encounterId: encounter.id });
    toast({
      title: 'Begegnung angelegt',
      body: `„${encounter.name}“ – im Bestiarium stellst du sie zusammen.`,
      action: { label: 'Öffnen', run: () => navigate(`/begegnungen/${encounter.id}`) },
    });
  };
  return (
    <SheetSection
      id="scenes"
      title="Szenen und Begegnungen"
      hint="Was liegt bereit, wenn sie hingehen? Mit einem Ort steht die Szene dort am Spieltisch; Gespieltes hakst du ab."
    >
      {list.items.map((scene) => (
        <div
          key={scene.id}
          className="wf-sheet-list__row wf-sheet-list__row--scene"
          data-done={scene.done}
        >
          <Checkbox checked={scene.done} onChange={(done) => list.set(scene.id, { done })}>
            <span className="wf-sheet-list__sr">Gespielt</span>
          </Checkbox>
          <Written
            label="Szene"
            wrap
            value={scene.text}
            mention={mention}
            onSave={(text) => list.set(scene.id, { text })}
          />
          <IconButton
            label="Szene entfernen"
            size="sm"
            variant="ghost"
            onClick={() => list.remove(scene.id)}
          >
            <X />
          </IconButton>
          <div className="wf-faden-scene__more">
            <EntityPicker
              value={scene.placeId}
              onChange={(placeId) => list.set(scene.id, { placeId })}
              kinds={['place']}
              placeholder="Wo?"
              create={{ storyId: story.id, onlyKinds: true }}
            />
            <Select
              value={scene.odds}
              aria-label="Wie sicher die Szene kommt"
              onChange={(event) => list.set(scene.id, { odds: event.target.value as SceneOdds })}
            >
              {SCENE_ODDS.map((odds) => (
                <option key={odds} value={odds}>
                  {SCENE_ODDS_LABEL[odds]}
                </option>
              ))}
            </Select>
            <Select
              value={scene.encounterId ?? ''}
              aria-label="Begegnung zur Szene"
              onChange={(event) =>
                event.target.value === '+'
                  ? prepare(scene)
                  : list.set(scene.id, { encounterId: event.target.value || null })
              }
            >
              <option value="">ohne Begegnung</option>
              {encounters.map((encounter) => (
                <option key={encounter.id} value={encounter.id}>
                  {encounter.name}
                </option>
              ))}
              <option value="+">Neue Begegnung …</option>
            </Select>
            {scene.encounterId && data.encounters[scene.encounterId] && (
              <IconButton
                label="Begegnung öffnen"
                size="sm"
                onClick={() => navigate(`/begegnungen/${scene.encounterId}`)}
              >
                <Swords />
              </IconButton>
            )}
          </div>
        </div>
      ))}
      <NewLine
        label="Neue Szene"
        placeholder={story.scenes.length ? 'Eine weitere Szene' : 'Was liegt bereit?'}
        mention={mention}
        onAdd={(text) =>
          patchStory(db, story.id, {
            scenes: [
              ...story.scenes,
              { id: newId(), text, encounterId: null, odds: 'maybe', placeId: null, done: false },
            ],
          })
        }
      />
    </SheetSection>
  );
}
