-- Deal packets no longer disclose an exact location under any circumstance, so
-- the address-request flow and the stored street address are both removed
-- rather than left switched off. A column that is never read is still a copy of
-- the address sitting in a second table; dropping it is the only version of
-- "no one can get the exact location" that does not depend on application code
-- continuing to behave.
--
-- Area detail (city / state / zip) stays — that is what the packet displays,
-- and get_packet_area() still serves it.

drop function if exists public.get_packet_address(uuid, text);
drop function if exists public.get_my_address_request(uuid, text);
drop function if exists public.request_packet_address(uuid, text, text, text, text);
drop function if exists public.resolve_address_request(uuid, boolean);

drop table if exists public.packet_address_requests;

alter table public.deal_packets drop column if exists address;
