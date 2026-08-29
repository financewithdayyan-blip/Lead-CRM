import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { geoAlbersUsa, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import usStates from 'us-atlas/states-10m.json';
import { geocodeAddress } from '@/lib/geocode';
import { useCityGeocodes, useUpsertCityGeocode, cityGeoKey } from '@/hooks/useCityGeocodes';
import { useZipGeocodes } from '@/hooks/useZipGeocodes';

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
// Drill-down zoom window, in the same projected units as WIDTH/HEIGHT —
// wide enough to comfortably fit a whole metro's zip-code spread.
const ZOOM_SIZE = 90;

const pct = (n: number) => `${Math.round(n * 100)}%`;

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
 * Clicking a city zooms into its own zip codes (positions from the
 * offline-backfilled zip_geocodes cache — see useZipGeocodes) using the
 * exact same projection, just a cropped viewBox — so a zip's dot never
 * drifts relative to the state outlines under it.
 */
export function CityPerformanceMap({ cities }: { cities: CityStat[] }) {
  const { data: cityGeocodes = new Map() } = useCityGeocodes();
  const upsertCityGeocode = useUpsertCityGeocode();
  const { data: zipGeocodes = new Map() } = useZipGeocodes();
  const [hover, setHover] = useState<{ label: string; tier: Tier; total: number; qualified: number; qualifyRate: number; replied: number; replyRate: number; x: number; y: number } | null>(null);
  const [visibleTiers, setVisibleTiers] = useState<Set<Tier>>(new Set(ALL_TIERS));
  const [selectedCity, setSelectedCity] = useState<CityStat | null>(null);
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

  const { statePaths, project } = useMemo(() => {
    const topology = usStates as unknown as Topology;
    const geo = feature(topology, topology.objects.states as GeometryCollection);
    const features = 'features' in geo ? geo.features : [geo];
    const projection = geoAlbersUsa().fitSize([WIDTH, HEIGHT], geo as any);
    const pathGen = geoPath(projection);
    const paths = features.map((f) => ({ id: String(f.id), d: pathGen(f as any) ?? '' })).filter((p) => p.d);
    return { statePaths: paths, project: (lng: number, lat: number) => projection([lng, lat]) };
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
        return { stat, x: point[0], y: point[1], r: radiusFor(stat.total) };
      })
      .filter((p): p is { stat: CityStat; x: number; y: number; r: number } => p !== null)
      // Smaller circles drawn last so a big city's bubble never fully buries a
      // small nearby one.
      .sort((a, b) => b.r - a.r);
  }, [cities, cityGeocodes, project, visibleTiers]);

  const cityCenter = selectedCity ? cityGeocodes.get(cityGeoKey(selectedCity.city, selectedCity.state)) : null;
  const cityCenterPoint = cityCenter ? project(cityCenter.lng, cityCenter.lat) : null;

  const zipTierCounts = useMemo(() => {
    const counts: Record<Tier, number> = { green: 0, yellow: 0, red: 0 };
    if (!selectedCity) return counts;
    for (const z of selectedCity.zips) counts[z.tier]++;
    return counts;
  }, [selectedCity]);

  const plottedZips = useMemo(() => {
    if (!selectedCity) return [];
    const maxTotal = Math.max(...selectedCity.zips.map((z) => z.total), 1);
    const radiusFor = (total: number) => 1.5 + 5.5 * Math.sqrt(total / maxTotal);
    return selectedCity.zips
      .filter((z) => visibleTiers.has(z.tier))
      .map((stat) => {
        const geo = zipGeocodes.get(stat.zip5);
        if (!geo) return null;
        const point = project(geo.lng, geo.lat);
        if (!point) return null;
        return { stat, x: point[0], y: point[1], r: radiusFor(stat.total) };
      })
      .filter((p): p is { stat: ZipStat; x: number; y: number; r: number } => p !== null)
      .sort((a, b) => b.r - a.r);
  }, [selectedCity, zipGeocodes, project, visibleTiers]);

  const viewBox = useMemo(() => {
    if (!selectedCity || !cityCenterPoint) return `0 0 ${WIDTH} ${HEIGHT}`;
    const x = Math.max(0, Math.min(WIDTH - ZOOM_SIZE, cityCenterPoint[0] - ZOOM_SIZE / 2));
    const y = Math.max(0, Math.min(HEIGHT - ZOOM_SIZE, cityCenterPoint[1] - ZOOM_SIZE / 2));
    return `${x} ${y} ${ZOOM_SIZE} ${ZOOM_SIZE}`;
  }, [selectedCity, cityCenterPoint]);

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

      <svg ref={svgRef} viewBox={viewBox} className="h-auto w-full">
        <g>
          {statePaths.map((p) => (
            <path key={p.id} d={p.d} fill={STATE_FILL} stroke={STATE_STROKE} strokeWidth={selectedCity ? 0.3 : 1} strokeLinejoin="round" />
          ))}
        </g>
        {!selectedCity ? (
          <g>
            {plottedCities.map(({ stat, x, y, r }) => (
              <circle
                key={`${stat.cityKey}-${stat.stateKey}`}
                cx={x}
                cy={y}
                r={r}
                fill={TIER_COLOR[stat.tier]}
                fillOpacity={0.62}
                stroke={TIER_COLOR[stat.tier]}
                strokeWidth={1.25}
                onMouseEnter={(e) => handleEnter(e, { label: `${stat.city}, ${stat.state}`, ...stat })}
                onMouseMove={(e) => handleEnter(e, { label: `${stat.city}, ${stat.state}`, ...stat })}
                onMouseLeave={() => setHover(null)}
                onClick={() => {
                  setHover(null);
                  setSelectedCity(stat);
                }}
                className="cursor-pointer transition-opacity hover:!fill-opacity-90"
              />
            ))}
          </g>
        ) : (
          <g>
            {plottedZips.map(({ stat, x, y, r }) => (
              <circle
                key={stat.zip5}
                cx={x}
                cy={y}
                r={r}
                fill={TIER_COLOR[stat.tier]}
                fillOpacity={0.62}
                stroke={TIER_COLOR[stat.tier]}
                strokeWidth={0.4}
                onMouseEnter={(e) => handleEnter(e, { label: stat.zip5, ...stat })}
                onMouseMove={(e) => handleEnter(e, { label: stat.zip5, ...stat })}
                onMouseLeave={() => setHover(null)}
                className="cursor-pointer transition-opacity hover:!fill-opacity-90"
              />
            ))}
          </g>
        )}
      </svg>

      {selectedCity && plottedZips.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-[13px] text-text-3">
          Not enough zip-level data for {selectedCity.city} yet.
        </div>
      )}

      {hover && (
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
          {selectedCity ? 'Circle size = leads contacted in this zip' : 'Circle size = leads contacted · click a city to see its zip codes'}
        </span>
      </div>
    </div>
  );
}
