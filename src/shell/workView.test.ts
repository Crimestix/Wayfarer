import { afterEach, describe, expect, it } from 'vitest';
import {
  currentWorkView,
  defaultWorkView,
  localWorkView,
  resetWorkView,
  setWorkView,
} from './workView';

afterEach(() => resetWorkView());

describe('Arbeitsansicht (F06, F13)', () => {
  it('folgt ohne eigene Wahl dem Abend', () => {
    expect(defaultWorkView(true)).toBe('play');
    expect(defaultWorkView(false)).toBe('prep');
    expect(currentWorkView(true)).toBe('play');
  });
  it('eine eigene Wahl gilt unabhängig vom Abend', () => {
    setWorkView('prep');
    expect(currentWorkView(true)).toBe('prep');
    setWorkView('play');
    expect(currentWorkView(false)).toBe('play');
  });
  it('Karten beginnen beim Spielen nur mit etwas zu spielen im Spielen', () => {
    expect(localWorkView('play', true)).toBe('play');
    expect(localWorkView('play', false)).toBe('prep');
    expect(localWorkView('prep', true)).toBe('prep');
  });
});
