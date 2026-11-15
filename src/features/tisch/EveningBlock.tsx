/**
 * „Dieser Abend“ am Spieltisch: was auf dem Blatt des Abends bereitliegt – der starke Einstieg,
 * mögliche Szenen und Geheimnisse zum Abhaken, Begegnungen, Beute. Kurz gehalten: Ist der
 * Einstieg gespielt, klappt der Block zu; Szenen mit Ort stehen links beim Ort („Was hier
 * passieren kann“), Szenen einer Geschichte im Spiel bei ihrer Geschichte – ebenso Hinweise, die
 * dort schon als „liegt hier“ stehen (`playClaims`). Was aus einer
 * Geschichte kam, ist mit dem Haken auch dort gespielt oder gefunden. Geschrieben wird es unter
 * „Abend vorbereiten“ (`features/abend`); die Rechnung steht in `domain/prep.ts`.
 */
import { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { eveningLoot, lootLine, lootRecipient } from '../../domain/loot';
import { playClaims, playView } from '../../domain/play';
import {
  openScenes,
  openSecrets,
  prepHasContent,
  prepView,
  readyEncounters,
} from '../../domain/prep';
import { cx, toast } from '../../ui';
import { setSceneDone, setSecretRevealed, setStartDone } from '../abend/actions';
import { LootDialog } from '../beute/LootDialog';
import { useGiveLoot } from '../beute/useGive';

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

export function EveningBlock() {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const view = useMemo(() => prepView(data), [data]);
  const { content } = view;
  const start = content.start.trim();
  /** Von Hand auf- oder zugeklappt – sonst offen, solange der Einstieg noch nicht gespielt ist. */
  const [chosen, setOpen] = useState<boolean | null>(null);
  const open = chosen ?? (start !== '' && !content.startDone);
  const all = openScenes(content);
  // Szenen mit Ort stehen links beim Ort, Szenen einer Geschichte im Spiel bei ihrer Geschichte.
  const scenes = all.filter((scene) => {
    const story = scene.from ? data.stories[scene.from.storyId] : undefined;
    return !scene.placeId && !(story?.inPlay && !story.closed);
  });
  const elsewhere = all.length - scenes.length;
  // Ein Hinweis, der bei seiner Geschichte im Spiel schon als „liegt hier“ steht, steht nur dort.
  const claimed = useMemo(() => playClaims(playView(data)), [data]);
  const allSecrets = openSecrets(content);
  const secrets = allSecrets.filter(
    (secret) => !(secret.hint && claimed.has(`hint:${secret.hint.threadId}:${secret.hint.hintId}`)),
  );
  const hintsElsewhere = allSecrets.length - secrets.length;
  const encounters = readyEncounters(data, content);
  /** Beute, die bereitliegt und zu keiner Geschichte im Spiel gehört – die steht dort. */
  const loot = eveningLoot(data);
  const give = useGiveLoot();
  const [handing, setHanding] = useState(false);
  const handOut = handing && <LootDialog give onClose={() => setHanding(false)} />;

  if (!prepHasContent(data, content) && loot.length === 0)
    return (
      <div className="wf-tisch-abend wf-tisch-abend--blank">
        Für diesen Abend liegt noch nichts bereit.
        <Link href="/abend">Abend vorbereiten</Link>
        <button type="button" onClick={() => setHanding(true)}>
          Beute ausgeben
        </button>
        {handOut}
      </div>
    );

  const brief = [
    start !== '' && (content.startDone ? 'Einstieg gespielt' : 'Einstieg'),
    all.length > 0 && count(all.length, 'Szene', 'Szenen'),
    allSecrets.length > 0 && count(allSecrets.length, 'Geheimnis', 'Geheimnisse'),
    encounters.length > 0 && count(encounters.length, 'Begegnung', 'Begegnungen'),
    loot.length > 0 ? `${loot.length}× Beute` : content.treasure.trim() !== '' && 'Beute',
  ]
    .filter(Boolean)
    .join(' · ');
  const played = (id: string, text: string) => {
    setSceneDone(db, id, true);
    toast({
      title: 'Szene gespielt',
      body: text.slice(0, 120),
      action: { label: 'Rückgängig', run: () => setSceneDone(db, id, false) },
    });
  };
  const began = () => {
    setStartDone(db, true);
    setOpen(null);
    toast({
      title: 'Einstieg gespielt',
      body: 'Der Abend läuft – das Blatt klappt zu.',
      action: { label: 'Rückgängig', run: () => setStartDone(db, false) },
    });
  };
  const revealed = (id: string, text: string) => {
    setSecretRevealed(db, id, true);
    toast({
      title: 'Geheimnis aufgedeckt',
      body: text.slice(0, 120),
      action: { label: 'Rückgängig', run: () => setSecretRevealed(db, id, false) },
    });
  };

  return (
    <section className={cx('wf-tisch-gesch wf-tisch-abend', open && 'wf-tisch-gesch--open')}>
      <button
        type="button"
        className="wf-tisch-gesch__head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title={view.session ? undefined : 'Noch läuft kein Abend – das Blatt ist vorbereitet'}
      >
        {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
        <span className="wf-tisch-gesch__title">Dieser Abend</span>
        <span className="wf-tisch-gesch__where">
          {view.session ? `Session ${view.number}` : `vorbereitet für Session ${view.number}`}
        </span>
      </button>
      {!open && brief && <div className="wf-tisch-gesch__brief">{brief}</div>}
      {open && (
        <div className="wf-tisch-dazu">
          {start && !content.startDone && (
            <>
              <span className="wf-tisch-dazu__label" data-here>
                Einstieg
              </span>
              <div className="wf-tisch-dazu__row">
                <button
                  type="button"
                  className="wf-chron__check"
                  title="Gespielt – der Block klappt zu"
                  aria-label="Einstieg gespielt"
                  onClick={began}
                />
                <span className="wf-tisch-abend__text">{start}</span>
              </div>
            </>
          )}
          {scenes.map((scene) => (
            <Line key={scene.id} label="Szene">
              <button
                type="button"
                className="wf-chron__check"
                title="Gespielt"
                aria-label={`Gespielt: ${scene.text}`}
                onClick={() => played(scene.id, scene.text)}
              />
              <span>
                {scene.text}
                {scene.storyId && data.stories[scene.storyId] && (
                  <em> – {data.stories[scene.storyId]!.title}</em>
                )}
              </span>
            </Line>
          ))}
          {elsewhere > 0 && (
            <>
              <span className="wf-tisch-dazu__label" />
              <div className="wf-tisch-dazu__row">
                <em>
                  {elsewhere === 1
                    ? 'Eine weitere Szene steht'
                    : `${elsewhere} weitere Szenen stehen`}{' '}
                  bei ihrem Ort oder ihrer Geschichte.
                </em>
              </div>
            </>
          )}
          {secrets.map((secret) => (
            <Line key={secret.id} label="Geheimnis">
              <button
                type="button"
                className="wf-chron__check"
                title="Die Gruppe hat es erfahren"
                aria-label={`Aufgedeckt: ${secret.text}`}
                onClick={() => revealed(secret.id, secret.text)}
              />
              <span>
                {secret.text}
                {secret.storyId && data.stories[secret.storyId] && (
                  <em> – {data.stories[secret.storyId]!.title}</em>
                )}
              </span>
            </Line>
          ))}
          {hintsElsewhere > 0 && (
            <>
              <span className="wf-tisch-dazu__label" />
              <div className="wf-tisch-dazu__row">
                <em>
                  {hintsElsewhere === 1
                    ? 'Ein Hinweis liegt hier – er steht bei seiner Geschichte im Spiel.'
                    : `${hintsElsewhere} Hinweise liegen hier – sie stehen bei ihrer Geschichte im Spiel.`}
                </em>
              </div>
            </>
          )}
          {encounters.map((encounter) => (
            <Line key={encounter.id} label="Begegnung">
              <span>
                {encounter.name}
                <button
                  type="button"
                  className="wf-tisch-dazu__link"
                  onClick={() => navigate(`/begegnungen/${encounter.id}`)}
                >
                  öffnen
                </button>
              </span>
            </Line>
          ))}
          {loot.map((entry) => (
            <Line key={entry.id} label="Beute">
              <span>
                {lootLine(data, entry)}
                <em> – für {lootRecipient(data, entry)}</em>
                <button
                  type="button"
                  className="wf-tisch-dazu__link"
                  title="Steht danach im Beute-Buch und in der Mitschrift"
                  onClick={() => give(entry)}
                >
                  ausgeben
                </button>
              </span>
            </Line>
          ))}
          {content.treasure.trim() && (
            <>
              <span className="wf-tisch-dazu__label">{loot.length > 0 ? 'Dazu' : 'Beute'}</span>
              <div className="wf-tisch-dazu__row wf-tisch-abend__text">
                {content.treasure.trim()}
              </div>
            </>
          )}
          <div className="wf-tisch-dazu__foot">
            <button type="button" onClick={() => setHanding(true)}>
              Beute ausgeben
            </button>
            <button type="button" onClick={() => navigate('/abend')}>
              Vorbereitung öffnen
            </button>
          </div>
        </div>
      )}
      {handOut}
    </section>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="wf-tisch-dazu__label">{label}</span>
      <div className="wf-tisch-dazu__row">{children}</div>
    </>
  );
}
