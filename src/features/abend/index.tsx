/**
 * „Abend vorbereiten“: das Blatt für einen Spielabend – geführt von oben nach unten, damit klar
 * ist, wo man anfängt: wo die Gruppe steht, die Gefährten, die Geschichten im Spiel (mit allem,
 * was sich davon auf den Abend legen lässt), ein starker Einstieg, mögliche Szenen, Geheimnisse,
 * Orte, Personen, Begegnungen, Beute. Jedes Fach ist freiwillig und lässt sich einklappen oder
 * für diesen Abend abwählen; der Rat am Rand nennt den nächsten sinnvollen Schritt zuerst.
 * Läuft ein Abend, gibt es zwei Blätter: seines und das des nächsten. Die Rechnung steht in
 * `domain/prep.ts` und `domain/prepOffers.ts`. Wayfarer schreibt nichts davon selbst.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { Flame, Printer } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import {
  prepAdvice,
  prepNext,
  prepStand,
  prepView,
  sectionFilled,
  suggestedWhich,
  type PrepSection,
  type PrepView,
  type PrepWhich,
} from '../../domain/prep';
import { useFocus } from '../../shell/focus';
import { Button, Checkbox, SheetAdvice, Tabs, Written, focusSheetSection } from '../../ui';
import { usePrint } from '../handouts/print';
import { patchPrep, setSkipped } from './actions';
import { Fach } from './Fach';
import { Leftovers } from './Leftovers';
import { spareNames } from './model';
import { PrepPaper } from './PrepPaper';
import { StoriesAction, StoriesBody } from './PrepStories';
import { PartyBody, WhereBody } from './PrepWhere';
import { EncountersAction, EncountersBody, LootBody, PeopleBody, PlacesBody } from './PrepWorld';
import { ScenesBody, SecretsBody, StartBody } from './PrepWriting';
import { SheetCtx } from './sheet';
import './abend.css';

/** Das Datum von heute, wie es an einer Session steht (JJJJ-MM-TT). */
const today = () => new Date().toISOString().slice(0, 10);

const BODY: Record<PrepSection, () => ReactNode> = {
  where: () => <WhereBody />,
  party: () => <PartyBody />,
  stories: () => <StoriesBody />,
  start: () => <StartBody />,
  scenes: () => <ScenesBody />,
  secrets: () => <SecretsBody />,
  places: () => <PlacesBody />,
  people: () => <PeopleBody />,
  encounters: () => <EncountersBody />,
  loot: () => <LootBody />,
};

const ACTION: Partial<Record<PrepSection, () => ReactNode>> = {
  stories: () => <StoriesAction />,
  encounters: () => <EncountersAction />,
};

export default function AbendPage() {
  const data = useData();
  // Läuft ein Abend von gestern noch, wird fast immer schon der nächste vorbereitet.
  const [asked, setAsked] = useState<PrepWhich>(() => suggestedWhich(data, today()));
  useFocus(['prep'], (focus) => setAsked(focus.which));
  // Beginnt oder endet ein Abend, während die Seite offen ist, zeigt sie das Blatt, an dem jetzt
  // gearbeitet wird: Wer gerade „Neue Session beginnen“ gewählt hat, sieht das eben vorbereitete
  // Blatt als „Dieser Abend“ – nicht ein leeres für den übernächsten.
  const runningId = data.state.sessionId;
  const [seenRunning, setSeenRunning] = useState(runningId);
  if (seenRunning !== runningId) {
    setSeenRunning(runningId);
    setAsked(suggestedWhich(data, today()));
  }

  const view = useMemo(() => prepView(data, asked), [data, asked]);
  // Wechselt das Blatt (eine Session beginnt oder endet, der andere Reiter), beginnen die Felder
  // neu. Das erste gespeicherte Wort legt das Blatt an, ist aber kein Wechsel: Sonst ginge der
  // Klick verloren, der das Feld verlassen hat, und das nächste Feld verlöre die Schreibmarke.
  return (
    <PrepSheet
      key={`${view.which}:${view.session?.id ?? 'offen'}:${view.number}`}
      view={view}
      onWhich={setAsked}
    />
  );
}

