/**
 * Die drei Fächer zum Schreiben auf dem Abend-Blatt: „Starker Einstieg“, „Mögliche Szenen“ und
 * „Geheimnisse und Hinweise“. Geschrieben wird beim Verlassen eines Feldes; eine neue Zeile
 * entsteht mit dem ersten Wort – nach der Eingabetaste steht die Schreibmarke gleich in der
 * nächsten. Darunter, was sich dazunehmen lässt: immer die eigenen Worte des Spielleiters.
 */
import { useMemo } from 'react';
import { Link, useLocation } from 'wouter';
import { Swords, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import {
  LAST_LINES,
  carriedNote,
  hintOf,
  lastSessionLines,
  readyAtStories,
  sceneOfText,
  secretOfText,
} from '../../domain/prep';
import { sceneOffers, startOffers, wantToKnow } from '../../domain/prepOffers';
import type { PrepScene, PrepSecret } from '../../domain/schema';
import { formatDayMonth } from '../../domain/time/calendar';
import {
  Checkbox,
  EntityPicker,
  IconButton,
  NamesHint,
  NewLine,
  Select,
  Written,
  toast,
} from '../../ui';
import { newEncounter } from '../bestiarium/encounterActions';
import {
  addScene,
  addSecret,
  addToStart,
  attachToSheet,
  detachFromSheet,
  markNotMeant,
} from './actions';
import { OfferHead, OfferRow } from './Fach';
import { lastLinesView } from './model';
import { TakeLines } from './PrepWhere';
import { useSheet, useSheetMention } from './sheet';

const NEW_ENCOUNTER = '+';

/** Namen im Text des Blatts: dazunehmen, anlegen oder wegklicken – nichts geschieht von selbst. */
function SheetNames({ texts }: { texts: readonly string[] }) {
  const db = useDb();
  const { which, content } = useSheet();
  const attached = useMemo(
    () => [...content.personIds, ...content.placeIds],
    [content.personIds, content.placeIds],
  );
  return (
    <NamesHint
      texts={texts}
      attached={attached}
      ignored={content.notMeant}
      known={['person', 'place', 'faction', 'family']}
      kinds={['person', 'place', 'faction']}
      onAdd={(entityId) => attachToSheet(db, entityId, which)}
      onIgnore={(key) => markNotMeant(db, key, which)}
      onRemove={(entityId) => detachFromSheet(db, entityId, which)}
    />
  );
}

// ── Starker Einstieg ───────────────────────────────────────────────────────

export function StartBody() {
  const db = useDb();
  const data = useData();
  const { which, view, content, number, patch } = useSheet();
  const mention = useSheetMention();
  const last = useMemo(
    () => lastLinesView(data, lastSessionLines(data, LAST_LINES, number), content.start),
    [data, number, content.start],
  );
  const fresh = useMemo(() => startOffers(data, content, number), [data, content, number]);
  const cal = data.campaign.calendar;
  return (
    <>
      <Written
        className="wf-abend-start"
        label="Starker Einstieg"
        grow
        value={content.start}
        mention={mention}
        onSave={(start) => patch({ start })}
      />
      {view.session && content.start.trim() !== '' && (
        <Checkbox checked={content.startDone} onChange={(startDone) => patch({ startDone })}>
          Gespielt – dann wandert er nicht in den nächsten Abend
        </Checkbox>
      )}
      {fresh.length > 0 && (
        <div className="wf-abend-offers">
          <OfferHead>
            <span>Gerade eingetreten</span>
          </OfferHead>
          {fresh.map((offer) => (
            <OfferRow
              key={offer.key}
              label={offer.kind === 'step' ? 'Schritt' : 'Termin'}
              text={offer.line}
              sub={[offer.sub, formatDayMonth(cal, offer.at)].filter(Boolean).join(' · ')}
              taken={offer.taken}
              takenText="Steht im Einstieg"
              action="in den Einstieg"
              title="Wörtlich in den Einstieg – unter dem, was schon dasteht"
              onTake={() => addToStart(db, offer.line, which)}
            />
          ))}
        </div>
      )}
      <div className="wf-abend-last">
        <span className="wf-sheet__label">{last.title}</span>
        {last.empty && <p className="wf-abend-last__none">{last.empty}</p>}
        <TakeLines
          lines={last.lines}
          target="in den Einstieg"
          onTake={(line) => addToStart(db, line, which)}
        />
      </div>
    </>
  );
}

// ── Mögliche Szenen ────────────────────────────────────────────────────────

export function ScenesBody() {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const { which, content, patch } = useSheet();
  const mention = useSheetMention();
  const offers = useMemo(() => sceneOffers(data, content), [data, content]);
  const stories = Object.values(data.stories)
    .filter((story) => !story.closed)
    .sort((a, b) => a.title.localeCompare(b.title, 'de'));
  const encounters = Object.values(data.encounters).sort((a, b) =>
    a.name.localeCompare(b.name, 'de'),
  );
  const update = (id: string, change: Partial<PrepScene>) =>
    patch({
      scenes: content.scenes.map((scene) => (scene.id === id ? { ...scene, ...change } : scene)),
    });
  const remove = (id: string) =>
    patch({ scenes: content.scenes.filter((scene) => scene.id !== id) });
  const prepare = (scene: PrepScene) => {
    const encounter = newEncounter(db, scene.text.trim().slice(0, 60));
    update(scene.id, { encounterId: encounter.id });
    toast({
      title: 'Begegnung angelegt',
      body: `„${encounter.name}“ – im Bestiarium stellst du sie zusammen.`,
      action: { label: 'Öffnen', run: () => navigate(`/begegnungen/${encounter.id}`) },
    });
  };
  return (
    <>
      {content.scenes.map((scene) => {
        const story = scene.storyId ? data.stories[scene.storyId] : undefined;
        const note = carriedNote(scene.carried);
        return (
          <div key={scene.id} className="wf-abend-row wf-abend-row--scene" data-done={scene.done}>
            <Checkbox checked={scene.done} onChange={(done) => update(scene.id, { done })}>
              <span className="wf-sheet-list__sr">Gespielt</span>
            </Checkbox>
            <Written
              label="Szene"
              grow
              value={scene.text}
              mention={mention}
              onSave={(text) => (text.trim() ? update(scene.id, { text }) : remove(scene.id))}
            />
            <IconButton
              label={
                scene.from ? 'Vom Abend nehmen – in der Geschichte bleibt sie' : 'Szene entfernen'
              }
              size="sm"
              variant="ghost"
              onClick={() => remove(scene.id)}
            >
              <X />
            </IconButton>
            <div className="wf-abend-scene__more">
              <EntityPicker
                value={scene.placeId}
                onChange={(placeId) => update(scene.id, { placeId })}
                kinds={['place']}
                placeholder="Wo?"

                create={{ storyId: scene.storyId, onlyKinds: true }}
              />
              {scene.from && story ? (
                <Link
                  href={`/geschichte/${story.id}`}
                  className="wf-abend-from wf-clamp-1"
                  title="Diese Szene kam aus der Geschichte – abgehakt wird beides zusammen"
                >
                  aus „{story.title}“
                </Link>
              ) : (
                <Select
                  value={scene.storyId ?? ''}
                  aria-label="Zu welcher Geschichte die Szene gehört"
                  onChange={(event) => update(scene.id, { storyId: event.target.value || null })}
                >
                  <option value="">zu keiner Geschichte</option>
                  {stories.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.title}
                    </option>
                  ))}
                </Select>
              )}
              <Select
                value={scene.encounterId ?? ''}
                aria-label="Begegnung zur Szene"
                onChange={(event) =>
                  event.target.value === NEW_ENCOUNTER
                    ? prepare(scene)
                    : update(scene.id, { encounterId: event.target.value || null })
                }
              >
                <option value="">ohne Begegnung</option>
                {encounters.map((encounter) => (
                  <option key={encounter.id} value={encounter.id}>
                    {encounter.name}
                  </option>
                ))}
                <option value={NEW_ENCOUNTER}>Neue Begegnung …</option>
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
              {note && <span className="wf-abend-carried">{note}</span>}
            </div>
          </div>
        );
      })}
      <NewLine
        label="Neue Szene"
        placeholder={content.scenes.length ? 'Eine weitere Szene' : 'Was könnte geschehen?'}
        mention={mention}
        onAdd={(text) => addScene(db, sceneOfText(text), which)}
      />
      <SheetNames texts={content.scenes.map((scene) => scene.text)} />
      {offers.length > 0 && (
        <div className="wf-abend-offers">
          <OfferHead>
            <span>Zum Dazunehmen</span>
          </OfferHead>
          {offers.map((offer) => (
            <OfferRow
              key={offer.key}
              text={offer.scene.text}
              sub={offer.sub}
              action="dazunehmen"
              title={
                offer.scene.from
                  ? 'Die Szene wird eine Szene des Abends – abgehakt wird beides zusammen'
                  : 'Wörtlich als Szene auf den Abend'
              }
              onTake={() =>
                addScene(db, { ...sceneOfText(offer.scene.text), ...offer.scene }, which)
              }
            />
          ))}
        </div>
      )}
    </>
  );
}

