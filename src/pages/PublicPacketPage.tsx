import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, Lock, MapPin } from 'lucide-react';
import { useLogPacketView, usePacketArea, usePublicPacket, type PublicPacketComp } from '@/hooks/usePublicPacket';
// Leaflet plus its CSS is a meaningful chunk, and a packet with no mapped
// addresses never needs it.
const PacketMap = lazy(() => import('@/components/packets/PacketMap').then((m) => ({ default: m.PacketMap })));
import { analyzeDeal, type DealAnalysis } from '@/hooks/useDealPackets';
import { VERDICT_STYLE } from '@/lib/dealVerdict';
import { useAnnouncePacketPresence } from '@/hooks/usePacketPresence';
import { getViewerIdentity, saveViewerIdentity, type ViewerIdentity } from '@/lib/viewerToken';
import { packetImageUrl } from '@/hooks/useDealPackets';
import { DEAL_TYPE_CONFIG } from '@/types/domain';

const money = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-text-3">{label}</div>
      <div className="mt-0.5 text-[15px] font-semibold text-text">{value}</div>
    </div>
  );
}

/** Shared by the listings and sold tables — same columns, different labels. */
function CompTable({
  rows,
  priceLabel,
  dateLabel,
}: {
  rows: PublicPacketComp[];
  priceLabel: string;
  dateLabel: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead className="border-b border-border text-[11px] uppercase tracking-wide text-text-3">
          <tr>
            <th className="pb-2 pr-3">Address</th>
            <th className="pb-2 pr-3 text-right">{priceLabel}</th>
            <th className="pb-2 pr-3 text-right">Sq ft</th>
            <th className="pb-2 text-right">{dateLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-b border-border last:border-b-0">
              <td className="py-2 pr-3 text-text-2">{c.address || '—'}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-text">{money(c.salePrice)}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-text-2">{c.sqft?.toLocaleString() ?? '—'}</td>
              <td className="py-2 text-right tabular-nums text-text-3">
                {c.saleDate ? new Date(c.saleDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-card">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-text-3">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Name + email wall, shown before any packet content when the admin enables it. */
function LeadCaptureGate({ onSubmit }: { onSubmit: (identity: ViewerIdentity) => void }) {
  const [name, setName] = useState('');
  const valid = name.trim().length > 1;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <form
        className="w-full max-w-sm rounded-2xl border border-border bg-surface p-7 shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit({ name: name.trim() });
        }}
      >
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">Investment Opportunity</div>
        <h1 className="mt-1.5 text-[19px] font-semibold text-text">Who's viewing?</h1>
        <p className="mt-1 text-[13px] leading-snug text-text-3">
          Just your name — the full packet opens straight away.
        </p>
        <input
          className="input mt-4"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          autoFocus
        />
        <button type="submit" disabled={!valid} className="btn btn-primary mt-3 w-full justify-center">
          View deal packet
        </button>
      </form>
    </div>
  );
}

/** Verdict, the four headline numbers, and the reasoning behind them. */
function DealAnalysisCard({ analysis, arv }: { analysis: DealAnalysis; arv: number | null }) {
  const style = VERDICT_STYLE[analysis.verdict];
  // Bar fills toward the 40%-equity mark, so a strong deal visibly fills more.
  const fill = analysis.margin != null ? Math.max(0, Math.min(100, (analysis.margin / 0.4) * 100)) : 0;

  return (
    <section className={`rounded-xl border p-5 shadow-card ${style.box}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-text-3">Deal Analysis</h2>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${style.pill}`}>
          {style.label}
        </span>
      </div>

      {analysis.margin != null && (
        <div className="mt-3">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-text">{Math.round(analysis.margin * 100)}%</span>
            <span className="text-[13px] text-text-3">equity against ARV</span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-black/10">
            <div className={`h-full rounded-full transition-all ${style.bar}`} style={{ width: `${fill}%` }} />
          </div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-4 border-t border-black/10 pt-3 sm:grid-cols-4">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-text-3">All-in cost</div>
          <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-text">{money(analysis.allIn)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-text-3">ARV</div>
          <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-text">{money(arv)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-text-3">Projected equity</div>
          <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-text">{money(analysis.spread)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-text-3">70% rule ceiling</div>
          <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-text">{money(analysis.mao)}</div>
        </div>
      </div>

      <ul className="mt-3 space-y-1 border-t border-black/10 pt-3">
        {analysis.notes.map((n, i) => (
          <li key={i} className="flex gap-2 text-[12.5px] leading-snug text-text-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current opacity-40" />
            {n}
          </li>
        ))}
      </ul>

      <p className="mt-3 text-[11px] leading-snug text-text-3">
        Calculated from the figures on this page: purchase price plus repairs and fee against ARV. Estimates only —
        run your own numbers before committing.
      </p>
    </section>
  );
}

export function PublicPacketPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: packet, isLoading, isError } = usePublicPacket(slug);
  const { data: area } = usePacketArea(slug);
  const logView = useLogPacketView();

  const [identity, setIdentity] = useState<ViewerIdentity | null>(() => (slug ? getViewerIdentity(slug) : null));
  const [lightbox, setLightbox] = useState<string | null>(null);
  const loggedRef = useRef(false);

  const gated = !!packet?.requireLeadCapture && !identity;

  // Counts toward the admin's live viewer number for as long as this page is
  // mounted. Suppressed behind the capture gate — someone staring at a form
  // isn't viewing the deal.
  useAnnouncePacketPresence(packet?.id, !!packet && !gated);

  // One view per page load, and never before the capture gate is satisfied.
  useEffect(() => {
    if (!slug || !packet || gated || loggedRef.current) return;
    loggedRef.current = true;
    logView.mutate({ slug, identity });
  }, [slug, packet, gated, identity]); // eslint-disable-line react-hooks/exhaustive-deps

  const repairTotalValue = useMemo(
    () => (packet?.repairs ?? []).reduce((s, r) => s + (Number(r.cost) || 0), 0),
    [packet?.repairs],
  );

  const listings = useMemo(() => (packet?.comps ?? []).filter((c) => c.kind === 'listing'), [packet?.comps]);
  const sold = useMemo(() => (packet?.comps ?? []).filter((c) => c.kind !== 'listing'), [packet?.comps]);

  // Only rows that actually geocoded get a pin. The subject property is never
  // included — the packet discloses an area, and one pin would give it away.
  const mapPins = useMemo(
    () =>
      (packet?.comps ?? [])
        .filter((c) => c.lat != null && c.lng != null)
        .map((c) => ({
          id: c.id,
          kind: (c.kind === 'listing' ? 'listing' : 'sold') as 'listing' | 'sold',
          address: c.address,
          price: c.salePrice,
          sqft: c.sqft,
          date: c.saleDate,
          lat: Number(c.lat),
          lng: Number(c.lng),
        })),
    [packet?.comps],
  );

  const analysis = useMemo(
    () =>
      analyzeDeal({
        // purchasePrice already includes the assignment fee — the RPC combines
        // them. Passing the fee again here would double-count it and understate
        // the deal.
        purchasePrice: packet?.purchasePrice ?? null,
        arv: packet?.arv ?? null,
        repairs: repairTotalValue,
        assignmentFee: null,
      }),
    [packet?.purchasePrice, packet?.arv, repairTotalValue],
  );

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-2 text-text-3">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  // Draft, archived, deleted and mistyped links all land here — deliberately
  // indistinguishable, so a wrong slug reveals nothing about what exists.
  if (isError || !packet) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-surface-2 p-6 text-center">
        <Lock size={22} className="text-text-3" />
        <h1 className="text-[17px] font-semibold text-text">This packet isn't available</h1>
        <p className="max-w-sm text-[13px] text-text-3">
          The link may have expired or been taken down. Check with whoever shared it for an up-to-date link.
        </p>
      </div>
    );
  }

  if (gated) {
    return (
      <LeadCaptureGate
        onSubmit={(id) => {
          saveViewerIdentity(slug!, id);
          setIdentity(id);
        }}
      />
    );
  }

  const areaLine = [area?.city, area?.state, area?.zip].filter(Boolean).join(', ');

  return (
    <div className="min-h-screen bg-surface-2 pb-16">
      {/* Dark hero — the headline price and the property carry the top of the page. */}
      <header className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
        <div className="mx-auto max-w-5xl px-5 py-8">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-400">
            Investment Opportunity
          </div>
          <h1 className="mt-2 text-3xl font-semibold leading-tight">
            {packet.propType || 'Property'}
          </h1>
          <div className="mt-1.5 flex items-center gap-1.5 text-[14px] text-slate-300">
            <MapPin size={14} className="shrink-0" />
            {areaLine || 'Location available on enquiry'}
          </div>

          <div className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
            {packet.purchasePrice != null && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-400">Purchase price</div>
                <div className="text-2xl font-bold tabular-nums">{money(packet.purchasePrice)}</div>
              </div>
            )}
            {packet.arv != null && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-400">ARV</div>
                <div className="text-2xl font-bold tabular-nums text-sky-300">{money(packet.arv)}</div>
              </div>
            )}
            {repairTotalValue > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-400">Est. repairs</div>
                <div className="text-2xl font-bold tabular-nums">{money(repairTotalValue)}</div>
              </div>
            )}
            {analysis.spread != null && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-400">Projected equity</div>
                <div className={`text-2xl font-bold tabular-nums ${analysis.spread >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {money(analysis.spread)}
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px]">
            {packet.leadStatus && (
              <span className="rounded-full bg-white/10 px-2.5 py-1 font-medium">{packet.leadStatus}</span>
            )}
            {packet.beds != null && <span className="rounded-full bg-white/10 px-2.5 py-1">{packet.beds} bed</span>}
            {packet.baths != null && <span className="rounded-full bg-white/10 px-2.5 py-1">{packet.baths} bath</span>}
            {packet.sqft != null && <span className="rounded-full bg-white/10 px-2.5 py-1">{packet.sqft.toLocaleString()} sq ft</span>}
            {packet.yearBuilt != null && <span className="rounded-full bg-white/10 px-2.5 py-1">Built {packet.yearBuilt}</span>}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-5 py-6">
        {packet.images.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-4">
            {/* First photo leads at double size — a flat grid of six thumbnails
                reads as a contact sheet rather than a listing. */}
            <button
              onClick={() => setLightbox(packetImageUrl(packet.images[0].storagePath))}
              className="group relative sm:col-span-2 sm:row-span-2"
            >
              <img
                src={packetImageUrl(packet.images[0].storagePath)}
                alt={packet.images[0].caption ?? 'Property photo'}
                className="h-56 w-full rounded-xl border border-border object-cover transition-opacity group-hover:opacity-90 sm:h-full"
              />
            </button>
            {packet.images.slice(1, 5).map((img) => (
              <button key={img.id} onClick={() => setLightbox(packetImageUrl(img.storagePath))} className="group relative">
                <img
                  src={packetImageUrl(img.storagePath)}
                  alt={img.caption ?? 'Property photo'}
                  loading="lazy"
                  className="h-28 w-full rounded-xl border border-border object-cover transition-opacity group-hover:opacity-90"
                />
              </button>
            ))}
            {packet.images.length > 5 && (
              <button
                onClick={() => setLightbox(packetImageUrl(packet.images[5].storagePath))}
                className="relative"
              >
                <img
                  src={packetImageUrl(packet.images[5].storagePath)}
                  alt="More property photos"
                  loading="lazy"
                  className="h-28 w-full rounded-xl border border-border object-cover brightness-50"
                />
                <span className="absolute inset-0 flex items-center justify-center text-[15px] font-semibold text-white">
                  +{packet.images.length - 5}
                </span>
              </button>
            )}
          </div>
        )}

        <DealAnalysisCard analysis={analysis} arv={packet.arv} />

        {packet.narrative && (
          <Card title="The opportunity">
            <div className="space-y-1.5">
              {packet.narrative.split('\n').filter((l) => l.trim()).map((line, i) => (
                <p key={i} className="flex gap-2 text-[14px] leading-relaxed text-text-2">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary/50" />
                  {line.trim()}
                </p>
              ))}
            </div>
          </Card>
        )}

        <Card title="Property detail">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Beds" value={packet.beds ?? '—'} />
            <Stat label="Baths" value={packet.baths ?? '—'} />
            <Stat label="Sq ft" value={packet.sqft?.toLocaleString() ?? '—'} />
            <Stat label="Year built" value={packet.yearBuilt ?? '—'} />
            {packet.showAssignmentFee && packet.assignmentFee != null && (
              <Stat label="Assignment fee" value={money(packet.assignmentFee)} />
            )}
          </div>
        </Card>

        {packet.dealTypes.length > 0 && (
          <Card title="Deal structures available">
            <div className="grid gap-3 sm:grid-cols-2">
              {packet.dealTypes.map((t) => {
                const cfg = DEAL_TYPE_CONFIG[t];
                if (!cfg) return null;
                return (
                  <div key={t} className="rounded-lg border border-border-2 bg-surface-3 p-3">
                    <div className="text-[13px] font-semibold text-text">{cfg.label}</div>
                    <p className="mt-1 text-[12px] leading-snug text-text-3">{cfg.description}</p>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {mapPins.length > 0 && (
          <Card title="The area">
            <Suspense fallback={<div className="h-72 animate-pulse rounded-xl bg-surface-3" />}>
              <PacketMap pins={mapPins} />
            </Suspense>
          </Card>
        )}

        {listings.length > 0 && (
          <Card title="Currently on the market">
            <CompTable rows={listings} priceLabel="List price" dateLabel="Listed" />
          </Card>
        )}

        {sold.length > 0 && (
          <Card title="Recently sold">
            <CompTable rows={sold} priceLabel="Sale price" dateLabel="Sold" />
          </Card>
        )}

        {packet.repairs.length > 0 && (
          <Card title="Repair estimate">
            <table className="w-full text-left text-[13px]">
              <tbody>
                {packet.repairs.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-b-0">
                    <td className="py-2 text-text-2">{r.item || '—'}</td>
                    <td className="py-2 text-right tabular-nums text-text">{money(r.cost)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="pt-2 text-[13px] font-semibold text-text">Total</td>
                  <td className="pt-2 text-right text-[13px] font-semibold tabular-nums text-text">{money(repairTotalValue)}</td>
                </tr>
              </tbody>
            </table>
          </Card>
        )}

        <p className="px-1 text-center text-[11px] text-text-3">
          Figures are estimates provided for evaluation and are not a warranty or an offer.
        </p>
      </main>

      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="Property photo enlarged" className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}
    </div>
  );
}
