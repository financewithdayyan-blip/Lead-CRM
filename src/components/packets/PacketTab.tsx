import { useState } from 'react';
import { Check, Copy, ExternalLink, FileText, Plus, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DealPacketBuilder } from './DealPacketBuilder';
import { PacketAnalytics } from './PacketAnalytics';
import { packetUrl, useCreatePacket, useDeletePacket, useLeadPackets } from '@/hooks/useDealPackets';
import { formatDate } from '@/lib/utils';
import type { DealPacket, Lead, PacketStatus } from '@/types/domain';

const STATUS_STYLE: Record<PacketStatus, string> = {
  draft: 'bg-surface-3 text-text-3',
  active: 'bg-success/15 text-success',
  archived: 'bg-warning-dim text-warning',
};

function PacketRow({ packet, onOpen, onDelete }: { packet: DealPacket; onOpen: () => void; onDelete: () => void }) {
  const [copied, setCopied] = useState(false);
  const url = packetUrl(packet.slug);

  function copy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border-2 bg-surface-3 p-3">
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLE[packet.status]}`}>
            {packet.status}
          </span>
          <span className="truncate text-[13px] font-medium text-text">
            {packet.ownerName || 'Untitled packet'}
          </span>
        </div>
        <div className="mt-0.5 text-[11px] text-text-3">
          Created {formatDate(packet.createdAt)}
          {packet.images.length > 0 && ` · ${packet.images.length} photo${packet.images.length !== 1 ? 's' : ''}`}
          {packet.comps.length > 0 && ` · ${packet.comps.length} comp${packet.comps.length !== 1 ? 's' : ''}`}
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-1.5">
        {packet.status === 'active' && (
          <>
            <button onClick={copy} className="btn !px-2 !py-1 text-[12px]" title="Copy shareable link">
              {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
            </button>
            <a href={url} target="_blank" rel="noopener noreferrer" className="btn !px-2 !py-1 text-[12px]" title="Open public packet">
              <ExternalLink size={13} />
            </a>
          </>
        )}
        <button onClick={onOpen} className="btn !px-2.5 !py-1 text-[12px]">Edit</button>
        <button onClick={onDelete} className="rounded p-1 text-text-3 hover:text-danger" title="Delete packet">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

export function PacketTab({ lead }: { lead: Lead }) {
  const { data: packets = [], isLoading } = useLeadPackets(lead.id);
  const createPacket = useCreatePacket();
  const deletePacket = useDeletePacket();
  const [openId, setOpenId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    try {
      const id = await createPacket.mutateAsync(lead);
      setOpenId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the packet.');
    }
  }

  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold text-text">Deal Packets</h2>
          <p className="text-[12px] text-text-3">
            Investor-facing summaries built from this lead. The street address stays hidden until you approve a viewer's request.
          </p>
        </div>
        <button onClick={handleCreate} disabled={createPacket.isPending} className="btn btn-primary shrink-0">
          <Plus size={14} /> {createPacket.isPending ? 'Creating…' : 'Create Deal Packet'}
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-danger/40 bg-danger-dim px-3 py-2 text-[13px] text-danger">{error}</div>
      )}

      {isLoading ? (
        <div className="py-6 text-center text-[13px] text-text-3">Loading packets…</div>
      ) : packets.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border-2 py-8 text-center">
          <FileText size={20} className="text-text-3" />
          <div className="text-[13px] text-text-2">No packets yet</div>
          <div className="max-w-sm text-[12px] text-text-3">
            A packet pulls the property details off this lead, then adds photos, comps, repairs and your narrative
            into one link you can send to investors.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {packets.map((p) => (
            <div key={p.id}>
              <PacketRow packet={p} onOpen={() => setOpenId(p.id)} onDelete={() => setDeleteTarget(p.id)} />
              {p.status !== 'draft' && <PacketAnalytics packetId={p.id} />}
            </div>
          ))}
        </div>
      )}

      {openId && <DealPacketBuilder packetId={openId} onClose={() => setOpenId(null)} />}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this packet?"
        message="The shareable link stops working immediately, and its view history and address requests are deleted with it. This cannot be undone."
        confirmLabel="Delete packet"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const id = deleteTarget;
          setDeleteTarget(null);
          if (!id) return;
          deletePacket.mutateAsync(id).catch((e) =>
            setError(e instanceof Error ? e.message : 'Could not delete the packet.'),
          );
        }}
      />
    </div>
  );
}
