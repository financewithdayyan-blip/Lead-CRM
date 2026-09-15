// Edge Function: track-packet-email-open
//
// Referenced as a hidden 1x1 image in every packet-share email. Recording
// the open is best-effort and must never delay or break the pixel itself —
// an email client that gets anything other than a fast, valid image where
// it expects one may render a broken-image icon, which is exactly the kind
// of visible glitch this is not allowed to cause. GET, no CORS needed.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// The standard 1x1 transparent tracking-pixel GIF.
const PIXEL_GIF = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='),
  (c) => c.charCodeAt(0),
);

function pixelResponse() {
  return new Response(PIXEL_GIF, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}

Deno.serve(async (req) => {
  try {
    const token = new URL(req.url).searchParams.get('t');
    if (!token) return pixelResponse();

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: share } = await admin
      .from('packet_email_shares')
      .select('id, email_opened_at, email_open_count')
      .eq('tracking_token', token)
      .maybeSingle();

    if (share) {
      await admin
        .from('packet_email_shares')
        .update({
          email_opened_at: share.email_opened_at ?? new Date().toISOString(),
          email_open_count: (share.email_open_count ?? 0) + 1,
        })
        .eq('id', share.id);
    }
  } catch {
    // Fall through — the pixel still has to come back regardless.
  }
  return pixelResponse();
});
