/**
 * Eine Ware wählen – aus allem: jeder Eintrag der Welt und jedes Wesen des Bestiariums, nach Art
 * gruppiert als Hilfe beim Finden (`wareGroups`), nie als Filter. Dazu der freie Weg: in Worten
 * oder als neuer Gegenstand.
 */
import { useMemo, useRef, useState } from 'react';
import { PackagePlus, Plus, Skull, Type } from 'lucide-react';
import { useData } from '../../data/hooks';
import { formatPrice, wareGroups, type WareOption } from '../../domain/shop';
import { Input, KindIcon, MenuItem, Popover } from '../../ui';

export function WarePicker({
  onPick,
  onWords,
  onCreate,
  exclude,
  placeholder = 'Ware wählen …',
}: {
  onPick: (option: WareOption) => void;
  /** Der freie Weg: nur in Worten. Ohne = nicht angeboten. */
  onWords?: (text: string) => void;
  /** Als neuen Gegenstand anlegen. Ohne = nicht angeboten. */
  onCreate?: (name: string) => void;
  /** Kennungen, die schon gewählt sind. */
  exclude?: readonly string[];
  placeholder?: string;
}) {
  const data = useData();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const skip = useMemo(() => new Set(exclude ?? []), [exclude]);
  const groups = useMemo(
    () => (open ? wareGroups(data, query, { exclude: skip }) : []),
    [data, query, skip, open],
  );
  const options = groups.flatMap((group) => group.options);
  const name = query.replace(/\s+/g, ' ').trim();
  const exact = options.some((o) => o.name.toLowerCase() === name.toLowerCase());
  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const pick = (option: WareOption) => {
    onPick(option);
    close();
  };

  return (
    <div className="wf-picker">
      <button
        ref={anchor}
        type="button"
        className="wf-picker__value"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="wf-grow wf-picker__placeholder">{placeholder}</span>
      </button>
      <Popover open={open} onClose={close} anchor={anchor} width={380}>
        <Input
          className="wf-picker__search"
          autoFocus
          placeholder="Suchen – Gegenstände, Tiere, Wesen, alles …"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (options[0]) pick(options[0]);
            else if (name && onWords) {
              onWords(name);
              close();
            }
          }}
        />
        <div className="wf-picker__list wf-laden-wares" role="listbox">
          {groups.map((group) => (
            <div key={group.label} role="group" aria-label={group.label}>
              <div className="wf-laden-wares__head">{group.label}</div>
              {group.options.map((option) => (
                <MenuItem
                  key={option.key}
                  icon={
                    option.entityId && data.entities[option.entityId] ? (
                      <KindIcon kind={data.entities[option.entityId]!.kind} />
                    ) : (
                      <Skull />
                    )
                  }
                  onClick={() => pick(option)}
                >
                  <span className="wf-laden-wares__name">{option.name}</span>
                  <span className="wf-mute">
                    {[option.sub, option.price !== null && formatPrice(option.price)]
                      .filter(Boolean)
                      .map((part) => ` · ${part}`)
                      .join('')}
                  </span>
                </MenuItem>
              ))}
            </div>
          ))}
          {!groups.length && !name && <div className="wf-picker__empty">Noch nichts angelegt.</div>}
          {!groups.length && name && (
            <div className="wf-picker__empty">Nichts dieses Namens in der Welt.</div>
          )}
          {name && onWords && (
            <MenuItem
              icon={<Type />}
              onClick={() => {
                onWords(name);
                close();
              }}
            >
              „{name}“ in Worten
            </MenuItem>
          )}
          {name && onCreate && !exact && (
            <MenuItem
              icon={<PackagePlus />}
              onClick={() => {
                onCreate(name);
                close();
              }}
            >
              „{name}“ als Gegenstand anlegen
            </MenuItem>
          )}
          {!name && (onWords || onCreate) && (
            <div className="wf-picker__empty">
              <Plus width={12} height={12} aria-hidden /> Nicht dabei? Tippe einen Namen – dann geht
              es auch in Worten{onCreate ? ' oder als neuer Gegenstand' : ''}.
            </div>
          )}
        </div>
      </Popover>
    </div>
  );
}
