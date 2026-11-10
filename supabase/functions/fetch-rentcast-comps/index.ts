// Edge Function: fetch-rentcast-comps
//
// AI Comping — backs the "AI Comping" button on the Underwriting tab's
// Comparable Sales card. Admin-only, real logged-in session (same posture
// as create-contract-instance: caller-scoped client for auth.getUser(),
// then the service-role client for everything else). The RentCast key
// lives here only — never shipped to the browser.
//
// Two RentCast calls, not one, because they return genuinely different
// things (confirmed directly against the live API before building this,
// not assumed from docs):
//   - /v1/avm/value's own `comparables` array is LISTING data only
//     (status: Active/Inactive — currently or recently for-sale). No
//     confirmed closed-sale price appears here at all.
//   - /v1/properties by lat/lng/radius returns real recorded
//     lastSaleDate/lastSalePrice per nearby property (county-recorder
//     data) — genuine sold comps, but sparser and often older than the
//     listing data, and lastSalePrice is frequently absent even when
//     lastSaleDate is present.
// So "Listing Comps" in the UI comes from the first call, "Sold Comps"
// from the second, filtered here to rows that actually have both a sale
// date and a sale price — a record with only a date is useless as a comp.
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
const SOLD_LIMIT = 25;

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

    let soldComps: NormalizedComp[] = [];
    try {
      const nearby = (await rentcastFetch('/properties', {
        latitude: String(subjectLat),
        longitude: String(subjectLng),
        radius: String(SOLD_RADIUS_MILES),
        limit: String(SOLD_LIMIT),
      })) as any[];
      soldComps = nearby
        .filter((p) => p.lastSalePrice != null && p.lastSaleDate != null && p.latitude != null && p.longitude != null)
        .map((p) => ({
          id: p.id,
          address: p.formattedAddress ?? null,
          price: p.lastSalePrice,
          sqft: p.squareFootage ?? null,
          beds: p.bedrooms ?? null,
          baths: p.bathrooms ?? null,
          lat: p.latitude,
          lng: p.longitude,
          distanceMiles: null, // /properties doesn't return distance — computed client-side if needed
          date: p.lastSaleDate,
          status: 'Sold',
        }));
    } catch (e) {
      // Sold comps are a "nice to have" second call — a failure here
      // shouldn't take down the listing comps that already succeeded.
      console.error('RentCast /properties (sold comps) failed:', e);
    }

    return json({
      subject: { lat: subjectLat, lng: subjectLng },
      listingComps,
      soldComps,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unexpected error' }, 500);
  }
});
