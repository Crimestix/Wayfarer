/**
 * Die ersten beiden Fächer des Abend-Blatts: „Wo wir stehen“ (der Rückblick, was noch offen
 * hängt, was die Gruppe vorhat) und „Die Gefährten“ (was jeder will, was ihn betrifft). Was zum
 * Übernehmen dasteht, sind die eigenen Zeilen des Spielleiters aus der Chronik – wörtlich.
 */
import { useMemo } from 'react';
import { Link, useLocation } from 'wouter';
import { Check, CornerDownLeft } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { activeParty, entityName } from '../../domain/derive';
import { openWishes } from '../../domain/heroArc';
import { LOOSE_REASON_SHORT, looseEnds, sinceText } from '../../domain/looseEnds';
import { partyUncovered, planLines } from '../../domain/prep';
import { recap as recapOf } from '../../domain/recap';
import { storiesOfHero } from '../../domain/story';
import { Button, Select, Written, cx, entityHref } from '../../ui';
import { tieHero } from '../faeden/actions';
import { patchCharacter } from '../gruppe/actions';
import { addToPlan, newStoryForHero } from './actions';
import { OfferHead } from './Fach';
import { takeLines, type LastLine } from './model';
import { RecapBox } from './RecapBox';
import { useSheet, useSheetMention } from './sheet';

/** Der Eintrag im Auswahlfeld, der eine neue Geschichte anlegt. */
const NEW_STORY = '__neu__';
/** So viele offene Punkte zeigt das Blatt – alle stehen unter „Noch offen“. */
const LOOSE_SHOWN = 5;

/** Zeilen der Chronik mit einem Klick in ein Feld des Blatts – darunter, nie darüber. */
export function TakeLines({
  lines,
  target,
  onTake,
}: {
  lines: readonly LastLine[];
  /** Wohin übernommen wird: „in den Einstieg“. */
  target: string;
  onTake: (line: string) => void;
}) {
  return (
    <>
      {lines.map((entry) => (
        <div
          key={entry.id}
          className={cx('wf-abend-last__row', entry.taken && 'wf-abend-last__row--taken')}
        >
          <span className="wf-abend-last__kind">{entry.kind}</span>
          <span className="wf-abend-last__line wf-clamp-2" title={entry.line}>
            {entry.line}
          </span>
          <Button
            size="sm"
            variant="ghost"
            icon={entry.taken ? <Check /> : <CornerDownLeft />}
            disabled={entry.taken}
            title={
              entry.taken
                ? 'Steht schon da.'
                : `Wörtlich ${target} übernehmen – in einer neuen Zeile unter dem, was schon dasteht.`
            }
            onClick={() => onTake(entry.line)}
          >
            {entry.taken ? 'Übernommen' : 'Übernehmen'}
          </Button>
        </div>
      ))}
    </>
  );
}

