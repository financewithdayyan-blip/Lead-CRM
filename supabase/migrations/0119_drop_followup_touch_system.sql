-- Removes the 10-touch follow-up system entirely (0021, 0026) — the
-- schedule/lock/override UI, the auto-decline-at-touch-10 behavior, and the
-- underlying columns/trigger/RPC. Nothing reads or writes these anymore
-- (see the app-side removal in the same change).
drop trigger if exists trg_followup_start on public.leads;
drop function if exists public.handle_followup_start();
drop function if exists public.override_followup_early_exit(uuid);

alter table public.leads
  drop column if exists followup_start_date,
  drop column if exists touch_count,
  drop column if exists touch_dates,
  drop column if exists early_exit_override;
