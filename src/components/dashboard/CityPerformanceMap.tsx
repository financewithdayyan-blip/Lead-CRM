import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { geoAlbersUsa, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import usStates from 'us-atlas/states-10m.json';
import { geocodeAddress } from '@/lib/geocode';
import { useCityGeocodes, useUpsertCityGeocode, cityGeoKey } from '@/hooks/useCityGeocodes';
import { useZipGeocodes } from '@/hooks/useZipGeocodes';
import { STATE_FIPS } from '@/lib/placeBoundaries';
import { CityZipMap } from './CityZipMap';
import { StateCityMap } from './StateCityMap';

export type Tier = 'green' | 'yellow' | 'red';

export interface ContractProperty {
  id: string;
  address: string;
  city: string;
  state: string;
}

export interface ZipStat {
  zip5: string;
  city: string;
  state: string;
  total: number;
  qualified: number;
  qualifyRate: number;
  contracts: number;
  contractRate: number;
  replied: number;
  replyRate: number;
  score: number;
  tier: Tier;
  contractProperties: ContractProperty[];
}

export interface CityStat {
  cityKey: string;
  stateKey: string;
  city: string;
  state: string;
  total: number;
  qualified: number;
  qualifyRate: number;
  contracts: number;
  contractRate: number;
  replied: number;
  replyRate: number;
  score: number;
  tier: Tier;
  zips: ZipStat[];
}

export interface StateStat {
  stateKey: string;
  state: string;
  total: number;
  qualified: number;
  qualifyRate: number;
  contracts: number;
  contractRate: number;
  replied: number;
  replyRate: number;
  score: number;
  tier: Tier;
  cities: CityStat[];
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

const FIPS_TO_STATE: Record<string, string> = Object.fromEntries(Object.entries(STATE_FIPS).map(([k, v]) => [v, k]));

const pct = (n: number) => `${Math.round(n * 100)}%`;

interface HoverInfo {
  label: string;
  tier: Tier;
  total: number;
  qualified: number;
  qualifyRate: number;
  contracts: number;
  contractRate: number;
  replied: number;
  replyRate: number;
  x: number;
  y: number;
}

/**
 * Three-level drill-down:
 *
 * 1. National — one stylized, self-contained US map (state outlines drawn
 *    from a bundled TopoJSON via d3-geo's Albers USA projection, no basemap
 *    tiles, no network map requests), every state shaded by its own
 *    performance tier. Click a state to drill in.
 * 2. State — swaps to StateCityMap, a real tile-based map (same approach as
 *    CityZipMap below): each of that state's cities starts as a circle at
 *    its geocoded point, upgrading to its real TIGERweb municipal boundary
 *    the moment that resolves. Click a city to drill further.
 * 3. City — swaps to CityZipMap, the same real tile-based map one level
 *    deeper, for that city's own zip codes.
 *
 * Levels 2 and 3 both need actual road/neighborhood context to tell
 * places apart at that zoom, which the national level's map abstraction
 * deliberately doesn't have — an earlier version tried rendering city
 * boundaries on the same SVG/Albers-USA abstraction as the national map,
 * cropped to the state, but kept falling back to plain circles even for
 * cities with confirmed-good TIGERweb data. Real tiles sidestep it.
 *
 * `states` (built in DashboardPage) is already scoped to leads actually
 * approached (stage !== 'new'), so the thousands of cold, untouched leads
 * never dilute a rate at any level.
 */
export function CityPerformanceMap({ states }: { states: StateStat[] }) {
  const { data: cityGeocodes = new Map() } = useCityGeocodes();
  const upsertCityGeocode = useUpsertCityGeocode();
  const { data: zipGeocodes = new Map() } = useZipGeocodes();
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [visibleTiers, setVisibleTiers] = useState<Set<Tier>>(new Set(ALL_TIERS));
  const [selectedState, setSelectedState] = useState<StateStat | null>(null);
  const [selectedCity, setSelectedCity] = useState<CityStat | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const allCities = useMemo(() => states.flatMap((s) => s.cities), [states]);

  function toggleTier(tier: Tier) {
    setVisibleTiers((prev) => {
      const next = new Set(prev);
      if (next.has(tier)) next.delete(tier);
      else next.add(tier);
      return next;
    });
  }

  useEffect(() => {
    const missing = allCities.filter((c) => !cityGeocodes.has(cityGeoKey(c.city, c.state))).slice(0, 25);
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
  }, [JSON.stringify(allCities.map((c) => c.cityKey + c.stateKey)), cityGeocodes.size]);

  const { statePaths } = useMemo(() => {
    const topology = usStates as unknown as Topology;
    const geo = feature(topology, topology.objects.states as GeometryCollection);
    const features = 'features' in geo ? geo.features : [geo];
    const projection = geoAlbersUsa().fitSize([WIDTH, HEIGHT], geo as any);
    const pathGenerator = geoPath(projection);
    const paths = features.map((f) => ({ id: String(f.id), d: pathGenerator(f as any) ?? '' })).filter((p) => p.d);
    return { statePaths: paths };
  }, []);

  const statesByKey = useMemo(() => new Map(states.map((s) => [s.stateKey, s])), [states]);

  const stateTierCounts = useMemo(() => {
    const counts: Record<Tier, number> = { green: 0, yellow: 0, red: 0 };
    for (const s of states) counts[s.tier]++;
    return counts;
  }, [states]);

  const cityTierCountsInState = useMemo(() => {
    const counts: Record<Tier, number> = { green: 0, yellow: 0, red: 0 };
    if (!selectedState) return counts;
    for (const c of selectedState.cities) counts[c.tier]++;
    return counts;
  }, [selectedState]);

  const stateCityMarkers = useMemo(() => {
    if (!selectedState) return [];
    return selectedState.cities
      .filter((stat) => visibleTiers.has(stat.tier))
      .map((stat) => {
        const geo = cityGeocodes.get(cityGeoKey(stat.city, stat.state));
        return geo ? { ...stat, lat: geo.lat, lng: geo.lng } : null;
      })
      .filter((c): c is CityStat & { lat: number; lng: number } => c !== null);
  }, [selectedState, cityGeocodes, visibleTiers]);

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

  function handleEnter(e: React.MouseEvent, entry: Omit<HoverInfo, 'x' | 'y'>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ ...entry, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  const tierCounts = selectedCity ? zipTierCounts : selectedState ? cityTierCountsInState : stateTierCounts;
  const hintText = selectedCity
    ? 'Circle size = leads contacted in this zip · click a circle for details'
    : selectedState
      ? 'Shaded by real city boundary where available (circle = boundary not resolved yet) · click a city to see its zip codes'
      : 'Click a state to see its cities';

  function handleBack() {
    setHover(null);
    if (selectedCity) setSelectedCity(null);
    else setSelectedState(null);
  }

  return (
    <div className="relative">
      {(selectedState || selectedCity) && (
        <button
          onClick={handleBack}
          className="mb-2 flex items-center gap-1.5 rounded-full border border-border-2 bg-surface-3 px-3 py-1.5 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
        >
          <ArrowLeft size={13} />
          {selectedCity ? `Back to ${selectedState!.state}` : 'Back to national map'}
          {selectedCity && <span className="text-text-3">— {selectedCity.city}, {selectedCity.state} by zip code</span>}
        </button>
      )}

      {selectedCity ? (
        <CityZipMap zips={zipMarkers} cityLabel={`${selectedCity.city}, ${selectedCity.state}`} />
      ) : selectedState ? (
        <StateCityMap
          cities={stateCityMarkers}
          stateLabel={selectedState.state}
          onSelectCity={(city) => {
            setHover(null);
            setSelectedCity(city);
          }}
        />
      ) : (
        <svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full">
          <g>
            {statePaths.map((p) => {
              const stateKey = FIPS_TO_STATE[p.id];
              const stat = stateKey ? statesByKey.get(stateKey) : undefined;
              const shown = stat && visibleTiers.has(stat.tier) ? stat : null;
              return (
                <path
                  key={p.id}
                  d={p.d}
                  fill={shown ? TIER_COLOR[shown.tier] : STATE_FILL}
                  fillOpacity={shown ? 0.55 : 1}
                  stroke={STATE_STROKE}
                  strokeWidth={1}
                  strokeLinejoin="round"
                  className={shown ? 'cursor-pointer transition-opacity hover:!fill-opacity-75' : undefined}
                  onMouseEnter={shown ? (e) => handleEnter(e, { label: shown.state, ...shown }) : undefined}
                  onMouseMove={shown ? (e) => handleEnter(e, { label: shown.state, ...shown }) : undefined}
                  onMouseLeave={shown ? () => setHover(null) : undefined}
                  onClick={
                    shown
                      ? () => {
                          setHover(null);
                          setSelectedState(shown);
                        }
                      : undefined
                  }
                />
              );
            })}
          </g>
        </svg>
      )}

      {!selectedState && !selectedCity && hover && (
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
            <div>{hover.contracts} contracts ({pct(hover.contractRate)})</div>
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
        <span className="ml-1 text-text-3">{hintText}</span>
      </div>
    </div>
  );
}
