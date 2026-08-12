import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export interface AiReplyConfigRow {
  id: string;
  tagId: string | null;
  framework: string;
  updatedAt: string;
}

/**
 * The framework used when a lead's tags have none of their own saved. Steps
 * run in a fixed order (motivation, then condition, then price, then
 * timeline, photos last) — asking out of order is what causes a lead to
 * reply with a bare number like "500k" with no context. MOTIVATION,
 * CONDITION, PRICE and TIMELINE are what mark a lead fully qualified and
 * pause AI auto-reply; ownership confirmation and the photo itself arriving
 * don't block the handoff to a human. Lien-adjacent tags (Lis Pendens,
 * Pre-Foreclosure, Auction) insert a mortgage step as a fifth requirement via
 * their own tag-specific framework below.
 */
export const DEFAULT_FRAMEWORK = `Goal: qualify this lead through a natural conversation, but follow the steps below in a fixed order. Do not jump ahead to price or timeline before condition is covered, and don't backtrack to something already answered. Going out of order is exactly how a lead ends up replying with a bare number like "500k" with no context behind it — stay on the current step until it is actually answered before moving to the next.

Steps, in this exact order:
1. Confirm you're speaking with the owner, or someone who can speak for them (see the standing rules on non-owners and wrong numbers).
2. MOTIVATION — ask why they're looking to sell, or what's going on with the property. A brief, natural answer is enough — don't push for more than they volunteer, and don't turn it into an interrogation.
3. CONDITION — cover these one at a time, in order:
   - How the property looks on the inside, general condition.
   - What they'd rate it, out of 10.
   - Any major repairs needed — HVAC, electrical, plumbing, etc.
   - How old the roof is.
4. PRICE — ask if they have a number in mind. If they give one, ask how they landed on it.
5. TIMELINE — ask if there's a timeline they're looking to close within.
6. PHOTOS — ask for interior photos so the current condition can actually be seen.
7. CALLBACK — last: ask what's a good time to call them back tomorrow to go over everything. This step isn't done just by asking — wait for them to actually give you a real day and time before it counts as answered.

A lead is FULLY QUALIFIED — which pauses auto-reply and hands off to a human — once MOTIVATION, CONDITION, PRICE, and TIMELINE above have all actually been established in this conversation. Asking for photos is still a required step before the interview counts as complete, but don't hold fully_qualified back waiting on the photo itself to arrive — once you've asked for it, that step is done; a human takes it from there. The CALLBACK step is different: it is only done once they've actually given a specific day and time to call back, not just once you've asked — fully_qualified must wait for that real answer.`;

/**
 * Appended to the Default text (or the tag's own framework, if the admin has
 * written one) for Lis Pendens, Pre-Foreclosure and Auction leads.
 */
export const LIEN_ADDENDUM = `

This lead is in foreclosure, lis pendens, or auction proceedings. Insert a MORTGAGE step immediately after TIMELINE and before PHOTOS — the fixed order for this tag is CONDITION, PRICE, TIMELINE, MORTGAGE, PHOTOS, CALLBACK: ask their monthly payment, total remaining balance owed, and interest rate, then ask them to email a copy of their mortgage statement to dayyan@bluebirdacquisition.com. Do not ask how far behind they are on payments. This mortgage step is also required for fully_qualified on this tag, alongside motivation, condition, price and timeline — don't hold fully_qualified back waiting for the statement document itself to actually arrive, once you've asked for it that part is done.

If they mention "a plan": ask whether it involves an attorney postponing the auction. If so, explain that a postponement only delays the auction — it doesn't resolve the underlying situation.`;

/** Tags this addendum auto-applies to when a tag has no framework of its own yet. */
export const LIEN_TAG_NAMES = ['Lis Pendens', 'Pre-Foreclosure', 'Foreclosure', 'Auction'];

/** Appended to the Default text (or the tag's own framework) for Tax Delinquent leads. */
export const TAX_ADDENDUM = `

This lead is tax delinquent. Insert a TAXES step immediately after CONDITION and before PRICE: ask how much they owe in back taxes, and how many years behind they are. Do not ask about a mortgage unless they bring it up themselves. This taxes step is also required for fully_qualified on this tag, alongside motivation, condition, price and timeline.`;

export const TAX_TAG_NAMES = ['Tax Delinquent'];

export function useAiReplyConfigs() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['ai_reply_config', session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_reply_config')
        .select('id, tag_id, framework, updated_at')
        .eq('user_id', session!.user.id);
      if (error) throw error;
      return data.map(
        (r): AiReplyConfigRow => ({ id: r.id, tagId: r.tag_id, framework: r.framework, updatedAt: r.updated_at }),
      );
    },
    enabled: !!session?.user.id,
  });
}

export function useSaveAiReplyConfig() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ tagId, framework }: { tagId: string | null; framework: string }) => {
      const userId = session!.user.id;

      // Postgres never treats NULL = NULL as a conflict, so upsert's
      // onConflict target has to switch for the Default row (tag_id IS NULL,
      // enforced by the partial index) versus a tag-specific one (the
      // ordinary composite unique constraint).
      if (tagId === null) {
        const { data: existing } = await supabase
          .from('ai_reply_config')
          .select('id')
          .eq('user_id', userId)
          .is('tag_id', null)
          .maybeSingle();

        const { error } = existing
          ? await supabase
              .from('ai_reply_config')
              .update({ framework, updated_at: new Date().toISOString() })
              .eq('id', existing.id)
          : await supabase.from('ai_reply_config').insert({ user_id: userId, tag_id: null, framework });

        if (error) throw error;
        return;
      }

      const { error } = await supabase
        .from('ai_reply_config')
        .upsert(
          { user_id: userId, tag_id: tagId, framework, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,tag_id' },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai_reply_config'] }),
  });
}
