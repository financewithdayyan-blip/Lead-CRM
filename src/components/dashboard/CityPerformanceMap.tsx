import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { geoAlbersUsa, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import usStates from 'us-atlas/states-10m.json';
import { geocodeAddress } from '@/lib/geocode';
import { useCityGeocodes, useUpsertCityGeocode, cityGeoKey } from '@/hooks/useCityGeocodes';
import { useZipGeocodes } from '@/hooks/useZipGeocodes';
import { fetchPlaceBoundaries, placeGeoKey, type PlaceGeometry } from '@/lib/placeBoundaries';
import { CityZipMap } from './CityZipMap';

export type Tier = 'green' | 'yellow' | 'red';

export interface ZipStat {
  zip5: string;
  city: string;
  state: string;
  total: number;
  qualified: number;
  qualifyRate: number;
  replied: number;
  replyRate: number;
  score: number;
  tier: Tier;
}

export interface CityStat {
  cityKey: string;
  stateKey: string;
  city: string;
  state: string;
  total: number;
  qualified: number;
  qualifyRate: number;
  replied: number;
  replyRate: number;
  score: number;
  tier: Tier;
  zips: ZipStat[];
}

const TIER_COLOR: Record<Tier, string> = {
  green: '#22c55e',
  yellow: '#eab308',
  red: '#ef4444',
};
const TIER_LABEL: Record<Tier, string> = {
  green: 'Performing market',
  yellow: 'Fair market',
  red: 'Poor market',
};
const ALL_TIERS: Tier[] = ['green', 'yellow', 'red'];

// A fixed illustrative canvas (not a pannable/zoomable real map) — same
// aspect ratio d3's own US examples use, scaled responsively via viewBox.
const WIDTH = 960;
const HEIGHT = 600;
const STATE_FILL = '#102338';
const STATE_STROKE = '#1f3a57';

const pct = (n: number) => `${Math.round(n * 100)}%`;

// A single city's projected footprint should never come close to spanning
// the whole national canvas — a defensive cap against degenerate geometry.
// Simplifying a small village's boundary too aggressively (or a bad ring
// from the source data) can produce a self-intersecting/inverted shape that
// SVG's fill rule then paints as covering nearly the entire viewBox instead
// of the tiny real place it's supposed to be — caught here by bounding-box
// size rather than trusting every path blindly; a rejected boundary falls
// back to the plain circle marker.
const MAX_CITY_PATH_SPAN = 200;

function sanePathFor(pathGen: ReturnType<typeof geoPath>, geometry: PlaceGeometry): string | null {
  const d = pathGen(geometry as any);
  if (!d) return null;
  const bounds = pathGen.bounds(geometry as any);
  const [[x0, y0], [x1, y1]] = bounds;
  const w = x1 - x0;
  const h = y1 - y0;
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  if (w > MAX_CITY_PATH_SPAN || h > MAX_CITY_PATH_SPAN) return null;
  return d;
}

/**
 * A stylized, self-contained US map (state outlines drawn from a bundled
 * TopoJSON via d3-geo's Albers USA projection — the projection that insets
 * Alaska/Hawaii the way the reference image showed, no basemap tiles, no
 * network map requests) with one circle per city that has enough contacted
 * leads to mean something — `cities` (built in DashboardPage) is already
 * scoped to leads actually approached (stage !== 'new'), so the ~4k cold,
 * untouched leads never dilute a city's rates. Every state is the same
 * neutral navy — states carry no data of their own here, they're just the
 * backdrop; the circles do all the talking: size = leads contacted
 * (sqrt-scaled, so area tracks count), color = a green/yellow/red
 * performance tier computed upstream from qualify rate + reply rate.
 * Coordinates come from the shared city_geocodes cache; a city missing one
 * gets geocoded here in the background and written back so every later
 * load (any user) has it without hitting the free geocoders again.
 *
 * Cities are shaded by their own real municipal boundary (from TIGERweb's
 * Incorporated Places, falling back to Census Designated Places) rather
 * than a plain circle — the same choropleth-by-real-shape treatment the
 * zip drill-down already uses, just one level up. A city TIGERweb has
 * neither for falls back to a circle at its geocoded point.
 *
 * Clicking a city swaps this stylized overview for CityZipMap — a real,
 * tile-based street map — since telling a city's own zip codes apart needs
 * actual road/neighborhood context this map's national-scale abstraction
 * deliberately doesn't have. Zip positions come from the offline-backfilled
 * zip_geocodes cache (see useZipGeocodes).
 */
export function CityPerformanceMap({ cities }: { cities: CityStat[] }) {
  const { data: cityGeocodes = new Map() } = useCityGeocodes();
  const upsertCityGeocode = useUpsertCityGeocode();
  const { data: zipGeocodes = new Map() } = useZipGeocodes();
  const [hover, setHover] = useState<{ label: string; tier: Tier; total: number; qualified: number; qualifyRate: number; replied: number; replyRate: number; x: number; y: number } | null>(null);
  const [visibleTiers, setVisibleTiers] = useState<Set<Tier>>(new Set(ALL_TIERS));
  const [selectedCity, setSelectedCity] = useState<CityStat | null>(null);
  const [placeBoundaries, setPlaceBoundaries] = useState<Map<string, PlaceGeometry>>(new Map());
  const svgRef = useRef<SVGSVGElement>(null);

  function toggleTier(tier: Tier) {
    setVisibleTiers((prev) => {
      const next = new Set(prev);
      if (next.has(tier)) next.delete(tier);
      else next.add(tier);
      return next;
    });
  }

  useEffect(() => {
    const missing = cities.filter((c) => !cityGeocodes.has(cityGeoKey(c.city, c.state))).slice(0, 25);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const c of missing) {
        if (cancelled) return;
        const point = await geocodeAddress(`${c.city}, ${c.state}`).catch(() => null);
        if (point && !cancelled) {
          upsertCityGeocode.mutate({ city: c.city, state: c.state, lat: point.lat, lng: point.lng });
        }
        await new Promise((r) => setTimeout(r, 1100));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(cities.map((c) => c.cityKey + c.stateKey)), cityGeocodes.size]);

  useEffect(() => {
    if (cities.length === 0) return;
    let cancelled = false;
    fetchPlaceBoundaries(cities.map((c) => ({ city: c.city, state: c.state }))).then((found) => {
      if (!cancelled) setPlaceBoundaries(found);
    });
    return () => {
      cancelled = true;
    };
    // Keyed on the cities' own identities (not the `cities` array reference)
    // — DashboardPage recomputes cityStats as a fresh array on unrelated
    // re-renders (date range, SMS range, any other dashboard state), which
    // was re-triggering this fetch (and cancelling the previous one, via
    // the cleanup above) before it ever got a chance to resolve, so
    // placeBoundaries stayed empty and every city fell back to a circle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(cities.map((c) => c.cityKey + c.stateKey))]);

  const { statePaths, project, pathGen } = useMemo(() => {
    const topology = usStates as unknown as Topology;
    const geo = feature(topology, topology.objects.states as GeometryCollection);
    const features = 'features' in geo ? geo.features : [geo];
    const projection = geoAlbersUsa().fitSize([WIDTH, HEIGHT], geo as any);
    const pathGenerator = geoPath(projection);
    const paths = features.map((f) => ({ id: String(f.id), d: pathGenerator(f as any) ?? '' })).filter((p) => p.d);
    return { statePaths: paths, project: (lng: number, lat: number) => projection([lng, lat]), pathGen: pathGenerator };
  }, []);

  const cityTierCounts = useMemo(() => {
    const counts: Record<Tier, number> = { green: 0, yellow: 0, red: 0 };
    for (const c of cities) counts[c.tier]++;
    return counts;
  }, [cities]);

  const plottedCities = useMemo(() => {
    const maxTotal = Math.max(...cities.map((c) => c.total), 1);
    const radiusFor = (total: number) => 4 + 15 * Math.sqrt(total / maxTotal);
    return cities
      .filter((stat) => visibleTiers.has(stat.tier))
      .map((stat) => {
        const geo = cityGeocodes.get(cityGeoKey(stat.city, stat.state));
        if (!geo) return null;
        const point = project(geo.lng, geo.lat);
        if (!point) return null;
        const boundary = placeBoundaries.get(placeGeoKey(stat.city, stat.state));
        const d = boundary ? sanePathFor(pathGen, boundary) : null;
        return { stat, x: point[0], y: point[1], r: radiusFor(stat.total), d };
      })
      .filter((p): p is { stat: CityStat; x: number; y: number; r: number; d: string | null } => p !== null)
      // Smaller circles/shapes drawn last so a big city never fully buries a
      // small nearby one.
      .sort((a, b) => b.r - a.r);
  }, [cities, cityGeocodes, project, pathGen, placeBoundaries, visibleTiers]);

  const zipTierCounts = useMemo(() => {
    const counts: Record<Tier, number> = { green: 0, yellow: 0, red: 0 };
    if (!selectedCity) return counts;
    for (const z of selectedCity.zips) counts[z.tier]++;
    return counts;
  }, [selectedCity]);

  const zipMarkers = useMemo(() => {
    if (!selectedCity) return [];
    return selectedCity.zips
      .filter((z) => visibleTiers.has(z.tier))
      .map((stat) => {
        const geo = zipGeocodes.get(stat.zip5);
        return geo ? { ...stat, lat: geo.lat, lng: geo.lng } : null;
      })
      .filter((z): z is ZipStat & { lat: number; lng: number } => z !== null);
  }, [selectedCity, zipGeocodes, visibleTiers]);

  function handleEnter(e: React.MouseEvent, entry: { label: string; tier: Tier; total: number; qualified: number; qualifyRate: number; replied: number; replyRate: number }) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ ...entry, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  const tierCounts = selectedCity ? zipTierCounts : cityTierCounts;

  return (
    <div className="relative">
      {selectedCity && (
        <button
          onClick={() => {
            setSelectedCity(null);
            setHover(null);
          }}
          className="mb-2 flex items-center gap-1.5 rounded-full border border-border-2 bg-surface-3 px-3 py-1.5 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
        >
          <ArrowLeft size={13} /> Back to national map
          <span className="text-text-3">— {selectedCity.city}, {selectedCity.state} by zip code</span>
        </button>
      )}

      {selectedCity ? (
        <CityZipMap zips={zipMarkers} cityLabel={`${selectedCity.city}, ${selectedCity.state}`} />
      ) : (
        <svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full">
          <g>
            {statePaths.map((p) => (
              <path key={p.id} d={p.d} fill={STATE_FILL} stroke={STATE_STROKE} strokeWidth={1} strokeLinejoin="round" />
            ))}
          </g>
          <g>
            {plottedCities.map(({ stat, x, y, r, d }) => {
              const handlers = {
                onMouseEnter: (e: React.MouseEvent) => handleEnter(e, { label: `${stat.city}, ${stat.state}`, ...stat }),
                onMouseMove: (e: React.MouseEvent) => handleEnter(e, { label: `${stat.city}, ${stat.state}`, ...stat }),
                onMouseLeave: () => setHover(null),
                onClick: () => {
                  setHover(null);
                  setSelectedCity(stat);
                },
              };
              return d ? (
                <path
                  key={`${stat.cityKey}-${stat.stateKey}`}
                  d={d}
                  fill={TIER_COLOR[stat.tier]}
                  fillOpacity={0.55}
                  stroke={TIER_COLOR[stat.tier]}
                  strokeWidth={1.25}
                  strokeLinejoin="round"
                  className="cursor-pointer transition-opacity hover:!fill-opacity-80"
                  {...handlers}
                />
              ) : (
                <circle
                  key={`${stat.cityKey}-${stat.stateKey}`}
                  cx={x}
                  cy={y}
                  r={r}
                  fill={TIER_COLOR[stat.tier]}
                  fillOpacity={0.62}
                  stroke={TIER_COLOR[stat.tier]}
                  strokeWidth={1.25}
                  className="cursor-pointer transition-opacity hover:!fill-opacity-90"
                  {...handlers}
                />
              );
            })}
          </g>
        </svg>
      )}

      {!selectedCity && hover && (
        <div
          className="pointer-events-none absolute z-10 min-w-[150px] rounded-lg border px-3 py-2 text-[12px] shadow-lg"
          style={{
            left: Math.min(hover.x + 12, WIDTH - 160),
            top: Math.max(hover.y - 12, 0),
            background: '#0b1826',
            borderColor: STATE_STROKE,
            color: '#e2e8f0',
          }}
        >
          <div className="font-semibold">{hover.label}</div>
          <div className="mt-0.5 font-semibold" style={{ color: TIER_COLOR[hover.tier] }}>
            {TIER_LABEL[hover.tier]}
          </div>
          <div className="mt-1 space-y-0.5 text-slate-300">
            <div>{hover.total} contacted</div>
            <div>{hover.qualified} qualified ({pct(hover.qualifyRate)})</div>
            <div>{hover.replied} replied ({pct(hover.replyRate)})</div>
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
        {ALL_TIERS.map((t) => {
          const active = visibleTiers.has(t);
          return (
            <button
              key={t}
              type="button"
              onClick={() => toggleTier(t)}
              aria-pressed={active}
              title={active ? `Hide ${TIER_LABEL[t].toLowerCase()}` : `Show ${TIER_LABEL[t].toLowerCase()}`}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors ${
                active ? 'border-transparent bg-surface-3 text-text-2' : 'border-border-2 text-text-3 opacity-50 hover:opacity-75'
              }`}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: TIER_COLOR[t] }} />
              {TIER_LABEL[t]}
              <span className="font-mono tabular-nums text-text-3">{tierCounts[t]}</span>
            </button>
          );
        })}
        <span className="ml-1 text-text-3">
          {selectedCity
            ? 'Circle size = leads contacted in this zip · click a circle for details'
            : 'Shaded by real city boundary where available (circle = boundary not found) · click a city to see its zip codes'}
        </span>
      </div>
    </div>
  );
}
