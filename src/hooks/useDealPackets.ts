import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type {
  DealPacket,
  DealType,
  Lead,
  PacketComp,
  PacketImage,
  PacketRepair,
  PacketStatus,
  PacketView,
} from '@/types/domain';

const PACKET_SELECT = '*, packet_comps(*), packet_repairs(*), packet_images(*)';

// ── Mappers ─────────────────────────────────────────────────────────────────

function dbToPacket(row: any): DealPacket {
  const bySort = (a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0);
  return {
    id: row.id,
    leadId: row.lead_id,
    userId: row.user_id,
    slug: row.slug,
    status: row.status as PacketStatus,
    ownerName: row.owner_name,
    propType: row.prop_type,
    beds: row.beds,
    baths: row.baths,
    sqft: row.sqft,
    yearBuilt: row.year_built,
    market: row.market,
    leadStatus: row.lead_status,
    city: row.city,
    state: row.state,
    zip: row.zip,
    purchasePrice: row.purchase_price,
    closingCost: row.closing_cost,
    arv: row.arv,
    arvIsManual: row.arv_is_manual ?? false,
    assignmentFee: row.assignment_fee,
    showAssignmentFee: row.show_assignment_fee ?? false,
    dealTypes: (row.deal_types ?? []) as DealType[],
    narrative: row.narrative,
    requireLeadCapture: row.require_lead_capture ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    comps: (row.packet_comps ?? []).sort(bySort).map(
      (c: any): PacketComp => ({
        id: c.id,
        kind: (c.kind ?? 'sold') as PacketComp['kind'],
        address: c.address,
        salePrice: c.sale_price,
        saleDate: c.sale_date,
        sqft: c.sqft,
        beds: c.beds != null ? Number(c.beds) : null,
        baths: c.baths != null ? Number(c.baths) : null,
        lat: c.lat != null ? Number(c.lat) : null,
        lng: c.lng != null ? Number(c.lng) : null,
      }),
    ),
    repairs: (row.packet_repairs ?? []).sort(bySort).map(
      (r: any): PacketRepair => ({ id: r.id, item: r.item, cost: Number(r.cost ?? 0) }),
    ),
    images: (row.packet_images ?? []).sort(bySort).map(
      (i: any): PacketImage => ({ id: i.id, storagePath: i.storage_path, caption: i.caption }),
    ),
  };
}

function dbToView(row: any): PacketView {
  return {
    id: row.id,
    packetId: row.packet_id,
    viewerToken: row.viewer_token,
    viewerName: row.viewer_name,
    viewerEmail: row.viewer_email,
    viewerPhone: row.viewer_phone,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  };
}

// ── Derived values ──────────────────────────────────────────────────────────

/** Straight average of comp price-per-sqft applied to the subject's sqft. */
export function computeArvFromComps(comps: PacketComp[], subjectSqft: number | null): number | null {
  if (!subjectSqft) return null;
  // Listings are asking prices, not achieved ones — only sold comps set ARV.
  const usable = comps.filter((c) => c.kind !== 'listing' && c.salePrice && c.sqft);
  if (!usable.length) return null;
  const avgPerSqft = usable.reduce((sum, c) => sum + c.salePrice! / c.sqft!, 0) / usable.length;
  return Math.round(avgPerSqft * subjectSqft);
}

export function repairTotal(repairs: PacketRepair[]): number {
  return repairs.reduce((sum, r) => sum + (Number(r.cost) || 0), 0);
}

export interface MarketEstimate {
  /** Mean price across every comparable, sold and listed alike. */
  value: number;
  soldCount: number;
  listingCount: number;
  total: number;
}

/**
 * Cost-averaged ARV: every comparable price added together and divided by how
 * many there are, sold and currently-listed alike.
 *
 * A flat mean of prices rather than an average price per square foot — it does
 * not need the subject's footprint, so it still produces a figure when sq ft is
 * missing from the packet or from individual comps.
 *
 * This is the operative ARV on the packet whenever comps exist; the figure
 * entered by the admin is the fallback for when they don't. computeArvFromComps
 * (sold prices only) still feeds the admin's own in-builder suggestion.
 */
