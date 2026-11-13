/** Zeilen, die Wayfarer in einen Artikel schreibt: Steckbrief und „Was geschah“ – und zurück. */
import { describe, expect, it } from 'vitest';
import { FATE_LABEL } from '../../domain/chronicleKinds';
import { PERSON_STATUS } from '../../domain/schema';
import { statusFromText } from './facts';
import { addHappenedLine, removeHappenedLine, setFactLine, unsetFactLine } from './factLines';
import { parseMarkdown, plainContext } from './markdown';

const PROSE = 'Krummzahn führt die Grubenschleicher.\n\nEr hasst das Licht.';

describe('Steckbrief', () => {
  it('legt einen Steckbrief an, wenn es keinen gibt – der Text bleibt', () => {
    const result = setFactLine(PROSE, 'person', 'status', 'tot');
    expect(result).toMatchObject({ line: '> Zustand: tot', before: null, made: true });
    expect(result.text).toBe(`> [!steckbrief]\n> Zustand: tot\n\n${PROSE}`);
    expect(unsetFactLine(result.text, result)).toBe(PROSE);
  });

  it('ersetzt nur den Wert eines Feldes, das unter anderem Namen dasteht', () => {
    const text = `> [!steckbrief]\n> Beruf: Anführer\n> Status: lebendig\n\n${PROSE}`;
    const result = setFactLine(text, 'person', 'status', 'tot');
    expect(result).toMatchObject({ line: '> Status: tot', before: '> Status: lebendig' });
    expect(result.text).toBe(`> [!steckbrief]\n> Beruf: Anführer\n> Status: tot\n\n${PROSE}`);
    expect(unsetFactLine(result.text, result)).toBe(text);
  });

  it('fügt ein fehlendes Feld zu den anderen Feldern – nicht in den Kurztext', () => {
    const text = `> [!steckbrief]\n> Beruf: Anführer\n> Spezies: Goblin\n>\n> Ein alter Kämpe.\n\n${PROSE}`;
    const result = setFactLine(text, 'person', 'whereabouts', 'Salzgrotte');
    expect(result.text).toBe(
      `> [!steckbrief]\n> Beruf: Anführer\n> Spezies: Goblin\n> Aufenthaltsort: Salzgrotte\n>\n> Ein alter Kämpe.\n\n${PROSE}`,
    );
    expect(unsetFactLine(result.text, result)).toBe(text);
  });

  it('hängt das Feld an einen Steckbrief ohne Felder an', () => {
    const text = `> [!steckbrief]\n> Ein alter Kämpe.\n\n${PROSE}`;
    const result = setFactLine(text, 'person', 'status', 'tot');
    expect(result.text).toBe(`> [!steckbrief]\n> Ein alter Kämpe.\n>\n> Zustand: tot\n\n${PROSE}`);
    expect(unsetFactLine(result.text, result)).toBe(text);
  });

  it('wird vom Steckbrief wieder richtig gelesen', () => {
    const result = setFactLine(PROSE, 'person', 'status', FATE_LABEL.dead);
    const nodes = parseMarkdown(result.text, plainContext());
    expect(JSON.stringify(nodes)).toContain('"type":"facts"');
    for (const status of PERSON_STATUS) expect(statusFromText(FATE_LABEL[status])).toBe(status);
  });

  it('lässt eine Zeile stehen, die der Spielleiter inzwischen geändert hat', () => {
    const result = setFactLine(PROSE, 'person', 'status', 'tot');
    const edited = result.text.replace('> Zustand: tot', '> Zustand: untot');
    expect(unsetFactLine(edited, result)).toBe(edited);
  });

  it('schreibt nichts in einen Codeblock', () => {
    const text = '```\n> [!steckbrief]\n> Zustand: lebt\n```\nText';
    const result = setFactLine(text, 'person', 'status', 'tot');
    expect(result.made).toBe(true);
    expect(result.text.endsWith(text)).toBe(true);
  });
});

describe('Was geschah', () => {
  it('legt den Abschnitt am Ende an und nimmt ihn wieder weg', () => {
    const result = addHappenedLine(PROSE, '8. Saatmond 701 AD (Session 5): Krummzahn ist tot.');
    expect(result).toMatchObject({
      line: '- 8. Saatmond 701 AD (Session 5): Krummzahn ist tot.',
      made: true,
      added: true,
    });
    expect(result.text).toBe(
      `${PROSE}\n\n## Was geschah\n\n- 8. Saatmond 701 AD (Session 5): Krummzahn ist tot.\n`,
    );
    expect(removeHappenedLine(result.text, result)).toBe(PROSE);
  });

  it('hängt an einen vorhandenen Abschnitt an – vor dem nächsten Abschnitt', () => {
    const text = `${PROSE}\n\n## Was geschah\n\n- Früher: geboren.\n\n## Beziehungen\n\nViele.`;
    const result = addHappenedLine(text, 'Später: gestorben.');
    expect(result.text).toBe(
      `${PROSE}\n\n## Was geschah\n\n- Früher: geboren.\n- Später: gestorben.\n\n## Beziehungen\n\nViele.`,
    );
    expect(result.made).toBe(false);
    expect(removeHappenedLine(result.text, result)).toBe(text);
  });

  it('schreibt denselben Punkt nicht zweimal und macht mehrzeilige Sätze einzeilig', () => {
    const once = addHappenedLine(PROSE, 'Er fiel.\nIm Kampf.');
    expect(once.line).toBe('- Er fiel. Im Kampf.');
    const twice = addHappenedLine(once.text, 'Er fiel. Im Kampf.');
    expect(twice).toMatchObject({ added: false, text: once.text });
  });

  it('trennt den Punkt durch eine Leerzeile von Fließtext im Abschnitt', () => {
    const text = '## Was geschah\nLange her.';
    const result = addHappenedLine(text, 'Neu.');
    expect(result.text).toBe('## Was geschah\nLange her.\n\n- Neu.');
    expect(removeHappenedLine(result.text, result)).toBe(text);
  });

  it('legt an einem leeren Artikel nur den Abschnitt an', () => {
    const result = addHappenedLine('', 'Neu.');
    expect(result.text).toBe('## Was geschah\n\n- Neu.\n');
    expect(removeHappenedLine(result.text, result)).toBe('');
  });
});
