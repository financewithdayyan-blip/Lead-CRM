import { FileSignature } from 'lucide-react';
import { PacketTab } from '@/components/packets/PacketTab';
import type { Lead } from '@/types/domain';

export function DealTab({ lead }: { lead: Lead }) {
  return (
    <div className="space-y-5">
      <div className="card flex flex-col items-center gap-2 py-10 text-center">
        <FileSignature size={22} className="text-text-3" />
        <div className="text-[14px] font-medium text-text">Contract & Title tracking coming soon</div>
        <p className="max-w-sm text-[12.5px] text-text-3">
          A live Contract status mirrored from Blue Docs and a Title &amp; Closing checklist are being built next.
        </p>
      </div>
      <PacketTab lead={lead} />
    </div>
  );
}
