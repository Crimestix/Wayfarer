/**
 * Ein Arbeitsbereich mit mehreren Ansichten: oben die Reiter, darunter die gewählte Seite. So
 * stehen verwandte Seiten – Weltkarte, Karten, Hexkarten – unter einem Eintrag der Navigation.
 */
import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import type { AreaTab } from '../features/registry';

const isAt = (location: string, path: string): boolean =>
  location === path || location.startsWith(path + '/');

export function AreaTabs({ tabs, children }: { tabs: readonly AreaTab[]; children: ReactNode }) {
  const [location] = useLocation();
  return (
    <div className="wf-area">
      <nav className="wf-area__tabs" aria-label="Ansichten dieses Bereichs">
        {tabs.map((tab) => (
          <Link
            key={tab.path}
            href={tab.path}
            className="wf-area__tab"
            aria-current={isAt(location, tab.path) ? 'page' : undefined}
            title={tab.hint}
          >
            <tab.icon aria-hidden />
            {tab.label}
          </Link>
        ))}
      </nav>
      <div className="wf-area__body">{children}</div>
    </div>
  );
}
