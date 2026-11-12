/**
 * Galerie der Personen: Porträts zum Durchblättern, gefiltert nach Ort und danach, ob die Gruppe
 * sie kennt. Erscheint rechts, wenn links „Personen“ gewählt und kein Eintrag offen ist.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Eye, EyeOff, Plus, Search, Users, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { entityName } from '../../domain/derive';
import type { Person } from '../../domain/schema';
import { AttitudeBadge, Button, EmptyState, IconButton, Input, Portrait, cx } from '../../ui';
import { patchDetails } from './actions';
import { openEntityDialog } from './editor';
import {
  PERSON_STATUS_LABEL,
  galleryPeople,
  partyAttitudes,
  type GalleryFilter,
  type KnownFilter,
} from './model';
import { Picker } from './parts';

/** Merkt sich die Filter, solange die App läuft. */
const memory: GalleryFilter = { query: '', placeId: null, known: 'all' };

const KNOWN_LABEL: Record<KnownFilter, string> = {
  all: 'Alle',
  known: 'Bekannt',
  unknown: 'Unbekannt',
};

const KNOWN_TITLE: Record<KnownFilter, string> = {
  all: 'Alle Personen',
  known: 'Nur Personen, die die Gruppe kennt',
  unknown: 'Nur Personen, denen die Gruppe noch nicht begegnet ist',
};

export function Gallery() {
  const data = useData();
  const [filter, setFilter] = useState<GalleryFilter>(() => ({ ...memory }));
  const set = (change: Partial<GalleryFilter>) => setFilter((f) => ({ ...f, ...change }));
  useEffect(() => {
    Object.assign(memory, filter);
  }, [filter]);
  // Ein gelöschter Ort filtert nicht weiter ins Leere.
  const placeId = filter.placeId && data.entities[filter.placeId] ? filter.placeId : null;
  const people = useMemo(
    () => galleryPeople(data, { ...filter, placeId }),
    [data, filter, placeId],
  );
  const attitudes = useMemo(() => partyAttitudes(data), [data]);
  const total = Object.values(data.entities).filter((e) => e.kind === 'person').length;
  const known = Object.values(data.entities).filter(
    (e) => e.kind === 'person' && e.person.met,
  ).length;
  const filtered = filter.query.trim() !== '' || placeId !== null || filter.known !== 'all';
  const create = () =>
    openEntityDialog({
      mode: 'create',
      kind: 'person',
      preset: {
        name: filter.query.trim(),
        placeId,
        met: filter.known === 'known',
      },
    });

  return (
    <div className="wf-welt-landing wf-welt-gallery">
      <header className="wf-welt-landing__head">
        <div className="wf-welt-landing__eyebrow">Weltdatenbank</div>
        <h1 className="wf-welt-landing__title">Personen</h1>
        <p className="wf-welt-landing__lead">
          {total === 0
            ? 'Noch niemand verzeichnet.'
            : `${total} ${total === 1 ? 'Person' : 'Personen'}, ${known} davon der Gruppe bekannt.`}
        </p>
      </header>

      <div className="wf-welt-gallery__bar">
        <div className="wf-welt-search wf-welt-gallery__search">
          <Search />
          <Input
            value={filter.query}
            placeholder="Name, Rolle, Schlagwort …"
            aria-label="Personen durchsuchen"
            onChange={(e) => set({ query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && filter.query) {
                e.preventDefault();
                set({ query: '' });
              }
            }}
          />
          {filter.query && (
            <IconButton
              label="Suche leeren"
              size="sm"
              variant="ghost"
              onClick={() => set({ query: '' })}
            >
              <X />
            </IconButton>
          )}
        </div>
        <div className="wf-welt-gallery__place">
          <Picker
            value={placeId}
            onChange={(next) => set({ placeId: next })}
            kinds={['place']}
            placeholder="Überall"
          />
        </div>
        <div
          className="wf-welt-filter wf-welt-gallery__known"
          role="radiogroup"
          aria-label="Bekanntheit"
        >
          {(['all', 'known', 'unknown'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={filter.known === value}
              title={KNOWN_TITLE[value]}
              onClick={() => set({ known: value })}
            >
              {KNOWN_LABEL[value]}
            </button>
          ))}
        </div>
        <Button variant="primary" icon={<Plus />} onClick={create}>
          Person
        </Button>
      </div>
      {placeId && (
        <p className="wf-welt-gallery__note">
          Wer in {entityName(data, placeId)} oder einem Ort darin ist, wohnt oder arbeitet.
        </p>
      )}

      {people.length ? (
        <div className="wf-welt-gallery__grid">
          {people.map((person) => (
            <GalleryCard
              key={person.id}
              person={person}
              attitude={attitudes.get(person.id) ?? null}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Users />}
          title={filtered ? 'Niemand passt zu diesen Filtern' : 'Noch keine Personen'}
          action={
            <div className="wf-row" style={{ gap: 8 }}>
              {filtered && (
                <Button
                  size="sm"
                  onClick={() => setFilter({ query: '', placeId: null, known: 'all' })}
                >
                  Filter zurücksetzen
                </Button>
              )}
              <Button size="sm" icon={<Plus />} onClick={create}>
                {filter.query.trim() ? `„${filter.query.trim()}“ anlegen` : 'Person anlegen'}
              </Button>
            </div>
          }
        >
          {filtered
            ? 'Lockere die Suche oder wähle einen anderen Ort.'
            : 'Alle Figuren der Welt, die nicht von Spielern geführt werden, erscheinen hier mit ihrem Porträt.'}
        </EmptyState>
      )}
    </div>
  );
}

function GalleryCard({ person, attitude }: { person: Person; attitude: number | null }) {
  const db = useDb();
  const data = useData();
  const { role, status, placeId, met } = person.person;
  const where = placeId ? entityName(data, placeId) : 'Aufenthalt unbekannt';
  return (
    <div className={cx('wf-welt-card', !met && 'wf-welt-card--unknown')}>
      <Link href={`/welt/${person.id}`} className="wf-welt-card__link" title={person.name}>
        <Portrait entity={person} size={112} />
        <span className="wf-welt-card__name wf-clamp-2">{person.name}</span>
        <span className="wf-welt-card__sub wf-clamp-1">
          {[role, status !== 'alive' && PERSON_STATUS_LABEL[status]].filter(Boolean).join(' · ') ||
            person.tagline ||
            ' '}
        </span>
        <span className="wf-welt-card__sub wf-clamp-1">{where}</span>
      </Link>
      <div className="wf-welt-card__foot">
        <AttitudeBadge value={attitude} />
        <IconButton
          size="sm"
          variant="ghost"
          label={met ? 'Als der Gruppe unbekannt markieren' : 'Als der Gruppe bekannt markieren'}
          onClick={() => patchDetails(db, person, { met: !met })}
        >
          {met ? <Eye /> : <EyeOff />}
        </IconButton>
      </div>
    </div>
  );
}
