export const SIGNATURE_FONT = 'Great Vibes';
const SIGNATURE_FONT_HREF = 'https://fonts.googleapis.com/css2?family=Great+Vibes&display=swap';

/** Injects the signature font's stylesheet once per page load — only the
 * public signing page needs it, so it's loaded on demand rather than
 * globally in index.html. */
export function loadSignatureFont() {
  if (document.getElementById('signature-font-link')) return;
  const link = document.createElement('link');
  link.id = 'signature-font-link';
  link.rel = 'stylesheet';
  link.href = SIGNATURE_FONT_HREF;
  document.head.appendChild(link);
}

/** Rasterizes a typed name in the signature font into a PNG data URL —
 * submitted and stamped onto the final PDF exactly like a drawn signature
 * would be, so nothing downstream needs to know the difference. */
export async function renderTypedSignature(name: string): Promise<string> {
  await document.fonts.load(`64px "${SIGNATURE_FONT}"`);
  await document.fonts.ready;

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 160;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#111827';
  ctx.font = `64px "${SIGNATURE_FONT}", cursive`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, canvas.width / 2, canvas.height / 2);
  return canvas.toDataURL('image/png');
}
