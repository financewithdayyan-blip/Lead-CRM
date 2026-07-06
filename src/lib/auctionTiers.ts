import { daysUntil } from './utils';

export type AuctionTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | 'CRITICAL' | 'PAST';
export type TouchScheduleMode = 'standard' | 'daily' | 'deadline';

/** Tailwind classes per tier — drives all badge colors across the app. */
export const TIER_CONFIG: Record<
  AuctionTier,
  { label: string; textClass: string; bgClass: string; borderClass: string }
> = {
  LOW:      { label: 'Low',      textClass: 'text-text-3',      bgClass: 'bg-surface-3',        borderClass: 'border-border'          },
  MEDIUM:   { label: 'Medium',   textClass: 'text-blue-400',    bgClass: 'bg-blue-950/30',      borderClass: 'border-blue-900/40'     },
  HIGH:     { label: 'High',     textClass: 'text-yellow-400',  bgClass: 'bg-yellow-950/30',    borderClass: 'border-yellow-900/40'   },
  URGENT:   { label: 'Urgent',   textClass: 'text-orange-400',  bgClass: 'bg-orange-950/30',    borderClass: 'border-orange-900/40'   },
  CRITICAL: { label: 'Critical', textClass: 'text-red-400',     bgClass: 'bg-red-950/40',       borderClass: 'border-red-900/50'      },
  PAST:     { label: 'Passed',   textClass: 'text-text-3',      bgClass: 'bg-surface-3',        borderClass: 'border-border'          },
};

/** Derive the urgency tier from a precomputed days-remaining value. */
export function getAuctionTier(daysRemaining: number): AuctionTier {
  if (daysRemaining <= 0)  return 'PAST';
  if (daysRemaining <= 3)  return 'CRITICAL';
  if (daysRemaining <= 7)  return 'URGENT';
  if (daysRemaining <= 14) return 'HIGH';
  if (daysRemaining <= 30) return 'MEDIUM';
  return 'LOW';
}

/**
 * Touch-schedule override for followup leads with an auction date.
 *
 *  standard  — 17+ days out  → standard [1,2,3,6,7,8,11,12,16,17] schedule
 *  daily     — 10–16 days    → call every day (no gap days), still needs 10 touches
 *  deadline  — < 10 days     → call every day, 10-touch minimum is waived
 */
export function touchScheduleMode(daysToAuction: number | null): TouchScheduleMode {
  if (daysToAuction === null) return 'standard';
  if (daysToAuction < 10)    return 'deadline';
  if (daysToAuction <= 16)   return 'daily';
  return 'standard';
}

/** Convenience wrapper — computes days to auction from an ISO date string. */
export function computeDaysToAuction(auctionDate: string | null | undefined): number | null {
  if (!auctionDate) return null;
  return daysUntil(auctionDate);
}
