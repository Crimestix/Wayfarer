/**
 * Landmasse aus einem Kartenbild: Bild wählen, sagen, was Wasser ist (oder was Land), und sehen,
 * was Wayfarer als Land liest. Danach wird die Fläche auf der Karte eingepasst.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { Button, Checkbox, Dialog, Field, Input } from '../../ui';
import {
  blurPixels,
  cleanMask,
  cropMask,
  dropAreas,
  dominantColor,
  landMask,
  traceMask,
  type Crop,
  type Rgb,
  type TraceOptions,
  type TracedShape,
} from './trace';

/** Größer wird ein Bild nicht gelesen – feiner als die Karte selbst muss die Küste nicht sein. */
const MAX_SIDE = 1400;
const NO_CROP: Crop = { top: 0, right: 0, bottom: 0, left: 0 };
const SIDES: [keyof Crop, string][] = [
  ['top', 'Oben'],
  ['bottom', 'Unten'],
  ['left', 'Links'],
  ['right', 'Rechts'],
];
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
  /** Ein Klick ins Bild nimmt eine Fläche weg, statt eine Farbe aufzunehmen. */
  const [clickDrops, setClickDrops] = useState(false);
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
  const crop = options.crop ?? NO_CROP;
  // Das weichgezeichnete Bild hängt nur am Regler dafür – nicht an Farbe und Ähnlichkeit.
  const soft = useMemo(
    () => (picture ? blurPixels(picture.pixels, picture.width, picture.height, smooth) : null),
    [picture, smooth],
  );
  const mask = useMemo(
    () =>
      picture && soft
        ? dropAreas(
            cleanMask(
              cropMask(
                landMask(soft, picture.width, picture.height, options),
                picture.width,
                picture.height,
                options.crop,
              ),
              picture.width,
              picture.height,
              options.minArea,
              options.fillHoles,
            ),
            picture.width,
            picture.height,
            options.drop,
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
    // Abgeschnittene Ränder erscheinen dunkler als das übrige Bild.
    const kept = cropMask(new Uint8Array(mask.length).fill(1), picture.width, picture.height, crop);
    for (let i = 0; i < mask.length; i++) {
      const land = mask[i] === 1;
      const dim = kept[i] ? 0.45 : 0.15;
      image.data[i * 4] = land ? 214 : picture.pixels[i * 4]! * dim;
      image.data[i * 4 + 1] = land ? 178 : picture.pixels[i * 4 + 1]! * dim;
      image.data[i * 4 + 2] = land ? 96 : picture.pixels[i * 4 + 2]! * dim;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }, [picture, mask, crop]);

  const pick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!picture || !soft) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = Math.floor(((event.clientX - box.left) / box.width) * picture.width);
    const y = Math.floor(((event.clientY - box.top) / box.height) * picture.height);
    if (clickDrops) {
      // Die Fläche unter dem Zeiger gehört nicht dazu.
      setOptions((current) => ({ ...current, drop: [...(current.drop ?? []), [x, y]] }));
      return;
    }
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
              title={
                clickDrops
                  ? 'Anklicken, um diese Fläche wegzunehmen'
                  : 'Anklicken, um die Farbe dieser Stelle dazuzunehmen'
              }
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
            <Checkbox
              checked={options.fillHoles === true}
              onChange={(fillHoles) => setOptions((current) => ({ ...current, fillHoles }))}
            >
              Dunkle Flecken im Land zuschütten
            </Checkbox>
            <div>
              <div className="wf-atlas-trace__label">Ein Klick ins Bild</div>
              <div className="wf-atlas-trace__modes" role="group">
                <button
                  type="button"
                  aria-pressed={!clickDrops}
                  onClick={() => setClickDrops(false)}
                >
                  Farbe aufnehmen
                </button>
                <button type="button" aria-pressed={clickDrops} onClick={() => setClickDrops(true)}>
                  Fläche wegnehmen
                </button>
              </div>
              <p className="wf-mute">
                Flächen wegnehmen: für Land, das nicht dazugehört – eine Nachbarinsel, eine Wolke,
                ein Schriftfeld.{' '}
                {(options.drop?.length ?? 0) > 0 && (
                  <button
                    type="button"
                    className="wf-atlas-trace__undo"
                    onClick={() => setOptions((current) => ({ ...current, drop: [] }))}
                  >
                    {options.drop!.length === 1
                      ? 'Die weggenommene Fläche zurückholen'
                      : `Alle ${options.drop!.length} weggenommenen Flächen zurückholen`}
                  </button>
                )}
              </p>
            </div>
            <details className="wf-atlas-trace__crop">
              <summary>Bildrand abschneiden</summary>
              <p className="wf-mute">
                Was abgeschnitten ist, gilt als Meer – etwa Titel, Maßstab oder Land am Rand, das
                nicht dazugehört. Das Bild behält seine Größe.
              </p>
              <div className="wf-atlas-trace__sides">
                {SIDES.map(([side, label]) => (
                  <label key={side}>
                    <span>
                      {label}: {Math.round(crop[side] * 100)} %
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={60}
                      value={Math.round(crop[side] * 100)}
                      onChange={(event) =>
                        setOptions((current) => ({
                          ...current,
                          crop: {
                            ...(current.crop ?? NO_CROP),
                            [side]: Number(event.target.value) / 100,
                          },
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
            </details>
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
