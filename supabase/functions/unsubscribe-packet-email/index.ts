// Edge Function: unsubscribe-packet-email
//
// One-click unsubscribe target for the "Unsubscribe" link in every
// deal-packet email (see send-packet-email). Reuses that send's own
// tracking_token — already unique per send, already safe to expose
// unauthenticated (see track-packet-email-click) — to resolve the real
// recipient address, rather than taking an email straight off the query
// string, so the link can never be used to suppress an arbitrary address
// that was never actually sent anything. GET only, hit directly by the
// recipient's mail client/browser — must never surface a bare JSON error,
// since there's no app around it to render one; always a plain confirmation
// page instead.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function page(title: string, message: string) {
  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:48px 16px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:14px;padding:32px;text-align:center;box-shadow:0 2px 4px rgba(11,30,51,.04),0 14px 32px -16px rgba(11,30,51,.16);">
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 20px;"><tr>
<td style="width:10px;height:10px;background:#0B1E33;border-radius:2px;"></td>
<td style="padding-left:8px;font-size:14px;font-weight:700;color:#0B1E33;">Bluebird Acquisition</td>
</tr></table>
<h1 style="margin:0 0 8px;font-size:18px;color:#0B1E33;">${title}</h1>
<p style="margin:0;font-size:14px;line-height:1.6;color:#45566B;">${message}</p>
</div>
</body>
</html>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

Deno.serve(async (req) => {
  try {
    const token = new URL(req.url).searchParams.get('t');
    if (!token) {
      return page('Link not recognized', "This unsubscribe link didn't include enough information to process. Reply to any deal email and ask to be removed instead.");
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: share } = await admin
      .from('packet_email_shares')
      .select('to_email')
      .eq('tracking_token', token)
      .maybeSingle();

    if (!share?.to_email) {
      return page('Link not recognized', "This unsubscribe link didn't match a known email. Reply to any deal email and ask to be removed instead.");
    }

    const email = share.to_email.trim().toLowerCase();
    await admin.from('packet_email_unsubscribes').upsert({ email }, { onConflict: 'email' });

    return page("You're unsubscribed", `${email} won't receive any more off-market deal emails from Bluebird Acquisition.`);
  } catch {
    return page('Something went wrong', 'Please reply to any deal email and ask to be removed instead.');
  }
});
