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

// ── Deal analysis ───────────────────────────────────────────────────────────

export type DealVerdict = 'strong' | 'fair' | 'thin' | 'unknown';

export interface DealAnalysis {
  verdict: DealVerdict;
  /** 10% of ARV — Bluebird covers this on both sides of the transaction. */
  closingCost: number | null;
  /** What the investor is all-in for: quoted price + repairs. */
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
 * Bluebird's buy-box, not the generic 70% rule.
 *
 *   closing cost = ARV x 10%          (covered by Bluebird, both sides)
 *   max offer    = ARV x 90% - 2 x repairs
 *
 * The doubled repair figure is the margin of safety: it absorbs both the work
 * itself and the overruns that usually follow it. The verdict keys off how far
 * the quoted price sits inside that ceiling.
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
}): DealAnalysis {
  const { purchasePrice, arv, repairs } = input;
  // The quoted price already carries the fee, so it is not added again here.
  const fee = input.assignmentFee ?? 0;
  const notes: string[] = [];

  const closingCost = arv != null ? Math.round(arv * 0.1) : null;
  const mao = arv != null ? Math.round(arv * 0.9 - 2 * repairs) : null;

  if (purchasePrice == null || arv == null || arv <= 0) {
    return {
      verdict: 'unknown',
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

  const allIn = purchasePrice + repairs + fee;
  const spread = arv - allIn;
  const margin = spread / arv;
  const headroom = mao != null ? mao - purchasePrice : null;
  const overMao = headroom != null && headroom < 0;

  // Measured against the ceiling itself, so the same 5k of headroom reads
  // differently on a 60k deal than on a 400k one.
  const headroomPct = mao != null && mao > 0 && headroom != null ? headroom / mao : null;

  let verdict: DealVerdict;
  if (headroomPct == null) {
    verdict = 'thin';
    notes.push('Repairs are large enough to wipe out the maximum offer at this ARV.');
  } else if (headroomPct >= 0.1) {
    verdict = 'strong';
    notes.push(`Priced ${usd(headroom!)} below the ${usd(mao!)} maximum offer — comfortably inside the buy box.`);
  } else if (headroomPct >= 0) {
    verdict = 'fair';
    notes.push(`Priced ${usd(headroom!)} under the ${usd(mao!)} maximum offer, so it works but with little room to spare.`);
  } else {
    verdict = 'thin';
    notes.push(`Priced ${usd(Math.abs(headroom!))} above the ${usd(mao!)} maximum offer for this ARV and repair level.`);
  }

  notes.push(`Max offer is ARV less 10% closing costs, less twice the repair estimate — ${usd(arv)} × 90% − 2 × ${usd(repairs)}.`);

  if (closingCost != null) {
    notes.push(`Bluebird covers closing costs on both sides, roughly ${usd(closingCost)} at 10% of ARV.`);
  }

  if (repairs === 0) {
    notes.push('No repair estimate entered, so the maximum offer here is the optimistic case.');
  }

  return { verdict, closingCost, allIn, spread, margin, mao, headroom, overMao, notes };
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
    | 'market' | 'leadStatus' | 'city' | 'state' | 'zip' | 'purchasePrice' | 'arv'
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
        zip: 'zip', purchasePrice: 'purchase_price', arv: 'arv', arvIsManual: 'arv_is_manual', assignmentFee: 'assignment_fee',
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
