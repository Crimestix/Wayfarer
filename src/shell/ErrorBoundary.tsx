/**
 * Auffangstelle: Kann ein Bereich nicht angezeigt werden – ein Fehler beim Aufbau der Seite oder
 * ein Teil, der sich nicht laden ließ –, bleibt Wayfarer bedienbar. Statt einer leeren Fläche
 * steht da, was los ist und wie es weitergeht. Der Spielstand ist davon nicht berührt: Er liegt
 * im Kampagnenordner und wird nur durch bewusste Handgriffe geändert.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import { Button, EmptyState } from '../ui';

interface Props {
  /** Wechselt dieser Wert (der Ort in der App), wird ein neuer Versuch gemacht. */
  resetKey: string;
  /** Führt aus dem Bereich heraus, z. B. zum Spieltisch. */
  onLeave: () => void;
  children: ReactNode;
}

interface State {
  error: Error | null;
  /** Der Ort, an dem der Fehler auftrat. */
  at: string;
}

/** Erkennt, ob ein nachgeladener Teil der App nicht ankam (statt eines Fehlers in der Seite). */
const isLoadFailure = (error: Error): boolean =>
  /dynamically imported module|Importing a module script failed|Loading chunk|Failed to fetch/i.test(
    error.message,
  );

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, at: '' };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // Ein Wechsel des Bereichs ist ein neuer Versuch.
    if (state.error && state.at && state.at !== props.resetKey) return { error: null, at: '' };
    if (state.error && !state.at) return { at: props.resetKey };
    return null;
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Bereich konnte nicht angezeigt werden:', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const loading = isLoadFailure(error);
    return (
      <div className="wf-page wf-shell-fault" role="alert">
        <EmptyState
          icon={<TriangleAlert />}
          title={
            loading
              ? 'Ein Teil von Wayfarer ließ sich nicht laden'
              : 'Dieser Bereich kann gerade nicht angezeigt werden'
          }
          action={
            <div className="wf-row" style={{ gap: 'var(--s-3)' }}>
              <Button
                variant="primary"
                icon={<RotateCcw />}
                onClick={() =>
                  loading ? window.location.reload() : this.setState({ error: null, at: '' })
                }
              >
                {loading ? 'Wayfarer neu laden' : 'Noch einmal versuchen'}
              </Button>
              <Button onClick={this.props.onLeave}>Zum Spieltisch</Button>
            </div>
          }
        >
          Dein Spielstand ist davon nicht betroffen – er liegt sicher im Kampagnenordner. Die
          anderen Bereiche funktionieren weiter.
        </EmptyState>
        <details className="wf-shell-fault__detail">
          <summary>Für die Fehlersuche</summary>
          <pre>{error.message}</pre>
        </details>
      </div>
    );
  }
}
