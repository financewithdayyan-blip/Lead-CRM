import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
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

type Bucket = 'draft' | 'sent' | 'yourTurn' | 'completed';

const COLUMNS: Array<{ key: Bucket; label: string; dot: string }> = [
  { key: 'draft', label: 'Draft', dot: 'bg-text-3' },
  { key: 'sent', label: 'Sent', dot: 'bg-info' },
  { key: 'yourTurn', label: 'Your Turn', dot: 'bg-warning' },
  { key: 'completed', label: 'Completed', dot: 'bg-success' },
];

/** The one party who can actually act right now on a given envelope —
 * signing is strictly sequential, so at most one party is ever both
 * pending and unlocked. Mirrors ContractInstanceRow's own Remind-button
 * rule; needed here too since both bucketing and the "Your Turn" Sign-now
 * link depend on knowing who that is. */
function findPendingParty(instance: ContractInstance) {
  const ordered = [...instance.parties].sort((a, b) => a.signOrder - b.signOrder);
  return ordered.find(
    (p) => p.status === 'pending' && !ordered.some((other) => other.signOrder < p.signOrder && other.status !== 'signed'),
  );
}

/** "Your Turn" means the next unlocked signer is our own side of the deal —
 * the built-in 'buyer' role, or any extra role the template itself labels
 * "Buyer" (Cash Deal's second, countersigning slot — see the Blue Docs
 * contract-flow plan). Every other in-flight envelope (waiting on the
 * seller or an outside party) is "Sent"; declined/voided/expired ones land
 * there too, still flagged by their own red badge, since the flow stalled
 * rather than actually completing. */
function bucketFor(instance: ContractInstance): Bucket {
  if (instance.status === 'draft') return 'draft';
  if (instance.status === 'signed') return 'completed';
  const pending = findPendingParty(instance);
  if (!pending) return 'sent';
  const isUs =
    pending.role === 'buyer' ||
    instance.templatePartyRoles.find((r) => r.id === pending.role)?.label.trim().toLowerCase() === 'buyer';
  return isUs ? 'yourTurn' : 'sent';
}

/**
 * Every generated contract across every template, laid out as a board —
 * Draft / Sent / Your Turn / Completed — instead of digging into each
 * template's own Sign Inbox one at a time. The 20s poll matches this app's
 * existing "cheap and proven" pattern for admin-facing live-ish data (see
 * usePublicSigningParty's 8s poll on the signer side); real-time status
 * changes (viewed/signed/declined) also surface through the regular
 * Notifications page via lc_notifications, inserted by the same edge
 * functions that write the audit trail.
 */
export function EnvelopesTab() {
  const { data: instances = [], isLoading } = useContractInstances();
  const deleteInstance = useDeleteContractInstance();
  const voidInstance = useVoidContractInstance();
  const getSignedUrl = useSignedTemplateUrl();

  const [search, setSearch] = useState('');
  const [previewTarget, setPreviewTarget] = useState<ContractInstance | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return instances;
    return instances.filter((c) => c.name.toLowerCase().includes(q) || c.parties.some((p) => p.name.toLowerCase().includes(q)));
  }, [instances, search]);

  const grouped = useMemo(() => {
    const g: Record<Bucket, ContractInstance[]> = { draft: [], sent: [], yourTurn: [], completed: [] };
    for (const c of filtered) g[bucketFor(c)].push(c);
    return g;
  }, [filtered]);

  async function download(path: string, name: string) {
    const url = await getSignedUrl.mutateAsync(path);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.pdf`;
    a.click();
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <div className="relative max-w-xs flex-1">
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
      ) : instances.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-2 py-16 text-center text-sm text-text-3">
          Nothing sent yet — invite a signer from the Contracts tab to get started.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const items = grouped[col.key];
            return (
              <div key={col.key} className="min-w-0">
                <div className="mb-2 flex items-center gap-1.5 px-0.5">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${col.dot}`} />
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-text-2">{col.label}</span>
                  <span className="text-[11px] text-text-3">{items.length}</span>
                </div>
                <div className="max-h-[calc(100vh-260px)] space-y-2 overflow-y-auto rounded-lg bg-surface-2/50 p-2">
                  {items.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border-2 py-8 text-center text-[11px] text-text-3">Nothing here</div>
                  ) : (
                    items.map((c) => {
                      const pending = col.key === 'yourTurn' ? findPendingParty(c) : null;
                      return (
                        <ContractInstanceRow
                          key={c.id}
                          instance={c}
                          compact
                          bucket={col.key}
                          signHref={pending ? `${window.location.origin}/crm/sign/${pending.accessToken}` : undefined}
                          onPreview={() => setPreviewTarget(c)}
                          onDownload={download}
                          onDelete={() => setDeleteTarget(c.id)}
                          onVoid={() => setVoidTarget(c.id)}
                        />
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
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
