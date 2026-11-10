/** Allgemeine Bausteine. Neue Oberflächen setzen sich aus diesen zusammen. */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type RefObject,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { X } from 'lucide-react';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

// ── Knöpfe ─────────────────────────────────────────────────────────────────

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  icon?: ReactNode;
  ref?: RefObject<HTMLButtonElement | null>;
}

export function Button({ variant = 'default', size = 'md', icon, className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'wf-btn',
        variant !== 'default' && `wf-btn--${variant}`,
        size === 'sm' && 'wf-btn--sm',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/** Knopf, der nur ein Symbol zeigt. `label` ist Pflicht: Tooltip und Name für Screenreader. */
export function IconButton({
  label,
  className,
  children,
  ...rest
}: Omit<ButtonProps, 'icon'> & { label: string }) {
  return (
    <Button {...rest} className={cx('wf-btn--icon', className)} aria-label={label} title={label}>
      {children}
    </Button>
  );
}

// ── Rahmen und Gliederung ──────────────────────────────────────────────────

export interface PanelProps {
  title?: ReactNode;
  /** Kleine Zahl hinter dem Titel. */
  count?: number;
  /** Knöpfe rechts im Kopf. */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Inhalt ohne Innenabstand (für Listen). */
  flush?: boolean;
  /** Inhalt rollt innerhalb des Rahmens. */
  scroll?: boolean;
  variant?: 'framed' | 'plain' | 'inset';
}

export function Panel({ title, count, actions, children, className, style, flush, scroll, variant = 'framed' }: PanelProps) {
  return (
    <section
      className={cx('wf-panel', variant !== 'framed' && `wf-panel--${variant}`, className)}
      style={style}
    >
      {(title || actions) && (
        <header className="wf-panel__head">
          <h3 className="wf-panel__title">
            {title}
            {count !== undefined && <span className="wf-panel__count">{count}</span>}
          </h3>
          {actions}
        </header>
      )}
      <div
        className={cx(
          'wf-panel__body',
          flush && 'wf-panel__body--flush',
          scroll && 'wf-panel__body--scroll wf-grow',
        )}
      >
        {children}
      </div>
    </section>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h4 className="wf-section-title">{children}</h4>;
}

export function Divider() {
  return (
    <div className="wf-divider" role="separator">
      <i />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="wf-empty">
      {icon}
      <div className="wf-empty__title">{title}</div>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Badge({
  tone,
  icon,
  children,
  title,
}: {
  tone?: 'gold' | 'blood' | 'moss' | 'arcane' | 'ember';
  icon?: ReactNode;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={cx('wf-badge', tone && `wf-badge--${tone}`)} title={title}>
      {icon}
      {children}
    </span>
  );
}

// ── Eingaben ───────────────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cx('wf-field', className)} role="group" aria-labelledby={id}>
      <div className="wf-field__label" id={id}>
        {label}
      </div>
      {children}
      {hint && <div className="wf-field__hint">{hint}</div>}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { ref?: RefObject<HTMLInputElement | null> }) {
  return <input {...rest} className={cx('wf-input', className)} />;
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: RefObject<HTMLTextAreaElement | null> }) {
  return <textarea {...rest} className={cx('wf-textarea', className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx('wf-select', className)}>
      {children}
    </select>
  );
}

export function Checkbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="wf-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

// ── Reiter ─────────────────────────────────────────────────────────────────

export interface TabDef<T extends string> {
  id: T;
  label: string;
  count?: number;
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: TabDef<T>[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="wf-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          className="wf-tab"
          aria-selected={tab.id === value}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count !== undefined && <span className="wf-tab__count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ── Dialog ─────────────────────────────────────────────────────────────────

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Knöpfe unten rechts. */
  footer?: ReactNode;
  width?: number;
}

/** Modaler Dialog. Escape und Klick neben den Dialog schließen ihn. */
export function Dialog({ open, onClose, title, children, footer, width = 580 }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      // Der Dialog würde sonst den Schließen-Knopf fokussieren; sinnvoller ist das erste Eingabefeld.
      const target =
        el.querySelector<HTMLElement>('[data-autofocus]') ??
        el.querySelector<HTMLElement>(
          '.wf-dialog__body textarea, .wf-dialog__body input, .wf-dialog__body select, .wf-dialog__body button',
        );
      target?.focus();
    }
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="wf-dialog"
      style={{ width }}
      onClose={onClose}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <>
          <header className="wf-dialog__head">
            <h2 className="wf-dialog__title">{title}</h2>
            <IconButton label="Schließen" variant="ghost" onClick={onClose}>
              <X />
            </IconButton>
          </header>
          <div className="wf-dialog__body">{children}</div>
          {footer && <footer className="wf-dialog__foot">{footer}</footer>}
        </>
      )}
    </dialog>
  );
}

// ── Aufklappfläche ─────────────────────────────────────────────────────────

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** Element, an dem die Fläche hängt. */
  anchor: RefObject<HTMLElement | null>;
  children: ReactNode;
  align?: 'left' | 'right';
  width?: number;
  className?: string;
}

