/** Dialog „Eintrag anlegen / bearbeiten“ für Orte, Personen, Fraktionen, Gegenstände und Themen. */
import { lifeWords } from '../../domain/lifespan';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useLocation } from 'wouter';
import { Dices, EyeOff, ImagePlus, Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { KIND_LABEL } from '../../domain/derive';
import { RARITY_LABEL, isNatureKind } from '../../domain/nature';
import { seasonsAt } from '../../domain/seasons';
import { freshSeed } from '../../domain/random';
import {
  PERSON_STATUS,
  RARITIES,
  createEntity,
  type PersonStatus,
  type Rarity,
} from '../../domain/schema';
import {
  Button,
  Checkbox,
  Dialog,
  EntityRefsEditor,
  Field,
  Input,
  Portrait,
  Select,
  TextArea,
  toast,
} from '../../ui';
import {
  adoptFamilies,
  discardUnusedDrafts,
  noteHolderChange,
  syncLinkedRelations,
} from './actions';
import { surnameOf } from './dynasty';
import {
  closeEntityDialog,
  openEntityDialog,
  useEntityDialogRequest,
  type EntityDialogRequest,
} from './editor';
import { fileToImage } from './image';
import { suggestNpc, type NpcSuggestion } from './npc';
import { Picker, WordChips } from './parts';
import {
  PERSON_LINKS,
  PERSON_STATUS_LABEL,
  WORLD_KINDS,
  categoryOptions,
  draftChanged,
  draftOf,
  draftProblem,
  emptyDraft,
  entityFromDraft,
  forbiddenParents,
  habitatChoices,
  isWorldEntity,
  nameTwin,
  type EntityDraft,
  type WorldKind,
} from './model';
import { hasStance } from '../../domain/known';

/**
 * Je Art ein Satz, der keinen Zweifel lässt. Faustregel: gewachsen = Pflanze, lebt = Tier, aus dem
 * Boden = Gestein, von Hand gemacht = Gegenstand, Tätigkeit = Beruf.
 */
const KIND_HINT: Record<WorldKind, string> = {
  place: 'Ort – alles, wo man sein kann: Region, Stadt, Gebäude oder Wildnis.',
  person:
    'Person – jede Figur, die kein Spieler führt, auch ein Tier mit eigenem Namen und eigener Geschichte.',
  family: 'Familie – Häuser, Sippen und Dynastien; die Mitglieder trägst du bei den Personen ein.',
  faction: 'Fraktion – Gruppen mit eigenen Zielen: Häuser, Gilden, Orden und Kulte.',
  item: 'Gegenstand – was von Hand gemacht ist: Waffen, Artefakte, Schriftstücke, auch Tränke, Gifte und Bücher.',
  topic: 'Thema – Gerüchte, Glaube und Handlungsfäden, was sonst kein Zuhause hat.',
  species: 'Spezies – Völker und Wesen, aus denen Personen stammen.',
  language: 'Sprache – was gesprochen wird; wer sie spricht, steht bei der Person.',
  script: 'Schrift – Alphabete und Zeichen, in denen Sprachen geschrieben werden.',
  ability: 'Fähigkeit – Gaben, Flüche und Besonderheiten, die Personen haben können.',
  plant:
    'Pflanze – alles, was wächst, auch Pilze, Moose und Algen; ein Trank daraus ist ein Gegenstand.',
  animal:
    'Tier – alles, was lebt, als Art: der Wolf, nicht ein Wolf mit eigenem Namen (der ist eine Person).',
  mineral: 'Gestein – alles, was aus dem Boden kommt: Erze, Edelsteine, Gesteine und Salze.',
  profession: 'Beruf – eine Tätigkeit, die man ausübt: ein Handwerk, ein Gewerbe oder ein Amt.',
};

const TAGLINE_HINT: Record<WorldKind, string> = {
  place: 'z. B. Hafenstadt unter der Hand eines Handelshauses.',
  person: 'z. B. Wirtin. Hört alles, erzählt wenig.',
  faction: 'z. B. Gilde der Lotsen. Kennt jede Sandbank.',
  item: 'z. B. Bronzeglocke, die schlägt, wenn jemand stirbt.',
  topic: 'z. B. Niemand weiß, warum das Leuchtfeuer erloschen ist.',
  family: 'z. B. Altes Seefahrerhaus, das seine Schulden verbirgt.',
  species: 'Ein Satz, woran man sie am Tisch erkennt.',
  language: 'Ein Satz, wie sie klingt und wo man sie hört.',
  script: 'Ein Satz, wie sie aussieht.',
  ability: 'Ein Satz, was sie bewirkt.',
  plant: 'z. B. Bitteres Kraut, das Fieber senkt.',
  animal: 'z. B. Scheues Rotwild, das in Rudeln zieht.',
  mineral: 'z. B. Blaues Erz, das im Dunkeln schimmert.',
  profession: 'z. B. Fertigt Waffen und beschlägt Pferde.',
};

export function EntityDialogHost() {
  const request = useEntityDialogRequest();
  if (!request) return null;
  return <EntityDialog key={request.mode === 'edit' ? request.id : 'neu'} request={request} />;
}

function EntityDialog({ request }: { request: EntityDialogRequest }) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const stored = request.mode === 'edit' ? data.entities[request.id] : undefined;
  const existing = isWorldEntity(stored) ? stored : undefined;
  /** Stand beim Öffnen – daran misst sich, ob etwas geändert wurde. */
  const [baseline] = useState<EntityDraft>(() =>
    existing
      ? draftOf(existing, data)
      : emptyDraft(
          request.mode === 'create' ? request.kind : 'person',
          request.mode === 'create' ? request.preset : {},
        ),
  );
  const [draft, setDraft] = useState<EntityDraft>(request.resume?.draft ?? baseline);
  /** Orte, die in diesem Dialog über „neu anlegen“ entstanden sind. */
  const created = useRef<string[]>(request.resume?.created ?? []);
  const [imageError, setImageError] = useState('');
  const [tried, setTried] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const categoryList = useId();
  const set = (change: Partial<EntityDraft>) => setDraft((d) => ({ ...d, ...change }));

  /** Was der Würfel zuletzt eingetragen hat – nur das darf er beim nächsten Wurf ersetzen. */
  const rolled = useRef<Partial<EntityDraft>>({});
  const [nameSource, setNameSource] = useState<NpcSuggestion['nameSource'] | null>(null);
  const roll = () => {
    const mine = <K extends keyof EntityDraft>(key: K) =>
      draft[key] !== '' && draft[key] !== null && draft[key] !== rolled.current[key];
    const suggestion = suggestNpc(
      data,
      { placeId: draft.placeId, speciesId: mine('speciesId') ? draft.speciesId : null },
      freshSeed(),
    );
    const next: Partial<EntityDraft> = {};
    // Was der Spielleiter selbst eingetragen hat, bleibt stehen.
    if (!mine('name')) next.name = suggestion.name;
    if (!mine('role')) next.role = suggestion.role;
    if (!mine('tagline')) next.tagline = suggestion.tagline;
    if (!mine('speciesId')) next.speciesId = suggestion.speciesId;
    if (!mine('homeId')) next.homeId = suggestion.homeId;
    rolled.current = { ...rolled.current, ...next };
    setNameSource('name' in next ? suggestion.nameSource : null);
    set(next);
  };

  const entityId = existing?.id ?? null;
  const problem = draftProblem(data, draft, entityId);
  const twin = nameTwin(data, draft, entityId);
  const categories = useMemo(
    () => (draft.kind === 'person' ? [] : categoryOptions(data, draft.kind)),
    [data, draft.kind],
  );
  const noParents = useMemo(() => forbiddenParents(data, entityId), [data, entityId]);
  const habitats = useMemo(() => habitatChoices(data), [data]);
  const seasons = useMemo(
    () => [
      ...seasonsAt(data).seasons.map((s) => s.name),
      ...data.campaign.calendar.months.map((m) => m.name),
    ],
    [data],
  );
  const creatures = useMemo(
    () => Object.values(data.creatures).sort((a, b) => a.name.localeCompare(b.name, 'de')),
    [data.creatures],
  );
  /** Legt aus dem Dialog heraus einen Eintrag an; wird er am Ende nicht verwendet, verschwindet er wieder. */
  const createDraftEntity = (
    kind: 'place' | 'species' | 'family' | 'language' | 'script' | 'ability' | 'profession',
    name: string,
  ) => {
    const id = db.put('entities', createEntity({ kind, name: name.trim() })).id;
    created.current.push(id);
    return id;
  };
  const createPlace = (name: string) => createDraftEntity('place', name);

  if (request.mode === 'edit' && !existing) return null;

  const save = () => {
    setTried(true);
    if (problem) return;
    const saved = db.batch(() => {
      const entity = db.put('entities', entityFromDraft(draft, existing, data));
      // Führt der Gegenstand seinen Lebenslauf, steht ein neuer Besitzer in der Chronik.
      noteHolderChange(db, existing, entity);
      if (entity.kind === 'person')
        for (const { field, type, kinds } of PERSON_LINKS)
          syncLinkedRelations(db, entity.id, type, kinds, draft[field]);
      // Neu angelegte Einträge, die am Ende doch nicht gewählt wurden, bleiben nicht liegen.
      discardUnusedDrafts(db, created.current, []);
      return entity;
    });
    closeEntityDialog();
    if (!existing) navigate(`/welt/${saved.id}`);
    // Familie aus dem Nachnamen: bei neuen Personen und wenn sich der Nachname geändert hat –
    // nicht bei jedem Speichern, sonst käme eine bewusst entfernte Zuordnung immer wieder.
    const surnameChanged =
      saved.kind === 'person' &&
      (!existing || surnameOf(existing.name)?.key !== surnameOf(saved.name)?.key);
    const adopted = surnameChanged ? adoptFamilies(db, [saved.id]) : null;
    if (adopted)
      toast({
        title: 'Familie aus dem Nachnamen',
        body: adopted.text,
        action: { label: 'Rückgängig', run: adopted.undo },
      });
  };

  /** Schließen ohne Speichern. Eingetragenes geht nicht stillschweigend verloren. */
  const cancel = () => {
    const removed = discardUnusedDrafts(db, created.current, []);
    closeEntityDialog();
    if (!draftChanged(draft, baseline)) return;
    toast({
      title: existing ? 'Änderungen verworfen' : 'Neuer Eintrag verworfen',
      body: draft.name.trim() || existing?.name || KIND_LABEL[draft.kind],
      action: {
        label: 'Weiter bearbeiten',
        run: () => {
          db.batch(() => {
            for (const place of removed)
              if (!db.getSnapshot().entities[place.id]) db.put('entities', { ...place, rev: 0 });
          });
          openEntityDialog({ ...request, resume: { draft, created: created.current } });
        },
      },
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    // In der Ortsauswahl und in Feldern mit Vorschlagsliste wählt die Eingabetaste einen Vorschlag.
    const choosing = target.closest('.wf-picker') !== null || target.hasAttribute('list');
    if (e.ctrlKey || e.metaKey || (target.tagName === 'INPUT' && !choosing)) {
      e.preventDefault();
      save();
    }
  };

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      set({ image: await fileToImage(file) });
      setImageError('');
    } catch (error) {
      setImageError((error as Error).message);
      toast({ title: 'Bild nicht übernommen', body: (error as Error).message, tone: 'danger' });
    }
  };

  const kindLabel = KIND_LABEL[draft.kind];
  return (
    <Dialog
      open
      onClose={cancel}
      title={existing ? `${kindLabel} bearbeiten` : 'Neuer Eintrag'}
      width={760}
      footer={
        <>
          <span className="wf-grow wf-welt-form__status" role="status">
            {tried && problem ? (
              <span className="wf-welt-form__problem">{problem}</span>
            ) : twin ? (
              `Es gibt bereits „${twin.name}“ (${KIND_LABEL[twin.kind]}).`
            ) : (
              'Eingabe speichert · in Textfeldern Strg+Eingabe'
            )}
          </span>
          <Button onClick={cancel}>Abbrechen</Button>
          <Button variant="primary" onClick={save}>
            {existing ? 'Speichern' : `${kindLabel} anlegen`}
          </Button>
        </>
      }
    >
      <div className="wf-col wf-welt-form" onKeyDown={onKeyDown}>
        {!existing && (
          <div>
            <div
              className="wf-welt-filter wf-welt-filter--kinds"
              role="radiogroup"
              aria-label="Art"
            >
              {WORLD_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={draft.kind === kind}
                  onClick={() => set({ kind })}
                >
                  {KIND_LABEL[kind]}
                </button>
              ))}
            </div>
            <p className="wf-welt-form__kindhint">{KIND_HINT[draft.kind]}</p>
          </div>
        )}

        <div className="wf-welt-form__top">
          <div className="wf-welt-form__image">
            <Portrait
              entity={{ kind: draft.kind, image: draft.image, name: draft.name }}
              size={132}
            />
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                void pickImage(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <div className="wf-row" style={{ gap: 4 }}>
              <Button size="sm" icon={<ImagePlus />} onClick={() => fileInput.current?.click()}>
                {draft.image ? 'Anderes Bild' : 'Bild wählen'}
              </Button>
              {draft.image && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 />}
                  aria-label="Bild entfernen"
                  title="Bild entfernen"
                  onClick={() => set({ image: null })}
                />
              )}
            </div>
            {imageError && <div className="wf-welt-form__problem">{imageError}</div>}
          </div>
          <div className="wf-col wf-grow" style={{ gap: 'var(--s-4)' }}>
            <Field
              label="Name"
              hint={
                nameSource === 'world'
                  ? 'Vorschlag im Klang der Namen deiner Welt – ändere ihn oder würfle neu.'
                  : nameSource === 'generic'
                    ? 'Vorschlag aus allgemeinen Silben. Kennt deine Welt mehr Personen, lernt Wayfarer ihren Klang.'
                    : undefined
              }
            >
              <div className="wf-welt-form__namerow">
                <Input
                  data-autofocus
                  className="wf-welt-form__name"
                  value={draft.name}
                  onChange={(e) => set({ name: e.target.value })}
                  aria-invalid={tried && !draft.name.trim()}
                />
                {draft.kind === 'person' && !existing && (
                  <Button
                    icon={<Dices />}
                    onClick={roll}
                    title="Eine Nebenfigur vorschlagen: Name, Tätigkeit, Spezies und ein Satz zur Person. Was du selbst eingetragen hast, bleibt stehen."
                  >
                    Würfeln
                  </Button>
                )}
              </div>
            </Field>
            <Field label="Kurzbeschreibung" hint="Ein Satz, der am Tisch reicht.">
              <Input
                value={draft.tagline}
                onChange={(e) => set({ tagline: e.target.value })}
                placeholder={TAGLINE_HINT[draft.kind]}
              />
            </Field>
          </div>
        </div>

        <div className="wf-form-grid">
          {draft.kind === 'person' && (
            <>
              <Field label="Rolle" hint="Beruf, Amt oder Aufgabe in der Geschichte.">
                <Input value={draft.role} onChange={(e) => set({ role: e.target.value })} />
              </Field>
              <Field
                label="Spezies"
                hint={
                  !draft.speciesId && draft.species.trim() ? (
                    <span>
                      Bisher als Text: „{draft.species.trim()}“.{' '}
                      <button
                        type="button"
                        className="wf-welt-form__link"
                        onClick={() =>
                          set({ speciesId: createDraftEntity('species', draft.species) })
                        }
                      >
                        Als Spezies übernehmen
                      </button>
                    </span>
                  ) : undefined
                }
              >
                <Picker
                  value={draft.speciesId}
                  onChange={(speciesId) => set({ speciesId })}
                  kinds={['species']}
                  placeholder="Spezies wählen oder neu anlegen …"
                  onCreate={(name) => createDraftEntity('species', name)}
                />
              </Field>
              <Field label="Hält sich auf in">
                <Picker
                  value={draft.placeId}
                  onChange={(placeId) => set({ placeId })}
                  kinds={['place']}
                  placeholder="Ort wählen oder neu anlegen …"
                  onCreate={createPlace}
                />
              </Field>
              <Field label="Ist zu Hause in">
                <Picker
                  value={draft.homeId}
                  onChange={(homeId) => set({ homeId })}
                  kinds={['place']}
                  placeholder="Ort wählen oder neu anlegen …"
                  onCreate={createPlace}
                />
              </Field>
              <Field label="Arbeitet bei" hint="Ein Ort oder eine Fraktion.">
                <Picker
                  value={draft.workplaceId}
                  onChange={(workplaceId) => set({ workplaceId })}
                  kinds={['place', 'faction']}
                  placeholder="Arbeitsplatz wählen …"
                  onCreate={createPlace}
                />
              </Field>
              <Field label="Zustand">
                <Select
                  value={draft.status}
                  onChange={(e) => set({ status: e.target.value as PersonStatus })}
                >
                  {PERSON_STATUS.map((status) => (
                    <option key={status} value={status}>
                      {PERSON_STATUS_LABEL[status]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Familie" hint="Gehört zu diesen Familien oder Häusern.">
                <EntityRefsEditor
                  value={draft.familyIds}
                  onChange={(familyIds) => set({ familyIds })}
                  kinds={['family']}
                  placeholder="Familie hinzufügen …"
                  onCreate={(name) => createDraftEntity('family', name)}
                />
              </Field>
              <Field label="Bekanntheit">
                <div className="wf-welt-form__check">
                  {existing && hasStance(data, existing.id) ? (
                    // Wer eine Haltung zur Gruppe hat, ist ihr bekannt – das steht nur da.
                    <span className="wf-welt-quiet">
                      Die Gruppe kennt diese Person – sie hat eine Haltung zu ihr.
                    </span>
                  ) : (
                    <Checkbox checked={draft.met} onChange={(met) => set({ met })}>
                      Die Gruppe kennt diese Person
                    </Checkbox>
                  )}
                </div>
              </Field>
              <Field label="Sprachen">
                <EntityRefsEditor
                  value={draft.languageIds}
                  onChange={(languageIds) => set({ languageIds })}
                  kinds={['language']}
                  placeholder="Sprache hinzufügen …"
                  onCreate={(name) => createDraftEntity('language', name)}
                />
              </Field>
              <Field label="Fähigkeiten">
                <EntityRefsEditor
                  value={draft.abilityIds}
                  onChange={(abilityIds) => set({ abilityIds })}
                  kinds={['ability']}
                  placeholder="Fähigkeit hinzufügen …"
                  onCreate={(name) => createDraftEntity('ability', name)}
                />
              </Field>
              <Field label="Berufe" hint="Was die Person ausübt – auch mehrere.">
                <EntityRefsEditor
                  value={draft.professionIds}
                  onChange={(professionIds) => set({ professionIds })}
                  kinds={['profession']}
                  placeholder="Beruf hinzufügen …"
                  onCreate={(name) => createDraftEntity('profession', name)}
                />
              </Field>
            </>
          )}
          {draft.kind === 'family' && (
            <Field label="Stammsitz">
              <Picker
                value={draft.seatId}
                onChange={(seatId) => set({ seatId })}
                kinds={['place']}
                placeholder="Ort wählen oder neu anlegen …"
                onCreate={createPlace}
              />
            </Field>
          )}
          {draft.kind === 'language' && (
            <Field label="Schrift" hint="In welcher Schrift sie gewöhnlich geschrieben wird.">
              <Picker
                value={draft.scriptId}
                onChange={(scriptId) => set({ scriptId })}
                kinds={['script']}
                placeholder="Schrift wählen oder neu anlegen …"
                onCreate={(name) => createDraftEntity('script', name)}
              />
            </Field>
          )}
          {draft.kind === 'place' && (
            <Field
              label="Liegt in"
              hint="Der Ort, zu dem dieser gehört – leer für eine oberste Ebene."
            >
              <Picker
                value={draft.parentId}
                onChange={(parentId) => set({ parentId })}
                kinds={['place']}
                exclude={noParents}
                placeholder="Übergeordneten Ort wählen …"
                onCreate={createPlace}
              />
            </Field>
          )}
          {draft.kind === 'faction' && (
            <Field label="Sitz">
              <Picker
                value={draft.seatId}
                onChange={(seatId) => set({ seatId })}
                kinds={['place']}
                placeholder="Ort wählen oder neu anlegen …"
                onCreate={createPlace}
              />
            </Field>
          )}
          {draft.kind === 'item' && (
            <Field
              label="Befindet sich bei"
              hint="Ein Ort, eine Person, eine Fraktion oder ein Gefährte."
            >
              <Picker
                value={draft.holderId}
                onChange={(holderId) => set({ holderId })}
                kinds={['place', 'person', 'faction', 'character']}
                exclude={entityId ? [entityId] : undefined}
                placeholder="Ort oder Besitzer wählen …"
              />
            </Field>
          )}
          {draft.kind === 'item' && !existing && (
            <Field label="Magie" hint="Seltenheit, Einstimmung und Ladungen dann auf seiner Seite.">
              <Checkbox checked={draft.magic} onChange={(magic) => set({ magic })}>
                magisch
              </Checkbox>
            </Field>
          )}
          {draft.kind === 'item' && (
            <Field
              label="Wert"
              hint={
                draft.magic
                  ? 'Listenpreis in Gold. Leer lassen: Läden nehmen den Richtwert nach Seltenheit.'
                  : 'Listenpreis in Gold – „2,5“, „12 GM“ oder „5 Silber“. Läden rechnen damit.'
              }
            >
              <Input
                value={draft.price}
                onChange={(e) => set({ price: e.target.value })}
                aria-invalid={tried && problem?.startsWith('„Wert“')}
              />
            </Field>
          )}
          {draft.kind !== 'person' && (
            <Field label="Art">
              <Input
                list={categoryList}
                value={draft.category}
                onChange={(e) => set({ category: e.target.value })}
                placeholder={categories.slice(0, 3).join(', ') + ' …'}
              />
              <datalist id={categoryList}>
                {categories.map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
            </Field>
          )}
          {isNatureKind(draft.kind) && (
            <>
              <Field label="Seltenheit">
                <Select
                  value={draft.rarity}
                  onChange={(e) => set({ rarity: e.target.value as Rarity | '' })}
                >
                  <option value="">nicht angegeben</option>
                  {RARITIES.map((rarity) => (
                    <option key={rarity} value={rarity}>
                      {RARITY_LABEL[rarity]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Lebensraum"
                className="wf-span-2"
                hint="Wörter wie Wald, Sumpf, Höhle – daran erkennt Wayfarer, wo es vorkommt."
              >
                <WordChips
                  value={draft.habitat}
                  onChange={(habitat) => set({ habitat })}
                  suggestions={habitats}
                  placeholder="Wald, Sumpf, Höhle …"
                  label="Lebensraum hinzufügen"
                />
              </Field>
              <Field
                label="Vorkommen"
                className="wf-span-2"
                hint="Orte und Gegenden, mit allem darunter. Dann nur dort – leer: überall, wo der Lebensraum passt."
              >
                <EntityRefsEditor
                  value={draft.regionIds}
                  onChange={(regionIds) => set({ regionIds })}
                  kinds={['place']}
                  placeholder="Gegend hinzufügen …"
                  onCreate={createPlace}
                />
              </Field>
              <Field
                label="Wann"
                hint="Jahreszeiten oder Monate, auch „Blüthain bis Erntfall“. Leer: das ganze Jahr."
              >
                <WordChips
                  value={draft.seasons}
                  onChange={(seasons) => set({ seasons })}
                  suggestions={seasons}
                  placeholder="Frühling, Herbst …"
                  label="Jahreszeit oder Monat hinzufügen"
                />
              </Field>
              <Field label="Wert" hint="In Gold – „2,5“, „12 GM“ oder „5 Silber“.">
                <Input
                  value={draft.price}
                  onChange={(e) => set({ price: e.target.value })}
                  aria-invalid={tried && problem?.startsWith('„Wert“')}
                />
              </Field>
            </>
          )}
          {draft.kind === 'animal' && (
            <Field
              label="Kampfwerte"
              hint={
                creatures.length
                  ? 'Ein Wesen aus dem Bestiarium. Neue Kampfwerte legst du auf der Seite des Tieres an.'
                  : 'Noch keine Wesen im Bestiarium. Kampfwerte legst du auf der Seite des Tieres an.'
              }
            >
              <Select
                value={draft.creatureId ?? ''}
                onChange={(e) => set({ creatureId: e.target.value || null })}
              >
                <option value="">keine</option>
                {creatures.map((creature) => (
                  <option key={creature.id} value={creature.id}>
                    {creature.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {draft.kind === 'profession' && (
            <Field label="Werkzeug" hint="Nach den Regeln, z. B. „Schmiedewerkzeug“.">
              <Input value={draft.tool} onChange={(e) => set({ tool: e.target.value })} />
            </Field>
          )}
          <Field
            label={lifeWords(draft.kind).start}
            hint={
              draft.kind === 'person'
                ? 'Ein Tag, ein Jahr oder ein Alter („Alter 34“) – das Alter rechnet Wayfarer.'
                : 'Ein Tag, ein Jahr oder „vor 300 Jahren“.'
            }
          >
            <Input value={draft.born} onChange={(e) => set({ born: e.target.value })} />
          </Field>
          <Field
            label={lifeWords(draft.kind).end}
            hint={
              draft.kind === 'person'
                ? 'Leer lassen, solange die Person lebt. Ein Tod aus der Chronik zählt von selbst.'
                : 'Leer lassen, solange es besteht.'
            }
          >
            <Input value={draft.ended} onChange={(e) => set({ ended: e.target.value })} />
          </Field>
          <Field label="Beinamen" hint="Andere Namen, mit Komma getrennt – die Suche findet sie.">
            <Input value={draft.aliases} onChange={(e) => set({ aliases: e.target.value })} />
          </Field>
          <Field label="Schlagworte" hint="Mit Komma getrennt.">
            <Input value={draft.tags} onChange={(e) => set({ tags: e.target.value })} />
          </Field>
          <Field label="Notizen" className="wf-span-2">
            <TextArea
              value={draft.notes}
              onChange={(e) => set({ notes: e.target.value })}
              rows={5}
              placeholder="Beschreibung, Auftreten, Hintergründe …"
            />
          </Field>
          <div className="wf-span-2 wf-welt-form__secret">
            <Field
              label="Geheimnis"
              hint={
                <span className="wf-row" style={{ gap: 6 }}>
                  <EyeOff width={13} height={13} /> Nur für dich: was die Gruppe (noch) nicht weiß.
                </span>
              }
            >
              <TextArea
                value={draft.secret}
                onChange={(e) => set({ secret: e.target.value })}
                rows={3}
              />
            </Field>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
