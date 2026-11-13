/**
 * „Ändern“ an einem Vorschlag beim Prüfen: dieselben Felder wie beim Festhalten (`RecordFields`),
 * dazu Text, Zeit, Genauigkeit und „Betrifft“ – bei Beute Inhalt, Gold, Empfänger und Herkunft,
 * bei einem Faden sein Satz. „Annehmen“ hält es so fest. Gerechnet wird in `review.ts`.
 */
import { useMemo, useState } from 'react';
import { useData } from '../../data/hooks';
import { RECORD_GROUPS, PRECISION_LABEL, isOwnDialogChoice } from '../../domain/chronicleKinds';
import {
  CHRONICLE_PRECISIONS,
  type ChroniclePrecision,
  type ReadProposal,
  type Session,
} from '../../domain/schema';
import {
  Button,
  Checkbox,
  Dialog,
  EntityPicker,
  EntityRefsEditor,
  Field,
  Input,
  Select,
  TextArea,
} from '../../ui';
import { timeDraftOf, timeOfDraft } from '../chronik/model';
import { RecordFields } from '../chronik/RecordFields';
import { emptyRecordDraft, type RecordFieldsKind } from '../chronik/recordDraft';
import { WorldTimeFields } from '../chronik/WorldTimeFields';
import { parseGold } from '../../domain/loot';
import {
  checksOf,
  consequencesOf,
  draftOfProposal,
  editProblem,
  editedInput,
  type ConsequenceKey,
  type ProposalChange,
} from './review';
import { proposalKindLabel } from './readSession';

const CHOICES = RECORD_GROUPS.map((group) => ({
  ...group,
  choices: group.choices.filter(
    (c): c is { choice: RecordFieldsKind; label: string } => !isOwnDialogChoice(c.choice),
  ),
}));

export function ProposalDialog({
  session,
  proposal,
  checks: initialChecks,
  onClose,
  onAccept,
}: {
  session: Session;
  proposal: ReadProposal;
  checks: Partial<Record<ConsequenceKey, boolean>>;
  onClose: () => void;
  onAccept: (change: ProposalChange) => void;
}) {
  const title = `${proposalKindLabel(proposal.kind)} ändern`;
  if (proposal.kind === 'loot')
    return <LootFields proposal={proposal} title={title} onClose={onClose} onAccept={onAccept} />;
  if (proposal.kind === 'thread')
    return <ThreadFields proposal={proposal} title={title} onClose={onClose} onAccept={onAccept} />;
  return (
    <EntryFields
      session={session}
      proposal={proposal}
      initialChecks={initialChecks}
      title={title}
      onClose={onClose}
      onAccept={onAccept}
    />
  );
}

function Footer({
  problem,
  onClose,
  onAccept,
}: {
  problem: string;
  onClose: () => void;
  onAccept: () => void;
}) {
  return (
    <>
      <span className="wf-field__hint wf-grow">{problem}</span>
      <Button onClick={onClose}>Abbrechen</Button>
      <Button
        variant="primary"
        disabled={!!problem}
        title={problem || undefined}
        onClick={onAccept}
      >
        Annehmen
      </Button>
    </>
  );
}

