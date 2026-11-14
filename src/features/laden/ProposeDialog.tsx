/**
 * „Liste vorschlagen“: was ein Laden führen könnte – die eigene Vorlage des Spielleiters für
 * diese Art (Zeilen angekreuzt, weil er sie selbst geschrieben hat) und „Wayfarer schlägt vor“
 * (aus seinen Einträgen, dem Bestiarium und dem Regelwerk – nichts angekreuzt). In den Bestand
 * kommt nur, was angekreuzt ist (`addProposedLines`). Jede Vorlage bleibt wählbar, auch eine
 * für eine andere Art. Die Rechnung steht in `domain/shopTemplate.ts`.
 */
import { useMemo, useState } from 'react';
import { PenLine } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { priceWithUnit, shopTitle } from '../../domain/shop';
import {
  templateProposals,
  templatesFor,
  wayfarerProposals,
  type Proposal,
} from '../../domain/shopTemplate';
import type { Shop } from '../../domain/schema';
import { SRD_ATTRIBUTION } from '../../domain/srd/lookup';
import { Button, Checkbox, Dialog, Select, cx, toast } from '../../ui';
import { addProposedLines } from './actions';

/** Die Zeilen einer Vorlage, die der Laden noch nicht führt – angekreuzt beim Wählen. */
const openKeys = (proposals: readonly Proposal[] | undefined): string[] =>
  (proposals ?? []).filter((p) => !p.have).map((p) => p.key);

