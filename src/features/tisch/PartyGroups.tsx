/**
 * Getrennte Wege am Spieltisch: der Umschalter der Teilgruppen („Wer macht was – bis wann“),
 * „Wer macht was?“ zum Trennen, Nachholen und Zusammenführen. Gerechnet wird in
 * `domain/party.ts` und `tisch/model.ts`, geschrieben über `data/actions.ts`.
 */
import { useMemo, useRef, useState } from 'react';
import { Clock3, History, Merge, Plus, Split, Trash2 } from 'lucide-react';
import { catchUp, leadGroup, mergeGroups, splitParty, type PartyRow } from '../../data/actions';
import { useData, useDb } from '../../data/hooks';
import { entityName } from '../../domain/derive';
import { ledMembers, partyGroups, partyOverview } from '../../domain/party';
import { formatWayTime } from '../../domain/ways';
import {
  Button,
  Checkbox,
  Dialog,
  EntityPicker,
  Field,
  IconButton,
  Input,
  MenuItem,
  Popover,
  toast,
} from '../../ui';
import { DurationField } from '../wege/DurationField';
import { catchUpOffers, shortWhen, standingText } from './model';

/** Der Umschalter der Teilgruppen: je Teilgruppe Mitglieder, Ort und Stand – ein Klick leitet sie. */
export function PartyGroupBar() {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const view = useMemo(() => partyOverview(data), [data]);
  const offers = useMemo(() => catchUpOffers(data), [data]);
  const [splitOpen, setSplitOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [catchOpen, setCatchOpen] = useState(false);
  const catchAnchor = useRef<HTMLButtonElement>(null);
  const now = data.state.now;
  return (
    <div className="wf-tisch-groups">
      <div className="wf-btn-group wf-tisch-groups__switch" role="group" aria-label="Teilgruppen">
        {view.rows.map((row) => (
          <Button
            key={row.group.id}
            size="sm"
            aria-pressed={row.group.led}
            className="wf-tisch-groups__item"
            title={[
              row.names.join(', '),
              row.placeId ? entityName(data, row.placeId) : 'kein Ort',
              standingText(cal, row, now),
              row.group.led ? '' : 'Klick: diese Teilgruppe leiten',
            ]
              .filter(Boolean)
              .join(' · ')}
            onClick={() => leadGroup(db, row.group.id)}
          >
            <span className="wf-tisch-groups__names">
              {row.names.join(', ')}
              <span className="wf-tisch-groups__place">
                {' · '}
                {row.placeId ? entityName(data, row.placeId) : 'kein Ort'}
              </span>
            </span>
            <span className="wf-tisch-groups__where">{standingText(cal, row, now)}</span>
          </Button>
        ))}
      </div>
      <span
        className="wf-tisch-groups__free"
        title={`Alle wieder frei: ${shortWhen(cal, view.allFree, now)}${
          view.allFree > now ? ` (in ${formatWayTime(view.allFree - now)})` : ''
        }`}
      >
        <Clock3 aria-hidden />
        alle frei {shortWhen(cal, view.allFree, now)}
      </span>
      <IconButton
        label="Wer macht was … – die geleitete Teilgruppe trennt sich weiter"
        size="sm"
        variant="ghost"
        onClick={() => setSplitOpen(true)}
      >
        <Split />
      </IconButton>
      {offers.length > 0 && (
        <>
          <IconButton
            ref={catchAnchor}
            label="Nachholen … – eine zurückliegende Teilgruppe auf eine spätere Zeit vorziehen"
            size="sm"
            variant="ghost"
            aria-expanded={catchOpen}
            onClick={() => setCatchOpen((open) => !open)}
          >
            <History />
          </IconButton>
          <Popover
            open={catchOpen}
            onClose={() => setCatchOpen(false)}
            anchor={catchAnchor}
            align="right"
            width={340}
          >
            {offers.map((offer) => (
              <MenuItem
                key={`${offer.groupId}:${offer.to}`}
                onClick={() => {
                  setCatchOpen(false);
                  const result = catchUp(db, offer.groupId, offer.to);
                  if (result)
                    toast({
                      title: `Nachgeholt: ${offer.label}`,
                      action: { label: 'Rückgängig', run: result.undo },
                    });
                }}
              >
                Nachholen: {offer.label}
              </MenuItem>
            ))}
          </Popover>
        </>
      )}
      <IconButton
        label="Zusammenführen … – Teilgruppen werden wieder eine"
        size="sm"
        variant="ghost"
        onClick={() => setMergeOpen(true)}
      >
        <Merge />
      </IconButton>
      {splitOpen && <SplitDialog onClose={() => setSplitOpen(false)} />}
      {mergeOpen && <MergeDialog onClose={() => setMergeOpen(false)} />}
    </div>
  );
}

/** Der Knopf in der Leiste, solange die Gruppe zusammen ist. */
export function SplitButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        icon={<Split />}
        title="Die Gruppe trennt sich: wer was wo wie lange macht – jede Teilgruppe bekommt ihre eigene Uhr"
        onClick={() => setOpen(true)}
      >
        Wer macht was …
      </Button>
      {open && <SplitDialog onClose={() => setOpen(false)} />}
    </>
  );
}

