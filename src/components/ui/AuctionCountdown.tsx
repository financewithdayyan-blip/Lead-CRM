import { Gavel } from 'lucide-react';
import { daysUntil, formatDate } from '@/lib/utils';

export function AuctionCountdown({ auctionDate, className = '' }: { auctionDate: string; className?: string }) {
  const days = daysUntil(auctionDate);
  const urgent = days <= 14;
  const label = days < 0 ? 'Auction passed' : days === 0 ? 'Auction today' : `${days}d to auction`;

  return (
    <span
      className={`inline-flex items-center gap-1 font-medium ${urgent ? 'text-danger' : 'text-text-3'} ${className}`}
      title={formatDate(auctionDate)}
    >
      <Gavel size={11} /> {label}
    </span>
  );
}
