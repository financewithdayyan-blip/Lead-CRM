import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface BuyerDeal {
  id: string;
  buyerId: string;
  leadId: string | null;
  propertyAddress: string;
  city: string | null;
  state: string | null;
  salePrice: number | null;
  closedDate: string | null;
  notes: string | null;
  createdAt: string;
}

function fromRow(r: any): BuyerDeal {
  return {
    id: r.id,
    buyerId: r.buyer_id,
    leadId: r.lead_id,
    propertyAddress: r.property_address,
    city: r.city,
    state: r.state,
    salePrice: r.sale_price != null ? Number(r.sale_price) : null,
    closedDate: r.closed_date,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

export function useBuyerDeals(buyerId: string | undefined) {
  return useQuery({
    queryKey: ['buyer_deals', buyerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('buyer_deals')
        .select('*')
        .eq('buyer_id', buyerId)
        .order('closed_date', { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data.map(fromRow);
    },
    enabled: !!buyerId,
  });
}

export interface BuyerDealInput {
  leadId: string | null;
  propertyAddress: string;
  city: string | null;
  state: string | null;
  salePrice: number | null;
  closedDate: string | null;
  notes: string | null;
}

function toDbRow(d: BuyerDealInput) {
  return {
    lead_id: d.leadId,
    property_address: d.propertyAddress,
    city: d.city,
    state: d.state,
    sale_price: d.salePrice,
    closed_date: d.closedDate,
    notes: d.notes,
  };
}

export function useCreateBuyerDeal(buyerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BuyerDealInput) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from('buyer_deals').insert({ ...toDbRow(input), buyer_id: buyerId, created_by: userData.user?.id ?? null });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['buyer_deals', buyerId] }),
  });
}

export function useDeleteBuyerDeal(buyerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('buyer_deals').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['buyer_deals', buyerId] }),
  });
}
