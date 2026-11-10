/**
 * Verbindung zwischen dem Editor und dem, was ihn einhängt: Die Funktionen der Seite (Vorschläge,
 * bekannte Verweise, Bildadressen) dürfen sich ändern, ohne dass der Editor neu entsteht. Er fragt
 * sie deshalb jedes Mal über dieses eine Objekt ab.
 */
import { Facet, StateEffect } from '@codemirror/state';
import type { LinkSuggestion } from './MarkdownEditor';

export interface EditorHost {
  suggestLinks: (query: string) => LinkSuggestion[];
  isKnownLink: (target: string) => boolean;
  /** Öffnet den Artikel; false, wenn die Seite keine Verweise öffnen kann. */
  openLink: (target: string) => boolean;
  /** Die Adresse, von der ein Bild geladen wird. */
  imageSrc: (url: string) => string;
}

const idleHost: EditorHost = {
  suggestLinks: () => [],
  isKnownLink: () => true,
  openLink: () => false,
  imageSrc: (url) => url,
};

export const hostFacet = Facet.define<EditorHost, EditorHost>({
  combine: (values) => values[0] ?? idleHost,
});

/** Sagt dem Editor, dass sich die Antworten der Seite geändert haben können. */
export const refreshEffect = StateEffect.define<null>();
