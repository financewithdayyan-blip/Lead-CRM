export interface SignatureFontOption {
  id: string;
  label: string;
  family: string;
}

/** Four distinct script styles to choose from — one flourished (Great
 * Vibes, the long-standing default), one flowing brush script (Allura), one
 * romantic looping script (Parisienne), and one classic looping cursive
 * (Sacramento) — so a typed signature doesn't always look identical
 * regardless of who's signing. Dancing Script and Alex Brush were dropped:
 * both are designed around lowercase/mixed-case flow, and a party whose
 * name is on record in ALL CAPS (common on these contracts) turned them
 * into blocky or overlapping messes — these four hold up in either case. */
export const SIGNATURE_FONTS: SignatureFontOption[] = [
  { id: 'great-vibes', label: 'Great Vibes', family: 'Great Vibes' },
  { id: 'allura', label: 'Allura', family: 'Allura' },
  { id: 'parisienne', label: 'Parisienne', family: 'Parisienne' },
  { id: 'sacramento', label: 'Sacramento', family: 'Sacramento' },
];

const SIGNATURE_FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Great+Vibes&family=Allura&family=Parisienne&family=Sacramento&display=swap';

/** Script fonts are drawn to connect lowercase letterforms — feeding them an
 * ALL-CAPS name (common here, since some parties have their legal name on
 * file that way) breaks that flow into blocky or overlapping capitals. This
 * normalizes purely for display/rasterization, never touching the raw
 * value typed into the name field. */
export function formatSignatureName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

/** Injects the signature fonts' stylesheet once per page load — only the
 * public signing page needs it, so it's loaded on demand rather than
 * globally in index.html. All four load together since the font picker
 * previews every option at once. */
export function loadSignatureFont() {
  if (document.getElementById('signature-font-link')) return;
  const link = document.createElement('link');
  link.id = 'signature-font-link';
  link.rel = 'stylesheet';
  link.href = SIGNATURE_FONT_HREF;
  document.head.appendChild(link);
}

/** Rasterizes a typed name in the chosen signature font into a PNG data
 * URL — submitted and stamped onto the final PDF exactly like a drawn
 * signature would be, so nothing downstream needs to know the difference. */
export async function renderTypedSignature(name: string, fontFamily: string): Promise<string> {
  await document.fonts.load(`64px "${fontFamily}"`);
  await document.fonts.ready;

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 160;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#111827';
  ctx.font = `64px "${fontFamily}", cursive`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, canvas.width / 2, canvas.height / 2);
  return canvas.toDataURL('image/png');
}
