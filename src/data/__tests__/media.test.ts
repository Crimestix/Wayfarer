import { describe, expect, it } from 'vitest';
import { mediaName, resolveMedia } from '../media';

describe('Bilder auf diesem Rechner', () => {
  it('leitet den Dateinamen aus der Adresse ab', () => {
    expect(mediaName('https://assets.example.org/0a1b2c3d-0000.png')).toBe('0a1b2c3d-0000.png');
    expect(mediaName('https://assets.example.org/ordner/karte.WEBP?x=1#y')).toBe('karte.WEBP');
    // Kein Bild im Netz oder kein brauchbarer Name: bleibt, wie es ist.
    for (const url of [
      null,
      undefined,
      '',
      'data:image/png;base64,AAAA',
      'http://assets.example.org/karte.png',
      'https://assets.example.org/',
      'https://assets.example.org/karte',
      'https://assets.example.org/karte.svg',
      'https://assets.example.org/.png',
      'https://assets.example.org/a%20b.png',
      'kein-url',
    ])
      expect(mediaName(url), String(url)).toBeNull();
  });

  it('zeigt die Datei vom Rechner, wenn sie da ist, sonst die Adresse im Netz', () => {
    const have = new Set(['karte.png']);
    const local = (name: string) => `lokal:${name}`;
    expect(resolveMedia('https://assets.example.org/karte.png', have, local)).toBe(
      'lokal:karte.png',
    );
    expect(resolveMedia('https://assets.example.org/fehlt.png', have, local)).toBe(
      'https://assets.example.org/fehlt.png',
    );
    expect(resolveMedia('data:image/png;base64,AAAA', have, local)).toBe(
      'data:image/png;base64,AAAA',
    );
    expect(resolveMedia(null, have, local)).toBeUndefined();
  });
});
