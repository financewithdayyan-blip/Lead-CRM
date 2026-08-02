-- unique(user_id, tag_id) does not stop duplicate Default rows: Postgres never
-- treats NULL = NULL as a conflict for a unique constraint, so two rows with
-- the same user_id and tag_id IS NULL are both legal under that constraint,
-- and upsert(onConflict: 'user_id,tag_id') silently fails to match them and
-- inserts a second Default row instead of updating the first.
--
-- A partial unique index has no such exception — it enforces "one Default row
-- per admin" directly.
create unique index if not exists ai_reply_config_default_unique
  on public.ai_reply_config (user_id)
  where tag_id is null;