function PrepSheet({ view, onWhich }: { view: PrepView; onWhich: (which: PrepWhich) => void }) {
  const db = useDb();
  const data = useData();
  const { content, which, number } = view;
  const stand = useMemo(() => prepStand(data, content), [data, content]);
  const advice = useMemo(() => prepAdvice(data, content, stand), [data, content, stand]);
  /** Geführt: alle Fächer, „Fang hier an“ und Rat. Sonst frei (F21). */
  const guide = data.campaign.prepGuide;
  const next = guide ? prepNext(stand) : null;
  /** Ein Fach steht offen – geführt zuerst das, bei dem es weitergeht; frei keines. */
  const [open, setOpen] = useState<PrepSection | null>(() =>
    guide ? (next?.key ?? 'where') : null,
  );
  /** Frei: Fächer, die der Spielleiter dazugeholt hat, obwohl noch nichts darin steht. */
  const [added, setAdded] = useState<PrepSection[]>([]);
  const shown = stand.filter(
    (entry) => guide || sectionFilled(data, content, entry.key) || added.includes(entry.key),
  );
  const waiting = guide ? [] : stand.filter((entry) => !shown.includes(entry));
  /** Wohin gesprungen wird, sobald das Fach aufgeklappt ist. */
  const [target, setTarget] = useState<{ key: PrepSection } | null>(null);
  useEffect(() => {
    if (target) focusSheetSection(target.key);
  }, [target]);
  const jump = (key: PrepSection) => {
    if (!added.includes(key)) setAdded((list) => [...list, key]);
    setOpen(key);
    setTarget({ key });
  };
  const { print, layer } = usePrint();
  const title = view.session ? `Session ${number}` : `Für Session ${number}`;
  const ctx = useMemo(
    () => ({ which, view, content, number, jump }),
    // `jump` ist bei jedem Zeichnen neu; gemeint ist das Blatt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [which, view, content, number],
  );

  return (
    <SheetCtx.Provider value={ctx}>
      <div className="wf-sheet">
        <div className="wf-sheet__main">
          <header className="wf-sheet__top">
            <div className="wf-sheet__kicker">Abend vorbereiten</div>
            {view.running && (
              <Tabs<PrepWhich>
                tabs={[
                  { id: 'now', label: `Dieser Abend (läuft) · Session ${view.running.number}` },
                  { id: 'next', label: 'Nächster Abend' },
                ]}
                value={which}
                onChange={onWhich}
              />
            )}
            <h1 className="wf-abend-title">
              {view.session ? `Session ${number} läuft` : `Für Session ${number}`}
            </h1>
            <p className="wf-sheet__hint">
              {view.session
                ? 'Dieses Blatt gehört zum laufenden Abend. Am Spieltisch hakst du ab, was gespielt und aufgedeckt wurde.'
                : view.running
                  ? 'Der laufende Abend endet erst von Hand – hier bereitest du schon den nächsten vor. Sobald er beginnt, liegt dieses Blatt am Spieltisch; was vom laufenden übrig bleibt, kommt dann dazu.'
                  : guide
                    ? 'Was hier steht, liegt am Spieltisch bereit, sobald der Abend beginnt. Von oben nach unten – und nur so weit, wie es dir hilft.'
                    : 'Bereite vor, wie es dir passt – frei in deinen Worten. Fächer holst du dazu, wenn du sie brauchst; was darin steht, liegt am Spieltisch bereit.'}
            </p>
          </header>

          <section
            className="wf-abend-free"
            aria-label="Deine Vorbereitung"
            data-with-faecher={shown.some((entry) => entry.key !== 'party') ? '' : undefined}
          >
            <Written
              className="wf-abend-free__text"
              label="Deine Vorbereitung"
              grow
              value={content.text}
              placeholder="Was du für den Abend im Kopf hast – in deinen Worten, in deiner Reihenfolge. Szenen, Namen, Geheimnisse, ein starker Einstieg: Alles darf hier stehen."
              onSave={(text) => patchPrep(db, { text }, which)}
            />
          </section>

          <Leftovers />

          <div className="wf-abend-faecher">
            {shown.map((entry, index) => {
              const after = guide ? shown[index + 1] : undefined;
              return (
                <Fach
                  key={entry.key}
                  stand={entry}
                  open={open === entry.key}
                  first={next?.key === entry.key}
                  onToggle={() => setOpen(open === entry.key ? null : entry.key)}
                  onSkip={(skipped) => setSkipped(db, entry.key, skipped, which)}
                  next={after ? { title: after.title, go: () => jump(after.key) } : null}
                  action={ACTION[entry.key]?.()}
                >
                  {BODY[entry.key]()}
                </Fach>
              );
            })}
          </div>
        </div>

        <aside className="wf-sheet__side">
          <section>
            <Checkbox checked={guide} onChange={(prepGuide) => db.setCampaign({ prepGuide })}>
              Geführt vorbereiten
            </Checkbox>
            <p className="wf-mute">
              {guide
                ? 'Alle Fächer von oben nach unten, mit einem Rat, wo es weitergeht.'
                : 'Aus: frei vorbereiten. Die Fächer bleiben da, wenn du sie brauchst.'}
            </p>
          </section>
          {waiting.length > 0 && (
            <section>
              <h3 className="wf-abend-sub">Fächer dazuholen</h3>
              <div className="wf-abend-more">
                {waiting.map((entry) => (
                  <button key={entry.key} type="button" onClick={() => jump(entry.key)}>
                    + {entry.title}
                  </button>
                ))}
              </div>
            </section>
          )}
          {guide && (
            <>
              <section>
                <h3 className="wf-abend-sub">
                  {next ? 'Fang hier an' : 'Das reicht für einen Abend'}
                </h3>
                {next ? (
                  <button type="button" className="wf-abend-next" onClick={() => jump(next.key)}>
                    <b>{next.title}</b>
                    <span>{next.note}</span>
                  </button>
                ) : (
                  <p className="wf-mute">
                    Alles Weitere entsteht am Tisch. Vorbereitung dient dem Improvisieren – nicht
                    dem Ablauf.
                  </p>
                )}
              </section>
              <section>
                <h3 className="wf-abend-sub">Das Blatt</h3>
                <SheetAdvice
                  items={advice}
                  onPick={(entry) => jump(entry.key)}
                  onOff={(entry, off) => setSkipped(db, entry.key, off, which)}
                />
              </section>
            </>
          )}
          <section>
            <h3 className="wf-abend-sub">Am Tisch</h3>
            <p className="wf-mute">
              Am Spieltisch liegt das Blatt bereit zum Abhaken. Was aus einer Geschichte kam, ist
              dann auch dort gespielt oder gefunden; was offen bleibt, wartet auf dem nächsten
              Blatt.
            </p>
            <Link href="/" className="wf-btn wf-btn--sm">
              <Flame />
              Zum Spieltisch
            </Link>
            <Button
              size="sm"
              icon={<Printer />}
              title="Einstieg, Namen, Szenen, Geheimnisse, Orte und Personen auf einer Seite"
              onClick={() =>
                print(
                  <PrepPaper
                    title={title}
                    content={content}
                    names={spareNames(data, number, content.namesRound)}
                  />,
                )
              }
            >
              Eine Seite drucken
            </Button>
          </section>
        </aside>
        {layer}
      </div>
    </SheetCtx.Provider>
  );
}