export function estimateMarketArv(
  comps: Pick<PacketComp, 'kind' | 'salePrice'>[],
): MarketEstimate | null {
  const usable = comps.filter((c) => c.salePrice != null && c.salePrice > 0);
  if (!usable.length) return null;

  const sum = usable.reduce((acc, c) => acc + c.salePrice!, 0);

  return {
    value: Math.round(sum / usable.length),
    soldCount: usable.filter((c) => c.kind !== 'listing').length,
    listingCount: usable.filter((c) => c.kind === 'listing').length,
    total: usable.length,
  };
}

// ── Comp confidence ─────────────────────────────────────────────────────────

export interface SubjectSpec {
  sqft: number | null;
  beds: number | null;
  baths: number | null;
}

export interface CompScore {
  /** Whole number 0-10. How closely this property matches the subject. */
  score: number;
  /** What cost it points, in descending severity. */
  reasons: string[];
}

/**
 * How comparable one property is to the subject, out of ten.
 *
 * No two houses are identical, so the bands allow real-world tolerance: square
 * footage within 12% and baths within one scores as a like-for-like match.
 * Beyond that the score decays rather than dropping off a cliff, because a 20%
 * size difference is weaker evidence, not worthless evidence.
 *
 * Weighted by how much each attribute actually moves value — footprint most,
 * then bedroom count, then baths. A missing attribute scores zero for that
 * dimension: an unrecorded square footage is genuinely unknown comparability,
 * not neutral, and pretending otherwise would inflate confidence in the ARV.
 */
export function scoreComp(comp: Pick<PacketComp, 'sqft' | 'beds' | 'baths'>, subject: SubjectSpec): CompScore {
  const reasons: string[] = [];
  let score = 0;

  // Square footage — 5 of 10.
  if (comp.sqft && subject.sqft) {
    const diff = Math.abs(comp.sqft - subject.sqft) / subject.sqft;
    if (diff <= 0.12) {
      score += 5;
    } else if (diff <= 0.3) {
      // Straight decay from full marks at 12% to nothing at 30%.
      score += 5 * (1 - (diff - 0.12) / 0.18);
      reasons.push(`${Math.round(diff * 100)}% size difference`);
    } else {
      reasons.push(`${Math.round(diff * 100)}% size difference`);
    }
  } else {
    reasons.push('no square footage recorded');
  }

  // Bedrooms — 3 of 10.
  if (comp.beds != null && subject.beds != null) {
    const diff = Math.abs(comp.beds - subject.beds);
    if (diff === 0) score += 3;
    else if (diff <= 1) {
      score += 1.5;
      reasons.push(`${diff} bedroom difference`);
    } else {
      reasons.push(`${diff} bedroom difference`);
    }
  } else {
    reasons.push('no bedroom count');
  }

  // Baths — 2 of 10. One either way is normal between otherwise-alike houses.
  if (comp.baths != null && subject.baths != null) {
    const diff = Math.abs(comp.baths - subject.baths);
    if (diff === 0) score += 2;
    else if (diff <= 1) score += 1.4;
    else if (diff <= 2) {
      score += 0.6;
      reasons.push(`${diff} bathroom difference`);
    } else {
      reasons.push(`${diff} bathroom difference`);
    }
  } else {
    reasons.push('no bathroom count');
  }

  // Whole numbers only — a comp is a 9 or a 10, not a 9.4. The extra decimal
  // implied a precision the underlying judgement doesn't have.
  return { score: Math.round(score), reasons };
}

export interface SetConfidence {
  /** Whole number 0-10 across the whole comp set. */
  score: number;
  label: 'High' | 'Moderate' | 'Low';
  /** Per-comp scores, keyed by comp id. */
  byId: Record<string, CompScore>;
  notes: string[];
}

/**
 * Confidence in the comparable average as a whole — the honest answer to "how
 * much should I trust this ARV".
 *
 * Starts from the mean comp score, then discounts for the two things that
 * undermine an average regardless of how alike the individual properties are:
 * too few data points, and prices scattered too widely to average meaningfully.
 */
