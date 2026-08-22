import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { BuyerCondition, BuyerPropertyType, CashBuyer, DealType } from '@/types/domain';
import type { PacketSummary } from './useDealPackets';

// A deal packet's propType is free text an admin typed ("Multi Family (
// Duplex)", "SFR", "Single Family Home") — there's no structured enum to
// compare against BuyerPropertyType directly, so this is a best-effort
// keyword match, not an exact one. False positives are fine here (worst
// case: a buyer sees one deal slightly outside their type); false negatives
// (hiding a real match because of wording) are the failure mode to avoid,
// so the keyword lists lean generous.
const PROPERTY_TYPE_KEYWORDS: Record<BuyerPropertyType, string[]> = {
  single_family: ['single', 'sfr', 'single-family', 'single family'],
  multi_family: ['multi', 'duplex', 'triplex', 'fourplex', 'quad'],
  townhome: ['townhome', 'townhouse', 'town home'],
  condo: ['condo'],
  land: ['land', 'lot'],
  mobile: ['mobile', 'manufactured'],
  other: [],
};

function propTypeMatches(buyerTypes: BuyerPropertyType[], dealPropType: string | null): boolean {
  if (buyerTypes.length === 0) return true; // no restriction set
  if (!dealPropType) return true; // deal has no type recorded, don't hide it over missing data
  const lower = dealPropType.toLowerCase();
  return buyerTypes.some((t) => t === 'other' || PROPERTY_TYPE_KEYWORDS[t].some((kw) => lower.includes(kw)));
}

function fromRow(r: any): CashBuyer {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    facebookUrl: r.facebook_url,
    markets: r.markets ?? [],
    propertyTypes: (r.property_types ?? []) as BuyerPropertyType[],
    priceMin: r.price_min != null ? Number(r.price_min) : null,
    priceMax: r.price_max != null ? Number(r.price_max) : null,
    minBeds: r.min_beds != null ? Number(r.min_beds) : null,
    minBaths: r.min_baths != null ? Number(r.min_baths) : null,
    condition: r.condition as BuyerCondition | null,
    dealTypes: (r.deal_types ?? []) as DealType[],
    notes: r.notes,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function useCashBuyers() {
  return useQuery({
    queryKey: ['cash_buyers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cash_buyers').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data.map(fromRow);
    },
  });
}

export interface CashBuyerInput {
  name: string;
  phone: string | null;
  email: string | null;
  facebookUrl: string | null;
  markets: string[];
  propertyTypes: BuyerPropertyType[];
  priceMin: number | null;
  priceMax: number | null;
  minBeds: number | null;
  minBaths: number | null;
  condition: BuyerCondition | null;
  dealTypes: DealType[];
  notes: string | null;
  status: 'active' | 'inactive';
}

function toDbRow(b: CashBuyerInput) {
  return {
    name: b.name,
    phone: b.phone,
    email: b.email,
    facebook_url: b.facebookUrl,
    markets: b.markets,
    property_types: b.propertyTypes,
    price_min: b.priceMin,
    price_max: b.priceMax,
    min_beds: b.minBeds,
    min_baths: b.minBaths,
    condition: b.condition,
    deal_types: b.dealTypes,
    notes: b.notes,
    status: b.status,
  };
}

export function useCreateCashBuyer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CashBuyerInput) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from('cash_buyers').insert({ ...toDbRow(input), created_by: userData.user?.id ?? null });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cash_buyers'] }),
  });
}

export function useUpdateCashBuyer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: CashBuyerInput & { id: string }) => {
      const { error } = await supabase.from('cash_buyers').update(toDbRow(input)).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cash_buyers'] }),
  });
}

export function useDeleteCashBuyer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cash_buyers').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cash_buyers'] }),
  });
}

/**
 * Whether a buyer's buy box is compatible with a deal — every filled-in
 * criterion must pass, but an empty one (no price ceiling set, no property
 * types picked, etc.) is treated as "no restriction on this dimension"
 * rather than a mismatch. A buyer with nothing filled in at all matches
 * every deal — that's a buyer who hasn't been given specific criteria yet,
 * not a buyer who wants nothing.
 */
export function buyerMatchesPacket(buyer: CashBuyer, packet: PacketSummary): boolean {
  if (buyer.status !== 'active') return false;

  if (buyer.markets.length > 0) {
    const dealCity = (packet.city ?? '').trim().toLowerCase();
    if (!dealCity) return false;
    const inMarket = buyer.markets.some((m) => m.trim().toLowerCase() === dealCity);
    if (!inMarket) return false;
  }

  // Matched against ARV when it's there (the number that actually reflects
  // what the property is worth), falling back to purchase price only when
  // no ARV has been entered yet.
  const dealPrice = packet.arv ?? packet.purchasePrice;
  if (dealPrice != null) {
    if (buyer.priceMin != null && dealPrice < buyer.priceMin) return false;
    if (buyer.priceMax != null && dealPrice > buyer.priceMax) return false;
  }

  if (buyer.dealTypes.length > 0 && packet.dealTypes.length > 0) {
    const overlap = buyer.dealTypes.some((t) => packet.dealTypes.includes(t));
    if (!overlap) return false;
  }

  if (!propTypeMatches(buyer.propertyTypes, packet.propType)) return false;

  if (buyer.minBeds != null && packet.beds != null && packet.beds < buyer.minBeds) return false;
  if (buyer.minBaths != null && packet.baths != null && packet.baths < buyer.minBaths) return false;

  return true;
}
