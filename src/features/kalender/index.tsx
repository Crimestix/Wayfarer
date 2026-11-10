import { Hammer } from 'lucide-react';
import { EmptyState } from '../../ui';

/** Platzhalter – dieser Bereich wird gerade gebaut. */
export default function Page() {
  return (
    <div className="wf-page">
      <header className="wf-page__head">
        <h1 className="wf-page__title">Kalender</h1>
      </header>
      <div className="wf-page__body">
        <EmptyState icon={<Hammer />} title="In Arbeit">
          Dieser Bereich wird gerade gebaut.
        </EmptyState>
      </div>
    </div>
  );
}
