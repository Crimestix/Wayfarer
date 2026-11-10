/** Bausteine der Einstellungsseite: Abschnitt, Handgriff mit Erklärung, Hinweisfläche, Dateiwahl. */
import { Component, useId, useRef, type ReactNode } from 'react';
import { cx } from '../../ui';

/** Ein Abschnitt: links Titel und ein Satz Erklärung, rechts der Inhalt. */
export function Section({
  numeral,
  title,
  lead,
  children,
}: {
  /** Römische Ziffer als Zierde vor dem Titel. */
  numeral: string;
  title: string;
  lead: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="wf-einstellungen-section" aria-labelledby={id}>
      <header className="wf-einstellungen-section__head">
        <div className="wf-einstellungen-section__numeral" aria-hidden="true">
          {numeral}
        </div>
        <h2 className="wf-einstellungen-section__title" id={id}>
          {title}
        </h2>
        <p className="wf-einstellungen-section__lead">{lead}</p>
      </header>
      <div className="wf-einstellungen-section__body">{children}</div>
    </section>
  );
}

/** Ein Handgriff mit Symbol, Namen, Erklärung und Knopf rechts. */
export function ActionRow({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="wf-einstellungen-action">
      <div className="wf-einstellungen-action__icon">{icon}</div>
      <div className="wf-einstellungen-action__text">
        <div className="wf-einstellungen-action__title">{title}</div>
        <div className="wf-einstellungen-action__hint">{children}</div>
      </div>
      <div className="wf-einstellungen-action__do">{action}</div>
    </div>
  );
}

export function Notice({
  tone = 'info',
  icon,
  title,
  children,
  action,
}: {
  tone?: 'info' | 'warn' | 'danger';
  icon?: ReactNode;
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={cx('wf-einstellungen-notice', `wf-einstellungen-notice--${tone}`)} role={tone === 'danger' ? 'alert' : 'note'}>
      {icon && <div className="wf-einstellungen-notice__icon">{icon}</div>}
      <div className="wf-grow">
        {title && <div className="wf-einstellungen-notice__title">{title}</div>}
        <div className="wf-einstellungen-notice__body">{children}</div>
      </div>
      {action}
    </div>
  );
}

/** Unsichtbare Dateiwahl; `open()` zeigt den Dialog des Systems. */
export function useFilePicker(onFile: (file: File) => void) {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      accept=".json,application/json"
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0];
        // Zurücksetzen, damit dieselbe Datei noch einmal gewählt werden kann.
        e.target.value = '';
        if (file) onFile(file);
      }}
    />
  );
  return { input, open: () => ref.current?.click() };
}

/**
 * Fängt Fehler eines eingebetteten Bausteins ab, damit die übrigen Einstellungen – vor allem die
 * Sicherung – erreichbar bleiben.
 */
export class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
