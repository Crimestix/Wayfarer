/**
 * Die Fächer „Orte“, „Personen“, „Begegnungen“ und „Beute“ des Abend-Blatts: Verweise auf die
 * Welt, kein Abschreiben. Angeboten wird, was naheliegt (`domain/prepOffers.ts`); was fehlt,
 * entsteht hier als Platzhalter. Die „Namen für den Notfall“ sind erzeugt – als solche erkennbar,
 * stabil je Blatt und erst ein Eintrag der Welt, wenn der Spielleiter einen anlegt.
 */
import { useMemo } from 'react';
import { Link, useLocation } from 'wouter';
import { Dices, Plus, Swords, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { readyEncounters } from '../../domain/prep';
import {
  encounterOffers,
  personOffers,
  personRows,
  placeOffers,
  placeRows,
  stocksNear,
} from '../../domain/prepOffers';
import { stockSummary } from '../../domain/stock';
import {
  Button,
  EntityPicker,
  IconButton,
  KindIcon,
  Select,
  StubMark,
  Written,
  entityHref,
  toast,
  useWriting,
} from '../../ui';
import { newEncounter } from '../bestiarium/encounterActions';
import { LootList } from '../beute/LootList';
import { detachFromSheet, rerollNames, setOnSheet } from './actions';
import { OfferHead, OfferRow } from './Fach';
import { spareNames } from './model';
import { useSheet } from './sheet';

// ── Orte ───────────────────────────────────────────────────────────────────

export function PlacesBody() {
  const db = useDb();
  const data = useData();
  const { which, content } = useSheet();
  const rows = useMemo(() => placeRows(data, content), [data, content]);
  const offers = useMemo(() => placeOffers(data, content), [data, content]);
  const add = (id: string | null) => {
    if (id) setOnSheet(db, 'placeIds', id, true, which);
  };
  return (
    <>
      {rows.map((row) => (
        <div key={row.place.id} className="wf-abend-ref">
          <Link href={entityHref(row.place)} className="wf-abend-name wf-clamp-1">
            <KindIcon kind="place" /> {row.place.name}
          </Link>
          <span className="wf-abend-ref__line wf-clamp-2">
            {row.here && <b>Die Gruppe ist hier. </b>}
            {row.line || (row.path !== row.place.name ? row.path : '')}
            {row.unwritten && <em className="wf-abend-ref__blank"> noch ohne Text</em>}
          </span>
          <IconButton
            label={`${row.place.name} vom Blatt nehmen`}
            size="sm"
            variant="ghost"
            onClick={() => setOnSheet(db, 'placeIds', row.place.id, false, which)}
          >
            <X />
          </IconButton>
        </div>
      ))}
      <div className="wf-abend-pick">
        <EntityPicker
          value={null}
          onChange={add}
          kinds={['place']}
          exclude={content.placeIds}
          placeholder="Ort dazunehmen – oder neu anlegen …"
          create={{ onlyKinds: true }}
          onRevert={(id) => detachFromSheet(db, id, which)}
        />
      </div>
      {offers.length > 0 && (
        <div className="wf-abend-offers">
          <OfferHead>
            <span>Liegt nahe</span>
          </OfferHead>
          {offers.map((offer) => (
            <OfferRow
              key={offer.place.id}
              text={offer.place.name}
              sub={offer.why}
              action="dazunehmen"
              onTake={() => add(offer.place.id)}
            />
          ))}
        </div>
      )}
    </>
  );
}

// ── Personen ───────────────────────────────────────────────────────────────

export function PeopleBody() {
  const db = useDb();
  const data = useData();
  const write = useWriting();
  const { which, content, number } = useSheet();
  const rows = useMemo(() => personRows(data, content), [data, content]);
  const offers = useMemo(() => personOffers(data, content), [data, content]);
  const spare = useMemo(
    () => spareNames(data, number, content.namesRound),
    [data, number, content.namesRound],
  );
  const add = (id: string | null) => {
    if (id) setOnSheet(db, 'personIds', id, true, which);
  };
  const create = (name: string, role: string) => {
    const outcome = write(
      { name, kind: 'person', line: role },
      { revert: (entity) => detachFromSheet(db, entity.id, which) },
    );
    if (outcome?.taken) add(outcome.entity.id);
  };
  return (
    <>
      {rows.map((row) => (
        <div key={row.entity.id} className="wf-abend-ref">
          <Link href={entityHref(row.entity)} className="wf-abend-name wf-clamp-1">
            <KindIcon kind={row.entity.kind} /> {row.entity.name}
          </Link>
          <span className="wf-abend-ref__line wf-clamp-2">
            {row.facts.map((fact) => fact.text).join(' · ')}
            {row.facts.length === 0 && !row.unwritten && (
              <em className="wf-abend-ref__blank">Noch nichts eingetragen.</em>
            )}{' '}
            <StubMark entity={row.entity} />
          </span>
          <IconButton
            label={`${row.entity.name} vom Blatt nehmen`}
            size="sm"
            variant="ghost"
            onClick={() => setOnSheet(db, 'personIds', row.entity.id, false, which)}
          >
            <X />
          </IconButton>
        </div>
      ))}
      <div className="wf-abend-pick">
        <EntityPicker
          value={null}
          onChange={add}
          kinds={['person', 'faction', 'family']}
          exclude={content.personIds}
          placeholder="Person dazunehmen – oder neu anlegen …"
          create={{ onlyKinds: true }}
          onRevert={(id) => detachFromSheet(db, id, which)}
        />
      </div>
      {offers.length > 0 && (
        <div className="wf-abend-offers">
          <OfferHead>
            <span>Liegt nahe</span>
          </OfferHead>
          {offers.map((offer) => (
            <OfferRow
              key={offer.entity.id}
              text={offer.entity.name}
              sub={offer.why}
              action="dazunehmen"
              onTake={() => add(offer.entity.id)}
            />
          ))}
        </div>
      )}
      <div className="wf-abend-offers wf-abend-spare">
        <OfferHead>
          <span>Namen für den Notfall</span>
          <button
            type="button"
            className="wf-abend-link"
            title="Andere Namen erzeugen"
            onClick={() => rerollNames(db, which)}
          >
            <Dices aria-hidden /> neu würfeln
          </button>
        </OfferHead>
        <p className="wf-abend-spare__hint">
          Von Wayfarer erzeugt – für Leute am Rand, die plötzlich einen Namen brauchen.{' '}
          {spare.some((entry) => entry.learned)
            ? 'Sie klingen wie die Namen deiner Welt und gehören erst dazu, wenn du einen anlegst.'
            : 'Zur Welt gehören sie erst, wenn du einen anlegst; je mehr Personen sie hat, desto mehr klingen neue Namen nach ihr.'}
        </p>
        <div className="wf-abend-spare__list">
          {spare.map((entry) => (
            <span key={entry.name} className="wf-abend-spare__name">
              <b>{entry.name}</b>
              <em>{entry.role}</em>
              <button
                type="button"
                className="wf-abend-link"
                title={`„${entry.name}“ als Person anlegen – ein Platzhalter, noch zu schreiben`}
                onClick={() => create(entry.name, entry.role)}
              >
                anlegen
              </button>
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Begegnungen ────────────────────────────────────────────────────────────

export function EncountersAction() {
  const db = useDb();
  const [, navigate] = useLocation();
  const { content, patch } = useSheet();
  const prepare = () => {
    const encounter = newEncounter(db);
    patch({ encounterIds: [...content.encounterIds, encounter.id] });
    toast({
      title: 'Begegnung angelegt',
      body: `„${encounter.name}“ – im Bestiarium stellst du sie zusammen.`,
      action: { label: 'Öffnen', run: () => navigate(`/begegnungen/${encounter.id}`) },
    });
  };
  return (
    <Button size="sm" icon={<Plus />} onClick={prepare}>
      Neue Begegnung
    </Button>
  );
}

export function EncountersBody() {
  const data = useData();
  const { content, patch } = useSheet();
  const ids = content.encounterIds;
  const ready = readyEncounters(data, content);
  const offers = useMemo(() => encounterOffers(data, content), [data, content]);
  const stocks = useMemo(() => stocksNear(data), [data]);
  const offered = new Set(offers.map((offer) => offer.encounter.id));
  const others = Object.values(data.encounters)
    .filter((encounter) => !ids.includes(encounter.id) && !offered.has(encounter.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return (
    <>
      {ready.length === 0 && <p className="wf-sheet__none">Noch keine Begegnung bereitgelegt.</p>}
      {ready.map((encounter) => (
        <div key={encounter.id} className="wf-abend-ref">
          <Link href={`/begegnungen/${encounter.id}`} className="wf-abend-name wf-clamp-1">
            <Swords aria-hidden /> {encounter.name}
          </Link>
          <span className="wf-abend-ref__line wf-clamp-1">
            {encounter.foes.length === 1 ? '1 Gegner' : `${encounter.foes.length} Gegner`}
            {encounter.placeId && data.entities[encounter.placeId]
              ? ` · ${data.entities[encounter.placeId]!.name}`
              : ''}
          </span>
          <IconButton
            label={`„${encounter.name}“ vom Blatt nehmen`}
            size="sm"
            variant="ghost"
            onClick={() => patch({ encounterIds: ids.filter((id) => id !== encounter.id) })}
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
            if (event.target.value) patch({ encounterIds: [...ids, event.target.value] });
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
      {offers.length > 0 && (
        <div className="wf-abend-offers">
          <OfferHead>
            <span>Liegt nahe</span>
          </OfferHead>
          {offers.map((offer) => (
            <OfferRow
              key={offer.encounter.id}
              text={offer.encounter.name}
              sub={offer.why}
              action="bereitlegen"
              onTake={() => patch({ encounterIds: [...ids, offer.encounter.id] })}
            />
          ))}
        </div>
      )}
      {stocks.length > 0 && (
        <div className="wf-abend-offers">
          <OfferHead>
            <span>Baue und Horte am Ort der Gruppe</span>
            <Link href="/bestaende" className="wf-abend-link">
              Bestände öffnen
            </Link>
          </OfferHead>
          {stocks.map((view) => (
            <div key={view.stock.id} className="wf-abend-offer">
              <span className="wf-abend-offer__text wf-clamp-2">{stockSummary(view)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── Beute ──────────────────────────────────────────────────────────────────

export function LootBody() {
  const { content, patch } = useSheet();
  return (
    <>
      <LootList />
      <div className="wf-sheet__pair wf-sheet__pair--top wf-sheet__pair--gap">
        <span className="wf-sheet__label">Gedanken zur Beute</span>
        <Written
          label="Gedanken zur Beute"
          grow
          value={content.treasure}
          placeholder="Was noch nicht feststeht"
          onSave={(treasure) => patch({ treasure })}
        />
      </div>
    </>
  );
}
