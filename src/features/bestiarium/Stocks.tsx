/**
 * Bestände: ein Bau, Hort oder Nest an einem Ort – wer dort haust, wie viele es waren und wie
 * viele noch da sind. Der Spielleiter trägt ein; Wayfarer zählt die Verluste.
 */
import { useMemo, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { Minus, Plus, Swords, Tent, Trash2, Undo2, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { stockSummary, stockView } from '../../domain/stock';
import {
  Button,
  EmptyState,
  EntityPicker,
  Field,
  IconButton,
  Input,
  Select,
  TextArea,
  confirmDialog,
  cx,
} from '../../ui';
import { newEncounter } from './encounterActions';
import { creatureRows } from './model';
import {
  addGroup,
  fieldFromStock,
  loseFromGroup,
  newStock,
  removeGroup,
  removeStock,
  updateStock,
} from './stockActions';
import './bestiarium.css';

export default function StocksPage() {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const params = useParams<{ id?: string }>();
  const stocks = useMemo(
    () => Object.values(data.stocks).sort((a, b) => a.name.localeCompare(b.name, 'de')),
    [data.stocks],
  );
  const stock = params.id ? data.stocks[params.id] : undefined;
  const view = useMemo(() => (stock ? stockView(data, stock) : null), [data, stock]);
  const creatures = useMemo(() => creatureRows(data), [data]);
  const [pick, setPick] = useState('');
  const [count, setCount] = useState('10');
  const open = (id: string | null) => navigate(id ? `/bestaende/${id}` : '/bestaende');
  const create = () => open(newStock(db).id);

  const remove = async () => {
    if (!stock) return;
    const ok = await confirmDialog({
      title: `„${stock.name}“ löschen?`,
      body: 'Der Bestand verschwindet mit seinen Zahlen. Der Ort und die Wesen im Bestiarium bleiben.',
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    removeStock(db, stock.id);
    open(null);
  };
  /** Alle, die noch da sind, treten an: eine Begegnung am Ort des Bestands. */
  const fight = () => {
    if (!stock || !view) return;
    const encounter = newEncounter(db, `${stock.name}: Kampf`);
    db.patch('encounters', encounter.id, { placeId: stock.placeId });
    for (const entry of view.groups)
      if (entry.resolved && entry.alive > 0)
        fieldFromStock(
          db,
          encounter.id,
          stock.id,
          entry.group.creatureId,
          Math.min(entry.alive, 12),
        );
    navigate(`/begegnungen/${encounter.id}`);
  };

  return (
    <div className="wf-best wf-best--enc">
      <aside className="wf-best-side" aria-label="Bestände">
        <div className="wf-best-side__head">
          <h1 className="wf-best-side__title">Bestände</h1>
          <span className="wf-best-side__total">{stocks.length}</span>
        </div>
        <div className="wf-best-side__new">
          <Button variant="primary" icon={<Plus aria-hidden />} onClick={create}>
            Neuer Bestand
          </Button>
        </div>
        <div className="wf-best-side__list">
          {stocks.map((entry) => {
            const summary = stockView(data, entry);
            return (
              <button
                key={entry.id}
                type="button"
                className="wf-best-row"
                data-current={entry.id === stock?.id}
                onClick={() => open(entry.id)}
              >
                <span className="wf-best-row__name">{entry.name}</span>
                <span className="wf-best-row__line">
                  {[
                    entry.placeId ? data.entities[entry.placeId]?.name : '',
                    summary.count ? `${summary.alive} von ${summary.count}` : 'noch leer',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
            );
          })}
          {!stocks.length && (
            <p className="wf-best-side__none">
              Hier stehen Baue, Horte und Nester: Orte mit Bewohnern, deren Zahl sich mit jedem
              Kampf ändert.
            </p>
          )}
        </div>
      </aside>

      <div className="wf-best-main">
        {!stock || !view ? (
          <div className="wf-best-blank">
            <EmptyState
              icon={<Tent aria-hidden />}
              title={stocks.length ? 'Wähle links einen Bestand' : 'Noch kein Bestand'}
            >
              Statt einzelner Statblöcke: ein Ort mit Bewohnern – „rund 30, davon 6 Krieger und ein
              Anführer“. Stellst du sie in eine Begegnung, fehlen die Besiegten danach im Bestand.
            </EmptyState>
          </div>
        ) : (
          <>
            <div className="wf-best-bar wf-best-enc__bar">
              <Input
                key={stock.id}
                className="wf-best-enc__name"
                defaultValue={stock.name}
                aria-label="Name des Bestands"
                onBlur={(event) =>
                  event.target.value.trim() &&
                  updateStock(db, stock.id, { name: event.target.value.trim() })
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
              <div className="wf-best-enc__place">
                <EntityPicker
                  value={stock.placeId}
                  onChange={(placeId) => updateStock(db, stock.id, { placeId })}
                  kinds={['place']}
                  placeholder="An welchem Ort?"
                />
              </div>
              <span className="wf-grow" />
              <Button
                size="sm"
                icon={<Swords aria-hidden />}
                disabled={view.alive === 0}
                title="Legt eine Begegnung an, in der die Bewohner antreten – höchstens zwölf je Art"
                onClick={fight}
              >
                Begegnung daraus
              </Button>
              <IconButton size="sm" label="Bestand löschen" onClick={remove}>
                <Trash2 aria-hidden />
              </IconButton>
            </div>

            <div className="wf-best-scroll">
              <div className="wf-best-stock">
                <p className="wf-best-stock__sum">
                  <b>{stockSummary(view)}</b>
                  {view.xp > 0 && <span> · zusammen {view.xp.toLocaleString('de-DE')} EP</span>}
                </p>
                <div className="wf-best-enc__add">
                  <Select
                    value={pick}
                    aria-label="Wesen aus dem Bestiarium"
                    onChange={(event) => setPick(event.target.value)}
                  >
                    <option value="">Wer haust hier? Wesen wählen …</option>
                    {creatures.map((row) => (
                      <option key={row.id} value={row.id}>
                        {' '.repeat(row.depth)}
                        {row.name} · HG {row.cr}
                      </option>
                    ))}
                  </Select>
                  <Input
                    value={count}
                    inputMode="numeric"
                    aria-label="Anzahl"
                    title="Wie viele"
                    onChange={(event) => setCount(event.target.value)}
                  />
                  <Button
                    icon={<Plus aria-hidden />}
                    disabled={!pick}
                    onClick={() => addGroup(db, stock.id, pick, Number(count) || 1)}
                  >
                    Eintragen
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
                  {view.groups.map((entry) => (
                    <div
                      key={entry.group.id}
                      className={cx('wf-best-group', entry.alive === 0 && 'wf-best-foe--down')}
                    >
                      <button
                        type="button"
                        className="wf-best-foe__main"
                        disabled={!entry.resolved}
                        title="Statblock öffnen"
                        onClick={() => navigate(`/bestiarium/${entry.group.creatureId}`)}
                      >
                        <span className="wf-best-foe__name">{entry.name}</span>
                        <span className="wf-best-foe__sub">
                          {entry.resolved ? `HG ${entry.resolved.block.cr}` : ''}
                          {entry.group.lost > 0 &&
                            `${entry.resolved ? ' · ' : ''}${entry.group.lost} verloren`}
                        </span>
                      </button>
                      <span className="wf-best-foe__hp" title="Noch da / waren es einmal">
                        <b>{entry.alive}</b> / {entry.group.count}
                      </span>
                      <IconButton
                        size="sm"
                        label={`Ein Verlust bei ${entry.name}`}
                        disabled={entry.alive === 0}
                        onClick={() => loseFromGroup(db, stock.id, entry.group.id, 1)}
                      >
                        <Minus aria-hidden />
                      </IconButton>
                      <IconButton
                        size="sm"
                        label={`Einen Verlust bei ${entry.name} zurücknehmen`}
                        disabled={entry.group.lost === 0}
                        onClick={() => loseFromGroup(db, stock.id, entry.group.id, -1)}
                      >
                        <Undo2 aria-hidden />
                      </IconButton>
                      <IconButton
                        size="sm"
                        label={`${entry.name} aus dem Bestand nehmen`}
                        onClick={() => removeGroup(db, stock.id, entry.group.id)}
                      >
                        <X aria-hidden />
                      </IconButton>
                    </div>
                  ))}
                </div>
                <div className="wf-best-form__row">
                  <Field label="Vorräte">
                    <TextArea
                      key={stock.id}
                      defaultValue={stock.stores}
                      rows={2}
                      onBlur={(event) => updateStock(db, stock.id, { stores: event.target.value })}
                    />
                  </Field>
                  <Field label="Beute">
                    <TextArea
                      key={stock.id}
                      defaultValue={stock.loot}
                      rows={2}
                      onBlur={(event) => updateStock(db, stock.id, { loot: event.target.value })}
                    />
                  </Field>
                </div>
                <div className="wf-best-form__row">
                  <Field label="Revier" hint="Wie weit sie streifen und was sie dort tun.">
                    <TextArea
                      key={stock.id}
                      defaultValue={stock.range}
                      rows={2}
                      onBlur={(event) => updateStock(db, stock.id, { range: event.target.value })}
                    />
                  </Field>
                  <Field label="Notizen">
                    <TextArea
                      key={stock.id}
                      defaultValue={stock.notes}
                      rows={2}
                      onBlur={(event) => updateStock(db, stock.id, { notes: event.target.value })}
                    />
                  </Field>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
