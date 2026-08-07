-- The AI's new final qualification step asks the seller for a good time to
-- call them back tomorrow — this is where that answer lands, separate from
-- the existing next_follow_up (a plain date, manually set by an admin
-- anywhere in the pipeline) since this one carries a specific time and is
-- always AI-populated from a real conversation answer.
alter table public.leads
  add column scheduled_callback_at timestamptz,
  add column scheduled_callback_note text;
