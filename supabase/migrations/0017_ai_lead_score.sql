alter table public.leads
  add column if not exists ai_score int check (ai_score between 0 and 100),
  add column if not exists ai_score_reasoning text,
  add column if not exists ai_scored_at timestamptz;
