/**
 * „Beteiligte“ auf dem Blatt einer Geschichte: wer und was dazugehört – jede Art der Welt –, in
 * welcher Rolle und was er hier will. Darunter die Namen aus dem Text des Blatts und die
 * Verbindungen: die Beziehungen der Welt zwischen den Beteiligten, hier nur zusammen gelesen und
 * mit einem Griff gezogen (`relate`). Gerechnet wird in `domain/storySheet.ts`.
 */
import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { EyeOff, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { CREATE_KINDS } from '../../domain/pick';
import { RELATION_TYPES, relationType } from '../../domain/relations';
import type { Story } from '../../domain/schema';
import { ROLE_SUGGESTIONS, castOf, castTies, lonelyLine } from '../../domain/storySheet';
import {
  Button,
  EntityPicker,
  IconButton,
  KindIcon,
  NamesHint,
  Select,
  SheetSection,
  StubMark,
  Written,
  entityHref,
  toast,
} from '../../ui';
import { relate, removeRelation } from '../welt/actions';
import { setWorldLayout } from '../welt/overview';
import { attachToStory, detachFromStory, listInStory, markNotMeant, setStoryRole } from './actions';
import { useStoryMention } from './storyMention';

const TIE_GROUPS = [...new Set(RELATION_TYPES.map((type) => type.group))];
/** Eine eigene Bezeichnung braucht ein Wort dazu – die trägt man auf der Seite des Eintrags ein. */
const TIE_TYPES = RELATION_TYPES.filter((type) => type.key !== 'custom');

export function StoryCast({
  story,
  texts,
  attached,
}: {
  story: Story;
  /** Was auf dem Blatt geschrieben steht (`storyTexts`). */
  texts: readonly string[];
  /** Wer schon dazugehört (`storyAttached`). */
  attached: readonly string[];
}) {
  const db = useDb();
  const data = useData();
  const mention = useStoryMention(story);
  const rows = castOf(data, story);
  const roles = `wf-faden-rollen-${story.id}`;
  const remove = (entityId: string, name: string) => {
    const undo = detachFromStory(db, story.id, entityId);
    toast({
      title: `${name} gehört nicht mehr dazu`,
      body: 'Der Eintrag selbst bleibt in der Welt.',
      action: { label: 'Rückgängig', run: undo },
    });
  };

  return (
    <SheetSection
      id="cast"
      title="Beteiligte"
      hint="Wer und was gehört dazu – und als was? Jede Art ist wählbar; was es noch nicht gibt, legst du hier an."
    >
      <datalist id={roles}>
        {ROLE_SUGGESTIONS.map((role) => (
          <option key={role} value={role} />
        ))}
      </datalist>
      {rows.map((row) => (
        <div key={row.entity.id} className="wf-faden-cast">
          <span className="wf-faden-cast__name">
            <KindIcon kind={row.entity.kind} />
            <Link href={entityHref(row.entity)} className="wf-clamp-1">
              {row.entity.name}
            </Link>
            <StubMark entity={row.entity} />
          </span>
          <Written
            label={`Rolle von ${row.entity.name} in dieser Geschichte`}
            value={row.role}
            list={roles}
            placeholder={row.driver ? 'Antreiber' : 'Rolle'}
            onSave={(role) => setStoryRole(db, story.id, row.entity.id, { role })}
          />
          <Written
            label={`Was ${row.entity.name} hier will`}
            wrap
            value={row.wants}
            placeholder="will hier …"
            mention={mention}
            onSave={(wants) => setStoryRole(db, story.id, row.entity.id, { wants })}
          />
          {row.listed ? (
            <IconButton
              label={`${row.entity.name} aus der Geschichte nehmen`}
              size="sm"
              variant="ghost"
              onClick={() => remove(row.entity.id, row.entity.name)}
            >
              <X />
            </IconButton>
          ) : (
            <span
              className="wf-faden-cast__via"
              title={
                row.driver
                  ? 'Treibt die Geschichte an – gewählt unter „Wer will was“.'
                  : 'Gehört über einen Hinweis oder die Uhr dazu.'
              }
            />
          )}
        </div>
      ))}
      <EntityPicker
        value={null}
        onChange={(id) => id && listInStory(db, story.id, id)}
        exclude={[
          ...rows.filter((row) => row.listed || row.driver).map((row) => row.entity.id),
          ...story.heroes.map((hero) => hero.characterId),
        ]}
        placeholder="Beteiligten hinzufügen – oder neu anlegen …"
        create={{ storyId: story.id }}
        onRevert={(id) => detachFromStory(db, story.id, id)}
      />
      <NamesHint
        texts={texts}
        attached={attached}
        ignored={story.notMeant}
        storyId={story.id}
        kinds={CREATE_KINDS}
        onAdd={(entityId) => attachToStory(db, story.id, entityId)}
        onRemove={(entityId) => detachFromStory(db, story.id, entityId)}
        onIgnore={(key) => markNotMeant(db, story.id, key)}
      />
      {rows.length >= 2 && <Ties story={story} />}
    </SheetSection>
  );
}

/** Die Verbindungen zwischen den Beteiligten – und die Zeile, mit der man eine neue zieht. */
function Ties({ story }: { story: Story }) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const rows = castOf(data, story);
  const ties = castTies(data, story);
  const lonely = lonelyLine(rows);
  const [from, setFrom] = useState('');
  const [type, setType] = useState('');
  const [to, setTo] = useState('');
  const ready = from !== '' && to !== '' && type !== '' && from !== to;
  const connect = () => {
    if (!ready) return;
    const result = relate(db, { from, to, type });
    if (!result) return;
    const [a, b] = [data.entities[from]?.name ?? '', data.entities[to]?.name ?? ''];
    toast({
      title: `${a} – ${relationType(type).label} – ${b}`,
      body: result.created
        ? 'Die Beziehung steht jetzt auch auf den Seiten der beiden und im Netz.'
        : 'Zwischen den beiden gab es schon eine Beziehung in dieser Richtung – sie hat jetzt diese Art.',
      action: { label: 'Rückgängig', run: result.undo },
    });
    setType('');
    setTo('');
  };
  return (
    <div className="wf-faden-ties">
      <div className="wf-faden-frage__sub">
        <span>Verbindungen</span>
        <button
          type="button"
          className="wf-faden-link"
          onClick={() => {
            setWorldLayout('net');
            navigate('/welt');
          }}
        >
          Im Netz ansehen
        </button>
      </div>
      {ties.map((tie) => (
        <div key={tie.relation.id} className="wf-faden-tie" data-ended={tie.relation.ended}>
          <span className="wf-faden-tie__text">
            {tie.from.name} <em>– {tie.label} –</em> {tie.to.name}
            {tie.relation.ended && <i> (früher)</i>}
            {tie.relation.secret && <EyeOff aria-label="Die Gruppe weiß nichts davon" />}
          </span>
          <IconButton
            label={`Verbindung von ${tie.from.name} zu ${tie.to.name} lösen`}
            size="sm"
            variant="ghost"
            onClick={() => {
              const undo = removeRelation(db, tie.relation);
              toast({
                title: 'Verbindung gelöst',
                body: `${tie.from.name} – ${tie.label} – ${tie.to.name}. Sie steht auch auf den Seiten der beiden nicht mehr.`,
                action: { label: 'Rückgängig', run: undo },
              });
            }}
          >
            <X />
          </IconButton>
        </div>
      ))}
      {lonely && <p className="wf-sheet__none">{lonely}</p>}
      <div className="wf-faden-tieform">
        <Select
          value={from}
          aria-label="Verbindung von"
          onChange={(event) => setFrom(event.target.value)}
        >
          <option value="">Wer …</option>
          {rows.map((row) => (
            <option key={row.entity.id} value={row.entity.id}>
              {row.entity.name}
            </option>
          ))}
        </Select>
        <Select
          value={type}
          aria-label="Art der Verbindung"
          onChange={(event) => setType(event.target.value)}
        >
          <option value="">… steht wie …</option>
          {TIE_GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {TIE_TYPES.filter((entry) => entry.group === group).map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        <Select
          value={to}
          aria-label="Verbindung zu"
          onChange={(event) => setTo(event.target.value)}
        >
          <option value="">… zu wem?</option>
          {rows
            .filter((row) => row.entity.id !== from)
            .map((row) => (
              <option key={row.entity.id} value={row.entity.id}>
                {row.entity.name}
              </option>
            ))}
        </Select>
        <Button size="sm" disabled={!ready} onClick={connect}>
          Verbinden
        </Button>
      </div>
    </div>
  );
}