export function compSetConfidence(
  comps: (Pick<PacketComp, 'sqft' | 'beds' | 'baths' | 'salePrice'> & { id: string })[],
  subject: SubjectSpec,
): SetConfidence | null {
  if (!comps.length) return null;

  const byId: Record<string, CompScore> = {};
  for (const c of comps) byId[c.id] = scoreComp(c, subject);

  const notes: string[] = [];
  // Averaged over the rounded scores actually shown, so the overall figure
  // always reconciles with the individual badges.
  const mean = comps.reduce((sum, c) => sum + byId[c.id].score, 0) / comps.length;
  let score = mean;

  if (comps.length < 3) {
    score *= 0.8;
    notes.push(`Only ${comps.length} comparable${comps.length === 1 ? '' : 's'} — a small sample to average.`);
  } else if (comps.length < 5) {
    score *= 0.92;
    notes.push(`${comps.length} comparables is a workable sample, though more would tighten the estimate.`);
  } else {
    notes.push(`${comps.length} comparables is a solid sample.`);
  }

  // Coefficient of variation on price: a wide spread means the average sits in
  // the middle of numbers that don't agree with each other.
  const priced = comps.filter((c) => c.salePrice && c.salePrice > 0);
  if (priced.length >= 2) {
    const avg = priced.reduce((s, c) => s + c.salePrice!, 0) / priced.length;
    const sd = Math.sqrt(priced.reduce((s, c) => s + (c.salePrice! - avg) ** 2, 0) / priced.length);
    const cv = sd / avg;
    if (cv > 0.2) {
      score *= 0.85;
      notes.push(`Prices vary widely (±${Math.round(cv * 100)}%), so the average carries more uncertainty.`);
    } else if (cv > 0.1) {
      notes.push(`Prices are reasonably clustered (±${Math.round(cv * 100)}%).`);
    } else {
      notes.push(`Prices are tightly clustered (±${Math.round(cv * 100)}%), which supports the average.`);
    }
  }

  const rounded = Math.round(Math.min(10, score));
  return {
    score: rounded,
    label: rounded >= 7.5 ? 'High' : rounded >= 5 ? 'Moderate' : 'Low',
    byId,
    notes,
  };
}

// ── Deal analysis ───────────────────────────────────────────────────────────

export type DealVerdict = 'strong' | 'fair' | 'thin' | 'unknown';

export interface DealAnalysis {
  verdict: DealVerdict;
  /** The quoted asking price — the first line of the buyer's breakdown. */
  askingPrice: number | null;
  /** Total repair estimate, carried through so the card can itemise it. */
  repairs: number;
  /** Entered by the admin. Paid by the buyer at closing, so it counts toward all-in. */
  closingCost: number | null;
  /** What the buyer is all-in for: quoted price + repairs + closing costs. */
  allIn: number | null;
  /** ARV minus all-in — the equity left at resale value. */
  spread: number | null;
  /** Spread as a share of ARV. */
  margin: number | null;
  /** Max allowable offer: (ARV x 90%) - 2x repairs. */
  mao: number | null;
  /** MAO minus the quoted price. Negative means the price is over the max. */
  headroom: number | null;
  overMao: boolean;
  /** Plain-language reasons behind the verdict, strongest first. */
  notes: string[];
}

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/**
 * Verdict from projected equity — ARV less everything the buyer spends, as a
 * share of ARV. Keyed off equity rather than a hidden ceiling so every input
 * behind the badge is a number the investor can see on the page.
 *
 * Max offer (ARV x 90% - 2 x repairs) is still computed for the builder, where
 * it is a useful internal check, but it no longer drives the verdict and is not
 * shown to investors.
 *
 * Deterministic rather than a model call. An investor-facing verdict has to be
 * reproducible and defensible line by line — the same packet must never score
 * differently on two loads — and it keeps a public, unauthenticated page from
 * being an inference-cost vector.
 */
