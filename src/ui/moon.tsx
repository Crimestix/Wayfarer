import type { MoonDef, WorldTime } from '../domain/time/calendar';
import { moonPhase } from '../domain/time/calendar';

/** Umriss des beleuchteten Teils. fraction: 0 = Neumond, 0,5 = Vollmond. */
function litPath(fraction: number, r: number): string {
  const f = ((fraction % 1) + 1) % 1;
  const waxing = f < 0.5;
  const k = Math.cos(2 * Math.PI * f);
  const rx = Math.max(Math.abs(k) * r, 0.001);
  const limb = waxing ? 1 : 0;
  const terminator = k > 0 ? (waxing ? 0 : 1) : waxing ? 1 : 0;
  return `M 0 ${-r} A ${r} ${r} 0 0 ${limb} 0 ${r} A ${rx} ${r} 0 0 ${terminator} 0 ${-r} Z`;
}

/** Mond in seiner aktuellen Phase. */
export function MoonGlyph({
  moon,
  time,
  size = 22,
}: {
  moon: MoonDef;
  time: WorldTime;
  size?: number;
}) {
  const phase = moonPhase(moon, time);
  return (
    <svg
      width={size}
      height={size}
      viewBox="-12 -12 24 24"
      role="img"
      aria-label={`${moon.name}: ${phase.label}`}
    >
      <title>{`${moon.name}: ${phase.label} (${phase.light} %)`}</title>
      <circle r="10" fill="#0b0a09" stroke={moon.color} strokeOpacity="0.45" strokeWidth="1" />
      <path d={litPath(phase.fraction, 10)} fill={moon.color} />
    </svg>
  );
}
