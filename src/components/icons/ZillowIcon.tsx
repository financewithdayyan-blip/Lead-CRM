/** Zillow's brand blue on a rounded badge with a simplified "Z" mark —
 *  not a pixel copy of their logo, just enough to read as "Zillow" at a
 *  glance next to the button's own text label. */
export function ZillowIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#006AFF" />
      <path d="M7 8h10l-9.3 8H17" stroke="white" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
