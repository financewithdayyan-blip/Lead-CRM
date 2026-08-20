import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, Loader2, Lock, MapPin, Send, X } from 'lucide-react';
import { useLogPacketView, usePacketArea, usePublicPacket, type PublicPacketComp } from '@/hooks/usePublicPacket';
// Leaflet plus its CSS is a meaningful chunk, and a packet with no mapped
// addresses never needs it.
const PacketMap = lazy(() => import('@/components/packets/PacketMap').then((m) => ({ default: m.PacketMap })));
import { analyzeDeal, compSetConfidence, estimateComparableArv, type CompScore, type ComparableEstimate, type DealAnalysis, type SetConfidence } from '@/hooks/useDealPackets';
import { VERDICT_STYLE } from '@/lib/dealVerdict';
import { useAnnouncePacketPresence } from '@/hooks/usePacketPresence';
import { getViewerIdentity, saveViewerIdentity, type ViewerIdentity } from '@/lib/viewerToken';
import { packetImageUrl, packetVideoUrl } from '@/hooks/useDealPackets';
import { DEAL_TYPE_CONFIG } from '@/types/domain';

const money = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** Big serif figure used for both the property-detail grid and the comp breakdown. */
function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-text-3">{label}</div>
      <div className="mt-1 font-serif text-[19px] font-bold text-text">{value}</div>
    </div>
  );
}

/** Numbered magazine-style break that opens every content section. */
function SectionHead({ num, title }: { num: number; title: string }) {
  return (
    <div className="mb-3.5 flex items-baseline gap-3.5">
      <span className="shrink-0 rounded-full bg-accent-dim px-2.5 py-0.5 font-mono text-[11px] font-bold text-accent-hover">
        {String(num).padStart(2, '0')}
      </span>
      <span className="shrink-0 font-serif text-[19px] font-semibold text-text">{title}</span>
      <span className="h-px flex-1 bg-gradient-to-r from-border-2 to-transparent" />
    </div>
  );
}

