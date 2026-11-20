/**
 * Die Mappe auf einem Text oder einer Geschichte (F05): was zur Arbeit daran gehört, mit einem Klick
 * zu öffnen; „Anheften“ sucht in allem, zuletzt Bearbeitetes zuerst. Und der Rückweg auf dem
 * Material: „Liegt in der Mappe von …“. Nur Verweise – nichts wird kopiert oder verschoben.
 */
import { useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { Paperclip, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import type { MaterialRef } from '../../domain/schema';
import { Input, MenuItem, Popover, toast } from '../../ui';
import {
  materialChoices,
  materialOf,
  ownerRef,
  pinMaterial,
  pinnedIn,
  sameRef,
  unpinMaterial,
  type MaterialOwner,
} from './material';
import './material.css';

const SHOWN_CHOICES = 12;

export function MaterialBox({ owner: given }: { owner: MaterialOwner }) {
  const data = useData();
  // Der Aufrufer baut den Besitzer bei jedem Zeichnen neu – gemerkt wird nach Art und Kennung.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const owner = useMemo(() => given, [given.type, given.id]);
  const db = useDb();
  const items = useMemo(() => materialOf(data, owner), [data, owner]);
  const back = useMemo(() => pinnedIn(data, ownerRef(data, owner)), [data, owner]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const anchor = useRef<HTMLButtonElement>(null);
  const choices = useMemo(() => {
    if (!open) return [];
    const self = ownerRef(data, owner);
    const needle = query.trim().toLowerCase();
    return materialChoices(data)
      .filter((c) => !sameRef(c.ref, self) && !items.some((i) => sameRef(i.ref, c.ref)))
      .filter((c) => !needle || c.title.toLowerCase().includes(needle))
      .slice(0, SHOWN_CHOICES);
  }, [open, query, data, owner, items]);

  const pin = (ref: MaterialRef) => {
    const undo = pinMaterial(db, owner, ref);
    setOpen(false);
    setQuery('');
    if (undo)
      toast({ title: 'Angeheftet', action: { label: 'Rückgängig', run: undo }, slot: 'material' });
  };
  const unpin = (ref: MaterialRef, title: string) => {
    const undo = unpinMaterial(db, owner, ref);
    toast({
      title: `„${title}“ aus der Mappe genommen`,
      body: 'Es selbst bleibt bestehen.',
      action: { label: 'Rückgängig', run: undo },
      slot: 'material',
    });
  };

  return (
    <div className="wf-welt-material" aria-label="Mappe">
      <span className="wf-welt-material__title">
        <Paperclip aria-hidden /> Mappe
      </span>
      {items.map((item) => (
        <span key={`${item.ref.type}:${item.ref.id}`} className="wf-welt-material__item">
          <Link href={item.href}>
            <span className="wf-welt-material__kind">{item.label}</span> {item.title}
          </Link>
          <button
            type="button"
            aria-label={`${item.title} aus der Mappe nehmen`}
            title="Aus der Mappe nehmen"
            onClick={() => unpin(item.ref, item.title)}
          >
            <X aria-hidden />
          </button>
        </span>
      ))}
      <button
        ref={anchor}
        type="button"
        className="wf-welt-material__add"
        onClick={() => setOpen((v) => !v)}
        title="Text, Geschichte, Karte oder Eintrag hierher heften – nur ein Verweis"
      >
        {items.length ? '+ Anheften' : '+ Material anheften'}
      </button>
      {back.length > 0 && (
        <span className="wf-welt-material__back">
          Liegt in der Mappe von{' '}
          {back.map((item, i) => (
            <span key={`${item.ref.type}:${item.ref.id}`}>
              {i > 0 && ', '}
              <Link href={item.href}>{item.title}</Link>
            </span>
          ))}
        </span>
      )}
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} width={320}>
        <div className="wf-welt-material__pick">
          <Input
            autoFocus
            value={query}
            placeholder="Suchen …"
            aria-label="Material suchen"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && choices[0]) pin(choices[0].ref);
            }}
          />
          {choices.map((choice) => (
            <MenuItem key={`${choice.ref.type}:${choice.ref.id}`} onClick={() => pin(choice.ref)}>
              <span className="wf-welt-material__kind">{choice.label}</span> {choice.title}
            </MenuItem>
          ))}
          {choices.length === 0 && <p className="wf-welt-material__none">Nichts gefunden.</p>}
        </div>
      </Popover>
    </div>
  );
}

/** Nur der Rückweg – für Material ohne eigene Mappe (Wegenetz, Hexkarte, Dungeon). */
export function MaterialBack({ refTo }: { refTo: MaterialRef }) {
  const data = useData();
  const { type, id } = refTo;
  const back = useMemo(() => pinnedIn(data, { type, id }), [data, type, id]);
  if (!back.length) return null;
  return (
    <span className="wf-welt-material__back">
      <Paperclip aria-hidden /> Liegt in der Mappe von{' '}
      {back.map((item, i) => (
        <span key={`${item.ref.type}:${item.ref.id}`}>
          {i > 0 && ', '}
          <Link href={item.href}>{item.title}</Link>
        </span>
      ))}
    </span>
  );
}
