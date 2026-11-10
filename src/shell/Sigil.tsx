/** Zeichen von Wayfarer: eine Windrose. */
export function Sigil() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <circle cx="24" cy="24" r="21" opacity="0.5" />
      <circle cx="24" cy="24" r="16.5" strokeDasharray="1 3.2" opacity="0.7" />
      <path
        d="M24 3 L27.4 20.6 L45 24 L27.4 27.4 L24 45 L20.6 27.4 L3 24 L20.6 20.6 Z"
        fill="currentColor"
        fillOpacity="0.14"
      />
      <path d="M24 3 L24 45 M3 24 L45 24" opacity="0.35" />
      <path
        d="M33.5 14.5 L26.4 21.6 M14.5 33.5 L21.6 26.4 M14.5 14.5 L21.6 21.6 M33.5 33.5 L26.4 26.4"
        opacity="0.6"
      />
      <circle cx="24" cy="24" r="2.2" fill="currentColor" />
    </svg>
  );
}
