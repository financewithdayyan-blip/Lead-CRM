-- Lead Profile redesign, Phase 1 (Overview/Property tabs + sidebar).
-- All additive/nullable — zero backfill risk, zero impact on existing rows.
alter table public.leads
  add column if not exists mortgage_balance numeric,
  add column if not exists monthly_payment numeric,
  add column if not exists back_taxes numeric,
  add column if not exists occupancy text check (occupancy in ('owner_occupied', 'tenant_occupied', 'vacant')),
  add column if not exists solution text,
  add column if not exists next_step text,
  add column if not exists preferred_contact_method text check (preferred_contact_method in ('call', 'text', 'email')),
  add column if not exists best_time_to_contact text;
