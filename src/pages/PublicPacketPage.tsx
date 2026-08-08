import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Loader2, Lock, MapPin, TrendingUp, X } from 'lucide-react';
import { useLogPacketView, usePacketArea, usePublicPacket, type PublicPacketComp } from '@/hooks/usePublicPacket';
// Leaflet plus its CSS is a meaningful chunk, and a packet with no mapped
// addresses never needs it.
const PacketMap = lazy(() => import('@/components/packets/PacketMap').then((m) => ({ default: m.PacketMap })));
import { analyzeDeal, compSetConfidence, estimateComparableArv, type CompScore, type ComparableEstimate, type DealAnalysis, type SetConfidence } from '@/hooks/useDealPackets';
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
function matchTone(score: number) {
  if (score >= 7.5) return 'bg-success/15 text-success';
  if (score >= 5) return 'bg-warning-dim text-warning';
  return 'bg-danger-dim text-danger';
}

function CompTable({
  rows,
  priceLabel,
  dateLabel,
  scores,
}: {
  rows: PublicPacketComp[];
  priceLabel: string;
  dateLabel: string;
  scores?: Record<string, CompScore>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead className="border-b border-border text-[11px] uppercase tracking-wide text-text-3">
          <tr>
            <th className="pb-2 pr-3">Address</th>
            <th className="pb-2 pr-3 text-right">{priceLabel}</th>
            <th className="pb-2 pr-3 text-right">Bed</th>
            <th className="pb-2 pr-3 text-right">Bath</th>
            <th className="pb-2 pr-3 text-right">Sq ft</th>
            <th className="pb-2 pr-3 text-right">{dateLabel}</th>
            {scores && <th className="pb-2 text-right">Match</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-b border-border last:border-b-0">
              <td className="py-2 pr-3 text-text-2">{c.address || '—'}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-text">{money(c.salePrice)}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-text-2">{c.beds ?? '—'}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-text-2">{c.baths ?? '—'}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-text-2">{c.sqft?.toLocaleString() ?? '—'}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-text-3">
                {c.saleDate ? new Date(c.saleDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}
              </td>
              {scores && (
                <td className="py-2 text-right">
                  {scores[c.id] ? (
                    <span
                      className={`inline-block rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${matchTone(scores[c.id].score)}`}
                      title={scores[c.id].reasons.join(' · ') || 'Close match on size, beds and baths'}
                    >
                      {scores[c.id].score}/10
                    </span>
                  ) : (
                    <span className="text-text-3">—</span>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Qualifies the comparable average. A number without a sense of how alike the
 * comps were is worth less than a slightly worse number you can trust.
 */
function confidenceText(label: SetConfidence['label']) {
  return label === 'High' ? 'text-success' : label === 'Moderate' ? 'text-warning' : 'text-danger';
}

function ConfidenceBlock({ confidence }: { confidence: SetConfidence }) {
  const tone =
    confidence.label === 'High' ? 'bg-success' : confidence.label === 'Moderate' ? 'bg-warning' : 'bg-danger';

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border-2">
        <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${confidence.score * 10}%` }} />
      </div>
      <ul className="mt-2 space-y-0.5">
        {confidence.notes.map((n, i) => (
          <li key={i} className="flex gap-1.5 text-[12px] leading-snug text-text-3">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current opacity-40" />
            {n}
          </li>
        ))}
      </ul>
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

interface PacketPhoto {
  id: string;
  storagePath: string;
  caption: string | null;
}

/**
 * Photo grid that always fills completely, whatever the photo count.
 *
 * A fixed 2x2-plus-four mosaic leaves visible holes at two, three or four
 * photos, so the column count adapts: three columns fits a 2x2 feature beside
 * two stacked thumbnails, four columns fits it beside four. Anything past the
 * last visible slot collapses into a "+N more" overlay rather than a ragged
 * extra row. Row heights come from the grid, never from the images, so a
 * portrait shot can't stretch a row and strand its neighbours.
 */
function PhotoMosaic({ images, onOpen }: { images: PacketPhoto[]; onOpen: (i: number) => void }) {
  if (!images.length) return null;

  const Tile = ({ img, index, className, overlay }: { img: PacketPhoto; index: number; className: string; overlay?: number }) => (
    <button onClick={() => onOpen(index)} className={`group relative overflow-hidden rounded-xl border border-border ${className}`}>
      <img
        src={packetImageUrl(img.storagePath)}
        alt={img.caption ?? 'Property photo'}
        loading={index === 0 ? undefined : 'lazy'}
        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
      />
      {overlay ? (
        <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-[17px] font-semibold text-white">
          +{overlay} more
        </span>
      ) : null}
    </button>
  );

  if (images.length === 1) {
    return <Tile img={images[0]} index={0} className="block h-72 w-full sm:h-[420px]" />;
  }

  if (images.length === 2) {
    return (
      <div className="grid h-56 grid-cols-2 gap-2 sm:h-[420px]">
        {images.map((img, i) => <Tile key={img.id} img={img} index={i} className="h-full" />)}
      </div>
    );
  }

  // Three columns holds two thumbnails; four holds four. Picking the layout by
  // count is what keeps every cell occupied.
  const wide = images.length >= 5;
  const thumbs = images.slice(1, wide ? 5 : 3);
  const extra = images.length - 1 - thumbs.length;

  return (
    <div className={`grid grid-cols-2 gap-2 sm:h-[420px] sm:grid-rows-2 ${wide ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
      <Tile img={images[0]} index={0} className="col-span-2 h-56 sm:row-span-2 sm:h-full" />
      {thumbs.map((img, i) => (
        <Tile
          key={img.id}
          img={img}
          index={i + 1}
          className="h-28 sm:h-full"
          overlay={extra > 0 && i === thumbs.length - 1 ? extra : undefined}
        />
      ))}
    </div>
  );
}

/** Name-only wall, shown before any packet content when the admin enables it. */
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

/** One line of the analysis breakdown: label, optional qualifier, right-aligned figure. */
function Line({
  label, value, sign, hint, strong, tone,
}: {
  label: string;
  value: number | null;
  sign?: '+';
  hint?: string;
  strong?: boolean;
  tone?: 'good' | 'bad';
}) {
  const toneClass = tone === 'bad' ? 'text-danger' : tone === 'good' ? 'text-success' : 'text-text';
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <dt className={`text-[13px] ${strong ? 'font-semibold text-text' : 'text-text-2'}`}>
        {label}
        {hint && <span className="ml-1.5 text-[11px] font-normal text-text-3">{hint}</span>}
      </dt>
      <dd className={`shrink-0 tabular-nums ${strong ? `text-[15px] font-bold ${toneClass}` : 'text-[13px] text-text'}`}>
        {sign && value != null ? sign : ''}{money(value)}
      </dd>
    </div>
  );
}

/** Verdict, an itemised breakdown, and the rule the verdict comes from. */
function DealAnalysisCard({ analysis, arv, market }: { analysis: DealAnalysis; arv: number | null; market: ComparableEstimate | null }) {
  const style = VERDICT_STYLE[analysis.verdict];
  // Tracks headroom against the ceiling, the same measure the verdict uses, so
  // the bar and the badge can never disagree. Full at 25% under max.
  const fill =
    analysis.mao != null && analysis.mao > 0 && analysis.headroom != null
      ? Math.max(0, Math.min(100, (analysis.headroom / analysis.mao / 0.25) * 100))
      : 0;

  return (
    <section className={`rounded-xl border p-5 shadow-card ${style.box}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-text-3">Deal Analysis</h2>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${style.pill}`}>
          {style.label}
        </span>
      </div>

      {/* Headline is the verdict's own reasoning, so the badge and the number
          under it can never tell different stories. */}
      <p className="mt-2 text-[15px] font-medium leading-snug text-text">{analysis.notes[0]}</p>

      {analysis.headroom != null && (
        <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-black/10">
          <div className={`h-full rounded-full transition-all ${style.bar}`} style={{ width: `${fill}%` }} />
        </div>
      )}

      {/* ── What the buyer is in for ─────────────────────────────────────── */}
      <div className="mt-4 border-t border-black/10 pt-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Buyer's cost</div>
        <dl className="mt-2">
          <Line label="Asking price" value={analysis.askingPrice} />
          <Line label="Repairs" value={analysis.repairs} sign="+" />
          {analysis.closingCost != null && (
            <Line label="Closing costs" value={analysis.closingCost} sign="+" hint="paid by buyer" />
          )}
          <div className="mt-1 border-t border-black/15 pt-1">
            <Line label="All-in cost" value={analysis.allIn} strong />
          </div>
        </dl>
      </div>

      {/* ── What it's worth ──────────────────────────────────────────────── */}
      <div className="mt-3 border-t border-black/10 pt-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Value</div>
        <dl className="mt-2">
          <Line label="ARV" value={arv} hint={market ? "comparable average" : undefined} />
          {market && (
            <Line
              label="Comparable average"
              value={market.value}
              hint={
                market.method === 'per_sqft'
                  ? `${market.soldCount} sold comp${market.soldCount === 1 ? '' : 's'} · price/sqft basis`
                  : `${market.soldCount} sold comp${market.soldCount === 1 ? '' : 's'} · flat average`
              }
            />
          )}
          <Line
            label="Projected equity"
            value={analysis.spread}
            strong
            hint={analysis.margin != null ? `${Math.round(analysis.margin * 100)}% of ARV` : undefined}
            tone={analysis.spread != null && analysis.spread < 0 ? 'bad' : 'good'}
          />
        </dl>
      </div>

      <p className="mt-3 border-t border-black/10 pt-3 text-[11px] leading-snug text-text-3">
        Figures are estimates provided for evaluation and are not a warranty or an offer.
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
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const loggedRef = useRef(false);

  const gated = !!packet?.requireLeadCapture && !identity;

  // Counts toward the admin's live viewer number for as long as this page is
  // mounted. Suppressed behind the capture gate — someone staring at a form
  // isn't viewing the deal.
  useAnnouncePacketPresence(packet?.id, !!packet && !gated);

  const imageCount = packet?.images.length ?? 0;

  /** Wraps at both ends so arrowing past the last photo returns to the first. */
  const step = (delta: number) =>
    setLightboxIndex((i) => (i === null || !imageCount ? i : (i + delta + imageCount) % imageCount));

  useEffect(() => {
    if (lightboxIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxIndex(null);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    // The page behind the lightbox shouldn't scroll while it's open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [lightboxIndex, imageCount]); // eslint-disable-line react-hooks/exhaustive-deps

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
          beds: c.beds,
          baths: c.baths,
          date: c.saleDate,
          lat: Number(c.lat),
          lng: Number(c.lng),
        })),
    [packet?.comps],
  );

  // Sold comps only — average price-per-sqft applied to this property's own
  // sqft, more accurate than a flat average whenever comps (or the subject)
  // vary in size. Falls back to a flat average of sold prices if sqft data
  // isn't there to support the per-sqft method.
  const market = useMemo(
    () => estimateComparableArv(packet?.comps ?? [], packet?.sqft ?? null),
    [packet?.comps, packet?.sqft],
  );

  // How alike the comps actually are to this property — what qualifies the
  // comparable average rather than presenting it as a bare number.
  const confidence = useMemo(
    () =>
      compSetConfidence(packet?.comps ?? [], {
        sqft: packet?.sqft ?? null,
        beds: packet?.beds ?? null,
        baths: packet?.baths ?? null,
      }),
    [packet?.comps, packet?.sqft, packet?.beds, packet?.baths],
  );

  // The comparable average is the operative ARV whenever comps exist; the
  // figure entered on the packet is the fallback for when they don't.
  const adjustedArv = market?.value ?? packet?.arv ?? null;

  const analysis = useMemo(
    () =>
      analyzeDeal({
        // purchasePrice already includes the assignment fee — the RPC combines
        // them. Passing the fee again here would double-count it and understate
        // the deal.
        purchasePrice: packet?.purchasePrice ?? null,
        arv: adjustedArv,
        repairs: repairTotalValue,
        assignmentFee: null,
        closingCost: packet?.closingCost ?? null,
      }),
    [packet?.purchasePrice, adjustedArv, packet?.closingCost, repairTotalValue],
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
            {adjustedArv != null && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-400">ARV</div>
                <div className="text-2xl font-bold tabular-nums text-sky-300">{money(adjustedArv)}</div>
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
        <PhotoMosaic images={packet.images} onOpen={setLightboxIndex} />

        <DealAnalysisCard analysis={analysis} arv={adjustedArv} market={market} />

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
            <CompTable rows={listings} priceLabel="List price" dateLabel="Listed" scores={confidence?.byId} />
          </Card>
        )}

        {sold.length > 0 && (
          <Card title="Recently sold">
            <CompTable rows={sold} priceLabel="Sale price" dateLabel="Sold" scores={confidence?.byId} />
          </Card>
        )}

        {market && (
          <Card title="Comparable average">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-3xl font-bold tabular-nums text-text">{money(market.value)}</div>
                <div className="mt-0.5 text-[12.5px] text-text-3">
                  {market.method === 'per_sqft'
                    ? `price/sqft across ${market.soldCount} sold comp${market.soldCount === 1 ? '' : 's'}, applied to this property's sq ft`
                    : `flat average across ${market.soldCount} sold comp${market.soldCount === 1 ? '' : 's'}`}
                  {market.listingCount > 0 ? ` (${market.listingCount} active listing${market.listingCount === 1 ? '' : 's'} shown above for reference only)` : ''}
                </div>
              </div>

              {confidence && (
                <div className="text-right">
                  <div className="text-[11px] uppercase tracking-wide text-text-3">Comp confidence</div>
                  <div className="mt-0.5 flex items-baseline justify-end gap-1.5">
                    <span className={`text-2xl font-bold tabular-nums ${confidenceText(confidence.label)}`}>
                      {confidence.score}
                    </span>
                    <span className="text-[13px] text-text-3">/ 10 · {confidence.label}</span>
                  </div>
                </div>
              )}
            </div>

            {market.method === 'per_sqft' ? (
              <div className="mt-3 grid grid-cols-3 gap-3 border-t border-border pt-3">
                <Stat label="Avg sale price" value={money(market.avgSalePrice)} />
                <Stat label="Avg sq ft" value={market.avgSqft?.toLocaleString() ?? '—'} />
                <Stat label="Avg $/sq ft" value={market.avgPricePerSqft != null ? money(Math.round(market.avgPricePerSqft)) : '—'} />
              </div>
            ) : (
              <p className="mt-2 text-[12.5px] leading-snug text-text-3">
                Sold comp prices added together and divided by how many there are — square footage wasn't available
                to price this per square foot instead.
              </p>
            )}

            {confidence && <ConfidenceBlock confidence={confidence} />}
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

      {lightboxIndex !== null && packet.images[lightboxIndex] && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/92 backdrop-blur-sm"
          onClick={() => setLightboxIndex(null)}
        >
          <div className="flex shrink-0 items-center justify-between px-4 py-3 text-white">
            <span className="text-[13px] tabular-nums text-white/70">
              {lightboxIndex + 1} / {packet.images.length}
            </span>
            <button
              onClick={() => setLightboxIndex(null)}
              className="rounded-full p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center px-4">
            {packet.images.length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); step(-1); }}
                className="absolute left-3 z-10 rounded-full bg-white/10 p-2.5 text-white transition-colors hover:bg-white/25"
                aria-label="Previous photo"
              >
                <ChevronLeft size={22} />
              </button>
            )}

            <img
              src={packetImageUrl(packet.images[lightboxIndex].storagePath)}
              alt={packet.images[lightboxIndex].caption ?? 'Property photo'}
              onClick={(e) => e.stopPropagation()}
              className="max-h-full max-w-full rounded-lg object-contain"
            />

            {packet.images.length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); step(1); }}
                className="absolute right-3 z-10 rounded-full bg-white/10 p-2.5 text-white transition-colors hover:bg-white/25"
                aria-label="Next photo"
              >
                <ChevronRight size={22} />
              </button>
            )}
          </div>

          {packet.images.length > 1 && (
            <div
              className="flex shrink-0 justify-center gap-1.5 overflow-x-auto px-4 py-3"
              onClick={(e) => e.stopPropagation()}
            >
              {packet.images.map((img, i) => (
                <button
                  key={img.id}
                  onClick={() => setLightboxIndex(i)}
                  className={`h-12 w-16 shrink-0 overflow-hidden rounded transition-all ${
                    i === lightboxIndex ? 'ring-2 ring-white' : 'opacity-50 hover:opacity-90'
                  }`}
                >
                  <img src={packetImageUrl(img.storagePath)} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
