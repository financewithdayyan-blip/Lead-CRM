import { Gavel } from 'lucide-react';
import { daysUntil, formatDate } from '@/lib/utils';
import { getAuctionTier, TIER_CONFIG } from '@/lib/auctionTiers';

/**
 * Tier-aware auction countdown badge.
 *
 * Tiers → colors:
 *   LOW  (31+ d)  → gray
 *   MEDIUM (15–30)→ blue
 *   HIGH   (8–14) → yellow
 *   URGENT (4–7)  → orange
 *   CRITICAL(1–3) → red pulsing badge
 *   PAST   (≤ 0)  → gray "Auction passed"
 */
export function AuctionCountdown({ auctionDate, className = '' }: { auctionDate: string; className?: string }) {
  const days = daysUntil(auctionDate);
  const tier = getAuctionTier(days);
  const cfg  = TIER_CONFIG[tier];

  if (days < 0) {
    return (
      <span className={`inline-flex items-center gap-1 text-[11px] font-medium text-text-3 ${className}`} title={formatDate(auctionDate)}>
        <Gavel size={11} /> Auction passed
      </span>
    );
  }

  const label = days === 0 ? 'Auction today!' : `${days}d to auction`;

  if (tier === 'CRITICAL') {
    return (
      <span
        className={`inline-flex animate-pulse items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cfg.bgClass} ${cfg.textClass} ${cfg.borderClass} ${className}`}
        title={formatDate(auctionDate)}
      >
        <Gavel size={9} /> AUCTION IN {days}d
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium ${cfg.textClass} ${className}`}
      title={formatDate(auctionDate)}
    >
      <Gavel size={11} /> {label}
    </span>
  );
}
