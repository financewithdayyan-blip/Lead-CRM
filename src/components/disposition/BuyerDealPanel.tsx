import { useState } from 'react';
import { Check, Circle, FileImage } from 'lucide-react';
import { useAllDealPackets } from '@/hooks/useDealPackets';
import { useLatestBuyerDealRecipient, useMarkDealStage, type DealStage } from '@/hooks/useDisposition';
import { formatCurrency, formatDate } from '@/lib/utils';

/** The "Deal progress" panel next to a buyer's thread in the Disposition
 *  Messages tab. "Deal packet sent" is the only stage inferred from data
 *  that's already real (a disposition_send_recipients row existing at
 *  all) — every stage after it (Buyer committed / Assignment signed / Sent
 *  to TC / Closed) is a plain timestamp an admin sets by clicking a
 *  button, not something this CRM tracks automatically yet (there's no
 *  e-sign or TC integration wired to this feature). Flagged here, not
 *  hidden, so the checklist reads as "what we've recorded" rather than
 *  implying a live pipeline that isn't there. */
export function BuyerDealPanel({ buyerId }: { buyerId: string }) {
  const { data: recipient, isLoading } = useLatestBuyerDealRecipient(buyerId);
  const { data: packets = [] } = useAllDealPackets();
  const markStage = useMarkDealStage();
  const [committingPrice, setCommittingPrice] = useState('');
  const [showCommitInput, setShowCommitInput] = useState(false);

  if (isLoading) return <div className="p-4 text-center text-[12.5px] text-text-3">Loading deal…</div>;
  if (!recipient) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-[12.5px] text-text-3">
        No deal packet has been sent to this buyer yet — send one from the Map tab to start tracking progress here.
      </div>
    );
  }

  const packet = packets.find((p) => p.id === recipient.packetId);
  const buyerPrice = recipient.committedPrice;
  const assignmentFee = buyerPrice != null && packet?.finalPrice != null ? buyerPrice - packet.finalPrice : null;

  function mark(stage: DealStage, price?: number) {
    markStage.mutate({ recipientId: recipient!.id, stage, price });
  }

  const steps: Array<{ key: DealStage | 'sent'; label: string; done: boolean; sub: string; action?: () => void }> = [
    { key: 'sent', label: 'Deal packet sent', done: true, sub: formatDate(recipient.createdAt) },
    {
      key: 'committed',
      label: 'Buyer committed',
      done: !!recipient.committedAt,
      sub: recipient.committedAt ? `${formatCurrency(recipient.committedPrice)} on ${formatDate(recipient.committedAt)}` : 'Not committed yet',
      action: () => setShowCommitInput(true),
    },
    {
      key: 'assignment_signed',
      label: 'Assignment signed',
      done: !!recipient.assignmentSignedAt,
      sub: recipient.assignmentSignedAt ? formatDate(recipient.assignmentSignedAt) : 'Not sent yet',
      action: () => mark('assignment_signed'),
    },
    {
      key: 'sent_to_tc',
      label: 'Sent to TC',
      done: !!recipient.sentToTcAt,
      sub: recipient.sentToTcAt ? formatDate(recipient.sentToTcAt) : 'Not sent yet',
      action: () => mark('sent_to_tc'),
    },
    {
      key: 'closed',
      label: 'Closed',
      done: !!recipient.closedAt,
      sub: recipient.closedAt ? formatDate(recipient.closedAt) : 'Not closed yet',
      action: () => mark('closed'),
    },
  ];

  return (
    <div className="space-y-3 overflow-y-auto p-1">
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex h-24 items-center justify-center bg-surface-3 text-text-3">
          <FileImage size={20} />
        </div>
        <div className="p-3">
          <div className="text-[13.5px] font-semibold text-text">{packet?.address ?? packet?.city ?? 'Property'}</div>
          <div className="mt-0.5 text-[11.5px] text-text-3">
            {[packet?.beds != null ? `${packet.beds} bd` : null, packet?.baths != null ? `${packet.baths} ba` : null, packet?.propType].filter(Boolean).join(' · ')}
            {packet?.arv != null ? ` · ARV ${formatCurrency(packet.arv)}` : ''}
          </div>
          <div className="mt-2.5 grid grid-cols-3 gap-1.5 text-center">
            <div className="rounded-md bg-surface-3 p-1.5">
              <div className="text-[10px] text-text-3">Your contract</div>
              <div className="text-[12.5px] font-bold text-text">{packet?.finalPrice != null ? formatCurrency(packet.finalPrice) : '—'}</div>
            </div>
            <div className="rounded-md bg-surface-3 p-1.5">
              <div className="text-[10px] text-text-3">Buyer price</div>
              <div className="text-[12.5px] font-bold text-text">{buyerPrice != null ? formatCurrency(buyerPrice) : '—'}</div>
            </div>
            <div className="rounded-md bg-success-dim p-1.5">
              <div className="text-[10px] text-success">Assignment fee</div>
              <div className="text-[12.5px] font-bold text-success">{assignmentFee != null ? formatCurrency(assignmentFee) : '—'}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-3">
        <div className="mb-2 text-[13px] font-semibold text-text">Deal progress</div>
        <div className="space-y-2.5">
          {steps.map((s) => (
            <div key={s.key} className="flex items-start gap-2.5">
              {s.done ? <Check size={16} className="mt-0.5 shrink-0 text-success" /> : <Circle size={16} className="mt-0.5 shrink-0 text-text-3" />}
              <div className="min-w-0 flex-1">
                <div className={s.done ? 'text-[13px] font-medium text-text' : 'text-[13px] font-medium text-text-2'}>{s.label}</div>
                <div className="text-[11.5px] text-text-3">{s.sub}</div>
                {!s.done && s.action && s.key === 'committed' && showCommitInput && (
                  <div className="mt-1.5 flex gap-1.5">
                    <input
                      className="input !w-[110px] !py-1 text-[12px]"
                      placeholder="Price"
                      inputMode="numeric"
                      value={committingPrice}
                      onChange={(e) => setCommittingPrice(e.target.value)}
                    />
                    <button
                      className="btn btn-primary !px-2 !py-1 text-[11.5px]"
                      disabled={!committingPrice.trim() || markStage.isPending}
                      onClick={() => {
                        mark('committed', Number(committingPrice));
                        setShowCommitInput(false);
                        setCommittingPrice('');
                      }}
                    >
                      Save
                    </button>
                  </div>
                )}
                {!s.done && s.action && !(s.key === 'committed' && showCommitInput) && (
                  <button className="mt-1 text-[11.5px] font-medium text-primary hover:underline" onClick={s.action} disabled={markStage.isPending}>
                    Mark as done
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
