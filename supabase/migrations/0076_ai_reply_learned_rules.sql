-- Lets ai-reply learn from its own mistakes over time without a human
-- reviewing every conversation: a nightly job (ai-reply-review) reads what
-- the AI got wrong and appends narrow, additive rules here, rather than ever
-- touching the hand-authored SYSTEM_RULES constant in ai-reply/index.ts —
-- which keeps hard invariants (never state/confirm a price, opt-out/STOP
-- handling) completely out of reach of anything automated. ai-reply reads
-- these back in and appends them to its prompt as a section the review job
-- can grow; the core prompt text itself is never rewritten by anything but
-- a real code change and deploy.
create table public.ai_reply_learned_rules (
  id uuid primary key default gen_random_uuid(),
  rule_text text not null,
  source_lead_id uuid references public.leads(id) on delete set null,
  reasoning text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.ai_reply_learned_rules enable row level security;

create policy "ai_reply_learned_rules_all" on public.ai_reply_learned_rules
  for all using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- Audit trail for each nightly run. Not surfaced in the UI by design (the
-- review is meant to run quietly), but keeps a record in case a change in
-- the AI's behavior ever needs explaining after the fact.
create table public.ai_reply_review_log (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  conversations_reviewed int not null default 0,
  issues_found int not null default 0,
  rules_added int not null default 0,
  detail jsonb not null default '[]'::jsonb,
  error text
);

alter table public.ai_reply_review_log enable row level security;

create policy "ai_reply_review_log_all" on public.ai_reply_review_log
  for all using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');