export function WhereBody() {
  const db = useDb();
  const data = useData();
  const { which, content, number, patch } = useSheet();
  const mention = useSheetMention();
  const recap = useMemo(() => recapOf(data, number), [data, number]);
  const wanted = useMemo(
    () => takeLines(data, planLines(data, number), content.plan),
    [data, number, content.plan],
  );
  const open = useMemo(() => looseEnds(data), [data]);
  const place = data.state.placeId ? data.entities[data.state.placeId] : undefined;
  return (
    <>
      {recap ? (
        <RecapBox recap={recap} />
      ) : (
        <p className="wf-sheet__none">
          Noch ist kein Abend gespielt – danach steht hier, wo es aufgehört hat.{' '}
          {place ? (
            <>
              Die Gruppe steht hier: <Link href={entityHref(place)}>{place.name}</Link>.
            </>
          ) : (
            'Die Gruppe ist noch an keinem Ort.'
          )}
        </p>
      )}
      {open.length > 0 && (
        <div className="wf-abend-offers">
          <OfferHead>
            <span>Hängt noch offen</span>
            <Link href="/offen" className="wf-abend-link">
              {open.length > LOOSE_SHOWN ? `alle ${open.length} ansehen` : 'ansehen'}
            </Link>
          </OfferHead>
          {open.slice(-LOOSE_SHOWN).map((end) => (
            <div key={end.entry.id} className="wf-abend-offer">
              <span className="wf-abend-offer__label">{LOOSE_REASON_SHORT[end.reason]}</span>
              <span className="wf-abend-offer__text wf-clamp-2">
                {end.entry.text.trim() || end.placeIds.map((id) => entityName(data, id)).join(', ')}
              </span>
              <span className="wf-abend-offer__when">{sinceText(end)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="wf-sheet__pair wf-sheet__pair--top wf-abend-plan">
        <span className="wf-sheet__label">Was die Gruppe vorhat</span>
        <Written
          label="Was die Gruppe vorhat"
          grow
          value={content.plan}
          mention={mention}
          onSave={(plan) => patch({ plan })}
        />
      </div>
      {wanted.length > 0 && (
        <div className="wf-abend-last">
          <span className="wf-sheet__label">Zuletzt entschieden und gewünscht</span>
          <TakeLines
            lines={wanted}
            target="in „Was die Gruppe vorhat“"
            onTake={(line) => addToPlan(db, line, which)}
          />
        </div>
      )}
    </>
  );
}

export function PartyBody() {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const { content } = useSheet();
  const party = activeParty(data);
  const uncovered = useMemo(
    () => new Set(partyUncovered(data, content).map((character) => character.id)),
    [data, content],
  );
  const stories = Object.values(data.stories)
    .filter((story) => !story.closed)
    .sort((a, b) => a.title.localeCompare(b.title, 'de'));
  return (
    <>
      {party.length === 0 && (
        <p className="wf-sheet__none">
          Noch kein Gefährte. <Link href="/gruppe">Zu den Gefährten</Link>
        </p>
      )}
      {party.map((character) => {
        const ties = storiesOfHero(data, character.id);
        const free = stories.filter((story) => !ties.some((tie) => tie.story.id === story.id));
        const wishes = openWishes(data, character.id);
        return (
          <div key={character.id} className="wf-abend-row wf-abend-row--goal">
            <Link href={entityHref(character)} className="wf-abend-name wf-clamp-1">
              {character.name}
            </Link>
            <div className="wf-abend-goal">
              <Written
                label={`Was ${character.name} will`}
                value={character.character.goal}
                placeholder="Ein Ziel – in einem Satz"
                onSave={(goal) => patchCharacter(db, character.id, { goal })}
              />
              {wishes.map((wish) => (
                <span key={wish.id} className="wf-abend-wish">
                  Offener Wunsch: {wish.text}
                </span>
              ))}
              <div className="wf-abend-ties">
                {ties.length === 0 && (
                  <span>
                    {uncovered.has(character.id)
                      ? `Für ${character.name} steht noch nichts auf dem Blatt.`
                      : 'An keiner Geschichte – auf dem Blatt ist trotzdem etwas dabei.'}
                  </span>
                )}
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
                <Select
                  value=""
                  aria-label={`${character.name} an eine Geschichte heften`}
                  title="An eine Geschichte heften, die ihn persönlich betrifft – oder gleich eine neue für ihn schreiben"
                  onChange={(event) => {
                    const choice = event.target.value;
                    if (choice === NEW_STORY)
                      navigate(`/geschichte/${newStoryForHero(db, character.id).id}`);
                    else if (choice) tieHero(db, choice, character.id);
                  }}
                >
                  <option value="">an Geschichte heften …</option>
                  <option value={NEW_STORY}>{`+ Neue Geschichte für ${character.name}`}</option>
                  {free.length > 0 && (
                    <optgroup label="Bestehende Geschichten">
                      {free.map((story) => (
                        <option key={story.id} value={story.id}>
                          {story.title}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </Select>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
