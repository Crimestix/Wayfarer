/** Lädt die Beispielantworten aus `../fixtures` für die Tests. */
import { readFileSync } from 'node:fs';

export function fixtureText(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
}

export function fixture<T>(name: string): T {
  return JSON.parse(fixtureText(name)) as T;
}
