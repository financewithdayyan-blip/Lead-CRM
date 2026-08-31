import { useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useAllLeadStagesAndTags, useDeleteLeads } from '@/hooks/useLeads';
import { STAGE_CONFIG, type LeadStage, type Tag } from '@/types/domain';

// Common subset of Lead and LeadStageAndTags — "selected" mode gets full Lead
// objects straight from the Leads table's current page, "by filter" mode gets
// the lighter per-account fetch below; both carry everything this modal needs.
interface DeletableLead {
  id: string;
  leadNum: number | null;
  firstName: string;
  lastName: string;
  stage: LeadStage;
  tagIds: string[];
}

export function DeleteLeadsModal({
  selectedLeads,
  tags,
  targetUserId,
  onClose,
}: {
  selectedLeads: DeletableLead[];
  tags: Tag[];
  targetUserId?: string;
  onClose: () => void;
}) {
  const deleteLeads = useDeleteLeads();
  const hasSelection = selectedLeads.length > 0;
  const [mode, setMode] = useState<'selected' | 'filter'>(hasSelection ? 'selected' : 'filter');
  const [stages, setStages] = useState<Set<LeadStage>>(new Set());
  const [tagIds, setTagIds] = useState<Set<string>>(new Set());
  const [confirmText, setConfirmText] = useState('');

  // "By filter" needs live stage/tag counts across the WHOLE account, not
  // just whatever page the Leads table currently has loaded — fetched only
  // while this modal is open.
  const { data: allLeads = [] } = useAllLeadStagesAndTags(targetUserId);

  const targets = useMemo(() => {
    if (mode === 'selected') return selectedLeads;
    return allLeads.filter(
      (l) => (stages.size > 0 && stages.has(l.stage)) || (tagIds.size > 0 && l.tagIds.some((t) => tagIds.has(t))),
    );
  }, [selectedLeads, allLeads, mode, stages, tagIds]);

  function toggleStage(s: LeadStage) {
    setStages((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  }
  function toggleTag(id: string) {
    setTagIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const confirmed = confirmText.trim().toUpperCase() === 'DELETE';
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!confirmed || targets.length === 0 || deleteLeads.isPending) return;
    setError(null);
    try {
      await deleteLeads.mutateAsync(targets.map((l) => l.id));
      onClose();
    } catch (e) {
      // Large deletes run in chunks, so a failure partway can still have removed
      // some leads. Stay open and say so rather than closing on a silent error.
      setError(e instanceof Error ? e.message : 'Delete failed. Some leads may not have been removed.');
    }
  }

  return (
    <Modal open onClose={onClose} title="Delete Leads">
      <div className="space-y-4">
        {/* Mode tabs — only show "Selected" tab when there is a selection */}
        <div className="flex gap-2">
          {hasSelection && (
            <button onClick={() => setMode('selected')} className={`btn ${mode === 'selected' ? '!border-danger !text-danger' : ''}`}>
              Selected ({selectedLeads.length})
            </button>
          )}
          <button onClick={() => setMode('filter')} className={`btn ${mode === 'filter' ? '!border-danger !text-danger' : ''}`}>
            By filter
          </button>
        </div>

        {mode === 'filter' && (
          <div className="space-y-3">
            <div>
              <div className="label">By stage</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(STAGE_CONFIG).map(([key, cfg]) => {
                  const count = allLeads.filter((l) => l.stage === key).length;
                  if (!count) return null;
                  return (
                    <button
                      key={key}
                      onClick={() => toggleStage(key as LeadStage)}
                      className={`btn !px-2 !py-1 text-[12px] ${stages.has(key as LeadStage) ? '!border-danger !text-danger' : ''}`}
                    >
                      {cfg.label} <span className="opacity-60">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            {tags.length > 0 && (
              <div>
                <div className="label">By tag</div>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t) => {
                    const count = allLeads.filter((l) => l.tagIds.includes(t.id)).length;
                    return (
                      <button
                        key={t.id}
                        onClick={() => toggleTag(t.id)}
                        className={`btn !px-2 !py-1 text-[12px] ${tagIds.has(t.id) ? '!border-danger !text-danger' : ''}`}
                      >
                        {t.name} <span className="opacity-60">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {mode === 'selected' && (
          <div className="max-h-40 overflow-y-auto rounded-md border border-border-2 bg-surface-3 px-3 py-2 text-[13px] text-text-2">
            {targets.map((l) => (
              <div key={l.id} className="py-0.5">
                {l.firstName} {l.lastName} <span className="text-text-3">#{l.leadNum}</span>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-md bg-danger-dim px-3 py-2 text-[13px] text-danger">
          This will permanently delete <strong>{targets.length}</strong> lead{targets.length !== 1 ? 's' : ''} and all associated activity, comps, and files.
        </div>

        <div>
          <label className="label">Type DELETE to confirm</label>
          <input className="input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" />
        </div>

        {error && (
          <div className="rounded-md border border-danger/40 bg-danger-dim px-3 py-2 text-[13px] text-danger">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose} disabled={deleteLeads.isPending}>
            Cancel
          </button>
          <button
            disabled={!confirmed || targets.length === 0 || deleteLeads.isPending}
            className="btn btn-danger"
            onClick={handleDelete}
          >
            {deleteLeads.isPending
              ? `Deleting ${targets.length}…`
              : `Delete ${targets.length} lead${targets.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
