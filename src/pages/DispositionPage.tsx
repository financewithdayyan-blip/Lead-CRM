import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Handshake, Mail, MessageSquare, Pencil, Plus, Trash2 } from 'lucide-react';
import { geoAlbersUsa, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import usStates from 'us-atlas/states-10m.json';
import { useCashBuyers, useDeleteCashBuyer } from '@/hooks/useCashBuyers';
import { useBuyerMarketMap } from '@/hooks/useDisposition';
import { CashBuyerModal } from '@/components/disposition/CashBuyerModal';
import { BuyerStateMap } from '@/components/disposition/BuyerStateMap';
import { SendDealPacketModal } from '@/components/disposition/SendDealPacketModal';
import { DispositionMessagesTab } from '@/components/disposition/DispositionMessagesTab';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { STATE_FIPS } from '@/lib/placeBoundaries';
import { US_STATE_OPTIONS } from '@/data/usGeo';
import { BUYER_TYPE_CONFIG, BUYER_TYPE_ORDER, type CashBuyer, type BuyerType } from '@/types/domain';
import { cn, externalHref, formatCurrency, formatPhone } from '@/lib/utils';

const WIDTH = 960;
const HEIGHT = 600;
const STATE_FILL = '#102338';
const STATE_STROKE = '#1f3a57';
const HIGHLIGHT = '#6E7BFF';
const FIPS_TO_STATE = Object.fromEntries(Object.entries(STATE_FIPS).map(([k, v]) => [v, k]));
const CODE_TO_NAME = new Map(US_STATE_OPTIONS.map((s) => [s.code, s.name]));

function BuyerRow({ buyer, selected, onToggle }: { buyer: CashBuyer; selected: boolean; onToggle: () => void }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors', selected ? 'border-primary bg-primary-dim' : 'border-border-2 bg-surface hover:bg-surface-3')}>
      <input type="checkbox" className="mt-1" checked={selected} onChange={onToggle} />
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] font-bold text-text-2">
        {buyer.name.slice(0, 2).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] font-semibold text-text">{buyer.name}</span>
          {buyer.buyerTypes[0] && (
            <span className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium" style={{ background: `${BUYER_TYPE_CONFIG[buyer.buyerTypes[0]].color}22`, color: BUYER_TYPE_CONFIG[buyer.buyerTypes[0]].color }}>
              {BUYER_TYPE_CONFIG[buyer.buyerTypes[0]].label}
            </span>
          )}
        </span>
        <span className="block truncate text-[11.5px] text-text-3">
          {[buyer.marketCities.slice(0, 2).join(', ')].filter(Boolean).join(' · ') || 'No city set'}
        </span>
        <span className="mt-1 flex flex-wrap gap-2 text-[11px]">
          {buyer.phone && (
            <a href={externalHref(`sms:${buyer.phone}`)} className="flex items-center gap-1 text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
              <MessageSquare size={11} /> SMS
            </a>
          )}
          {buyer.email && (
            <a href={externalHref(`mailto:${buyer.email}`)} className="flex items-center gap-1 text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
              <Mail size={11} /> Email
            </a>
          )}
        </span>
      </span>
    </label>
  );
}

