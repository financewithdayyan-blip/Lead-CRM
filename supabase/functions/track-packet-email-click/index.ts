// Edge Function: track-packet-email-click
//
// The CTA button and fallback link in a packet-share email both point here
// instead of straight at the packet, so "did they click through" is a real
// server-recorded fact rather than an inference from packet_views (whose
// viewer_token is a single value per browser across every packet it has
// ever visited, not something this send could reliably seed). Hit directly
// by the recipient's mail client/browser — GET, no CORS needed, and it must
// never surface a JSON error page since there is no app to render one.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const HOME_URL = 'https://www.bluebirdacquisition.com/';

function redirect(url: string) {
  return new Response(null, { status: 302, headers: { Location: url } });
}

Deno.serve(async (req) => {
  try {
    const token = new URL(req.url).searchParams.get('t');
    if (!token) return redirect(HOME_URL);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: share } = await admin
      .from('packet_email_shares')
      .select('id, link_clicked_at, link_click_count, deal_packets(slug)')
      .eq('tracking_token', token)
      .maybeSingle();

    // An unrecognized token (link forwarded oddly, or already expired somehow)
    // still deserves somewhere real to land — home, not a dead end.
    const slug = (share as any)?.deal_packets?.slug as string | undefined;
    if (!share || !slug) return redirect(HOME_URL);

    await admin
      .from('packet_email_shares')
      .update({
        link_clicked_at: share.link_clicked_at ?? new Date().toISOString(),
        link_click_count: (share.link_click_count ?? 0) + 1,
      })
      .eq('id', share.id);

    return redirect(`https://www.bluebirdacquisition.com/crm/deal/${slug}`);
  } catch {
    // Never let a tracking failure block the recipient from reaching the deal.
    return redirect(HOME_URL);
  }
});
