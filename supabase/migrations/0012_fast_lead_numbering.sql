-- set_lead_num() previously ran `select max(lead_num) from leads where
-- user_id = ...` for every single inserted row, so a bulk CSV import (one
-- statement, hundreds of rows) re-scanned that user's leads once per row -
-- slow enough to hit Postgres's statement_timeout on large imports. Track
-- each user's next number on their profile instead, so assigning one is a
-- single indexed row update (O(1)) instead of a growing per-row scan (O(n)).

alter table public.profiles add column next_lead_num int not null default 1;

update public.profiles p
set next_lead_num = coalesce((select max(l.lead_num) + 1 from public.leads l where l.user_id = p.id), 1);

create or replace function public.set_lead_num()
returns trigger
language plpgsql
as $$
begin
  if new.lead_num is null then
    update public.profiles
       set next_lead_num = next_lead_num + 1
     where id = new.user_id
     returning next_lead_num - 1 into new.lead_num;
  end if;
  return new;
end;
$$;
