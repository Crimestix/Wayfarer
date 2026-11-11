/**
 * Landmasse aus einem Kartenbild: Bild wählen, sagen, was Wasser ist (oder was Land), und sehen,
 * was Wayfarer als Land liest. Danach wird die Fläche auf der Karte eingepasst.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { Button, Dialog, Field, Input } from '../../ui';
import {
  blurPixels,
  cleanMask,
  dominantColor,
  landMask,
  traceMask,
  type Rgb,
  type TraceOptions,
  type TracedShape,
} from './trace';

/** Größer wird ein Bild nicht gelesen – feiner als die Karte selbst muss die Küste nicht sein. */
const MAX_SIDE = 1400;
/** Mehr Farben braucht keine Karte – und jede kostet beim Lesen Zeit. */
const MAX_COLORS = 8;

interface Picture {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

async function readPicture(file: File): Promise<Picture> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { pixels: ctx.getImageData(0, 0, width, height).data, width, height };
}

export function TraceDialog({
  onClose,
  onTraced,
}: {
  onClose: () => void;
  onTraced: (name: string, shape: TracedShape) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const [picture, setPicture] = useState<Picture | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [options, setOptions] = useState<TraceOptions>({
    mode: 'water',
    colors: [],
    tolerance: 70,
    minArea: 40,
    smooth: 0,
  });

  const load = async (file: File) => {
    setError('');
    try {
      const next = await readPicture(file);
      setPicture(next);
      setName((current) => current || file.name.replace(/\.[^.]+$/, ''));
      // Das Meer ist fast immer die häufigste Farbe – ein guter Anfang.
      setOptions((current) => ({
        ...current,
        mode: 'water',
        colors: [dominantColor(next.pixels)],
      }));
    } catch {
      setError('Dieses Bild lässt sich nicht lesen. Möglich sind PNG, JPG und WebP.');
    }
  };

  const smooth = options.smooth ?? 0;
  // Das weichgezeichnete Bild hängt nur am Regler dafür – nicht an Farbe und Ähnlichkeit.
  const soft = useMemo(
    () => (picture ? blurPixels(picture.pixels, picture.width, picture.height, smooth) : null),
    [picture, smooth],
  );
  const mask = useMemo(
    () =>
      picture && soft
        ? cleanMask(
            landMask(soft, picture.width, picture.height, options),
            picture.width,
            picture.height,
            options.minArea,
          )
        : null,
    [picture, soft, options],
  );
  /** Die kleinste Fläche lässt sich bis zu einem Hundertstel des Bildes hochstellen. */
  const maxArea = picture ? Math.max(600, Math.round((picture.width * picture.height) / 100)) : 600;
  const shape = useMemo(
    () => (picture && mask ? traceMask(mask, picture.width, picture.height) : null),
    [picture, mask],
  );

  // Vorschau: das Bild, darin golden, was als Land gelesen wird.
  useEffect(() => {
    const canvas = preview.current;
    if (!canvas || !picture || !mask) return;
    canvas.width = picture.width;
    canvas.height = picture.height;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(picture.width, picture.height);
    for (let i = 0; i < mask.length; i++) {
      const land = mask[i] === 1;
      image.data[i * 4] = land ? 214 : picture.pixels[i * 4]! * 0.45;
      image.data[i * 4 + 1] = land ? 178 : picture.pixels[i * 4 + 1]! * 0.45;
      image.data[i * 4 + 2] = land ? 96 : picture.pixels[i * 4 + 2]! * 0.45;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }, [picture, mask]);

  const pick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!picture || !soft) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = Math.floor(((event.clientX - box.left) / box.width) * picture.width);
    const y = Math.floor(((event.clientY - box.top) / box.height) * picture.height);
    const i = (Math.max(0, Math.min(picture.height - 1, y)) * picture.width + x) * 4;
    // Aus dem weichgezeichneten Bild: der Ton der Stelle, nicht ein einzelnes Korn.
    const color: Rgb = [soft[i]!, soft[i + 1]!, soft[i + 2]!];
    setOptions((current) => ({
      ...current,
      colors: [...current.colors, color].slice(-MAX_COLORS),
    }));
  };
  const setMode = (mode: TraceOptions['mode']) =>
    setOptions((current) =>
      current.mode === mode
        ? current
        : {
            ...current,
            mode,
            // Fürs Wasser ist die häufigste Farbe ein guter Anfang; das Land zeigt man selbst.
            colors: mode === 'water' && picture ? [dominantColor(picture.pixels)] : [],
          },
    );
  const dropColor = (index: number) =>
    setOptions((current) => ({
      ...current,
      colors: current.colors.filter((_, i) => i !== index),
    }));

  const count = shape ? shape.rings.length : 0;
  const clean = name.replace(/\s+/g, ' ').trim();

  return (
    <Dialog
      open
      onClose={onClose}
      title="Landmasse aus einem Kartenbild"
      width={860}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button
            variant="primary"
            disabled={!shape || !count || !clean || !options.colors.length}
            onClick={() => shape && onTraced(clean, shape)}
          >
            Weiter: auf der Karte einpassen
          </Button>
        </>
      }
    >
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void load(file);
        }}
      />
      {!picture ? (
        <div className="wf-atlas-trace__start">
          <p className="wf-soft">
            Wähle ein Bild der Landmasse – am besten eine flache Karte mit Norden oben, auf der sich
            Land und Meer in der Farbe klar unterscheiden. Wayfarer liest daraus die Küsten; wo das
            Land auf dem Planeten liegt, bestimmst du danach auf der Karte.
          </p>
          <Button variant="primary" icon={<ImagePlus />} onClick={() => input.current?.click()}>
            Bild wählen …
          </Button>
          {error && <p className="wf-atlas-trace__error">{error}</p>}
        </div>
      ) : (
        <div className="wf-atlas-trace">
          <div className="wf-atlas-trace__view">
            <canvas
              ref={preview}
              className="wf-atlas-trace__canvas"
              title="Anklicken, um die Farbe dieser Stelle dazuzunehmen"
              onClick={pick}
            />
          </div>
          <div className="wf-atlas-trace__side">
            <Field label="Name der Landmasse">
              <Input
                value={name}
                placeholder="z. B. Nordland"
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <div>
              <div className="wf-atlas-trace__label">Die gewählten Farben sind</div>
              <div className="wf-atlas-trace__modes" role="group">
                {(
                  [
                    ['water', 'Wasser'],
                    ['land', 'Land'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={options.mode === mode}
                    onClick={() => setMode(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="wf-atlas-trace__colors">
                {options.colors.map((color, index) => (
                  <button
                    key={`${index}-${color.join('-')}`}
                    type="button"
                    className="wf-atlas-trace__swatch"
                    style={{ background: `rgb(${color.join(',')})` }}
                    title="Diese Farbe wieder herausnehmen"
                    aria-label={`Farbe ${index + 1} herausnehmen`}
                    onClick={() => dropColor(index)}
                  />
                ))}
                {!options.colors.length && (
                  <span className="wf-mute">
                    Noch keine – klicke im Bild{' '}
                    {options.mode === 'water' ? 'ins Meer' : 'aufs Land'}.
                  </span>
                )}
              </div>
              <p className="wf-mute">
                {options.mode === 'water'
                  ? 'Alles, was keiner dieser Farben ähnelt, gilt als Land. Jeder Klick ins Bild nimmt die Farbe der Stelle dazu – bei gemalten Karten etwa tiefes Wasser, flaches Wasser und Schatten.'
                  : 'Nur was einer dieser Farben ähnelt, gilt als Land – gut, wenn Eis oder Schrift nicht dazugehören sollen. Jeder Klick aufs Land nimmt die Farbe der Stelle dazu.'}{' '}
                Ein Klick auf ein Farbfeld nimmt sie wieder heraus.
              </p>
            </div>
            <Field label={`Ähnlichkeit: ${options.tolerance}`} hint="Höher: mehr gilt als ähnlich.">
              <input
                type="range"
                min={10}
                max={220}
                value={options.tolerance}
                onChange={(event) =>
                  setOptions((current) => ({ ...current, tolerance: Number(event.target.value) }))
                }
              />
            </Field>
            <Field
              label={`Kleinste Fläche: ${options.minArea} Bildpunkte`}
              hint="Kleinere Flecken fallen weg – Schrift, Zierrat, Körnung."
            >
              <input
                type="range"
                min={1}
                max={maxArea}
                value={Math.min(maxArea, options.minArea)}
                onChange={(event) =>
                  setOptions((current) => ({ ...current, minArea: Number(event.target.value) }))
                }
              />
            </Field>
            <Field
              label={`Weichzeichnen: ${smooth}`}
              hint="Für gemalte Karten: verwischt Schatten, Wellen und Schrift."
            >
              <input
                type="range"
                min={0}
                max={12}
                value={smooth}
                onChange={(event) =>
                  setOptions((current) => ({ ...current, smooth: Number(event.target.value) }))
                }
              />
            </Field>
            <p className="wf-soft">
              Golden ist, was Wayfarer als Land liest:{' '}
              <b>{count === 1 ? 'eine Fläche' : `${count} Flächen`}</b>
              {shape && shape.holes.length > 0 && `, ${shape.holes.length} Gewässer darin`}.
            </p>
            <Button size="sm" onClick={() => input.current?.click()}>
              Anderes Bild …
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