/** Plain white section container — the numbering above it carries the title now. */
function Panel({ children }: { children: React.ReactNode }) {
  return <section className="rounded-2xl border border-border bg-surface p-6 shadow-card">{children}</section>;
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
    // A long address squeezed into a shrinking column used to wrap across
    // five or six lines on narrow screens while the numeric columns got
    // crushed alongside it — min-w on the table keeps every column at a
    // sane width instead, letting this scroll horizontally as one unit
    // (the normal, expected mobile-table pattern) rather than each column
    // fighting the others for space.
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-[12.5px]">
        <thead className="border-b-2 border-border-2 text-[10.5px] font-bold uppercase tracking-wide text-text-3">
          <tr>
            <th className="w-[150px] pb-2.5 pr-3">Address</th>
            <th className="pb-2.5 pr-3 text-right">{priceLabel}</th>
            <th className="pb-2.5 pr-3 text-right">Bed</th>
            <th className="pb-2.5 pr-3 text-right">Bath</th>
            <th className="pb-2.5 pr-3 text-right">Sq ft</th>
            <th className="pb-2.5 pr-3 text-right">{dateLabel}</th>
            {scores && <th className="pb-2.5 text-right">Match</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-b border-border last:border-b-0">
              <td className="max-w-[150px] truncate py-2.5 pr-3 font-medium text-text-2" title={c.address ?? undefined}>{c.address || '—'}</td>
              <td className="py-2.5 pr-3 text-right font-mono font-semibold tabular-nums text-text">{money(c.salePrice)}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-text-2">{c.beds ?? '—'}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-text-2">{c.baths ?? '—'}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-text-2">{c.sqft?.toLocaleString() ?? '—'}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-text-3">
                {c.saleDate ? new Date(c.saleDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}
              </td>
              {scores && (
                <td className="py-2.5 text-right">
                  {scores[c.id] ? (
                    <span
                      className={`inline-block rounded-full px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums ${matchTone(scores[c.id].score)}`}
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
    <div className="mt-4 border-t border-border pt-3.5">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border-2">
        <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${confidence.score * 10}%` }} />
      </div>
      <ul className="mt-2.5 space-y-1">
        {confidence.notes.map((n, i) => (
          <li key={i} className="flex gap-2 text-[11.5px] leading-snug text-text-3">
            <span className="mt-1.5 h-[3.5px] w-[3.5px] shrink-0 rounded-full bg-current opacity-50" />
            {n}
          </li>
        ))}
      </ul>
    </div>
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

  const Tile = ({ img, index, className, overlay, width }: { img: PacketPhoto; index: number; className: string; overlay?: number; width: number }) => (
    <button onClick={() => onOpen(index)} className={`group relative overflow-hidden rounded-xl border border-border ${className}`}>
      <img
        src={packetImageUrl(img.storagePath, { width, quality: 72 })}
        alt={img.caption ?? 'Property photo'}
        loading={index === 0 ? undefined : 'lazy'}
        decoding="async"
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
    return <Tile img={images[0]} index={0} className="block h-72 w-full sm:h-[420px]" width={1200} />;
  }

  if (images.length === 2) {
    return (
      <div className="grid h-56 grid-cols-2 gap-2 sm:h-[420px]">
        {images.map((img, i) => <Tile key={img.id} img={img} index={i} className="h-full" width={700} />)}
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
      <Tile img={images[0]} index={0} className="col-span-2 h-56 sm:row-span-2 sm:h-full" width={900} />
      {thumbs.map((img, i) => (
        <Tile
          key={img.id}
          img={img}
          index={i + 1}
          className="h-28 sm:h-full"
          width={360}
          overlay={extra > 0 && i === thumbs.length - 1 ? extra : undefined}
        />
      ))}
    </div>
  );
}

interface PacketVideoClip {
  id: string;
  storagePath: string;
  caption: string | null;
}

/** Walkthrough clips, below the photo mosaic — one per row so controls stay usable at any length. */
function VideoGrid({ videos }: { videos: PacketVideoClip[] }) {
  if (!videos.length) return null;
  return (
    <div className={`grid gap-2 ${videos.length > 1 ? 'sm:grid-cols-2' : ''}`}>
      {videos.map((v) => (
        <video
          key={v.id}
          src={packetVideoUrl(v.storagePath)}
          controls
          playsInline
          preload="metadata"
          className="aspect-video w-full rounded-xl border border-border bg-black"
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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-sidebar-2 via-sidebar to-[#081527] p-4">
      <form
        className="w-full max-w-sm rounded-2xl border border-border bg-surface p-7 shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit({ name: name.trim() });
        }}
      >
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">Investment Opportunity</div>
        <h1 className="mt-1.5 font-serif text-[19px] font-semibold text-text">Who's viewing?</h1>
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
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className={`text-[13px] ${strong ? 'font-semibold text-text' : 'text-text-2'}`}>
        {label}
        {hint && <span className="ml-1.5 text-[11px] font-normal text-text-3">{hint}</span>}
      </dt>
      <dd className={`shrink-0 font-mono tabular-nums ${strong ? `text-[15px] font-bold ${toneClass}` : 'text-[13px] font-medium text-text'}`}>
        {sign && value != null ? sign : ''}{money(value)}
      </dd>
    </div>
  );
}

/** Verdict, equity as the centerpiece, and an itemised breakdown beneath it. */
function DealAnalysisCard({ analysis, arv, market }: { analysis: DealAnalysis; arv: number | null; market: ComparableEstimate | null }) {
  const style = VERDICT_STYLE[analysis.verdict];
  // Driven by the same margin the verdict badge is computed from — headroom
  // against MAO is a different number and could show a near-empty "thin"
  // looking meter on a deal the badge above it calls Strong. Scaled to a 30%
  // margin ceiling (10 points past the "strong" threshold) so a strong deal
  // reads as a mostly-full bar rather than pinned to the far edge.
  const fill = analysis.margin != null ? Math.max(3, Math.min(100, (analysis.margin / 0.3) * 100)) : 0;
  // Keeps the "You are here" label fully inside the track even when the fill
  // is near either end, instead of letting its centred text clip against the
  // card's rounded corner.
  const labelPos = Math.max(8, Math.min(92, fill));
  const tone = analysis.verdict === 'strong' ? 'emerald' : analysis.verdict === 'fair' ? 'amber' : 'rose';
  const equityColor = tone === 'emerald' ? 'text-emerald-300' : tone === 'amber' ? 'text-amber-300' : 'text-rose-300';
  const meterFillClass =
    tone === 'emerald' ? 'from-emerald-400 to-emerald-300' : tone === 'amber' ? 'from-amber-400 to-amber-300' : 'from-rose-500 to-rose-400';
  const meterLabelClass = tone === 'emerald' ? 'text-emerald-300' : tone === 'amber' ? 'text-amber-300' : 'text-rose-300';

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
      <div className="bg-gradient-to-br from-sidebar to-sidebar-2 px-7 py-6 text-white">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10.5px] font-extrabold uppercase tracking-wide ${style.pill}`}>
          <Check size={10} strokeWidth={3.5} />
          {style.label}
        </span>

        {analysis.spread != null ? (
          <>
            <div className={`mt-3 font-serif text-[36px] font-bold sm:text-[44px] ${equityColor}`}>{money(analysis.spread)}</div>
            <p className="mt-1 max-w-md text-[13px] leading-relaxed text-[#B9C6D6]">{analysis.notes[0]}</p>
          </>
        ) : (
          <p className="mt-3 max-w-md text-[14px] font-medium leading-snug text-white">{analysis.notes[0]}</p>
        )}

        {analysis.margin != null && (
          <div className="mt-5">
            <div className="relative h-2 rounded-full bg-white/[0.14]">
              <span
                className={`absolute -top-[19px] -translate-x-1/2 font-mono text-[10.5px] font-bold ${meterLabelClass}`}
                style={{ left: `${labelPos}%` }}
              >
                You are here
              </span>
              <div className={`h-full rounded-full bg-gradient-to-r ${meterFillClass}`} style={{ width: `${fill}%` }} />
            </div>
            <div className="mt-1.5 flex justify-between text-[10px] text-[#7691AC]">
              <span>Thin margin</span>
              <span>Strong margin</span>
            </div>
          </div>
        )}
      </div>

      <div className="grid sm:grid-cols-2">
        <div className="px-7 py-5">
          <div className="mb-2 text-[10.5px] font-bold uppercase tracking-wide text-text-3">Buyer's cost</div>
          <dl>
            <Line label="Asking price" value={analysis.askingPrice} />
            <Line label="Repairs" value={analysis.repairs} sign="+" />
            {analysis.closingCost != null && (
              <Line label="Closing costs" value={analysis.closingCost} sign="+" hint="paid by buyer" />
            )}
            <div className="mt-1 border-t border-border pt-1.5">
              <Line label="All-in cost" value={analysis.allIn} strong />
            </div>
          </dl>
        </div>

        <div className="border-t border-border px-7 py-5 sm:border-l sm:border-t-0">
          <div className="mb-2 text-[10.5px] font-bold uppercase tracking-wide text-text-3">Value</div>
          <dl>
            <Line label="ARV" value={arv} hint={market ? 'comparable average' : undefined} />
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
            <div className="mt-1 border-t border-border pt-1.5">
              <Line
                label="Projected equity"
                value={analysis.spread}
                strong
                hint={analysis.margin != null ? `${Math.round(analysis.margin * 100)}% of ARV` : undefined}
                tone={analysis.spread != null && analysis.spread < 0 ? 'bad' : 'good'}
              />
            </div>
          </dl>
        </div>
      </div>

      <p className="border-t border-border bg-surface-2 px-7 py-3 text-[11px] leading-snug text-text-3">
        Figures are estimates provided for evaluation and are not a warranty or an offer.
      </p>
    </div>
  );
}

export function PublicPacketPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: packet, isLoading, isError } = usePublicPacket(slug);
  const { data: area } = usePacketArea(slug);
  const logView = useLogPacketView();

  const [identity, setIdentity] = useState<ViewerIdentity | null>(() => (slug ? getViewerIdentity(slug) : null));
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // The right-sized image transform (see packetImageUrl) renders on demand on
  // a cache miss, which can take a couple of seconds — without this, the
  // lightbox kept showing the *previous* photo's pixels with no indication
  // anything was happening while the new one loaded, which read as frozen.
  const [mainImageLoading, setMainImageLoading] = useState(false);
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

  useEffect(() => {
    if (lightboxIndex !== null) setMainImageLoading(true);
  }, [lightboxIndex]);

  // Warms the transform cache for the photo on either side of whichever one
  // is open, so the common case — stepping through with the arrows — only
  // pays the render-on-miss cost once instead of on every step.
  useEffect(() => {
    if (lightboxIndex === null || !packet?.images.length || imageCount < 2) return;
    for (const delta of [1, -1]) {
      const neighbor = packet.images[(lightboxIndex + delta + imageCount) % imageCount];
      if (neighbor) new Image().src = packetImageUrl(neighbor.storagePath, { width: 1920, quality: 82 });
    }
  }, [lightboxIndex, packet?.images, imageCount]);

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
  // Free geocoding can't resolve every address — a silent gap between the
  // comp table and the pin count reads as a bug, so it's called out plainly
  // instead of just showing fewer pins than comps with no explanation.
  const unmappedCompCount = useMemo(
    () => (packet?.comps ?? []).filter((c) => c.address && (c.lat == null || c.lng == null)).length,
    [packet?.comps],
  );
  const subjectCenter = useMemo(
    () => (packet?.subjectLat != null && packet?.subjectLng != null ? { lat: packet.subjectLat, lng: packet.subjectLng } : null),
    [packet?.subjectLat, packet?.subjectLng],
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

  // Purchase price / ARV / repairs / equity — whichever of these the admin
  // actually filled in, floated in the hero's glass stat strip in that order.
  const statItems = useMemo(() => {
    const items: { label: string; value: string; valueClass: string }[] = [];
    if (packet?.purchasePrice != null) items.push({ label: 'Purchase Price', value: money(packet.purchasePrice), valueClass: 'text-white' });
    if (adjustedArv != null) items.push({ label: 'ARV', value: money(adjustedArv), valueClass: 'text-sky-300' });
    if (repairTotalValue > 0) items.push({ label: 'Est. Repairs', value: money(repairTotalValue), valueClass: 'text-white' });
    if (analysis.spread != null) {
      items.push({
        label: 'Projected Equity',
        value: money(analysis.spread),
        valueClass: analysis.spread >= 0 ? 'text-emerald-300' : 'text-rose-300',
      });
    }
    return items;
  }, [packet?.purchasePrice, adjustedArv, repairTotalValue, analysis.spread]);

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

  // Every content section below, in reading order, skipped whenever the admin
  // left that part empty. Numbering comes from position in this list, not a
  // fixed constant, since which sections actually render varies per packet.
  const sections: { title: string; body: React.ReactNode }[] = [];

  if (packet.images.length > 0 || packet.videos.length > 0) {
    sections.push({
      title: 'The Property',
      body: (
        <div className="space-y-3">
          <PhotoMosaic images={packet.images} onOpen={setLightboxIndex} />
          <VideoGrid videos={packet.videos} />
        </div>
      ),
    });
  }

  sections.push({ title: 'Deal Analysis', body: <DealAnalysisCard analysis={analysis} arv={adjustedArv} market={market} /> });

  if (packet.narrative) {
    sections.push({
      title: 'The Opportunity',
      body: (
        <Panel>
          {packet.narrative.split('\n').filter((l) => l.trim()).map((line, i) => (
            <div key={i} className="mt-3 flex gap-2.5 text-[14.5px] leading-relaxed text-text-2 first:mt-0">
              <span className="shrink-0 font-serif text-[20px] font-bold leading-[1.2] text-accent">&ldquo;</span>
              {line.trim()}
            </div>
          ))}
        </Panel>
      ),
    });
  }

  sections.push({
    title: 'Property Detail',
    body: (
      <Panel>
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat label="Beds" value={packet.beds ?? '—'} />
          <Stat label="Baths" value={packet.baths ?? '—'} />
          <Stat label="Sq ft" value={packet.sqft?.toLocaleString() ?? '—'} />
          <Stat label="Year built" value={packet.yearBuilt ?? '—'} />
          {packet.showAssignmentFee && packet.assignmentFee != null && (
            <Stat label="Assignment fee" value={money(packet.assignmentFee)} />
          )}
        </div>
      </Panel>
    ),
  });

  if (packet.dealTypes.length > 0) {
    sections.push({
      title: 'Deal Structures Available',
      body: (
        <div className="grid gap-3.5 sm:grid-cols-2">
          {packet.dealTypes.map((t, i) => {
            const cfg = DEAL_TYPE_CONFIG[t];
            if (!cfg) return null;
            const navy = i % 2 === 0;
            return (
              <div
                key={t}
                className={`rounded-2xl p-5 ${navy ? 'bg-gradient-to-br from-sidebar to-sidebar-2 text-white' : 'bg-gradient-to-br from-accent to-accent-hover text-text'}`}
              >
                <div className="font-serif text-[15px] font-bold">{cfg.label}</div>
                <p className={`mt-1.5 text-[12px] leading-relaxed ${navy ? 'text-white/85' : 'text-text/80'}`}>{cfg.description}</p>
              </div>
            );
          })}
        </div>
      ),
    });
  }

  if (mapPins.length > 0) {
    sections.push({
      title: 'The Area',
      body: (
        <Panel>
          <Suspense fallback={<div className="h-72 animate-pulse rounded-xl bg-surface-3" />}>
            <PacketMap pins={mapPins} center={subjectCenter} />
          </Suspense>
          {unmappedCompCount > 0 && (
            <p className="mt-2.5 text-[11.5px] text-text-3">
              {unmappedCompCount} comp{unmappedCompCount !== 1 ? 's' : ''} couldn't be placed on the map — still listed in the tables below.
            </p>
          )}
        </Panel>
      ),
    });
  }

  if (listings.length > 0 || sold.length > 0) {
    sections.push({
      title: 'Comparable Sales',
      body: (
        <div className="space-y-3.5">
          {listings.length > 0 && (
            <Panel>
              <div className="text-[10.5px] font-bold uppercase tracking-wide text-text-3">Currently on the Market</div>
              <div className="mt-2.5"><CompTable rows={listings} priceLabel="List Price" dateLabel="Listed" scores={confidence?.byId} /></div>
            </Panel>
          )}
          {sold.length > 0 && (
            <Panel>
              <div className="text-[10.5px] font-bold uppercase tracking-wide text-text-3">Recently Sold</div>
              <div className="mt-2.5"><CompTable rows={sold} priceLabel="Sale Price" dateLabel="Sold" scores={confidence?.byId} /></div>
            </Panel>
          )}
        </div>
      ),
    });
  }

  if (market) {
    sections.push({
      title: 'Comparable Average',
      body: (
        <Panel>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="font-serif text-[34px] font-bold text-text">{money(market.value)}</div>
              <div className="mt-1 max-w-md text-[12px] leading-snug text-text-3">
                {market.method === 'per_sqft'
                  ? `price/sqft across ${market.soldCount} sold comp${market.soldCount === 1 ? '' : 's'}, applied to this property's sq ft`
                  : `flat average across ${market.soldCount} sold comp${market.soldCount === 1 ? '' : 's'}`}
                {market.listingCount > 0 ? ` (${market.listingCount} active listing${market.listingCount === 1 ? '' : 's'} shown above for reference only)` : ''}
              </div>
            </div>

            {confidence && (
              <div className="text-right">
                <div className="text-[10.5px] font-semibold uppercase tracking-wide text-text-3">Comp confidence</div>
                <div className="mt-1 flex items-baseline justify-end gap-1.5">
                  <span className={`font-mono text-[26px] font-extrabold tabular-nums ${confidenceText(confidence.label)}`}>
                    {confidence.score}
                  </span>
                  <span className="text-[13px] text-text-3">/ 10 · {confidence.label}</span>
                </div>
              </div>
            )}
          </div>

          {market.method === 'per_sqft' ? (
            <div className="mt-4 grid grid-cols-3 gap-4 border-t border-border pt-4">
              <Stat label="Avg sale price" value={money(market.avgSalePrice)} />
              <Stat label="Avg sq ft" value={market.avgSqft?.toLocaleString() ?? '—'} />
              <Stat label="Avg $/sq ft" value={market.avgPricePerSqft != null ? money(Math.round(market.avgPricePerSqft)) : '—'} />
            </div>
          ) : (
            <p className="mt-2.5 text-[12.5px] leading-snug text-text-3">
              Sold comp prices added together and divided by how many there are — square footage wasn't available
              to price this per square foot instead.
            </p>
          )}

          {confidence && <ConfidenceBlock confidence={confidence} />}
        </Panel>
      ),
    });
  }

  if (packet.repairs.length > 0) {
    sections.push({
      title: 'Repair Estimate',
      body: (
        <Panel>
          <table className="w-full text-left text-[13px]">
            <tbody>
              {packet.repairs.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-b-0">
                  <td className="py-2.5 text-text-2">{r.item || '—'}</td>
                  <td className="py-2.5 text-right font-mono font-medium tabular-nums text-text">{money(r.cost)}</td>
                </tr>
              ))}
              <tr>
                <td className="pt-3 text-[13px] font-semibold text-text">Total</td>
                <td className="pt-3 text-right font-mono text-[15px] font-bold tabular-nums text-text">{money(repairTotalValue)}</td>
              </tr>
            </tbody>
          </table>
        </Panel>
      ),
    });
  }

  return (
    <div className="min-h-screen bg-surface-2 pb-16">
      {/* Full-bleed navy/gold hero — the address is never in this payload by
          design (get_public_packet withholds it), so the property type carries
          the headline instead, same as the packet's own admin-facing label. */}
      <header
        className="relative overflow-hidden bg-gradient-to-br from-sidebar-2 via-sidebar to-[#081527] text-white"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 900px 500px at 82% 8%, rgba(201,162,75,.28), transparent 60%), repeating-linear-gradient(115deg, rgba(255,255,255,.05) 0 1px, transparent 1px 74px), linear-gradient(200deg, #0d3a63 0%, #0B1E33 45%, #081527 100%)',
        }}
      >
        <div className="relative mx-auto flex max-w-5xl items-center gap-2 px-5 pt-6 sm:px-8">
          <div className="flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-lg bg-primary">
            <Send size={13} className="text-white" />
          </div>
          <div className="font-serif text-[14px]"><span className="font-bold">Bluebird</span> <span className="font-medium text-[#8CA0B8]">Acquisition</span></div>
        </div>

        {analysis.verdict !== 'unknown' && (
          <div className="absolute right-5 top-6 z-[2] flex items-center gap-2 rounded-full bg-gradient-to-br from-accent to-accent-hover py-2 pl-2.5 pr-4 shadow-[0_10px_24px_-8px_rgba(201,162,75,0.55)] sm:right-8">
            <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#0B1E33]/[0.18]">
              <Check size={11} strokeWidth={3.5} className="text-sidebar" />
            </div>
            <div className="leading-tight">
              <div className="text-[9px] font-bold uppercase tracking-wide text-sidebar/65">Deal Rating</div>
              <div className="font-serif text-[15px] font-bold text-sidebar">{VERDICT_STYLE[analysis.verdict].label}</div>
            </div>
          </div>
        )}

        <div className="relative mx-auto max-w-5xl px-5 pt-8 sm:px-8">
          <div className="flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-[0.2em] text-accent">
            <span className="h-px w-[22px] bg-accent" />
            Investment Opportunity
          </div>
          <h1 className="mt-3.5 font-serif text-[32px] font-semibold leading-[1.05] tracking-tight sm:text-[44px]">
            {packet.propType || 'Property'}
          </h1>
          <div className="mt-2.5 flex items-center gap-1.5 text-[14px] font-medium text-[#AEC2D8]">
            <MapPin size={14} className="shrink-0" />
            {areaLine || 'Location available on enquiry'}
          </div>
        </div>

        {statItems.length > 0 && <div className="h-16 sm:h-[76px]" />}
      </header>

      {statItems.length > 0 && (
        <div className="relative z-[3] mx-auto -mt-14 max-w-5xl px-5 sm:-mt-16 sm:px-8">
          {/* Two columns on mobile — four flex-1 columns of "$1,234,567"-length
              values refuse to shrink below their content width (flex/grid
              items default to min-width:auto), which forced the whole page
              wider than the viewport and dragged everything else off-screen
              with it. Two per row leaves each cell roughly double the room,
              and min-w-0 + truncate is the backstop for anything still too
              long. Back to one row of four from sm: up, where there's space. */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-4 rounded-[20px] border border-white/[0.14] bg-sidebar/60 p-5 shadow-[0_24px_48px_-20px_rgba(11,30,51,0.45)] backdrop-blur-md sm:flex sm:gap-0 sm:divide-x sm:divide-accent/20 sm:py-5">
            {statItems.map((s) => (
              <div key={s.label} className="min-w-0 text-center sm:flex-1 sm:px-6 sm:text-left">
                <div className="truncate text-[10px] font-bold uppercase tracking-wide text-[#8CA0B8]">{s.label}</div>
                <div className={`mt-1 truncate font-serif text-[19px] font-bold sm:text-[26px] ${s.valueClass}`}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <main className={`mx-auto max-w-5xl px-5 sm:px-8 ${statItems.length > 0 ? 'pt-6' : 'pt-8'}`}>
        {(packet.leadStatus || packet.beds != null || packet.baths != null || packet.sqft != null || packet.yearBuilt != null) && (
          <div className="mb-7 flex flex-wrap gap-2">
            {packet.leadStatus && (
              <span className="rounded-full bg-accent-dim px-3 py-1.5 text-[12px] font-semibold text-accent-hover">{packet.leadStatus}</span>
            )}
            {packet.beds != null && <span className="rounded-full border border-border-2 bg-surface-3 px-3 py-1.5 text-[12px] font-semibold text-text-2">{packet.beds} bed</span>}
            {packet.baths != null && <span className="rounded-full border border-border-2 bg-surface-3 px-3 py-1.5 text-[12px] font-semibold text-text-2">{packet.baths} bath</span>}
            {packet.sqft != null && <span className="rounded-full border border-border-2 bg-surface-3 px-3 py-1.5 text-[12px] font-semibold text-text-2">{packet.sqft.toLocaleString()} sq ft</span>}
            {packet.yearBuilt != null && <span className="rounded-full border border-border-2 bg-surface-3 px-3 py-1.5 text-[12px] font-semibold text-text-2">Built {packet.yearBuilt}</span>}
          </div>
        )}

        <div className="space-y-8 pb-2">
          {sections.map((s, i) => (
            <div key={s.title}>
              <SectionHead num={i + 1} title={s.title} />
              {s.body}
            </div>
          ))}
        </div>

        <p className="mt-8 px-1 text-center text-[11px] text-text-3">
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

            {mainImageLoading && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <Loader2 size={28} className="animate-spin text-white/70" />
              </div>
            )}
            <img
              src={packetImageUrl(packet.images[lightboxIndex].storagePath, { width: 1920, quality: 82 })}
              alt={packet.images[lightboxIndex].caption ?? 'Property photo'}
              onClick={(e) => e.stopPropagation()}
              onLoad={() => setMainImageLoading(false)}
              decoding="async"
              className={`max-h-full max-w-full rounded-lg object-contain transition-opacity duration-200 ${mainImageLoading ? 'opacity-30' : 'opacity-100'}`}
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
                  <img
                    src={packetImageUrl(img.storagePath, { width: 128, quality: 60 })}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