export function analyzeDeal(input: {
  purchasePrice: number | null;
  arv: number | null;
  repairs: number;
  assignmentFee: number | null;
  closingCost: number | null;
}): DealAnalysis {
  const { purchasePrice, arv, repairs, closingCost } = input;
  // The quoted price already carries the fee, so it is not added again here.
  const fee = input.assignmentFee ?? 0;
  const notes: string[] = [];

  const mao = arv != null ? Math.round(arv * 0.9 - 2 * repairs) : null;

  if (purchasePrice == null || arv == null || arv <= 0) {
    return {
      verdict: 'unknown',
      askingPrice: purchasePrice,
      repairs,
      closingCost,
      allIn: null,
      spread: null,
      margin: null,
      mao,
      headroom: null,
      overMao: false,
      notes: ['Add a purchase price and ARV to see the full analysis.'],
    };
  }

  const allIn = purchasePrice + repairs + fee + (closingCost ?? 0);
  const spread = arv - allIn;
  const margin = spread / arv;
  const headroom = mao != null ? mao - purchasePrice : null;
  const overMao = headroom != null && headroom < 0;
  const pct = Math.round(margin * 100);

  let verdict: DealVerdict;
  if (margin >= 0.2) {
    verdict = 'strong';
    notes.push(`${usd(spread)} of projected equity — ${pct}% of ARV, a healthy spread for a project of this size.`);
  } else if (margin >= 0.1) {
    verdict = 'fair';
    notes.push(`${usd(spread)} of projected equity — ${pct}% of ARV. Workable, with less room for overruns.`);
  } else if (spread >= 0) {
    verdict = 'thin';
    notes.push(`${usd(spread)} of projected equity — only ${pct}% of ARV, thin once holding costs are counted.`);
  } else {
    verdict = 'thin';
    notes.push(`All-in cost exceeds ARV by ${usd(Math.abs(spread))}, so there is no equity at these numbers.`);
  }

  if (closingCost != null) {
    notes.push(`Closing costs of ${usd(closingCost)} are paid by the buyer and are included in the all-in figure.`);
  }

  if (repairs === 0) {
    notes.push('No repair estimate entered, so the spread here is the optimistic case.');
  }

  return { verdict, askingPrice: purchasePrice, repairs, closingCost, allIn, spread, margin, mao, headroom, overMao, notes };
}

/** The link handed to investors. Absolute so it can go straight onto a clipboard. */
export function packetUrl(slug: string): string {
  return `${window.location.origin}/crm/deal/${slug}`;
}

export function packetImageUrl(storagePath: string): string {
  return supabase.storage.from('packet-images').getPublicUrl(storagePath).data.publicUrl;
}

// ── Admin queries ───────────────────────────────────────────────────────────

export function useLeadPackets(leadId: string | undefined) {
  return useQuery({
    queryKey: ['deal_packets', 'lead', leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deal_packets')
        .select(PACKET_SELECT)
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data.map(dbToPacket);
    },
    enabled: !!leadId,
  });
}

export function usePacket(packetId: string | undefined) {
  return useQuery({
    queryKey: ['deal_packet', packetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deal_packets')
        .select(PACKET_SELECT)
        .eq('id', packetId)
        .single();
      if (error) throw error;
      return dbToPacket(data);
    },
    enabled: !!packetId,
  });
}

/** Seeds a draft packet from the lead so the builder opens pre-filled. */
export function useCreatePacket() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (lead: Lead) => {
      const { data, error } = await supabase
        .from('deal_packets')
        .insert({
          lead_id: lead.id,
          // Ownership follows the lead, not the acting admin, so an admin
          // building a packet on a caller's lead doesn't take it over.
          user_id: lead.userId ?? session!.user.id,
          owner_name: `${lead.firstName} ${lead.lastName}`.trim() || null,
          prop_type: lead.propType,
          beds: lead.beds,
          baths: lead.baths,
          sqft: lead.sqft,
          year_built: lead.yearBuilt,
          market: [lead.city, lead.state].filter(Boolean).join(', ') || null,
          // Street address is deliberately not copied — a packet never shows an
          // exact location, so it should not hold one.
          city: lead.city,
          state: lead.state,
          zip: lead.zip,
          purchase_price: lead.askingPrice,
          arv: lead.arv,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deal_packets'] }),
  });
}

type PacketFields = Partial<
  Pick<
    DealPacket,
    | 'status' | 'ownerName' | 'propType' | 'beds' | 'baths' | 'sqft' | 'yearBuilt'
    | 'market' | 'leadStatus' | 'city' | 'state' | 'zip' | 'purchasePrice' | 'closingCost' | 'arv'
    | 'arvIsManual' | 'assignmentFee' | 'showAssignmentFee' | 'dealTypes'
    | 'narrative' | 'requireLeadCapture'
  >
>;

/**
 * Saves the packet and its child rows together. Comps, repairs and images are
 * replaced wholesale rather than diffed — the same approach useUpsertComps
 * already takes for lead comps, and the row counts here are tiny.
 */
