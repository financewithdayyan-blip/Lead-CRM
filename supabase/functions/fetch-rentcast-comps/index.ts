// Edge Function: fetch-rentcast-comps
//
// AI Comping — backs the "AI Comping" button on the Underwriting tab's
// Comparable Sales card. Admin-only, real logged-in session (same posture
// as create-contract-instance: caller-scoped client for auth.getUser(),
// then the service-role client for everything else). The RentCast key
// lives here only — never shipped to the browser.
//
// Three RentCast calls, each returning genuinely different data
// (confirmed directly against the live API before building this):
//   - /v1/avm/value's own `comparables` array is LISTING data (status:
//     Active/Inactive — currently or recently for-sale). Hard-capped at
//     25 by RentCast itself regardless of what's requested (confirmed:
//     compCount=50 still returns exactly 25) — not a limit this function
//     is imposing.
//   - /v1/avm/rent/long-term is the same shape, for active RENTAL
//     listings instead of for-sale ones (comparables[].price is monthly
//     rent) — also hard-capped at 25.
//   - /v1/properties returns real recorded lastSaleDate/lastSalePrice per
//     nearby property (county-recorder data) — genuine sold comps. Per
//     RentCast's own recommendation (developers.rentcast.io/reference),
//     this call uses `address` + `radius` (not raw lat/lng) plus
//     `saleDateRange` (days) and the subject's own `propertyType` — an
//     earlier, unfiltered radius-only version of this call pulled in
//     decade-old, often-implausible-price county records (a real $500
//     "sale" turned out to be a non-arms-length transfer, not a comp).
//     Fixed to the trailing 365 days and a high limit — confirmed this
//     radius/window only ever has ~180 real records, nowhere near the
//     500 cap, so nothing is being truncated here.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const RENTCAST_API_KEY = Deno.env.get('RENTCAST_API_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

const FETCH_TIMEOUT_MS = 15_000;
const SOLD_RADIUS_MILES = 1;
const SOLD_LIMIT = 500;
// Trailing 12 months, not a shorter default — "show everything sold this
// year" was the explicit ask, not a thin recent-only slice.
const SALE_DATE_RANGE_DAYS = 365;
// A recorded "sale" under this is essentially always a non-arms-length
// transfer (quitclaim, foreclosure buy-back, intra-family transfer for
// $1/$10/$500) — real county data, but not a usable comp.
const MIN_PLAUSIBLE_SALE_PRICE = 10_000;

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

async function rentcastFetch(path: string, params: Record<string, string>) {
  const url = new URL(`https://api.rentcast.io/v1${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { 'X-Api-Key': RENTCAST_API_KEY },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`RentCast ${path} failed (${res.status}): ${await res.text()}`);
  return res.json();
}

interface NormalizedComp {
  id: string;
  address: string | null;
  price: number | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  lat: number;
  lng: number;
  distanceMiles: number | null;
  date: string | null;
  status: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });

    const { data: userData } = await callerClient.auth.getUser();
    if (!userData?.user?.id) return json({ error: 'Not signed in.' }, 401);

    const { data: profile } = await admin.from('profiles').select('role').eq('id', userData.user.id).single();
    if (profile?.role !== 'admin') return json({ error: 'Admins only.' }, 403);

    const { address } = await req.json();
    if (!address || typeof address !== 'string') return json({ error: 'Missing address' }, 400);

    const avm = await rentcastFetch('/avm/value', { address, compCount: '25' });
    const subjectLat = avm.latitude as number | undefined;
    const subjectLng = avm.longitude as number | undefined;
    if (subjectLat == null || subjectLng == null) {
      return json({ error: "Couldn't locate this address — check it's complete (street, city, state, zip)." }, 422);
    }

    const listingComps: NormalizedComp[] = ((avm.comparables ?? []) as any[])
      .filter((c) => c.latitude != null && c.longitude != null)
      .map((c) => ({
        id: c.id,
        address: c.formattedAddress ?? null,
        price: c.price ?? null,
        sqft: c.squareFootage ?? null,
        beds: c.bedrooms ?? null,
        baths: c.bathrooms ?? null,
        lat: c.latitude,
        lng: c.longitude,
        distanceMiles: typeof c.distance === 'number' ? Math.round(c.distance * 100) / 100 : null,
        date: c.listedDate ?? null,
        status: c.status ?? null,
      }));

    const subjectPropertyType = avm.subjectProperty?.propertyType as string | undefined;

    let soldComps: NormalizedComp[] = [];
    try {
      const nearby = (await rentcastFetch('/properties', {
        address,
        radius: String(SOLD_RADIUS_MILES),
        saleDateRange: String(SALE_DATE_RANGE_DAYS),
        limit: String(SOLD_LIMIT),
        ...(subjectPropertyType ? { propertyType: subjectPropertyType } : {}),
      })) as any[];
      soldComps = nearby
        .filter(
          (p) =>
            p.lastSalePrice != null &&
            p.lastSalePrice >= MIN_PLAUSIBLE_SALE_PRICE &&
            p.lastSaleDate != null &&
            p.latitude != null &&
            p.longitude != null,
        )
        .map((p) => ({
          id: p.id,
          address: p.formattedAddress ?? null,
          price: p.lastSalePrice,
          sqft: p.squareFootage ?? null,
          beds: p.bedrooms ?? null,
          baths: p.bathrooms ?? null,
          lat: p.latitude,
          lng: p.longitude,
          distanceMiles: Math.round(haversineMiles(subjectLat, subjectLng, p.latitude, p.longitude) * 100) / 100,
          date: p.lastSaleDate,
          status: 'Sold',
        }))
        .sort((a, b) => (a.distanceMiles ?? 0) - (b.distanceMiles ?? 0));
    } catch (e) {
      // Sold comps are a "nice to have" second call — a failure here
      // shouldn't take down the listing comps that already succeeded.
      console.error('RentCast /properties (sold comps) failed:', e);
    }

    let rentalComps: NormalizedComp[] = [];
    try {
      const rent = await rentcastFetch('/avm/rent/long-term', { address, compCount: '25' });
      rentalComps = ((rent.comparables ?? []) as any[])
        .filter((c) => c.latitude != null && c.longitude != null)
        .map((c) => ({
          id: c.id,
          address: c.formattedAddress ?? null,
          price: c.price ?? null,
          sqft: c.squareFootage ?? null,
          beds: c.bedrooms ?? null,
          baths: c.bathrooms ?? null,
          lat: c.latitude,
          lng: c.longitude,
          distanceMiles: typeof c.distance === 'number' ? Math.round(c.distance * 100) / 100 : null,
          date: c.listedDate ?? null,
          status: c.status ?? null,
        }));
    } catch (e) {
      // Same "nice to have, don't take down the rest" treatment as sold comps.
      console.error('RentCast /avm/rent/long-term (rental comps) failed:', e);
    }

    return json({
      subject: { lat: subjectLat, lng: subjectLng },
      listingComps,
      soldComps,
      rentalComps,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unexpected error' }, 500);
  }
});
