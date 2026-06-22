import { useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useDeleteLeads } from '@/hooks/useLeads';
import { STAGE_CONFIG, type Lead, type LeadStage, type Tag } from '@/types/domain';

export function DeleteLeadsModal({ leads, tags, onClose }: { leads: Lead[]; tags: Tag[]; onClose: () => void }) {
  const deleteLeads = useDeleteLeads();
  const [mode, setMode] = useState<'all' | 'filter'>('all');
  const [stages, setStages] = useState<Set<LeadStage>>(new Set());
  const [tagIds, setTagIds] = useState<Set<string>>(new Set());
  const [confirmText, setConfirmText] = useState('');

  const targets = useMemo(() => {
    if (mode === 'all') return leads;
    return leads.filter((l) => (stages.size > 0 && stages.has(l.stage)) || (tagIds.size > 0 && l.tagIds.some((t) => tagIds.has(t))));
  }, [leads, mode, stages, tagIds]);

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

  async function handleDelete() {
    if (!confirmed || targets.length === 0) return;
    await deleteLeads.mutateAsync(targets.map((l) => l.id));
    onClose();
  }

  return (
    <Modal open onClose={onClose} title="Delete Leads">
      <div className="space-y-4">
        <div className="flex gap-2">
          <button onClick={() => setMode('all')} className={`btn ${mode === 'all' ? '!border-danger !text-danger' : ''}`}>
            All leads
          </button>
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
                  const count = leads.filter((l) => l.stage === key).length;
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
                    const count = leads.filter((l) => l.tagIds.includes(t.id)).length;
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

        <div className="rounded-md bg-danger-dim px-3 py-2 text-[13px] text-danger">
          This will permanently delete <strong>{targets.length}</strong> lead{targets.length !== 1 ? 's' : ''} and all associated activity, comps, and files.
        </div>

        <div>
          <label className="label">Type DELETE to confirm</label>
          <input className="input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" />
        </div>

        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button disabled={!confirmed || targets.length === 0} className="btn btn-danger" onClick={handleDelete}>
            Delete {targets.length} lead{targets.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </Modal>
  );
}
