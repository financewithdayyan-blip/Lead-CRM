import { useMemo, useState } from 'react';
import { Mail, MessageSquare, MessagesSquare } from 'lucide-react';
import { useCashBuyers } from '@/hooks/useCashBuyers';
import { useLatestBuyerMessages, type LatestBuyerMessage } from '@/hooks/useBuyerMessages';
import { BuyerSmsThread } from '@/components/disposition/BuyerSmsThread';
import { formatDateTime } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { CashBuyer } from '@/types/domain';

/** All buyer conversations in one inbox — every cash buyer who has ever
 *  exchanged a message (either direction, SMS or email), sorted by most
 *  recent, with the full thread (same BuyerSmsThread used on the Buyer
 *  Profile page, so replying here is identical to replying there) on the
 *  right. Email replies aren't captured anywhere yet (only sends are
 *  logged) — this shows every email actually sent, just not a two-way
 *  thread for that channel the way SMS has. */
export function DispositionMessagesTab() {
  const { data: buyers = [] } = useCashBuyers();
  const { data: latest = new Map(), isLoading } = useLatestBuyerMessages();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const buyersById = useMemo(() => new Map(buyers.map((b) => [b.id, b])), [buyers]);

  const conversations = useMemo(() => {
    return [...latest.values()]
      .map((m) => ({ message: m, buyer: buyersById.get(m.buyerId) }))
      .filter((c): c is { message: LatestBuyerMessage; buyer: CashBuyer } => !!c.buyer)
      .sort((a, b) => new Date(b.message.at).getTime() - new Date(a.message.at).getTime());
  }, [latest, buyersById]);

  const selected = selectedId ? buyersById.get(selectedId) : undefined;

  return (
    <div className="flex gap-4" style={{ height: '70vh' }}>
      <div className="w-[320px] shrink-0 overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <MessagesSquare size={15} className="text-text-3" />
          <span className="text-[13px] font-semibold text-text">Buyer conversations</span>
        </div>
        <div className="h-[calc(100%-45px)] overflow-y-auto">
          {isLoading && <div className="p-4 text-center text-[12.5px] text-text-3">Loading…</div>}
          {!isLoading && conversations.length === 0 && (
            <div className="p-4 text-center text-[12.5px] text-text-3">No buyer messages yet — they'll show up here once a deal packet goes out.</div>
          )}
          {conversations.map(({ message, buyer }) => (
            <button
              key={buyer.id}
              onClick={() => setSelectedId(buyer.id)}
              className={cn('flex w-full items-start gap-2.5 border-b border-border px-4 py-3 text-left transition-colors', selectedId === buyer.id ? 'bg-primary-dim' : 'hover:bg-surface-3')}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] font-bold text-text-2">
                {buyer.name.slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold text-text">{buyer.name}</span>
                  <span className="shrink-0 text-[11px] text-text-3">{formatDateTime(message.at)}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-1 text-[12px] text-text-3">
                  {message.channel === 'email' ? <Mail size={11} /> : <MessageSquare size={11} />}
                  <span className="truncate">{message.direction === 'outbound' ? 'You: ' : ''}{message.body}</span>
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto">
        {selected ? (
          <BuyerSmsThread buyer={selected} />
        ) : (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border-2 text-[13px] text-text-3">
            Pick a conversation on the left.
          </div>
        )}
      </div>
    </div>
  );
}
