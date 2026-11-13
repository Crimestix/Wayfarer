/**
 * Bestiarium: Wesen finden (Suche, Filter), ansehen (Statblock nach 2024) und bauen – als Vorlage,
 * Variante oder Einzelner. Nichts wird mitgeliefert: Hier steht, was der Spielleiter gebaut oder
 * aus seinen Quellen übernommen hat.
 */
import { useMemo, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { ClipboardPaste, CopyPlus, Pencil, Plus, Skull, Trash2, UserPlus } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { CRS, KIND_LABEL, creatureChildren } from '../../domain/creature';
import type { Creature } from '../../domain/schema';
import { Button, EmptyState, IconButton, Input, Select, confirmDialog, cx } from '../../ui';
import { removeCreature } from './actions';
import { NO_FILTER, creatureFacets, creatureRows, type CreatureFilter } from './model';
import { PasteDialog } from './PasteDialog';
import { StatBlock } from './StatBlock';
import './bestiarium.css';

export default function BestiariumPage() {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const params = useParams<{ id?: string }>();
  const [filter, setFilter] = useState<CreatureFilter>(NO_FILTER);
  const [pasting, setPasting] = useState(false);
  const set = (change: Partial<CreatureFilter>) =>
    setFilter((before) => ({ ...before, ...change }));

  const total = Object.keys(data.creatures).length;
  const rows = useMemo(() => creatureRows(data, filter), [data, filter]);
  const facets = useMemo(() => creatureFacets(data), [data]);
  const all = useMemo(() => creatureRows(data), [data]);
  const current = all.find((row) => row.id === params.id) ?? null;
  const filtered = Object.values(filter).some(Boolean);
  const open = (id: string | null) => navigate(id ? `/bestiarium/${id}` : '/bestiarium');

  const remove = async (creature: Creature) => {
    const heirs = creatureChildren(data.creatures, creature.id);
    const ok = await confirmDialog({
      title: `„${creature.name}“ löschen?`,
      body: heirs.length
        ? `${heirs.length === 1 ? `„${heirs[0]!.name}“ erbt` : `${heirs.length} Wesen erben`} davon. ${heirs.length === 1 ? 'Es behält' : 'Sie behalten'} alle Werte und ${heirs.length === 1 ? 'steht' : 'stehen'} danach für sich.`
        : 'Der Statblock verschwindet aus dem Bestiarium.',
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    removeCreature(db, creature.id);
    open(creature.parentId);
  };

  return (
    <div className="wf-best">
      <aside className="wf-best-side" aria-label="Bestiarium">
        <div className="wf-best-side__head">
          <h1 className="wf-best-side__title">Bestiarium</h1>
          <span className="wf-best-side__total">{total}</span>
        </div>
        <div className="wf-best-side__new">
          <Button
            variant="primary"
            icon={<Plus aria-hidden />}
            onClick={() => navigate('/bestiarium/neu')}
          >
            Neues Wesen
          </Button>
          <Button
            icon={<ClipboardPaste aria-hidden />}
            title="Einen Statblock als Text einfügen – aus einem Buch, von D&D Beyond oder aus eigenen Notizen"
            onClick={() => setPasting(true)}
          >
            Text einfügen
          </Button>
        </div>
        {total > 0 && (
          <div className="wf-best-side__filter">
            <Input
              value={filter.query}
              placeholder="Wesen suchen …"
              aria-label="Wesen suchen"
              onChange={(event) => set({ query: event.target.value })}
            />
            <div className="wf-best-side__selects">
              <Select
                value={filter.maxCr}
                aria-label="Höchster Herausforderungsgrad"
                onChange={(event) => set({ maxCr: event.target.value })}
              >
                <option value="">Jeder HG</option>
                {CRS.map((cr) => (
                  <option key={cr} value={cr}>
                    bis HG {cr}
                  </option>
                ))}
              </Select>
              <Select
                value={filter.type}
                aria-label="Typ"
                onChange={(event) => set({ type: event.target.value })}
              >
                <option value="">Jeder Typ</option>
                {facets.types.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </Select>
              <Select
                value={filter.habitat}
                aria-label="Lebensraum"
                onChange={(event) => set({ habitat: event.target.value })}
              >
                <option value="">Jeder Lebensraum</option>
                {facets.habitats.map((habitat) => (
                  <option key={habitat}>{habitat}</option>
                ))}
              </Select>
              <Select
                value={filter.source}
                aria-label="Quelle"
                onChange={(event) => set({ source: event.target.value })}
              >
                <option value="">Jede Quelle</option>
                {facets.sources.map((source) => (
                  <option key={source}>{source}</option>
                ))}
              </Select>
            </div>
          </div>
        )}
        <div className="wf-best-side__list">
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              className={cx('wf-best-row', `wf-best-row--${row.kind}`)}
              style={{ paddingLeft: `calc(var(--s-4) + ${row.depth * 16}px)` }}
              data-current={row.id === current?.id}
              onClick={() => open(row.id)}
            >
              <span className="wf-best-row__name">{row.name}</span>
              <span className="wf-best-row__line">{row.line}</span>
            </button>
          ))}
          {total > 0 && !rows.length && (
            <p className="wf-best-side__none">
              Kein Wesen passt.{' '}
              {filtered && (
                <button type="button" onClick={() => setFilter(NO_FILTER)}>
                  Filter zurücksetzen
                </button>
              )}
            </p>
          )}
          {!total && (
            <p className="wf-best-side__none">
              Hier stehen deine Wesen: selbst gebaut oder aus deinen Quellen übernommen. Wayfarer
              bringt keine mit.
            </p>
          )}
        </div>
      </aside>

      <div className="wf-best-main">
        {!current ? (
          <div className="wf-best-blank">
            <EmptyState
              icon={<Skull aria-hidden />}
              title={total ? 'Wähle links ein Wesen' : 'Noch kein Wesen'}
            >
              Bau einen Statblock nach den Regeln von 2024 oder füge einen als Text ein. Wayfarer
              rechnet Modifikatoren, Übungsbonus, Trefferpunkte, Angriffe und Rettungswürfe und
              sagt, ob der Herausforderungsgrad zu den Werten passt. Eine Variante erbt ihre Vorlage
              und hält nur fest, was abweicht.
            </EmptyState>
          </div>
        ) : (
          <>
            <div className="wf-best-bar">
              <span className="wf-best-bar__kind">{KIND_LABEL[current.kind]}</span>
              <span className="wf-grow" />
              {current.kind !== 'individual' && (
                <>
                  <Button
                    size="sm"
                    icon={<CopyPlus aria-hidden />}
                    title="Erbt diesen Statblock und hält nur fest, was abweicht"
                    onClick={() => navigate(`/bestiarium/neu/variante/${current.id}`)}
                  >
                    Variante
                  </Button>
                  <Button
                    size="sm"
                    icon={<UserPlus aria-hidden />}
                    title="Ein bestimmtes Wesen mit Namen und eigenen Trefferpunkten"
                    onClick={() => navigate(`/bestiarium/neu/einzelner/${current.id}`)}
                  >
                    Einzelner
                  </Button>
                </>
              )}
              <Button
                size="sm"
                icon={<Pencil aria-hidden />}
                onClick={() => navigate(`/bestiarium/${current.id}/bearbeiten`)}
              >
                Bearbeiten
              </Button>
              <IconButton
                size="sm"
                label="Wesen löschen"
                onClick={() => remove(current.resolved.creature)}
              >
                <Trash2 aria-hidden />
              </IconButton>
            </div>
            <div className="wf-best-scroll">
              <StatBlock key={current.id} resolved={current.resolved} />
            </div>
          </>
        )}
      </div>

      {pasting && (
        <PasteDialog
          onClose={() => setPasting(false)}
          onSaved={(creature) => {
            setPasting(false);
            // Gleich prüfen und ergänzen: Was Wayfarer nicht verstanden hat, steht dort oben.
            navigate(`/bestiarium/${creature.id}/bearbeiten`);
          }}
        />
      )}
    </div>
  );
}
