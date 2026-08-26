import { MessageSquare } from 'lucide-react';
import { usePacketComments } from '@/hooks/useDealPackets';
import { formatDateTime } from '@/lib/utils';

/** Private notes investors left on this packet — visible only here, never on
 * the public page and never to other investors (see packet_comments_select's
 * RLS: owner or overseeing admin only). */
export function PacketComments({ packetId }: { packetId: string }) {
  const { data: comments = [] } = usePacketComments(packetId);

  if (!comments.length) return null;

  return (
    <div className="mt-2 rounded-md border border-border-2 bg-surface p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
        <MessageSquare size={12} /> Investor comments ({comments.length})
        <span className="normal-case text-text-3/70">· private, only visible to you</span>
      </div>
      <div className="max-h-64 space-y-2 overflow-y-auto">
        {comments.map((c) => (
          <div key={c.id} className="rounded-md border border-border-2 bg-surface-3 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12.5px] font-medium text-text">
                {c.viewerName || <span className="text-text-3">Anonymous</span>}
                {c.viewerEmail && <span className="ml-1.5 font-normal text-text-3">· {c.viewerEmail}</span>}
              </span>
              <span className="shrink-0 text-[11px] text-text-3">{formatDateTime(c.createdAt)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-[13px] text-text-2">{c.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
