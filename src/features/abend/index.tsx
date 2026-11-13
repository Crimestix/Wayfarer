/**
 * „Abend vorbereiten“: das Blatt für den nächsten Spielabend – was die Gefährten wollen, ein
 * starker Einstieg, die Geschichten im Spiel, mögliche Szenen, Geheimnisse, Begegnungen, Beute.
 * Am Spieltisch liegt es bereit zum Abhaken; was offen bleibt, wandert in den nächsten Abend.
 * Die Rechnung steht in `domain/prep.ts`. Wayfarer schreibt nichts davon selbst.
 */
import { useMemo } from 'react';
import { Link, useLocation } from 'wouter';
import { Flame, Plus, Swords, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { activeParty } from '../../domain/derive';
import {
  SECRETS_WANTED,
  openSecrets,
  prepAdvice,
  prepView,
  readyEncounters,
  type PrepView,
} from '../../domain/prep';
import { newId, type PrepScene, type PrepSecret } from '../../domain/schema';
import { storiesOfHero, storyClock, untilText } from '../../domain/story';
import {
  Button,
  Checkbox,
  IconButton,
  Input,
  Select,
  SheetAdvice,
  SheetSection,
  Written,
  cx,
  entityHref,
  toast,
  useDraftList,
} from '../../ui';
import { newEncounter } from '../bestiarium/encounterActions';
import { newStory, setInPlay, tieHero } from '../faeden/actions';
import { patchCharacter } from '../gruppe/actions';
import { LootList } from '../beute/LootList';
import { patchPrep } from './actions';
import './abend.css';

const upper = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export default function AbendPage() {
  const data = useData();
  const view = useMemo(() => prepView(data), [data]);
  // Wechselt das Blatt (eine Session beginnt oder endet), beginnen die Felder neu.
  return <PrepSheet key={`${view.prep?.id ?? 'neu'}:${view.number}`} view={view} />;
}

function PrepSheet({ view }: { view: PrepView }) {
  const db = useDb();
  const data = useData();
  const { content } = view;
  const advice = useMemo(() => prepAdvice(data, content), [data, content]);
  const open = advice.filter((entry) => !entry.done).length;

  return (
    <div className="wf-sheet">
      <div className="wf-sheet__main">
        <header className="wf-sheet__top">
          <div className="wf-sheet__kicker">Abend vorbereiten</div>
          <h1 className="wf-abend-title">
            {view.session ? `Session ${view.number} läuft` : `Für Session ${view.number}`}
          </h1>
          <p className="wf-sheet__hint">
            {view.session
              ? 'Dieses Blatt gehört zum laufenden Abend. Am Spieltisch hakst du ab, was gespielt und aufgedeckt wurde.'
              : 'Was hier steht, liegt am Spieltisch bereit, sobald der Abend beginnt.'}
            {view.carried.scenes + view.carried.secrets > 0 &&
              ` Vom letzten Abend übrig: ${[
                view.carried.secrets > 0 &&
                  (view.carried.secrets === 1
                    ? '1 Geheimnis'
                    : `${view.carried.secrets} Geheimnisse`),
                view.carried.scenes > 0 &&
                  (view.carried.scenes === 1 ? '1 Szene' : `${view.carried.scenes} Szenen`),
              ]
                .filter(Boolean)
                .join(' und ')}.`}
          </p>
        </header>

        <Companions />

        <SheetSection
          title="Starker Einstieg"
          hint="Etwas passiert – mitten hinein. Kein „ihr sitzt in der Schenke“."
        >
          <Written
            label="Starker Einstieg"
            rows={3}
            value={content.start}
            placeholder="Als die Gruppe den Steg betritt, treibt ein leeres Boot aus dem Nebel …"
            onSave={(start) => patchPrep(db, { start })}
          />
        </SheetSection>

        <Stories />
        <Scenes scenes={content.scenes} />
        <Secrets secrets={content.secrets} />
        <Encounters ids={content.encounterIds} />

        <SheetSection
          title="Beute"
          hint="Was der Abend bringen kann – am besten etwas, das zu einem bestimmten Gefährten passt. Am Spieltisch gibst du sie mit einem Klick aus; dann steht sie im Beute-Buch."
        >
          <LootList />
          <div className="wf-sheet__pair wf-sheet__pair--top">
            <span className="wf-sheet__label">Gedanken zur Beute</span>
            <Written
              label="Gedanken zur Beute"
              rows={2}
              value={content.treasure}
              placeholder="Was noch nicht feststeht …"
              onSave={(treasure) => patchPrep(db, { treasure })}
            />
          </div>
        </SheetSection>
      </div>

      <aside className="wf-sheet__side">
        <section>
          <h3 className="wf-abend-sub">{open === 0 ? 'Alles da' : `Noch offen · ${open}`}</h3>
          <p className="wf-mute">
            Ein Rat, keine Pflicht. Du musst nicht alles füllen – lass weg, was dir nicht hilft.
          </p>
          <SheetAdvice items={advice} />
        </section>
        <section>
          <h3 className="wf-abend-sub">Am Tisch</h3>
          <p className="wf-mute">
            Am Spieltisch steht dieses Blatt über den Geschichten im Spiel. Was du dort abhakst, ist
            hier erledigt; der Rest wandert in den nächsten Abend.
          </p>
          <Link href="/" className="wf-btn wf-btn--sm">
            <Flame />
            Zum Spieltisch
          </Link>
        </section>
      </aside>
    </div>
  );
}

// ── Die Gefährten ──────────────────────────────────────────────────────────

function Companions() {
  const db = useDb();
  const data = useData();
  const party = activeParty(data);
  const stories = Object.values(data.stories)
    .filter((story) => !story.closed)
    .sort((a, b) => a.title.localeCompare(b.title, 'de'));
  return (
    <SheetSection
      title="Die Gefährten"
      hint="Was will jeder – und welche Geschichte betrifft ihn persönlich? Beides bleibt bei dem Gefährten stehen."
    >
      {party.length === 0 && (
        <p className="wf-sheet__none">
          Noch kein Gefährte. <Link href="/gruppe">Zu den Gefährten</Link>
        </p>
      )}
      {party.map((character) => {
        const ties = storiesOfHero(data, character.id);
        const free = stories.filter((story) => !ties.some((tie) => tie.story.id === story.id));
        return (
          <div key={character.id} className="wf-abend-row wf-abend-row--goal">
            <Link href={entityHref(character)} className="wf-abend-name wf-clamp-1">
              {character.name}
            </Link>
            <div className="wf-abend-goal">
              <Written
                label={`Was ${character.name} will`}
                value={character.character.goal}
                placeholder="Ein Ziel, eine offene Rechnung, eine Sehnsucht …"
                onSave={(goal) => patchCharacter(db, character.id, { goal })}
              />
              <div className="wf-abend-ties">
                {ties.length === 0 && <span>Noch an keiner Geschichte.</span>}
                {ties.map((tie) => (
                  <Link
                    key={tie.story.id}
                    href={`/geschichte/${tie.story.id}`}
                    className={cx('wf-abend-tie', !tie.story.inPlay && 'wf-abend-tie--idle')}
                    title={[tie.why, !tie.story.inPlay && 'Diese Geschichte ist nicht im Spiel.']
                      .filter(Boolean)
                      .join('\n')}
                  >
                    {tie.story.title}
                    {!tie.story.inPlay && ' (nicht im Spiel)'}
                  </Link>
                ))}
                {free.length > 0 && (
                  <Select
                    value=""
                    aria-label={`${character.name} an eine Geschichte heften`}
                    onChange={(event) => {
                      if (event.target.value) tieHero(db, event.target.value, character.id);
                    }}
                  >
                    <option value="">an Geschichte heften …</option>
                    {free.map((story) => (
                      <option key={story.id} value={story.id}>
                        {story.title}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </SheetSection>
  );
}

// ── Geschichten im Spiel ───────────────────────────────────────────────────

function Stories() {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const now = data.state.now;
  const stories = Object.values(data.stories)
    .filter((story) => !story.closed)
    .sort((a, b) => a.title.localeCompare(b.title, 'de'));
  const playing = stories.filter((story) => story.inPlay);
  const idle = stories.filter((story) => !story.inPlay);
  return (
    <SheetSection
      title="Geschichten im Spiel"
      hint="Was an diesem Abend wichtig ist. Sie stehen am Spieltisch in der Mitte – mit allem, was an ihnen hängt."
      action={
        <Button
          size="sm"
          icon={<Plus />}
          onClick={() => navigate(`/geschichte/${newStory(db, { inPlay: true }).id}`)}
          title="Eine neue Geschichte schreiben – sie ist gleich im Spiel"
        >
          Neue Geschichte
        </Button>
      }
    >
      {playing.length === 0 && <p className="wf-sheet__none">Noch keine Geschichte im Spiel.</p>}
      {playing.map((story) => {
        const { view } = storyClock(data, story);
        return (
          <div key={story.id} className="wf-abend-row wf-abend-row--story">
            <Link href={`/geschichte/${story.id}`} className="wf-abend-name wf-clamp-1">
              {story.title}
            </Link>
            <span className="wf-abend-next wf-clamp-1">
              {view?.next
                ? `${view.paused ? 'Angehalten vor' : upper(untilText(view.next.at - now))}: ${view.next.step.text}`
                : view
                  ? 'Alles ist geschehen.'
                  : 'ohne Uhr'}
            </span>
            <IconButton
              label={`„${story.title}“ aus dem Spiel nehmen`}
              size="sm"
              variant="ghost"
              onClick={() => setInPlay(db, `story:${story.id}`, false)}
            >
              <X />
            </IconButton>
          </div>
        );
      })}
      {idle.length > 0 && (
        <Select
          className="wf-abend-add"
          value=""
          aria-label="Geschichte ins Spiel nehmen"
          onChange={(event) => {
            if (event.target.value) setInPlay(db, `story:${event.target.value}`, true);
          }}
        >
          <option value="">Geschichte ins Spiel nehmen …</option>
          {idle.map((story) => (
            <option key={story.id} value={story.id}>
              {story.title}
            </option>
          ))}
        </Select>
      )}
    </SheetSection>
  );
}

// ── Mögliche Szenen ────────────────────────────────────────────────────────

function Scenes({ scenes }: { scenes: PrepScene[] }) {
  const db = useDb();
  const list = useDraftList<PrepScene>(
    scenes,
    (items) => patchPrep(db, { scenes: items }),
    (scene) => !scene.text.trim(),
  );
  return (
    <SheetSection
      title="Mögliche Szenen"
      hint="Ein, zwei Sätze je Szene. Sie sind ein Angebot – sei bereit, sie wegzuwerfen."
      action={
        <Button
          size="sm"
          icon={<Plus />}
          onClick={() => list.add({ id: newId(), text: '', done: false })}
        >
          Szene
        </Button>
      }
    >
      {list.items.length === 0 && <p className="wf-sheet__none">Noch keine Szene.</p>}
      {list.items.map((scene) => (
        <div
          key={scene.id}
          className={cx('wf-abend-row wf-abend-row--scene', scene.done && 'wf-abend-row--done')}
        >
          <Checkbox checked={scene.done} onChange={(done) => list.set(scene.id, { done })}>
            <span className="wf-sheet-list__sr">Gespielt</span>
          </Checkbox>
          <Input
            value={scene.text}
            aria-label="Szene"
            placeholder="Was geschehen könnte"
            onChange={(event) => list.edit(scene.id, { text: event.target.value })}
            onBlur={list.flush}
          />
          <IconButton
            label="Szene entfernen"
            size="sm"
            variant="ghost"
            onClick={() => list.remove(scene.id)}
          >
            <X />
          </IconButton>
        </div>
      ))}
    </SheetSection>
  );
}

// ── Geheimnisse und Hinweise ───────────────────────────────────────────────

function Secrets({ secrets }: { secrets: PrepSecret[] }) {
  const db = useDb();
  const data = useData();
  const list = useDraftList<PrepSecret>(
    secrets,
    (items) => patchPrep(db, { secrets: items }),
    (secret) => !secret.text.trim(),
  );
  const stories = Object.values(data.stories)
    .filter((story) => !story.closed)
    .sort((a, b) => a.title.localeCompare(b.title, 'de'));
  const ready = openSecrets({ ...EMPTY_LISTS, secrets }).length;
  const add = () =>
    list.add({ id: newId(), text: '', storyId: null, revealed: false, revealedAt: null });
  return (
    <SheetSection
      title="Geheimnisse und Hinweise"
      hint="Was die Gruppe erfahren könnte – noch an keinem Ort und keiner Person festgemacht. Wo sie es findet, entscheidest du am Tisch. Was offen bleibt, wandert in den nächsten Abend."
      action={
        <>
          <span className={cx('wf-abend-count', ready < SECRETS_WANTED && 'wf-abend-count--low')}>
            {ready} von {SECRETS_WANTED}
          </span>
          <Button size="sm" icon={<Plus />} onClick={add}>
            Geheimnis
          </Button>
        </>
      }
    >
      {list.items.length === 0 && <p className="wf-sheet__none">Noch kein Geheimnis.</p>}
      {list.items.map((secret) => (
        <div
          key={secret.id}
          className={cx(
            'wf-abend-row wf-abend-row--secret',
            secret.revealed && 'wf-abend-row--done',
          )}
        >
          <Checkbox
            checked={secret.revealed}
            onChange={(revealed) =>
              list.set(secret.id, {
                revealed,
                revealedAt: revealed ? data.state.now : null,
              })
            }
          >
            <span className="wf-sheet-list__sr">Die Gruppe hat es erfahren</span>
          </Checkbox>
          <Input
            value={secret.text}
            aria-label="Geheimnis"
            placeholder="Der Zöllner hat das Geld selbst genommen."
            onChange={(event) => list.edit(secret.id, { text: event.target.value })}
            onBlur={list.flush}
            onKeyDown={(event) => {
              // Enter: gleich das nächste – so schreibt sich ein Vorrat in einem Zug.
              if (event.key === 'Enter' && secret.text.trim()) {
                list.flush();
                add();
              }
            }}
          />
          <Select
            value={secret.storyId ?? ''}
            aria-label="Zu welcher Geschichte es gehört"
            onChange={(event) => list.set(secret.id, { storyId: event.target.value || null })}
          >
            <option value="">zu keiner Geschichte</option>
            {stories.map((story) => (
              <option key={story.id} value={story.id}>
                {story.title}
              </option>
            ))}
          </Select>
          <IconButton
            label="Geheimnis entfernen"
            size="sm"
            variant="ghost"
            onClick={() => list.remove(secret.id)}
          >
            <X />
          </IconButton>
        </div>
      ))}
    </SheetSection>
  );
}

const EMPTY_LISTS = { start: '', scenes: [], secrets: [], encounterIds: [], treasure: '' };

// ── Begegnungen ────────────────────────────────────────────────────────────

function Encounters({ ids }: { ids: string[] }) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const ready = readyEncounters(data, { ...EMPTY_LISTS, encounterIds: ids });
  const others = Object.values(data.encounters)
    .filter((encounter) => !ids.includes(encounter.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const prepare = () => {
    const encounter = newEncounter(db);
    patchPrep(db, { encounterIds: [...ids, encounter.id] });
    toast({
      title: 'Begegnung angelegt',
      body: `„${encounter.name}“ – im Bestiarium stellst du sie zusammen.`,
      action: { label: 'Öffnen', run: () => navigate(`/begegnungen/${encounter.id}`) },
    });
  };
  return (
    <SheetSection
      title="Begegnungen bereit"
      hint="Im Bestiarium zusammengestellt – am Tisch nur noch öffnen. Begegnungen, die zu einer Geschichte gehören, stehen bei ihren Szenen."
      action={
        <Button size="sm" icon={<Plus />} onClick={prepare}>
          Neue Begegnung
        </Button>
      }
    >
      {ready.length === 0 && <p className="wf-sheet__none">Noch keine Begegnung bereitgelegt.</p>}
      {ready.map((encounter) => (
        <div key={encounter.id} className="wf-abend-row wf-abend-row--story">
          <Link href={`/begegnungen/${encounter.id}`} className="wf-abend-name wf-clamp-1">
            <Swords aria-hidden /> {encounter.name}
          </Link>
          <span className="wf-abend-next wf-clamp-1">
            {encounter.foes.length === 1 ? '1 Gegner' : `${encounter.foes.length} Gegner`}
            {encounter.placeId && data.entities[encounter.placeId]
              ? ` · ${data.entities[encounter.placeId]!.name}`
              : ''}
          </span>
          <IconButton
            label={`„${encounter.name}“ vom Blatt nehmen`}
            size="sm"
            variant="ghost"
            onClick={() => patchPrep(db, { encounterIds: ids.filter((id) => id !== encounter.id) })}
          >
            <X />
          </IconButton>
        </div>
      ))}
      {others.length > 0 && (
        <Select
          className="wf-abend-add"
          value=""
          aria-label="Begegnung bereitlegen"
          onChange={(event) => {
            if (event.target.value) patchPrep(db, { encounterIds: [...ids, event.target.value] });
          }}
        >
          <option value="">Begegnung bereitlegen …</option>
          {others.map((encounter) => (
            <option key={encounter.id} value={encounter.id}>
              {encounter.name}
            </option>
          ))}
        </Select>
      )}
    </SheetSection>
  );
}