// ── Geheimnisse und Hinweise ───────────────────────────────────────────────

export function SecretsBody() {
  const db = useDb();
  const data = useData();
  const { which, content, patch, jump } = useSheet();
  const mention = useSheetMention();
  const wanted = useMemo(() => wantToKnow(data), [data]);
  const atStories = useMemo(() => readyAtStories(data, content).hints, [data, content]);
  const stories = Object.values(data.stories)
    .filter((story) => !story.closed)
    .sort((a, b) => a.title.localeCompare(b.title, 'de'));
  const update = (id: string, change: Partial<PrepSecret>) =>
    patch({
      secrets: content.secrets.map((secret) =>
        secret.id === id ? { ...secret, ...change } : secret,
      ),
    });
  const remove = (id: string) =>
    patch({ secrets: content.secrets.filter((secret) => secret.id !== id) });
  return (
    <>
      {content.secrets.map((secret) => {
        const linked = hintOf(data, secret);
        const note = carriedNote(secret.carried);
        return (
          <div
            key={secret.id}
            className="wf-abend-row wf-abend-row--secret"
            data-done={secret.revealed}
          >
            <Checkbox
              checked={secret.revealed}
              onChange={(revealed) =>
                update(secret.id, { revealed, revealedAt: revealed ? data.state.now : null })
              }
            >
              <span className="wf-sheet-list__sr">Die Gruppe hat es erfahren</span>
            </Checkbox>
            <Written
              label="Geheimnis"
              wrap
              value={secret.text}
              mention={mention}
              onSave={(text) => (text.trim() ? update(secret.id, { text }) : remove(secret.id))}
            />
            {linked ? (
              <Link
                href={linked.thread.storyId ? `/geschichte/${linked.thread.storyId}` : '/faeden'}
                className="wf-abend-from wf-clamp-1"
                title={`Ein Hinweis zu „${linked.thread.title}“ – aufgedeckt heißt dort gefunden`}
              >
                Hinweis zu „{linked.thread.title}“
              </Link>
            ) : (
              <Select
                value={secret.storyId ?? ''}
                aria-label="Zu welcher Geschichte es gehört"
                title="Mit einer Geschichte steht es auch auf ihrem Blatt – unter ihren Hinweisen, als „für den Abend bereit“"
                onChange={(event) => update(secret.id, { storyId: event.target.value || null })}
              >
                <option value="">zu keiner Geschichte</option>
                {stories.map((story) => (
                  <option key={story.id} value={story.id}>
                    {story.title}
                  </option>
                ))}
              </Select>
            )}
            <IconButton
              label={
                linked
                  ? 'Vom Abend nehmen – der Hinweis bleibt bei seiner Frage'
                  : 'Geheimnis entfernen'
              }
              size="sm"
              variant="ghost"
              onClick={() => remove(secret.id)}
            >
              <X />
            </IconButton>
            {note && <span className="wf-abend-carried wf-abend-carried--row">{note}</span>}
          </div>
        );
      })}
      <NewLine
        label="Neues Geheimnis"
        placeholder={
          content.secrets.length
            ? 'Ein weiteres – die Eingabetaste legt das nächste an'
            : 'Was wahr ist und die Gruppe noch nicht weiß'
        }
        mention={mention}
        onAdd={(text) => addSecret(db, secretOfText(text), which)}
      />
      <SheetNames texts={content.secrets.map((secret) => secret.text)} />
      {atStories > 0 && (
        <p className="wf-abend-there">
          {atStories === 1
            ? 'Ein Hinweis der Geschichten im Spiel fehlt der Gruppe noch.'
            : `${atStories} Hinweise der Geschichten im Spiel fehlen der Gruppe noch.`}{' '}
          <button type="button" className="wf-abend-link" onClick={() => jump('stories')}>
            dort auf den Abend legen
          </button>
        </p>
      )}
      {wanted.length > 0 && (
        <div className="wf-abend-offers">
          <OfferHead>
            <span>Das wollen sie wissen</span>
          </OfferHead>
          {wanted.map((entry) => (
            <div key={entry.key} className="wf-abend-offer">
              <span className="wf-abend-offer__label">
                {entry.kind === 'guess' ? 'Vermutung' : 'Gerücht'}
              </span>
              <span className="wf-abend-offer__text wf-clamp-2">{entry.text}</span>
              <Link
                href={entry.kind === 'guess' ? '/spielerbuch' : '/offen'}
                className="wf-abend-link"
              >
                ansehen
              </Link>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
