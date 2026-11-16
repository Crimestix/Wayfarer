/** Die Gefährten als schmale Leiste am unteren Rand: Zustand der Gruppe auf einen Blick. */
import {
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { Link } from 'wouter';
import { ExternalLink, Eye, Feather, MapPin, Swords } from 'lucide-react';
import { nameIntoJournal } from './journalInsert';
import { useData, useDb } from '../../data/hooks';
import { useMediaSrc } from '../../data/media';
import { FATE_LABEL } from '../../domain/chronicleKinds';
import { cx, entityHref } from '../../ui';
import { restingIn } from '../../domain/body';
import { isSplit } from '../../domain/party';
import { BodySwitch } from '../gruppe/parts';
import { setExhaustion } from './commands';
import { PartyGroupBar, SplitButton } from './PartyGroups';
import {
  MAX_EXHAUSTION,
  companions,
  exhaustionAfterClick,
  exhaustionEffect,
  type Companion,
} from './model';

const LEVELS = Array.from({ length: MAX_EXHAUSTION }, (_, i) => i + 1);

function Mate({ companion }: { companion: Companion }) {
  const db = useDb();
  const { character, elsewhere, astray, sheet } = companion;
  const c = character.character;
  const apart = elsewhere !== null || astray;
  const resting = restingIn(useData(), character.id);
  const whereabouts = elsewhere ? elsewhere.name : 'nicht bei der Gruppe';
  /** Tot, verschollen …: Der Gefährte bleibt in der Leiste, aber gekennzeichnet. */
  const fate = c.status === 'alive' ? null : FATE_LABEL[c.status];
  // Die sechs Marken sind zusammen ein Halt für die Tabulatortaste; Pfeiltasten ändern die Stufe.
  const focusLevel = Math.max(1, c.exhaustion);
  const onPipKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    const next = Math.min(MAX_EXHAUSTION, Math.max(0, c.exhaustion + step));
    setExhaustion(db, character.id, next);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('button')[Math.max(1, next) - 1]?.focus();
  };
  const src = useMediaSrc();
  // Ohne Bild der Anfangsbuchstabe: Sechs gleiche Schwert-Symbole würden niemanden unterscheiden.
  const face = (
    <span className="wf-portrait wf-tisch-mate__face" aria-hidden>
      {character.image ? (
        <img src={src(character.image)} alt="" />
      ) : (
        character.name.trim().charAt(0).toUpperCase() || '?'
      )}
    </span>
  );
  return (
    <div
      className={cx(
        'wf-tisch-mate',
        apart && 'wf-tisch-mate--apart',
        fate && 'wf-tisch-mate--fallen',
      )}
    >
      {sheet ? (
        <a
          className="wf-tisch-mate__sheet"
          href={sheet}
          target="_blank"
          rel="noreferrer noopener"
          title={`Charakterbogen von ${character.name} öffnen`}
          aria-label={`Charakterbogen von ${character.name} öffnen`}
        >
          {face}
          <ExternalLink aria-hidden />
        </a>
      ) : (
        face
      )}
      <div className="wf-tisch-mate__main">
        <Link
          href={entityHref(character)}
          className="wf-tisch-mate__name wf-clamp-1"
          title={[
            character.name,
            c.className && `${c.className} ${c.level}`,
            c.player && `gespielt von ${c.player}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        >
          {character.name}
        </Link>
        <button
          type="button"
          className="wf-tisch-mate__write"
          title={`${character.name} in die Mitschrift setzen – wer hat was getan?`}
          aria-label={`${character.name} in die Mitschrift setzen`}
          onClick={() => nameIntoJournal({ id: character.id, name: character.name })}
        >
          <Feather aria-hidden />
        </button>
        <div className="wf-tisch-mate__stats">
          <div
            className="wf-tisch-pips"
            role="group"
            aria-label={`Erschöpfung von ${character.name}: ${c.exhaustion} von ${MAX_EXHAUSTION}`}
            title={exhaustionEffect(c.exhaustion)}
            data-level={c.exhaustion}
            onKeyDown={onPipKey}
          >
            {LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                className="wf-tisch-pip"
                aria-label={`Erschöpfung ${level}`}
                aria-pressed={level <= c.exhaustion}
                tabIndex={level === focusLevel ? 0 : -1}
                onClick={() =>
                  setExhaustion(db, character.id, exhaustionAfterClick(c.exhaustion, level))
                }
              >
                <i />
              </button>
            ))}
          </div>
          <span
            className="wf-tisch-mate__sense wf-num"
            title={
              c.passivePerception === null
                ? 'Passive Wahrnehmung ist noch nicht eingetragen.'
                : `Passive Wahrnehmung ${c.passivePerception}`
            }
          >
            <Eye aria-hidden />
            {c.passivePerception ?? '–'}
          </span>
        </div>
        {/* Zwei Gefährten, ein Körper: wer gerade ruht, steht leise dabei – ein Klick wechselt. */}
        {resting && (
          <div className="wf-tisch-mate__body">
            ruht: <BodySwitch character={character} />
          </div>
        )}
        {(fate || apart || c.conditions.length > 0) && (
          <div
            className="wf-tisch-mate__notes wf-clamp-1"
            title={[
              fate && `Schicksal: ${fate}`,
              apart && `Abseits der Gruppe: ${whereabouts}`,
              c.conditions.length > 0 && `Zustände: ${c.conditions.join(', ')}`,
            ]
              .filter(Boolean)
              .join('\n')}
          >
            {fate && <span className="wf-tisch-mate__fate">{fate}</span>}
            {apart && (
              <span className="wf-tisch-mate__apart">
                <MapPin aria-hidden />
                {whereabouts}
              </span>
            )}
            {c.conditions.length > 0 && (
              <span className="wf-tisch-mate__conditions">{c.conditions.join(', ')}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Meldungen stehen unten rechts – am Spieltisch genau über den Knöpfen der Leiste („Wer macht
 * was …“, Zusammenführen). Solange die Leiste da ist, rücken sie über sie (`--wf-toast-lift`),
 * sonst schluckt eine Meldung nach dem Festhalten den nächsten Klick.
 */
function useToastsAbove(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const lift = () =>
      root.style.setProperty(
        '--wf-toast-lift',
        `${Math.max(0, window.innerHeight - el.getBoundingClientRect().top)}px`,
      );
    lift();
    const watch = new ResizeObserver(lift);
    watch.observe(el);
    window.addEventListener('resize', lift);
    return () => {
      watch.disconnect();
      window.removeEventListener('resize', lift);
      root.style.removeProperty('--wf-toast-lift');
    };
  }, [ref]);
}

export function CompanionStrip() {
  const data = useData();
  const list = useMemo(() => companions(data), [data]);
  const split = isSplit(data);
  const strip = useRef<HTMLElement>(null);
  useToastsAbove(strip);
  return (
    <section
      ref={strip}
      className={cx('wf-tisch-party', split && 'wf-tisch-party--split')}
      aria-label="Gefährten"
    >
      <Link href="/gruppe" className="wf-tisch-party__label" title="Zur Gruppe">
        <span>Gefährten</span>
      </Link>
      {list.length === 0 ? (
        <div className="wf-tisch-party__empty">
          <Swords aria-hidden />
          <span>
            Noch keine aktiven Gefährten. Hier stehen Erschöpfung, Zustände und passive Wahrnehmung
            der Gruppe.
          </span>
          <Link href="/gruppe" className="wf-btn wf-btn--sm">
            Gefährten anlegen
          </Link>
        </div>
      ) : (
        <div className="wf-tisch-party__main">
          {/* Getrennte Wege: der Umschalter der Teilgruppen über den Gefährten. */}
          {split && <PartyGroupBar />}
          <div className="wf-tisch-party__row">
            <div
              className="wf-tisch-party__list"
              style={{ '--mates': list.length } as CSSProperties}
            >
              {list.map((companion) => (
                <Mate key={companion.character.id} companion={companion} />
              ))}
            </div>
            {!split && list.length > 1 && (
              <div className="wf-tisch-party__split">
                <SplitButton />
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