interface Draft {
  key: number;
  memberIds: string[];
  placeId: string | null;
  text: string;
  minutes: number;
}

/**
 * „Wer macht was?“: je Zeile wer, wo, was (in eigenen Worten) und wie lange. Wer in keiner Zeile
 * steht, bleibt bei der geleiteten Teilgruppe.
 */
function SplitDialog({ onClose }: { onClose: () => void }) {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const here = data.state.placeId;
  const now = data.state.now;
  const mates = useMemo(() => ledMembers(data), [data]);
  const fresh = (key: number): Draft => ({
    key,
    memberIds: [],
    placeId: here,
    text: '',
    minutes: 60,
  });
  const [rows, setRows] = useState<Draft[]>(() => [fresh(1)]);
  const [problem, setProblem] = useState('');
  const patch = (key: number, change: Partial<Draft>) =>
    setRows((list) => list.map((row) => (row.key === key ? { ...row, ...change } : row)));
  const toggle = (key: number, id: string) =>
    setRows((list) =>
      list.map((row) =>
        row.key === key
          ? {
              ...row,
              memberIds: row.memberIds.includes(id)
                ? row.memberIds.filter((other) => other !== id)
                : [...row.memberIds, id],
            }
          : { ...row, memberIds: row.memberIds.filter((other) => other !== id) },
      ),
    );
  const used = new Set(rows.flatMap((row) => row.memberIds));
  const staying = mates.filter((id) => !used.has(id));
  const filled = rows.filter((row) => row.memberIds.length > 0);
  const save = () => {
    const input: PartyRow[] = filled.map((row) => ({
      memberIds: row.memberIds,
      placeId: row.placeId,
      text: row.text,
      minutes: row.minutes,
    }));
    const result = splitParty(db, input);
    if ('problem' in result) {
      setProblem(result.problem);
      return;
    }
    onClose();
    toast({
      title: 'Die Gruppe hat sich getrennt',
      body: staying.length
        ? `Du leitest weiter: ${staying.map((id) => entityName(data, id)).join(', ')}.`
        : undefined,
      action: { label: 'Rückgängig', run: result.undo },
    });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Wer macht was?"
      width={760}
      footer={
        <>
          <span className="wf-grow wf-mute" role="alert">
            {problem ||
              (staying.length
                ? `Bleiben bei dir: ${staying.map((id) => entityName(data, id)).join(', ')}`
                : 'Niemand bleibt – du leitest danach eine der neuen Teilgruppen.')}
          </span>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={save} disabled={!filled.length}>
            Trennen
          </Button>
        </>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-4)' }}>
        <p className="wf-mute" style={{ margin: 0 }}>
          Jede Zeile wird eine Teilgruppe mit eigener Uhr: Sie rückt um die Dauer vor, die anderen
          bleiben in ihrer Zeit. Was eine Teilgruppe tut, steht in deinen Worten in der Chronik.
        </p>
        {rows.map((row, index) => (
          <fieldset key={row.key} className="wf-tisch-splitrow">
            <legend className="wf-tisch-subtitle">
              Teilgruppe {index + 1}
              {row.minutes > 0 && row.memberIds.length > 0 && (
                <span className="wf-mute"> · bis {shortWhen(cal, now + row.minutes, now)}</span>
              )}
            </legend>
            <Field label="Wer">
              <div
                className="wf-btn-group"
                role="group"
                aria-label={`Wer gehört zu Teilgruppe ${index + 1}`}
                style={{ flexWrap: 'wrap' }}
              >
                {mates.map((id) => (
                  <Button
                    key={id}
                    size="sm"
                    aria-pressed={row.memberIds.includes(id)}
                    onClick={() => toggle(row.key, id)}
                  >
                    {entityName(data, id)}
                  </Button>
                ))}
              </div>
            </Field>
            <div className="wf-form-grid">
              <Field label="Wo" hint="Vorgabe: hier. Auch ein Ort darin.">
                <EntityPicker
                  value={row.placeId}
                  onChange={(placeId) => patch(row.key, { placeId })}
                  kinds={['place']}
                  placeholder="Ort wählen …"
                />
              </Field>
              <Field label="Was" hint="In deinen Worten; leer lassen geht auch.">
                <Input
                  value={row.text}
                  placeholder="kauft ein, liest im Archiv …"
                  onChange={(e) => patch(row.key, { text: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Wie lange">
              <DurationField
                value={row.minutes}
                onChange={(minutes) => patch(row.key, { minutes })}
              />
            </Field>
            {rows.length > 1 && (
              <IconButton
                label={`Teilgruppe ${index + 1} entfernen`}
                size="sm"
                variant="ghost"
                className="wf-tisch-splitrow__remove"
                onClick={() => setRows((list) => list.filter((other) => other.key !== row.key))}
              >
                <Trash2 />
              </IconButton>
            )}
          </fieldset>
        ))}
        {staying.length > 0 && (
          <div>
            <Button
              size="sm"
              icon={<Plus />}
              onClick={() =>
                setRows((list) => [...list, fresh(Math.max(...list.map((r) => r.key)) + 1)])
              }
            >
              Weitere Teilgruppe
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** Zusammenführen: welche Teilgruppen wieder eine werden – nur auf Klick. */
function MergeDialog({ onClose }: { onClose: () => void }) {
  const db = useDb();
  const data = useData();
  const groups = useMemo(() => partyGroups(data), [data]);
  const led = groups.find((group) => group.led);
  const [chosen, setChosen] = useState<string[]>(() =>
    groups.filter((group) => group.placeId === led?.placeId).map((group) => group.id),
  );
  const places = new Set(
    groups.filter((group) => chosen.includes(group.id)).map((group) => group.placeId),
  );
  const save = () => {
    const result = mergeGroups(db, chosen);
    onClose();
    if (result)
      toast({
        title: 'Zusammengeführt',
        action: { label: 'Rückgängig', run: result.undo },
      });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Teilgruppen zusammenführen"
      width={520}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={save} disabled={chosen.length < 2}>
            Zusammenführen
          </Button>
        </>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-3)' }}>
        {groups.map((group) => (
          <Checkbox
            key={group.id}
            checked={chosen.includes(group.id)}
            onChange={(on) =>
              setChosen((list) => (on ? [...list, group.id] : list.filter((id) => id !== group.id)))
            }
          >
            {group.memberIds.map((id) => entityName(data, id)).join(', ')} ·{' '}
            {group.placeId ? entityName(data, group.placeId) : 'kein Ort'}
            {group.led && ' (geleitet)'}
          </Checkbox>
        ))}
        <p className="wf-mute" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
          Wer zurückliegt, wird auf die Zeit der vordersten gezogen; dabei tritt nichts ein.
          {places.size > 1 &&
            ` Wer woanders steht, zieht zum Ort ${
              led && chosen.includes(led.id) ? 'der geleiteten Teilgruppe' : 'der ersten gewählten'
            } – das steht als Ortswechsel in der Chronik.`}
        </p>
      </div>
    </Dialog>
  );
}
