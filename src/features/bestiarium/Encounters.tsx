/**
 * Begegnungen: Wesen des Bestiariums zusammenstellen, die Schwierigkeit nach dem EP-Budget der
 * Gruppe sehen und am Tisch jedes Exemplar mit eigenen Trefferpunkten führen. Ein Klick auf ein
 * Exemplar zeigt seinen Statblock – mit den Würfeln für Angriff und Schaden.
 */
import { useMemo, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { BookCheck, Footprints, Minus, Plus, RotateCcw, Swords, Trash2, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { DIFFICULTY_LABEL, encounterView, type FoeView } from '../../domain/creature';
import { journeyUnderway } from '../../domain/journey';
import { fielded, lossPlan, stockView } from '../../domain/stock';
import {
  Button,
  EmptyState,
  EntityPicker,
  IconButton,
  Input,
  Select,
  confirmDialog,
  cx,
  toast,
} from '../../ui';
import {
  addFoes,
  newEncounter,
  removeEncounter,
  removeFoe,
  resetEncounter,
  setFoeHp,
  updateEncounter,
} from './encounterActions';
import { creatureRows } from './model';
import { bookLosses, fieldFromStock } from './stockActions';
import { StatBlock } from './StatBlock';
import './bestiarium.css';

const number = (value: number) => value.toLocaleString('de-DE');

export default function EncountersPage() {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const params = useParams<{ id?: string }>();
  const encounters = useMemo(
    () => Object.values(data.encounters).sort((a, b) => b.created.localeCompare(a.created)),
    [data.encounters],
  );
  const encounter = params.id ? data.encounters[params.id] : undefined;
  const view = useMemo(
    () => (encounter ? encounterView(data, encounter) : null),
    [data, encounter],
  );
  const creatures = useMemo(() => creatureRows(data), [data]);
  const [pick, setPick] = useState('');
  const [count, setCount] = useState('1');
  const [selected, setSelected] = useState<string | null>(null);
  const current = view?.foes.find((entry) => entry.foe.id === selected) ?? view?.foes[0] ?? null;
  const open = (id: string | null) => navigate(id ? `/begegnungen/${id}` : '/begegnungen');
  /** Bestände, aus denen sich Bewohner in die Begegnung stellen lassen – die am Ort zuerst. */
  const stocks = useMemo(
    () =>
      Object.values(data.stocks)
        .map((stock) => stockView(data, stock))
        .filter((entry) => entry.alive > 0)
        .sort(
          (a, b) =>
            Number(b.stock.placeId === encounter?.placeId) -
              Number(a.stock.placeId === encounter?.placeId) ||
            a.stock.name.localeCompare(b.stock.name, 'de'),
        ),
    [data, encounter?.placeId],
  );
  const losses = encounter ? lossPlan(data, encounter).foeIds.length : 0;
  const add = () => {
    if (!encounter || !pick) return;
    const [source, first, second] = pick.split(':');
    const wanted = Number(count) || 1;
    if (source === 'c') {
      addFoes(db, encounter.id, first!, wanted);
      return;
    }
    const taken = fieldFromStock(db, encounter.id, first!, second!, wanted);
    if (taken < wanted)
      toast({
        title: taken ? `Nur ${taken} sind noch da` : 'Von ihnen ist niemand mehr da',
        body: 'Mehr gibt der Bestand nicht her.',
      });
  };
  const book = () => {
    if (!encounter) return;
    const booked = bookLosses(db, encounter.id);
    if (booked)
      toast({
        title: booked.count === 1 ? 'Ein Verlust verbucht' : `${booked.count} Verluste verbucht`,
        body: 'Sie fehlen jetzt in ihrem Bestand.',
        action: { label: 'Rückgängig', run: booked.undo },
      });
  };

  const create = () => open(newEncounter(db).id);
  const remove = async () => {
    if (!encounter) return;
    const ok = await confirmDialog({
      title: `„${encounter.name}“ löschen?`,
      body: 'Die Begegnung verschwindet mit dem Stand ihrer Trefferpunkte. Die Wesen im Bestiarium bleiben.',
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    removeEncounter(db, encounter.id);
    open(null);
  };

  return (
    <div className="wf-best wf-best--enc">
      <aside className="wf-best-side" aria-label="Begegnungen">
        <div className="wf-best-side__head">
          <h1 className="wf-best-side__title">Begegnungen</h1>
          <span className="wf-best-side__total">{encounters.length}</span>
        </div>
        <div className="wf-best-side__new">
          <Button variant="primary" icon={<Plus aria-hidden />} onClick={create}>
            Neue Begegnung
          </Button>
        </div>
        <div className="wf-best-side__list">
          {encounters.map((entry) => {
            const summary = encounterView(data, entry);
            return (
              <button
                key={entry.id}
                type="button"
                className="wf-best-row"
                data-current={entry.id === encounter?.id}
                onClick={() => open(entry.id)}
              >
                <span className="wf-best-row__name">{entry.name}</span>
                <span className="wf-best-row__line">
                  {summary.foes.length
                    ? `${summary.standing} von ${summary.foes.length} stehen · ${number(summary.xp)} EP · ${DIFFICULTY_LABEL[summary.difficulty]}`
                    : 'noch leer'}
                </span>
              </button>
            );
          })}
          {!encounters.length && (
            <p className="wf-best-side__none">
              Hier stehen deine Begegnungen: Wesen aus dem Bestiarium, zusammengestellt für eine
              Szene.
            </p>
          )}
        </div>
      </aside>

      <div className="wf-best-main">
        {!encounter || !view ? (
          <div className="wf-best-blank">
            <EmptyState
              icon={<Swords aria-hidden />}
              title={encounters.length ? 'Wähle links eine Begegnung' : 'Noch keine Begegnung'}
            >
              Stell Wesen aus dem Bestiarium zusammen. Wayfarer zählt ihre Erfahrungspunkte,
              vergleicht sie mit dem Budget deiner Gruppe und führt am Tisch für jedes Exemplar
              eigene Trefferpunkte.
            </EmptyState>
          </div>
        ) : (
          <>
            <div className="wf-best-bar wf-best-enc__bar">
              <Input
                key={encounter.id}
                className="wf-best-enc__name"
                defaultValue={encounter.name}
                aria-label="Name der Begegnung"
                onBlur={(event) =>
                  event.target.value.trim() &&
                  updateEncounter(db, encounter.id, { name: event.target.value.trim() })
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
              <div className="wf-best-enc__place">
                <EntityPicker
                  value={encounter.placeId}
                  onChange={(placeId) => updateEncounter(db, encounter.id, { placeId })}
                  kinds={['place']}
                  placeholder="Wo?"
                />
              </div>
              <span className="wf-grow" />
              {/* Aus dem Halt einer Reise geöffnet: mit einem Klick zurück an den Spieltisch. */}
              {journeyUnderway(data)?.halt?.encounterId === encounter.id && (
                <Button
                  size="sm"
                  icon={<Footprints aria-hidden />}
                  title="Die Reise wartet am Spieltisch an diesem Halt"
                  onClick={() => navigate('/')}
                >
                  Zurück zur Reise
                </Button>
              )}
              {losses > 0 && (
                <Button
                  size="sm"
                  icon={<BookCheck aria-hidden />}
                  title="Wer aus einem Bestand stammt und besiegt ist, fehlt dort danach"
                  onClick={book}
                >
                  {losses === 1 ? 'Verlust verbuchen' : `${losses} Verluste verbuchen`}
                </Button>
              )}
              <Button
                size="sm"
                icon={<RotateCcw aria-hidden />}
                title="Alle wieder unverletzt – die Begegnung beginnt von vorn"
                disabled={!view.foes.some((entry) => entry.foe.hp !== null)}
                onClick={() => resetEncounter(db, encounter.id)}
              >
                Von vorn
              </Button>
              <IconButton size="sm" label="Begegnung löschen" onClick={remove}>
                <Trash2 aria-hidden />
              </IconButton>
            </div>

            <div className="wf-best-enc">
              <div className="wf-best-enc__left">
                <Budget view={view} />
                <div className="wf-best-enc__add">
                  <Select
                    value={pick}
                    aria-label="Wesen aus dem Bestiarium"
                    onChange={(event) => setPick(event.target.value)}
                  >
                    <option value="">Wesen wählen …</option>
                    {stocks.map((entry) => (
                      <optgroup
                        key={entry.stock.id}
                        label={`Aus dem Bestand „${entry.stock.name}“`}
                      >
                        {entry.groups
                          .filter(
                            (group) =>
                              group.resolved &&
                              group.alive >
                                fielded(encounter, entry.stock.id, group.group.creatureId),
                          )
                          .map((group) => (
                            <option
                              key={group.group.id}
                              value={`s:${entry.stock.id}:${group.group.creatureId}`}
                            >
                              {group.name} –{' '}
                              {group.alive -
                                fielded(encounter, entry.stock.id, group.group.creatureId)}{' '}
                              übrig
                            </option>
                          ))}
                      </optgroup>
                    ))}
                    {stocks.length > 0 && <option disabled>── Aus dem Bestiarium ──</option>}
                    {creatures.map((row) => (
                      <option key={row.id} value={`c:${row.id}`}>
                        {' '.repeat(row.depth)}
                        {row.name} · HG {row.cr}
                      </option>
                    ))}
                  </Select>
                  <Input
                    value={count}
                    inputMode="numeric"
                    aria-label="Anzahl"
                    title="Wie viele Exemplare"
                    onChange={(event) => setCount(event.target.value)}
                  />
                  <Button icon={<Plus aria-hidden />} disabled={!pick} onClick={add}>
                    Hinzufügen
                  </Button>
                </div>
                {!creatures.length && (
                  <p className="wf-best-side__none">
                    Das Bestiarium ist noch leer.{' '}
                    <button type="button" onClick={() => navigate('/bestiarium')}>
                      Wesen anlegen
                    </button>
                  </p>
                )}
                <div className="wf-best-foes">
                  {view.foes.map((entry) => (
                    <FoeRow
                      key={entry.foe.id}
                      entry={entry}
                      current={entry.foe.id === current?.foe.id}
                      from={entry.foe.stockId ? data.stocks[entry.foe.stockId]?.name : undefined}
                      onSelect={() => setSelected(entry.foe.id)}
                      onHp={(hp) => setFoeHp(db, encounter.id, entry.foe.id, hp)}
                      onRemove={() => removeFoe(db, encounter.id, entry.foe.id)}
                    />
                  ))}
                  {!view.foes.length && creatures.length > 0 && (
                    <p className="wf-best-side__none">
                      Noch niemand da. Wähle oben ein Wesen und wie viele davon.
                    </p>
                  )}
                </div>
              </div>
              <div className="wf-best-enc__right">
                {current?.resolved ? (
                  <StatBlock key={current.resolved.creature.id} resolved={current.resolved} />
                ) : (
                  <p className="wf-best-side__none">
                    Ein Klick auf ein Exemplar zeigt hier seinen Statblock – mit den Würfeln für
                    Angriff und Schaden.
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** EP der Begegnung gegen das Budget der Gruppe: niedrig, mittel, hoch. */
function Budget({ view }: { view: ReturnType<typeof encounterView> }) {
  const { budget, xp, levels, difficulty } = view;
  const top = Math.max(budget.high * 1.25, xp, 1);
  const at = (value: number) => `${Math.min(100, (value / top) * 100)}%`;
  return (
    <div className="wf-best-budget">
      <div className="wf-best-budget__head">
        <b>{number(xp)} EP</b>
        <span className={`wf-best-budget__word wf-best-budget__word--${difficulty}`}>
          {levels.length ? DIFFICULTY_LABEL[difficulty] : 'ohne Gruppe kein Budget'}
        </span>
        <span className="wf-grow" />
        <span className="wf-mute">
          {view.foes.length
            ? `${view.standing} von ${view.foes.length} stehen`
            : 'noch keine Gegner'}
        </span>
      </div>
      {levels.length > 0 && (
        <>
          <div className="wf-best-budget__bar" aria-hidden>
            <i className="wf-best-budget__fill" style={{ width: at(xp) }} />
            {(['low', 'moderate', 'high'] as const).map((step) => (
              <i key={step} className="wf-best-budget__mark" style={{ left: at(budget[step]) }} />
            ))}
          </div>
          <div className="wf-best-budget__legend">
            <span>
              Gruppe: {levels.length === 1 ? 'ein Gefährte' : `${levels.length} Gefährten`}, Stufe{' '}
              {[...new Set(levels)].join(', ')}
            </span>
            <span>
              niedrig bis {number(budget.low)} · mittel bis {number(budget.moderate)} · hoch bis{' '}
              {number(budget.high)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/** Ein Exemplar: Name, Trefferpunkte, Schaden und Heilung. */
function FoeRow({
  entry,
  current,
  from,
  onSelect,
  onHp,
  onRemove,
}: {
  entry: FoeView;
  current: boolean;
  /** Der Bestand, aus dem das Exemplar stammt. */
  from?: string;
  onSelect: () => void;
  onHp: (hp: number) => void;
  onRemove: () => void;
}) {
  const [amount, setAmount] = useState('');
  const change = (sign: 1 | -1) => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return;
    onHp(entry.hp + sign * value);
    setAmount('');
  };
  return (
    <div
      className={cx('wf-best-foe', entry.down && 'wf-best-foe--down')}
      data-current={current}
      data-low={!entry.down && entry.hp <= entry.max / 2}
    >
      <button type="button" className="wf-best-foe__main" onClick={onSelect}>
        <span className="wf-best-foe__name">{entry.foe.name}</span>
        <span className="wf-best-foe__sub">
          {entry.resolved
            ? entry.down
              ? entry.foe.booked
                ? 'besiegt · im Bestand verbucht'
                : 'besiegt'
              : `HG ${entry.resolved.block.cr} · RK ${entry.resolved.block.ac}`
            : 'nicht mehr im Bestiarium'}
          {from && !entry.foe.booked && ` · aus: ${from}`}
        </span>
      </button>
      {entry.resolved && (
        <>
          <span className="wf-best-foe__hp" title="Trefferpunkte">
            <b>{entry.hp}</b> / {entry.max}
            <i aria-hidden>
              <i style={{ width: `${entry.max ? (entry.hp / entry.max) * 100 : 0}%` }} />
            </i>
          </span>
          <Input
            value={amount}
            inputMode="numeric"
            placeholder="Zahl"
            aria-label={`Schaden oder Heilung für ${entry.foe.name}`}
            onChange={(event) => setAmount(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') change(-1);
            }}
          />
          <IconButton size="sm" label="Schaden eintragen" onClick={() => change(-1)}>
            <Minus aria-hidden />
          </IconButton>
          <IconButton size="sm" label="Heilung eintragen" onClick={() => change(1)}>
            <Plus aria-hidden />
          </IconButton>
        </>
      )}
      <IconButton size="sm" label={`${entry.foe.name} aus der Begegnung nehmen`} onClick={onRemove}>
        <X aria-hidden />
      </IconButton>
    </div>
  );
}