/**
 * Fläche, die unter (oder bei Platzmangel über) einem Element aufklappt.
 * Fest positioniert, damit sie in Dialogen und Rollbereichen nicht abgeschnitten wird.
 */
export function Popover({ open, onClose, anchor, children, align = 'left', width, className }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Bis die Lage berechnet ist, unsichtbar – aber nicht „visibility: hidden“: darin ließe sich
  // nichts fokussieren, und das Suchfeld einer Auswahl bekäme beim Öffnen nie den Fokus.
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', opacity: 0 });

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const rect = anchor.current.getBoundingClientRect();
    const next: CSSProperties = { position: 'fixed', width: width ?? Math.max(rect.width, 220) };
    const below = window.innerHeight - rect.bottom;
    if (below < 260 && rect.top > below) next.bottom = window.innerHeight - rect.top + 6;
    else next.top = rect.bottom + 6;
    if (align === 'right') next.right = Math.max(8, window.innerWidth - rect.right);
    else next.left = Math.max(8, Math.min(rect.left, window.innerWidth - (width ?? rect.width) - 8));
    setStyle(next);
  }, [open, anchor, align, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, anchor]);

  if (!open) return null;
  return (
    <div ref={ref} className={cx('wf-popover', className)} style={style}>
      {children}
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  onClick,
  active,
  disabled,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="wf-menu-item" data-active={active} disabled={disabled} onClick={onClick}>
      {icon}
      <span className="wf-grow">{children}</span>
    </button>
  );
}

// ── Meldungen ──────────────────────────────────────────────────────────────

export interface ToastInput {
  title: string;
  body?: ReactNode;
  tone?: 'default' | 'danger';
  /** Knopf in der Meldung, z. B. „Rückgängig“. */
  action?: { label: string; run: () => void };
  /** Anzeigedauer in Millisekunden. */
  duration?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

let toasts: ToastItem[] = [];
let toastSeq = 0;
const toastListeners = new Set<() => void>();
const emitToasts = () => toastListeners.forEach((l) => l());

function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emitToasts();
}

/** Zeigt unten rechts eine kurze Meldung. */
export function toast(input: ToastInput) {
  const id = ++toastSeq;
  toasts = [...toasts.slice(-3), { ...input, id }];
  emitToasts();
  setTimeout(() => dismissToast(id), input.duration ?? (input.action ? 12000 : 6000));
}

export function Toaster() {
  const items = useSyncExternalStore(
    (l) => {
      toastListeners.add(l);
      return () => toastListeners.delete(l);
    },
    () => toasts,
  );
  return (
    <div className="wf-toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={cx('wf-toast', t.tone === 'danger' && 'wf-toast--danger')}>
          <div className="wf-grow">
            <div className="wf-toast__title">{t.title}</div>
            {t.body && <div className="wf-toast__body">{t.body}</div>}
          </div>
          {t.action && (
            <Button
              size="sm"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </Button>
          )}
          <IconButton label="Meldung schließen" size="sm" variant="ghost" onClick={() => dismissToast(t.id)}>
            <X />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

// ── Rückfrage ──────────────────────────────────────────────────────────────

export interface ConfirmInput {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

let confirmState: (ConfirmInput & { resolve: (ok: boolean) => void }) | null = null;
const confirmListeners = new Set<() => void>();

/** Fragt nach, bevor etwas Unumkehrbares geschieht. Löst mit true auf, wenn bestätigt wurde. */
export function confirmDialog(input: ConfirmInput): Promise<boolean> {
  return new Promise((resolve) => {
    confirmState?.resolve(false);
    confirmState = { ...input, resolve };
    confirmListeners.forEach((l) => l());
  });
}

export function ConfirmHost() {
  const state = useSyncExternalStore(
    (l) => {
      confirmListeners.add(l);
      return () => confirmListeners.delete(l);
    },
    () => confirmState,
  );
  const finish = (ok: boolean) => {
    confirmState?.resolve(ok);
    confirmState = null;
    confirmListeners.forEach((l) => l());
  };
  return (
    <Dialog
      open={state !== null}
      onClose={() => finish(false)}
      title={state?.title ?? ''}
      width={460}
      footer={
        <>
          <Button onClick={() => finish(false)}>Abbrechen</Button>
          <Button
            variant={state?.danger ? 'danger' : 'primary'}
            onClick={() => finish(true)}
            autoFocus
            data-autofocus
            // Eine noch gehaltene Eingabetaste (vom Knopf, der die Rückfrage geöffnet hat) bestätigt nicht.
            onKeyDown={(e) => {
              if (e.repeat) e.preventDefault();
            }}
          >
            {state?.confirmLabel ?? 'Bestätigen'}
          </Button>
        </>
      }
    >
      <div className="wf-soft">{state?.body}</div>
    </Dialog>
  );
}