export function ProposeDialog({
  shop,
  onClose,
  onTemplates,
}: {
  shop: Shop;
  onClose: () => void;
  /** Die Vorlagen schreiben (ein eigener Dialog). */
  onTemplates: () => void;
}) {
  const db = useDb();
  const data = useData();
  const kind = shop.kind.trim();
  const { fitting, others } = useMemo(() => templatesFor(data, kind), [data, kind]);
  const [templateId, setTemplateId] = useState<string | null>(() => fitting[0]?.id ?? null);
  const template = templateId ? data.assortments[templateId] : undefined;
  const own = useMemo(
    () => (template ? templateProposals(data, shop, template) : null),
    [data, shop, template],
  );
  const wayfarer = useMemo(() => wayfarerProposals(data, shop), [data, shop]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(openKeys(own?.proposals)));

  const all = [
    ...(own?.proposals ?? []),
    ...wayfarer.world,
    ...wayfarer.creatures,
    ...wayfarer.rules,
  ];
  const chosen = all.filter((p) => picked.has(p.key) && !p.have);
  const toggle = (keys: string[], on: boolean) =>
    setPicked((now) => {
      const next = new Set(now);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  const chooseTemplate = (id: string | null) => {
    // Die Zeilen der alten Vorlage fallen weg, die der neuen sind angekreuzt.
    const next = id ? data.assortments[id] : undefined;
    const fresh = next ? templateProposals(data, shop, next).proposals : [];
    setPicked((now) => {
      const keep = [...now].filter((key) => !key.startsWith('template:'));
      return new Set([...keep, ...openKeys(fresh)]);
    });
    setTemplateId(id);
  };

  const save = () => {
    const result = addProposedLines(
      db,
      shop.id,
      chosen.map((p) => p.line),
    );
    onClose();
    if (result && result.added > 0)
      toast({
        title: result.added === 1 ? '1 Ware im Bestand' : `${result.added} Waren im Bestand`,
        body: 'Preise, Einheiten und Mengen änderst du in den Zeilen.',
        action: { label: 'Rückgängig', run: result.undo },
      });
  };

  const hasTemplates = fitting.length + others.length > 0;
  const nothing =
    !own?.proposals.length &&
    !wayfarer.world.length &&
    !wayfarer.creatures.length &&
    !wayfarer.rules.length;

  return (
    <Dialog
      open
      onClose={onClose}
      width={820}
      title={`Liste vorschlagen · ${shopTitle(data, shop)}`}
      footer={
        <>
          <span className="wf-grow wf-laden-rules__count">
            {chosen.length === 0
              ? 'Noch nichts angekreuzt.'
              : chosen.length === 1
                ? '1 angekreuzt'
                : `${chosen.length} angekreuzt`}
          </span>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!chosen.length} onClick={save}>
            In den Bestand{chosen.length ? ` (${chosen.length})` : ''}
          </Button>
        </>
      }
    >
      <div className="wf-laden-rules">
        <div className="wf-laden-rules__bar">
          <span className="wf-caps">Deine Liste</span>
          {hasTemplates ? (
            <Select
              value={templateId ?? ''}
              aria-label="Vorlage"
              onChange={(event) => chooseTemplate(event.target.value || null)}
            >
              <option value="">Keine Vorlage</option>
              {fitting.length > 0 && (
                <optgroup label={kind ? `Passt zu „${kind}“` : 'Passt'}>
                  {fitting.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.kind || 'Ohne Art'}
                    </option>
                  ))}
                </optgroup>
              )}
              {others.length > 0 && (
                <optgroup label="Andere Vorlagen">
                  {others.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.kind || 'Ohne Art'}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          ) : (
            <span className="wf-grow wf-laden-rules__count">
              {kind
                ? `Zu „${kind}“ hast du noch keine eigene Liste.`
                : 'Noch keine eigene Liste geschrieben.'}
            </span>
          )}
          <Button size="sm" variant="ghost" icon={<PenLine />} onClick={onTemplates}>
            {hasTemplates ? 'Vorlagen schreiben …' : 'Liste schreiben …'}
          </Button>
        </div>

        <div className="wf-laden-rules__list" role="group" aria-label="Vorschläge">
          {own && (
            <ProposalBlock
              title={`Vorlage „${template?.kind || 'Ohne Art'}“`}
              proposals={own.proposals}
              picked={picked}
              onToggle={toggle}
              empty="Die Vorlage ist noch leer."
            />
          )}
          {own && own.unreadable.length > 0 && (
            <p className="wf-laden-warn">
              Nicht gelesen: {own.unreadable.map((line) => line.text).join(' · ')}
            </p>
          )}
          <div className="wf-laden-propose__head">Wayfarer schlägt vor</div>
          {!kind && (
            <p className="wf-laden-empty">
              Gib dem Laden eine Art (Schmiede, Tierhändler, Hafen …) – dann schlägt Wayfarer mehr
              vor.
            </p>
          )}
          <ProposalBlock
            title="Aus deinen Einträgen"
            proposals={wayfarer.world}
            picked={picked}
            onToggle={toggle}
          />
          <ProposalBlock
            title="Aus dem Bestiarium"
            proposals={wayfarer.creatures}
            picked={picked}
            onToggle={toggle}
          />
          <ProposalBlock
            title={
              wayfarer.ruleLabels.length
                ? `Aus dem Regelwerk – passt zu „${wayfarer.ruleLabels.join(', ')}“`
                : 'Aus dem Regelwerk'
            }
            proposals={wayfarer.rules}
            picked={picked}
            onToggle={toggle}
          />
          {nothing && kind && (
            <p className="wf-laden-empty">
              Zu „{kind}“ findet Wayfarer nichts. Schreib eine eigene Liste, sieh im Regelwerk nach
              oder wähle Waren einzeln – ein Laden kann alles führen.
            </p>
          )}
        </div>
        {wayfarer.rules.length > 0 && (
          <p className="wf-laden-rules__credit" title={SRD_ATTRIBUTION.en}>
            {SRD_ATTRIBUTION.short}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function ProposalBlock({
  title,
  proposals,
  picked,
  onToggle,
  empty,
}: {
  title: string;
  proposals: readonly Proposal[];
  picked: ReadonlySet<string>;
  onToggle: (keys: string[], on: boolean) => void;
  empty?: string;
}) {
  if (!proposals.length && !empty) return null;
  const open = proposals.filter((p) => !p.have).map((p) => p.key);
  const all = open.length > 0 && open.every((key) => picked.has(key));
  return (
    <div>
      <div className="wf-laden-rules__sub wf-laden-propose__sub">
        <span className="wf-grow">
          {title} · {proposals.length}
        </span>
        {open.length > 1 && (
          <button
            type="button"
            className="wf-laden-propose__all"
            onClick={() => onToggle(open, !all)}
          >
            {all ? 'Keine' : 'Alle'}
          </button>
        )}
      </div>
      {!proposals.length && <p className="wf-laden-empty">{empty}</p>}
      {proposals.map((p) => (
        <div
          key={p.key}
          className={cx('wf-laden-rules__row', p.have && 'wf-laden-rules__row--have')}
        >
          {p.have ? (
            <span className="wf-laden-rules__name wf-laden-rules__name--have">{p.name}</span>
          ) : (
            <Checkbox checked={picked.has(p.key)} onChange={(on) => onToggle([p.key], on)}>
              <span className="wf-laden-rules__name">{p.name}</span>
            </Checkbox>
          )}
          <span className="wf-laden-rules__facts">
            {p.have
              ? 'schon im Bestand'
              : [p.reason, p.line.qty !== null && `${p.line.qty} da`].filter(Boolean).join(' · ')}
          </span>
          <span className="wf-laden-rules__price">
            {p.price === null ? 'Preis offen' : priceWithUnit(p.price, p.line.unit)}
          </span>
        </div>
      ))}
    </div>
  );
}