function BuyerRoster({ onAdd, onEdit }: { onAdd: () => void; onEdit: (b: CashBuyer) => void }) {
  const { data: buyers = [], isLoading } = useCashBuyers();
  const deleteCashBuyer = useDeleteCashBuyer();
  const [deleteTarget, setDeleteTarget] = useState<CashBuyer | null>(null);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return buyers;
    return buyers.filter((b) => `${b.name} ${b.marketStates.join(' ')} ${b.marketCities.join(' ')}`.toLowerCase().includes(q));
  }, [buyers, search]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <input className="input max-w-xs" placeholder="Search buyers…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn btn-primary" onClick={onAdd}>
          <Plus size={14} /> Add Buyer
        </button>
      </div>
      {isLoading ? (
        <div className="py-12 text-center text-sm text-text-3">Loading buyers…</div>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((b) => (
            <div key={b.id} className="card !p-3.5">
              <div className="flex items-start justify-between gap-2">
                <span className="truncate font-semibold text-text">{b.name}</span>
                <div className="flex shrink-0 gap-1">
                  <button className="btn !p-1.5" onClick={() => onEdit(b)}>
                    <Pencil size={12} />
                  </button>
                  <button className="btn !p-1.5" onClick={() => setDeleteTarget(b)}>
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              <div className="mt-1 truncate text-[12px] text-text-3">{[b.phone ? formatPhone(b.phone) : null, b.email].filter(Boolean).join(' · ') || 'No contact info'}</div>
              <div className="mt-2 flex flex-wrap gap-1">
                {b.buyerTypes.map((t) => (
                  <span key={t} className="rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ background: `${BUYER_TYPE_CONFIG[t].color}22`, color: BUYER_TYPE_CONFIG[t].color }}>
                    {BUYER_TYPE_CONFIG[t].label}
                  </span>
                ))}
              </div>
              <div className="mt-2 border-t border-border-2 pt-2 text-[12px] text-text-3">
                {b.marketCities.slice(0, 3).join(', ') || 'Any city'} · {b.marketStates.join(', ') || 'Any state'}
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete buyer?"
        message={`Remove ${deleteTarget?.name ?? 'this buyer'} from the roster? This can't be undone.`}
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteCashBuyer.mutate(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}

/** Disposition — a map-first buyer browser: national state totals, drill
 *  into a state to see every buyer's city as a pin, lasso-select an area (or
 *  pick a city from the list) and send a deal packet to everyone selected
 *  in one SMS/email/both blast. The flat roster/edit/delete view from
 *  before is still here as a second tab — nothing about managing buyers
 *  individually was removed, just no longer the page's front door. */
export function DispositionPage() {
  const navigate = useNavigate();
  const { data: buyers = [] } = useCashBuyers();
  const { stateCounts, pins } = useBuyerMarketMap(buyers);
  const [tab, setTab] = useState<'map' | 'roster' | 'messages'>('map');
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [selectedBuyerIds, setSelectedBuyerIds] = useState<Set<string>>(new Set());
  const [cityFilter, setCityFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<BuyerType | 'all'>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<CashBuyer | null>(null);
  const [showSend, setShowSend] = useState(false);

  const { statePaths } = useMemo(() => {
    const topology = usStates as unknown as Topology;
    const geo = feature(topology, topology.objects.states as GeometryCollection);
    const features = 'features' in geo ? geo.features : [geo];
    const projection = geoAlbersUsa().fitSize([WIDTH, HEIGHT], geo as any);
    const pathGenerator = geoPath(projection);
    return { statePaths: features.map((f) => ({ id: String(f.id), d: pathGenerator(f as any) ?? '' })).filter((p) => p.d) };
  }, []);

  const countsByCode = useMemo(() => new Map(stateCounts.map((s) => [s.state, s.count])), [stateCounts]);
  const maxCount = Math.max(...stateCounts.map((s) => s.count), 1);

  const statePins = useMemo(() => {
    if (!selectedState) return [];
    return pins.filter((p) => p.state === selectedState);
  }, [pins, selectedState]);

  const citiesInState = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of statePins) counts.set(p.city, (counts.get(p.city) ?? 0) + 1);
    return [...counts.entries()].map(([city, count]) => ({ city, count })).sort((a, b) => b.count - a.count);
  }, [statePins]);

  const visiblePins = useMemo(() => {
    let out = statePins;
    if (cityFilter) out = out.filter((p) => p.city === cityFilter);
    if (typeFilter !== 'all') out = out.filter((p) => p.buyerTypes.includes(typeFilter));
    return out;
  }, [statePins, cityFilter, typeFilter]);

  const buyersById = useMemo(() => new Map(buyers.map((b) => [b.id, b])), [buyers]);
  const selectedBuyers = useMemo(() => [...selectedBuyerIds].map((id) => buyersById.get(id)).filter((b): b is CashBuyer => !!b), [selectedBuyerIds, buyersById]);

  const typeCounts = useMemo(() => {
    const counts = new Map<BuyerType, number>();
    for (const id of selectedBuyerIds) {
      const b = buyersById.get(id);
      b?.buyerTypes.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1));
    }
    return counts;
  }, [selectedBuyerIds, buyersById]);

  function handleStateClick(code: string) {
    setSelectedState(code);
    setCityFilter(null);
    setSelectedBuyerIds(new Set());
  }

  function toggleBuyer(id: string) {
    setSelectedBuyerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const uniqueBuyersInView = useMemo(() => [...new Map(visiblePins.map((p) => [p.buyerId, p])).values()], [visiblePins]);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Handshake size={20} />
          </span>
          <div>
            <h1 className="text-2xl font-semibold text-text">Disposition</h1>
            <p className="text-sm text-text-3">Find cash buyers on the map, then send them a deal packet by SMS or email.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-border bg-surface-3 p-1">
            <button className={cn('rounded-md px-3 py-1.5 text-[12.5px] font-medium', tab === 'map' ? 'bg-surface text-text shadow-sm' : 'text-text-3')} onClick={() => setTab('map')}>
              Map
            </button>
            <button className={cn('rounded-md px-3 py-1.5 text-[12.5px] font-medium', tab === 'roster' ? 'bg-surface text-text shadow-sm' : 'text-text-3')} onClick={() => setTab('roster')}>
              Roster
            </button>
            <button className={cn('rounded-md px-3 py-1.5 text-[12.5px] font-medium', tab === 'messages' ? 'bg-surface text-text shadow-sm' : 'text-text-3')} onClick={() => setTab('messages')}>
              Messages
            </button>
          </div>
          <span className="rounded-full bg-surface-3 px-2.5 py-1.5 text-[12px] font-medium text-text-2">{stateCounts.length} markets</span>
          <span className="rounded-full bg-surface-3 px-2.5 py-1.5 text-[12px] font-medium text-text-2">{buyers.length} cash buyers</span>
        </div>
      </div>

      {tab === 'roster' ? (
        <BuyerRoster onAdd={() => setShowAdd(true)} onEdit={setEditTarget} />
      ) : tab === 'messages' ? (
        <DispositionMessagesTab />
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="min-w-0 flex-1">
            <div className="card">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-text">
                  {selectedState && (
                    <button onClick={() => setSelectedState(null)} className="flex items-center gap-1 text-text-3 hover:text-text">
                      <ArrowLeft size={14} />
                    </button>
                  )}
                  {selectedState ? `United States / ${CODE_TO_NAME.get(selectedState) ?? selectedState}` : 'United States'}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
                  {BUYER_TYPE_ORDER.map((t) => (
                    <span key={t} className="flex items-center gap-1 text-text-3">
                      <span className="h-2 w-2 rounded-full" style={{ background: BUYER_TYPE_CONFIG[t].color }} />
                      {BUYER_TYPE_CONFIG[t].label}
                    </span>
                  ))}
                </div>
              </div>

              {selectedState ? (
                <BuyerStateMap
                  pins={visiblePins}
                  stateLabel={CODE_TO_NAME.get(selectedState) ?? selectedState}
                  selectedIds={selectedBuyerIds}
                  onSelectionChange={(ids) => setSelectedBuyerIds(new Set(ids))}
                  onCityClick={(city) => setCityFilter((prev) => (prev === city ? null : city))}
                />
              ) : (
                <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full">
                  {statePaths.map((p) => {
                    const code = FIPS_TO_STATE[p.id];
                    const count = code ? countsByCode.get(code) ?? 0 : 0;
                    return (
                      <path
                        key={p.id}
                        d={p.d}
                        fill={count > 0 ? HIGHLIGHT : STATE_FILL}
                        fillOpacity={count > 0 ? 0.25 + 0.55 * (count / maxCount) : 1}
                        stroke={STATE_STROKE}
                        strokeWidth={1}
                        className={count > 0 ? 'cursor-pointer transition-opacity hover:!fill-opacity-90' : undefined}
                        onClick={count > 0 && code ? () => handleStateClick(code) : undefined}
                      />
                    );
                  })}
                </svg>
              )}
              {!selectedState && <p className="mt-2 text-[12px] text-text-3">Highlighted states are where you wholesale. Click one to zoom in.</p>}
            </div>
          </div>

          <div className="w-full shrink-0 lg:w-[320px]">
            {!selectedState ? (
              <div className="card">
                <div className="mb-1 text-[15px] font-semibold text-text">Your buyer markets</div>
                <p className="mb-3 text-[12px] text-text-3">Pick a state to see its cities and buyers.</p>
                <div className="max-h-[560px] space-y-2.5 overflow-y-auto">
                  {stateCounts.map((s) => {
                    const name = CODE_TO_NAME.get(s.state) ?? s.state;
                    const citiesHere = [...new Set(pins.filter((p) => p.state === s.state).map((p) => p.city))].slice(0, 4);
                    return (
                      <button key={s.state} onClick={() => handleStateClick(s.state)} className="block w-full rounded-lg border border-border-2 bg-surface p-3 text-left transition-colors hover:bg-surface-3">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-text">{name}</span>
                          <span className="font-mono text-[13px] font-bold text-primary-text">{s.count} buyers</span>
                        </div>
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(6, (s.count / maxCount) * 100)}%` }} />
                        </div>
                        {citiesHere.length > 0 && <div className="mt-1.5 text-[11.5px] text-text-3">{citiesHere.join(' · ')}</div>}
                      </button>
                    );
                  })}
                  {stateCounts.length === 0 && <div className="py-8 text-center text-[12.5px] text-text-3">Add a cash buyer with a market state to see it here.</div>}
                </div>
              </div>
            ) : selectedBuyerIds.size === 0 ? (
              <div className="card">
                <div className="mb-1 text-[15px] font-semibold text-text">
                  {CODE_TO_NAME.get(selectedState) ?? selectedState} · {statePins.length ? new Set(statePins.map((p) => p.buyerId)).size : 0} buyers
                </div>
                <p className="mb-3 text-[12px] text-text-3">Draw a lasso around buyers on the map, or pick a city below.</p>
                <div className="max-h-[480px] space-y-1.5 overflow-y-auto">
                  {citiesInState.map((c) => (
                    <button
                      key={c.city}
                      onClick={() => setCityFilter((prev) => (prev === c.city ? null : c.city))}
                      className={cn('flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-[13px] transition-colors', cityFilter === c.city ? 'border-primary bg-primary-dim' : 'border-border-2 bg-surface hover:bg-surface-3')}
                    >
                      <span className="font-medium text-text">{c.city}</span>
                      <span className="text-text-3">{c.count} buyer{c.count === 1 ? '' : 's'}</span>
                    </button>
                  ))}
                  {citiesInState.length === 0 && <div className="py-6 text-center text-[12px] text-text-3">No geocoded cities yet for this state's buyers.</div>}
                </div>
                {uniqueBuyersInView.length > 0 && (
                  <button className="btn btn-primary !mt-3 w-full" onClick={() => setSelectedBuyerIds(new Set(uniqueBuyersInView.map((p) => p.buyerId)))}>
                    Select all buyers in {cityFilter ?? (CODE_TO_NAME.get(selectedState) ?? selectedState)}
                  </button>
                )}
              </div>
            ) : (
              <div className="card">
                <div className="mb-1 flex items-center justify-between">
                  <div className="text-[15px] font-semibold text-text">{selectedBuyerIds.size} buyers in selected area</div>
                  <button className="text-[12px] text-text-3 hover:text-text" onClick={() => setSelectedBuyerIds(new Set())}>
                    Clear
                  </button>
                </div>
                <p className="mb-2.5 text-[12px] text-text-3">{citiesInState.filter((c) => selectedBuyers.some((b) => b.marketCities.includes(c.city))).map((c) => c.city).join(' · ') || 'Mixed cities'}</p>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  <button onClick={() => setTypeFilter('all')} className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium', typeFilter === 'all' ? 'border-text bg-text text-surface' : 'border-border-2 text-text-2')}>
                    All {selectedBuyerIds.size}
                  </button>
                  {BUYER_TYPE_ORDER.filter((t) => typeCounts.has(t)).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTypeFilter(t)}
                      className="rounded-full border px-2 py-0.5 text-[11px] font-medium"
                      style={typeFilter === t ? { borderColor: BUYER_TYPE_CONFIG[t].color, background: `${BUYER_TYPE_CONFIG[t].color}22`, color: BUYER_TYPE_CONFIG[t].color } : { borderColor: 'var(--border-2)' }}
                    >
                      {BUYER_TYPE_CONFIG[t].label} {typeCounts.get(t)}
                    </button>
                  ))}
                </div>
                <label className="mb-2 flex items-center gap-2 text-[12.5px] font-medium text-text-2">
                  <input
                    type="checkbox"
                    checked={selectedBuyerIds.size === uniqueBuyersInView.length && uniqueBuyersInView.length > 0}
                    onChange={(e) => setSelectedBuyerIds(e.target.checked ? new Set(uniqueBuyersInView.map((p) => p.buyerId)) : new Set())}
                  />
                  Select all {uniqueBuyersInView.length} · {selectedBuyerIds.size} selected
                </label>
                <div className="max-h-[360px] space-y-2 overflow-y-auto">
                  {selectedBuyers
                    .filter((b) => typeFilter === 'all' || b.buyerTypes.includes(typeFilter))
                    .map((b) => (
                      <BuyerRow key={b.id} buyer={b} selected onToggle={() => toggleBuyer(b.id)} />
                    ))}
                </div>
                <button className="btn btn-primary !mt-3 w-full" onClick={() => setShowSend(true)} disabled={selectedBuyerIds.size === 0}>
                  Send deal packet to {selectedBuyerIds.size} buyer{selectedBuyerIds.size === 1 ? '' : 's'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showAdd && <CashBuyerModal onClose={() => setShowAdd(false)} />}
      {editTarget && <CashBuyerModal buyer={editTarget} onClose={() => setEditTarget(null)} />}
      {showSend && selectedBuyers.length > 0 && (
        <SendDealPacketModal buyers={selectedBuyers} stateLabel={selectedState ? CODE_TO_NAME.get(selectedState) ?? selectedState : ''} onClose={() => setShowSend(false)} />
      )}
    </div>
  );
}
