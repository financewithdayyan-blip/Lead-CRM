import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { getViewerToken, type ViewerIdentity } from '@/lib/viewerToken';
import type { DealType } from '@/types/domain';

/**
 * Everything here talks to security-definer RPCs rather than tables. Anonymous
 * visitors have no row access to deal_packets at all, which is what keeps the
 * street address out of the payload rather than merely out of sight.
 */

export interface PublicPacketComp {
  id: string;
  kind: 'sold' | 'listing';
  address: string | null;
  salePrice: number | null;
  saleDate: string | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  lat: number | null;
  lng: number | null;
}

export interface PublicPacket {
  id: string;
  slug: string;
  ownerName: string | null;
  propType: string | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  yearBuilt: number | null;
  market: string | null;
  leadStatus: string | null;
  state: string | null;
  purchasePrice: number | null;
  closingCost: number | null;
  arv: number | null;
  assignmentFee: number | null;
  showAssignmentFee: boolean;
  dealTypes: DealType[];
  narrative: string | null;
  requireLeadCapture: boolean;
  createdAt: string;
  // Coordinates only, never the street address — draws a proximity circle
  // around the subject without ever pinning or exposing its exact location.
  subjectLat: number | null;
  subjectLng: number | null;
  comps: PublicPacketComp[];
  repairs: { id: string; item: string; cost: number }[];
  images: { id: string; storagePath: string; caption: string | null }[];
}

export function usePublicPacket(slug: string | undefined) {
  return useQuery({
    queryKey: ['public_packet', slug],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_public_packet', { p_slug: slug });
      if (error) throw error;
      return (data as PublicPacket | null) ?? null;
    },
    enabled: !!slug,
    // A packet flipped to draft or archived should stop resolving reasonably
    // fast for someone sitting on the page.
    staleTime: 60_000,
    retry: false,
  });
}

/** City / state / zip — the coarse location shown before an address is approved. */
export function usePacketArea(slug: string | undefined) {
  return useQuery({
    queryKey: ['packet_area', slug],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_packet_area', { p_slug: slug });
      if (error) throw error;
      return (data as { city: string | null; state: string | null; zip: string | null } | null) ?? null;
    },
    enabled: !!slug,
    retry: false,
  });
}

export function useLogPacketView() {
  return useMutation({
    mutationFn: async ({ slug, identity }: { slug: string; identity?: ViewerIdentity | null }) => {
      const { error } = await supabase.rpc('log_packet_view', {
        p_slug: slug,
        p_viewer_token: getViewerToken(),
        p_viewer_name: identity?.name ?? null,
        p_viewer_email: identity?.email ?? null,
        p_viewer_phone: identity?.phone ?? null,
        p_user_agent: navigator.userAgent,
      });
      if (error) throw error;
    },
  });
}

