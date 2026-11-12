/**
 * Ein Ding hat eine Seite – von selbst. Heißt ein Artikel wie ein Eintrag der Welt und wissen die
 * beiden noch nichts voneinander, verbindet Wayfarer sie, gleich wo der Eintrag oder der Artikel
 * entstanden ist. So wird nichts doppelt angelegt.
 */
import { useEffect, useMemo } from 'react';
import { useData, useDb } from '../../data/hooks';
import { linkTwins } from './actions';
import { twins } from './facts';

/** Läuft unsichtbar mit; rendert nichts. */
export function TwinSync() {
  const db = useDb();
  const data = useData();
  const waiting = useMemo(() => twins(data).length, [data]);
  useEffect(() => {
    if (waiting) linkTwins(db);
  }, [db, waiting]);
  return null;
}
