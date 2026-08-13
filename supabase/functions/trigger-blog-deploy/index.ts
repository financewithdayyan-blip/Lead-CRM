// Edge Function: trigger-blog-deploy
//
// Called only by the pg_net trigger on blog_posts (0082) whenever a post's
// published-ness changes — never by a browser. Its one job is forwarding
// that event to Vercel's Deploy Hook so the static blog pages (built by
// scripts/generate-blog.mjs) actually regenerate and go live. Guarded by a
// shared secret rather than JWT verification since the caller is Postgres,
// not a logged-in user — same category as send-reminders/ai-reply-review.
const VERCEL_DEPLOY_HOOK_URL = Deno.env.get('VERCEL_DEPLOY_HOOK_URL')!;
const INTERNAL_SECRET = Deno.env.get('BLOG_DEPLOY_TRIGGER_SECRET')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  if (req.headers.get('x-internal-secret') !== INTERNAL_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }

  try {
    const res = await fetch(VERCEL_DEPLOY_HOOK_URL, { method: 'POST' });
    return json({ ok: res.ok, status: res.status });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unexpected error' }, 500);
  }
});