export function useSavePacket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      fields,
      comps,
      repairs,
      images,
    }: {
      id: string;
      fields: PacketFields;
      comps?: Omit<PacketComp, 'id'>[];
      repairs?: Omit<PacketRepair, 'id'>[];
      images?: Omit<PacketImage, 'id'>[];
    }) => {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      const map: Record<keyof PacketFields, string> = {
        status: 'status', ownerName: 'owner_name', propType: 'prop_type', beds: 'beds',
        baths: 'baths', sqft: 'sqft', yearBuilt: 'year_built', market: 'market',
        leadStatus: 'lead_status', city: 'city', state: 'state',
        zip: 'zip', purchasePrice: 'purchase_price', closingCost: 'closing_cost', arv: 'arv', arvIsManual: 'arv_is_manual', assignmentFee: 'assignment_fee',
        showAssignmentFee: 'show_assignment_fee', dealTypes: 'deal_types',
        narrative: 'narrative', requireLeadCapture: 'require_lead_capture',
      };
      for (const [k, v] of Object.entries(fields)) {
        const col = map[k as keyof PacketFields];
        if (col) patch[col] = v;
      }

      const { error } = await supabase.from('deal_packets').update(patch).eq('id', id);
      if (error) throw error;

      if (comps) {
        await supabase.from('packet_comps').delete().eq('packet_id', id);
        if (comps.length) {
          const { error: e } = await supabase.from('packet_comps').insert(
            comps.map((c, i) => ({
              packet_id: id, kind: c.kind ?? 'sold', address: c.address,
              sale_price: c.salePrice, sale_date: c.saleDate || null, sqft: c.sqft,
              beds: c.beds ?? null, baths: c.baths ?? null,
              lat: c.lat ?? null, lng: c.lng ?? null, sort_order: i,
            })),
          );
          if (e) throw e;
        }
      }

      if (repairs) {
        await supabase.from('packet_repairs').delete().eq('packet_id', id);
        if (repairs.length) {
          const { error: e } = await supabase.from('packet_repairs').insert(
            repairs.map((r, i) => ({ packet_id: id, item: r.item, cost: r.cost, sort_order: i })),
          );
          if (e) throw e;
        }
      }

      if (images) {
        await supabase.from('packet_images').delete().eq('packet_id', id);
        if (images.length) {
          const { error: e } = await supabase.from('packet_images').insert(
            images.map((im, i) => ({
              packet_id: id, storage_path: im.storagePath, caption: im.caption, sort_order: i,
            })),
          );
          if (e) throw e;
        }
      }

      return id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['deal_packet', id] });
      qc.invalidateQueries({ queryKey: ['deal_packets'] });
    },
  });
}

export function useDeletePacket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('deal_packets').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deal_packets'] }),
  });
}

/** Uploads to the public packet-images bucket and returns the storage path. */
export function useUploadPacketImage() {
  return useMutation({
    mutationFn: async ({ packetId, file }: { packetId: string; file: File }) => {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${packetId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from('packet-images').upload(path, file, {
        cacheControl: '3600',
        upsert: false,
      });
      if (error) throw error;
      return path;
    },
  });
}

/**
 * Copies an already-uploaded lead file into the packet's own public bucket
 * and returns the new storage path — a real byte copy, not a reference.
 * lead-files is a private bucket (owner/overseer only) while packet-images
 * is public, since a Deal Packet is viewed by an unauthenticated investor;
 * there's no way for the public page to read a private object directly, so
 * this is the only way to reuse a photo already on the lead without asking
 * the admin to download it and re-select it from disk.
 */
export function useCopyLeadFileToPacket() {
  return useMutation({
    mutationFn: async ({ packetId, storagePath, fileName }: { packetId: string; storagePath: string; fileName: string }) => {
      const { data, error: downloadError } = await supabase.storage.from('lead-files').download(storagePath);
      if (downloadError) throw downloadError;
      const ext = fileName.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${packetId}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('packet-images').upload(path, data, {
        cacheControl: '3600',
        upsert: false,
      });
      if (uploadError) throw uploadError;
      return path;
    },
  });
}

// ── Analytics ───────────────────────────────────────────────────────────────

export function usePacketViews(packetId: string | undefined) {
  return useQuery({
    queryKey: ['packet_views', packetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('packet_views')
        .select('*')
        .eq('packet_id', packetId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data.map(dbToView);
    },
    enabled: !!packetId,
  });
}

/** Unique viewers plus a daily series for the views-over-time chart. */
export function summarizeViews(views: PacketView[], days = 14) {
  const unique = new Set(views.map((v) => v.viewerToken)).size;

  const counts = new Map<string, number>();
  for (const v of views) {
    const day = v.createdAt.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  const series: { date: string; views: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    series.push({ date: iso, views: counts.get(iso) ?? 0 });
  }

  return { total: views.length, unique, series };
}
