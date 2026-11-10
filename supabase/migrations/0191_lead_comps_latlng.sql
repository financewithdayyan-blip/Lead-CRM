-- AI Comping (RentCast): comps pulled from the API carry real coordinates,
-- needed to plot them on the picker map. Manually-typed comps simply leave
-- these null, same as every other optional column here. packet_comps
-- already has this exact pair — lead_comps never did.
alter table public.lead_comps add column if not exists lat double precision;
alter table public.lead_comps add column if not exists lng double precision;
