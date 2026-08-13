-- Fires a Vercel rebuild whenever a blog post's published-ness actually
-- changes, so hitting Publish in the CRM makes the post go live within a
-- couple minutes without anyone touching git or the Vercel dashboard. A DB
-- trigger rather than a client-side call from the admin UI on purpose: it
-- fires no matter which code path changes status (today's admin UI, a future
-- bulk-edit tool, a manual fix-up query) and can't be skipped by a closed
-- tab or a flaky browser request.
--
-- Same pg_net/Vault pattern as 0066 (send-daily-reminders) and 0077
-- (ai-reply-review) — the secret itself is never written into a migration
-- file, it's inserted once by hand:
--   select vault.create_secret('<random-string>', 'blog_deploy_trigger_secret');
-- pg_net/pg_cron extensions already enabled by 0065.
--
-- Draft-to-draft edits never fire a rebuild — only a status change that
-- actually affects what's live does. No debounce: rapid successive saves of
-- an already-published post each trigger a separate rebuild, which is
-- acceptable given expected posting frequency.
create or replace function public.handle_blog_deploy_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (TG_OP = 'INSERT' and NEW.status = 'published')
     or (TG_OP = 'UPDATE' and (NEW.status = 'published' or OLD.status = 'published'))
     or (TG_OP = 'DELETE' and OLD.status = 'published') then
    perform net.http_post(
      url := 'https://ggfpvrdxqopippzqkojr.supabase.co/functions/v1/trigger-blog-deploy',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'blog_deploy_trigger_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 15000
    );
  end if;
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_blog_deploy on public.blog_posts;
create trigger trg_blog_deploy
  after insert or update or delete on public.blog_posts
  for each row execute function public.handle_blog_deploy_trigger();
