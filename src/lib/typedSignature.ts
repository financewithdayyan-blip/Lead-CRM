export interface SignatureFontOption {
  id: string;
  label: string;
  family: string;
}

/** Four distinct script styles to choose from — one flourished (Great
 * Vibes, the long-standing default), one casual/handwritten (Dancing
 * Script), one flowing brush script (Alex Brush), and one classic looping
 * cursive (Sacramento) — so a typed signature doesn't always look identical
 * regardless of who's signing. */
export const SIGNATURE_FONTS: SignatureFontOption[] = [
  { id: 'great-vibes', label: 'Great Vibes', family: 'Great Vibes' },
  { id: 'dancing-script', label: 'Dancing Script', family: 'Dancing Script' },
  { id: 'alex-brush', label: 'Alex Brush', family: 'Alex Brush' },
  { id: 'sacramento', label: 'Sacramento', family: 'Sacramento' },
];

const SIGNATURE_FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Great+Vibes&family=Dancing+Script&family=Alex+Brush&family=Sacramento&display=swap';

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
