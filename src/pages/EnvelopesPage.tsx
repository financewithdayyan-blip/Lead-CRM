import { useMemo, useState } from 'react';
import { Inbox, Search } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ContractInstanceRow } from '@/components/bluedocs/ContractInstanceRow';
import { ContractPreviewModal } from '@/components/bluedocs/ContractPreviewModal';
import {
  useContractInstances,
  useDeleteContractInstance,
  useVoidContractInstance,
  type ContractInstance,
} from '@/hooks/useContractInstances';
import { useSignedTemplateUrl } from '@/hooks/useDocTemplates';

type StatusFilter = 'all' | ContractInstance['status'];

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'sent', label: 'Sent' },
  { key: 'partial', label: 'Partially signed' },
  { key: 'signed', label: 'Completed' },
  { key: 'declined', label: 'Declined' },
  { key: 'voided', label: 'Voided' },
];

/**
 * Every generated contract/LOI across every template in one place — replaces
 * digging into each template's own Sign Inbox one at a time. The 20s poll
 * matches this app's existing "cheap and proven" pattern for admin-facing
 * live-ish data (see usePublicSigningParty's 8s poll on the signer side);
 * real-time status changes (viewed/signed/declined) also surface through
 * the regular Notifications page via lc_notifications, inserted by the same
 * edge functions that write the audit trail.
 */
export function EnvelopesPage() {
  const { data: instances = [], isLoading } = useContractInstances();
  const deleteInstance = useDeleteContractInstance();
  const voidInstance = useVoidContractInstance();
  const getSignedUrl = useSignedTemplateUrl();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [previewTarget, setPreviewTarget] = useState<ContractInstance | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return instances.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.parties.some((p) => p.name.toLowerCase().includes(q));
    });
  }, [instances, statusFilter, search]);

  async function download(path: string, name: string) {
    const url = await getSignedUrl.mutateAsync(path);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.pdf`;
    a.click();
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Inbox size={20} />
        </span>
        <div>
          <h1 className="text-2xl font-semibold text-text">Envelopes</h1>
          <p className="text-sm text-text-3">Every contract and LOI sent for signature, across every template</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 overflow-x-auto">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
                statusFilter === t.key ? 'bg-primary text-white' : 'bg-surface-3 text-text-3 hover:text-text'
              }`}
              onClick={() => setStatusFilter(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto min-w-[220px] flex-1 max-w-xs">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            className="input !pl-7"
            placeholder="Search by document or party name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-text-3">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-2 py-16 text-center text-sm text-text-3">
          {instances.length === 0 ? 'Nothing sent yet — invite a signer from Blue Docs to get started.' : 'Nothing matches this filter.'}
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((c) => (
            <ContractInstanceRow
              key={c.id}
              instance={c}
              onPreview={() => setPreviewTarget(c)}
              onDownload={download}
              onDelete={() => setDeleteTarget(c.id)}
              onVoid={() => setVoidTarget(c.id)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this envelope?"
        message="This permanently deletes the contract and its signing links, including anyone who's already signed."
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (deleteTarget) deleteInstance.mutate(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={!!voidTarget}
        title="Void this envelope?"
        message="Every remaining signer's link stops working immediately. Anyone who already signed stays on record — this doesn't delete anything, it just cancels what's left."
        confirmLabel="Void"
        danger
        onConfirm={() => {
          if (voidTarget) voidInstance.mutate({ id: voidTarget });
          setVoidTarget(null);
        }}
        onCancel={() => setVoidTarget(null)}
      />

      {previewTarget && <ContractPreviewModal instance={previewTarget} onClose={() => setPreviewTarget(null)} />}
    </div>
  );
}
