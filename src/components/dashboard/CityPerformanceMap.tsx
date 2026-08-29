import { useEffect, useMemo, useRef, useState } from 'react';
import { geoAlbersUsa, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import usStates from 'us-atlas/states-10m.json';
import { geocodeAddress } from '@/lib/geocode';
import { useCityGeocodes, useUpsertCityGeocode, cityGeoKey } from '@/hooks/useCityGeocodes';

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
  tier: 'green' | 'yellow' | 'red';
}

const TIER_COLOR: Record<CityStat['tier'], string> = {
  green: '#22c55e',
  yellow: '#eab308',
  red: '#ef4444',
};
const TIER_LABEL: Record<CityStat['tier'], string> = {
  green: 'High performing',
  yellow: 'Average',
  red: 'Needs attention',
};

// A fixed illustrative canvas (not a pannable/zoomable real map) — same
// aspect ratio d3's own US examples use, scaled responsively via viewBox.
const WIDTH = 960;
const HEIGHT = 600;
const STATE_FILL = '#102338';
const STATE_STROKE = '#1f3a57';

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * A stylized, self-contained US map (state outlines drawn from a bundled
 * TopoJSON via d3-geo's Albers USA projection — the projection that insets
 * Alaska/Hawaii the way the reference image showed, no basemap tiles, no
 * network map requests) with one circle per city that has enough leads to
 * mean something. Every state is the same neutral navy — states carry no
 * data of their own here, they're just the backdrop; the circles do all the
 * talking: size = lead volume (sqrt-scaled, so area tracks count), color =
 * a green/yellow/red performance tier computed upstream from qualify rate +
 * reply rate. Coordinates come from the shared city_geocodes cache; a city
 * missing one gets geocoded here in the background and written back so
 * every later load (any user) has it without hitting the free geocoders
 * again.
 */
export function CityPerformanceMap({ cities }: { cities: CityStat[] }) {
  const { data: geocodes = new Map() } = useCityGeocodes();
  const upsertGeocode = useUpsertCityGeocode();
  const [hover, setHover] = useState<{ stat: CityStat; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const missing = cities.filter((c) => !geocodes.has(cityGeoKey(c.city, c.state))).slice(0, 25);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const c of missing) {
        if (cancelled) return;
        const point = await geocodeAddress(`${c.city}, ${c.state}`).catch(() => null);
        if (point && !cancelled) {
          upsertGeocode.mutate({ city: c.city, state: c.state, lat: point.lat, lng: point.lng });
        }
        await new Promise((r) => setTimeout(r, 1100));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(cities.map((c) => c.cityKey + c.stateKey)), geocodes.size]);

  const { statePaths, project } = useMemo(() => {
    const topology = usStates as unknown as Topology;
    const geo = feature(topology, topology.objects.states as GeometryCollection);
    const features = 'features' in geo ? geo.features : [geo];
    const projection = geoAlbersUsa().fitSize([WIDTH, HEIGHT], geo as any);
    const pathGen = geoPath(projection);
    const paths = features.map((f) => ({ id: String(f.id), d: pathGen(f as any) ?? '' })).filter((p) => p.d);
    return { statePaths: paths, project: (lng: number, lat: number) => projection([lng, lat]) };
  }, []);

  const plotted = useMemo(() => {
    const maxTotal = Math.max(...cities.map((c) => c.total), 1);
    const radiusFor = (total: number) => 4 + 15 * Math.sqrt(total / maxTotal);
    return cities
      .map((stat) => {
        const geo = geocodes.get(cityGeoKey(stat.city, stat.state));
        if (!geo) return null;
        const point = project(geo.lng, geo.lat);
        if (!point) return null;
        return { stat, x: point[0], y: point[1], r: radiusFor(stat.total) };
      })
      .filter((p): p is { stat: CityStat; x: number; y: number; r: number } => p !== null)
      // Smaller circles drawn last so a big city's bubble never fully buries a
      // small nearby one.
      .sort((a, b) => b.r - a.r);
  }, [cities, geocodes, project]);

  function handleEnter(e: React.MouseEvent, stat: CityStat) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ stat, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  return (
    <div className="relative">
      <svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full">
        <g>
          {statePaths.map((p) => (
            <path key={p.id} d={p.d} fill={STATE_FILL} stroke={STATE_STROKE} strokeWidth={1} strokeLinejoin="round" />
          ))}
        </g>
        <g>
          {plotted.map(({ stat, x, y, r }) => (
            <circle
              key={`${stat.cityKey}-${stat.stateKey}`}
              cx={x}
              cy={y}
              r={r}
              fill={TIER_COLOR[stat.tier]}
              fillOpacity={0.62}
              stroke={TIER_COLOR[stat.tier]}
              strokeWidth={1.25}
              onMouseEnter={(e) => handleEnter(e, stat)}
              onMouseMove={(e) => handleEnter(e, stat)}
              onMouseLeave={() => setHover(null)}
              className="cursor-pointer transition-opacity hover:!fill-opacity-90"
            />
          ))}
        </g>
      </svg>

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
          <div className="font-semibold">{hover.stat.city}, {hover.stat.state}</div>
          <div className="mt-0.5 font-semibold" style={{ color: TIER_COLOR[hover.stat.tier] }}>
            {TIER_LABEL[hover.stat.tier]}
          </div>
          <div className="mt-1 space-y-0.5 text-slate-300">
            <div>{hover.stat.total} lead{hover.stat.total === 1 ? '' : 's'}</div>
            <div>{hover.stat.qualified} qualified ({pct(hover.stat.qualifyRate)})</div>
            <div>{hover.stat.replied} replied ({pct(hover.stat.replyRate)})</div>
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-4 text-[12px] text-text-2">
        {(['green', 'yellow', 'red'] as const).map((t) => (
          <span key={t} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: TIER_COLOR[t] }} />
            {TIER_LABEL[t]}
          </span>
        ))}
        <span className="text-text-3">Circle size = lead volume · ranked by qualify rate + reply rate</span>
      </div>
    </div>
  );
}
