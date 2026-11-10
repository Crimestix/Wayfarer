/** Dialog „Eintrag anlegen / bearbeiten“ für Orte, Personen, Fraktionen, Gegenstände und Themen. */
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useLocation } from 'wouter';
import { EyeOff, ImagePlus, Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { KIND_LABEL } from '../../domain/derive';
import { PERSON_STATUS, createEntity, type PersonStatus } from '../../domain/schema';
import {
  Button,
  Checkbox,
  Dialog,
  Field,
  Input,
  Portrait,
  Select,
  Tabs,
  TextArea,
  toast,
} from '../../ui';
import { discardUnusedDrafts } from './actions';
import {
  closeEntityDialog,
  openEntityDialog,
  useEntityDialogRequest,
  type EntityDialogRequest,
} from './editor';
import { fileToImage } from './image';
import { Picker } from './parts';
import {
  PERSON_STATUS_LABEL,
  WORLD_KINDS,
  categoryOptions,
  draftChanged,
  draftOf,
  draftProblem,
  emptyDraft,
  entityFromDraft,
  forbiddenParents,
  isWorldEntity,
  nameTwin,
  type EntityDraft,
  type WorldKind,
} from './model';

const KIND_HINT: Record<WorldKind, string> = {
  place: 'Region, Stadt, Gebäude oder Wildnis – alles, wo man sein kann.',
  person: 'Jede Figur, die nicht von einem Spieler geführt wird.',
  faction: 'Häuser, Gilden, Orden, Kulte – Gruppen mit eigenen Zielen.',
  item: 'Dinge von Bedeutung: Artefakte, Schriftstücke, Schlüssel.',
  topic: 'Gerüchte, Glaube, Handlungsfäden – was sonst kein Zuhause hat.',
};

const TAGLINE_HINT: Record<WorldKind, string> = {
  place: 'z. B. Hafenstadt unter der Hand eines Handelshauses.',
  person: 'z. B. Wirtin. Hört alles, erzählt wenig.',
  faction: 'z. B. Gilde der Lotsen. Kennt jede Sandbank.',
  item: 'z. B. Bronzeglocke, die schlägt, wenn jemand stirbt.',
  topic: 'z. B. Niemand weiß, warum das Leuchtfeuer erloschen ist.',
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
      ? draftOf(existing)
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

  const entityId = existing?.id ?? null;
  const problem = draftProblem(data, draft, entityId);
  const twin = nameTwin(data, draft, entityId);
  const categories = useMemo(
    () => (draft.kind === 'person' ? [] : categoryOptions(data, draft.kind)),
    [data, draft.kind],
  );
  const noParents = useMemo(() => forbiddenParents(data, entityId), [data, entityId]);
  const createPlace = (name: string) => {
    const id = db.put('entities', createEntity({ kind: 'place', name })).id;
    created.current.push(id);
    return id;
  };

  if (request.mode === 'edit' && !existing) return null;

  const save = () => {
    setTried(true);
    if (problem) return;
    const saved = db.batch(() => {
      const entity = db.put('entities', entityFromDraft(draft, existing));
      // Neu angelegte Orte, die am Ende doch nicht gewählt wurden, bleiben nicht liegen.
      discardUnusedDrafts(db, created.current, []);
      return entity;
    });
    closeEntityDialog();
    if (!existing) navigate(`/welt/${saved.id}`);
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
            <Tabs
              tabs={WORLD_KINDS.map((kind) => ({ id: kind, label: KIND_LABEL[kind] }))}
              value={draft.kind}
              onChange={(kind) => set({ kind })}
            />
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
            <Field label="Name">
              <Input
                data-autofocus
                className="wf-welt-form__name"
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                aria-invalid={tried && !draft.name.trim()}
              />
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
              <Field label="Volk">
                <Input value={draft.species} onChange={(e) => set({ species: e.target.value })} />
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
              <Field label="Bekanntheit">
                <div className="wf-welt-form__check">
                  <Checkbox checked={draft.met} onChange={(met) => set({ met })}>
                    Die Gruppe kennt diese Person
                  </Checkbox>
                </div>
              </Field>
            </>
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
