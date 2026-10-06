import { PacketTab } from '@/components/packets/PacketTab';
import { OfferSummaryStrip } from './OfferSummaryStrip';
import { ContractStatusCard } from './ContractStatusCard';
import { TitleClosingCard } from './TitleClosingCard';
import type { Lead } from '@/types/domain';

export function DealTab({ lead }: { lead: Lead }) {
  return (
    <div className="space-y-5">
      <OfferSummaryStrip lead={lead} />
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <ContractStatusCard leadId={lead.id} />
        <TitleClosingCard lead={lead} />
      </div>
      <PacketTab lead={lead} />
    </div>
  );
}