function EntryFields({
  session,
  proposal,
  initialChecks,
  title,
  onClose,
  onAccept,
}: {
  session: Session;
  proposal: ReadProposal;
  initialChecks: Partial<Record<ConsequenceKey, boolean>>;
  title: string;
  onClose: () => void;
  onAccept: (change: ProposalChange) => void;
}) {
  const data = useData();
  const cal = data.campaign.calendar;
  const start = useMemo(() => draftOfProposal(proposal), [proposal]);
  const [choice, setChoice] = useState<RecordFieldsKind>(start?.choice ?? 'note');
  const [draft, setDraft] = useState(start?.draft ?? emptyRecordDraft());
  const [refs, setRefs] = useState<string[]>(start?.refs ?? proposal.refs);
  const [text, setText] = useState(proposal.text);
  const [time, setTime] = useState(() => timeDraftOf(cal, proposal.at));
  const [precision, setPrecision] = useState<ChroniclePrecision>(proposal.precision);
  const [secret, setSecret] = useState(proposal.secret);
  const [changed, setChanged] = useState(initialChecks);

  const at = timeOfDraft(cal, time);
  const common = {
    text,
    at: at ?? undefined,
    sessionId: session.id,
    refs,
    secret,
    precision,
  };
  const input = editedInput(choice, draft, common, data.state.now);
  const problem = editProblem(data, choice, draft, common);
  const consequences = consequencesOf(data, input, secret).filter((c) => c.key !== 'article');
  const accept = () => {
    const checks = { ...checksOf(consequences, changed), article: draft.createArticle };
    onAccept({ input, checks });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      width={720}
      footer={<Footer problem={problem} onClose={onClose} onAccept={accept} />}
    >
      <div className="wf-col">
        <blockquote className="wf-nachtragen-dialog__quote">„{proposal.quote}“</blockquote>
        <div className="wf-form-grid">
          <Field label="Art">
            <Select
              value={choice}
              onChange={(e) => setChoice(e.target.value as RecordFieldsKind)}
              data-autofocus
            >
              {CHOICES.map((group) => (
                <optgroup key={group.id} label={group.label}>
                  {group.choices.map((c) => (
                    <option key={c.choice} value={c.choice}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          <Field label="Wie genau ist die Zeit?">
            <Select
              value={precision}
              onChange={(e) => setPrecision(e.target.value as ChroniclePrecision)}
            >
              {CHRONICLE_PRECISIONS.map((p) => (
                <option key={p} value={p}>
                  {PRECISION_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="wf-span-2">
            <WorldTimeFields cal={cal} value={time} onChange={setTime} />
          </div>
          <Field label="Text" className="wf-span-2">
            <TextArea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        </div>
        <RecordFields kind={choice} draft={draft} onChange={setDraft} at={at ?? undefined} />
        <div className="wf-form-grid">
          <Field label="Betrifft">
            <EntityRefsEditor value={refs} onChange={setRefs} />
          </Field>
          <div className="wf-col wf-nachtragen-dialog__checks">
            <Checkbox checked={secret} onChange={setSecret}>
              Nur für die Spielleitung
            </Checkbox>
            {consequences.map((c) => (
              <Checkbox
                key={c.key}
                checked={changed[c.key] ?? c.checked}
                onChange={(on) => setChanged({ ...changed, [c.key]: on })}
              >
                {c.label}
              </Checkbox>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function LootFields({
  proposal,
  title,
  onClose,
  onAccept,
}: {
  proposal: ReadProposal;
  title: string;
  onClose: () => void;
  onAccept: (change: ProposalChange) => void;
}) {
  const p = proposal.payload as {
    text?: string;
    gold?: number;
    toId?: string | null;
    source?: string;
  };
  const [text, setText] = useState(p.text ?? proposal.text);
  const [gold, setGold] = useState(p.gold ? String(p.gold) : '');
  const [toId, setToId] = useState<string | null>(p.toId ?? null);
  const [source, setSource] = useState(p.source ?? '');
  const goldValue = gold.trim() ? parseGold(gold) : 0;
  const problem =
    goldValue === null
      ? 'Das Gold ist keine Zahl.'
      : !text.trim() && !goldValue
        ? 'Was wurde erbeutet?'
        : '';
  const accept = () =>
    onAccept({
      loot: { text, gold: goldValue ?? 0, itemId: null, toId, source, storyId: null },
    });
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={<Footer problem={problem} onClose={onClose} onAccept={accept} />}
    >
      <div className="wf-col">
        <blockquote className="wf-nachtragen-dialog__quote">„{proposal.quote}“</blockquote>
        <Field label="Was">
          <Input value={text} onChange={(e) => setText(e.target.value)} data-autofocus />
        </Field>
        <div className="wf-form-grid">
          <Field label="Gold">
            <Input value={gold} onChange={(e) => setGold(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="An" hint={toId ? undefined : 'Leer heißt: an die ganze Gruppe.'}>
            <EntityPicker
              value={toId}
              onChange={setToId}
              kinds={['character']}
              placeholder="Die Gruppe"
            />
          </Field>
        </div>
        <Field label="Woher">
          <Input value={source} onChange={(e) => setSource(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

function ThreadFields({
  proposal,
  title,
  onClose,
  onAccept,
}: {
  proposal: ReadProposal;
  title: string;
  onClose: () => void;
  onAccept: (change: ProposalChange) => void;
}) {
  const p = proposal.payload as { title?: string };
  const [text, setText] = useState(p.title ?? proposal.text);
  const [refs, setRefs] = useState<string[]>(proposal.refs);
  const problem = text.trim() ? '' : 'Der Faden braucht einen Satz.';
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <Footer
          problem={problem}
          onClose={onClose}
          onAccept={() => onAccept({ thread: { title: text.trim(), refs } })}
        />
      }
    >
      <div className="wf-col">
        <Field label="Der Faden in einem Satz">
          <Input value={text} onChange={(e) => setText(e.target.value)} data-autofocus />
        </Field>
        <Field label="Hängt an">
          <EntityRefsEditor value={refs} onChange={setRefs} />
        </Field>
      </div>
    </Dialog>
  );
}
