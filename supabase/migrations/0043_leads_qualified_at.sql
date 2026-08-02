-- ── Qualified-at timestamp ───────────────────────────────────────────────
-- There's no historical stage-transition log ('stage_change' activities are
-- defined in the type system but nothing has ever written one), so a
-- "leads qualified over time" chart has no event data to plot. This adds
-- exactly the one timestamp needed for that: set once, the first time a
-- lead's stage enters the qualified-or-beyond part of the pipeline, however
-- it gets there — AI qualification, a manual Kanban drag, anything that
-- updates stage. Never overwritten afterward, so it always reflects the
-- first time this lead qualified, not the most recent stage change.
alter table public.leads add column if not exists qualified_at timestamptz;

create or replace function public.handle_qualified_at()
returns trigger
language plpgsql
as $$
begin
  if NEW.stage in ('initial_contact', 'followup', 'negotiation', 'contract')
     and NEW.qualified_at is null
     and (TG_OP = 'INSERT' or OLD.stage not in ('initial_contact', 'followup', 'negotiation', 'contract'))
  then
    NEW.qualified_at := now();
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_qualified_at on public.leads;
create trigger trg_qualified_at
  before insert or update of stage on public.leads
  for each row execute function public.handle_qualified_at();

-- Backfill: leads that qualified before this column existed have no real
-- "first qualified" moment to recover, so updated_at is used as the closest
-- available proxy rather than leaving them permanently absent from any
-- qualified-over-time chart.
update public.leads
set qualified_at = updated_at
where stage in ('initial_contact', 'followup', 'negotiation', 'contract')
  and qualified_at is null;
