import { useUpdateLead } from '@/hooks/useLeads';
import { formatDate } from '@/lib/utils';
import { TITLE_CHECKLIST_STEPS, type Lead } from '@/types/domain';

export function TitleClosingCard({ lead }: { lead: Lead }) {
  const updateLead = useUpdateLead();
  const checklist = lead.titleChecklist ?? {};
  const doneCount = TITLE_CHECKLIST_STEPS.filter((s) => checklist[s.key]?.done).length;

  function toggle(key: (typeof TITLE_CHECKLIST_STEPS)[number]['key']) {
    const current = checklist[key]?.done ?? false;
    updateLead.mutate({
      id: lead.id,
      titleChecklist: {
        ...checklist,
        [key]: { done: !current, completedAt: !current ? new Date().toISOString() : null },
      },
    });
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2 border-b border-border pb-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Title & Closing</div>
        <div className="text-[13px] font-semibold text-text">
          {doneCount}/{TITLE_CHECKLIST_STEPS.length}
        </div>
      </div>

      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-border-2">
        <div
          className="h-full rounded-full bg-success transition-all"
          style={{ width: `${(doneCount / TITLE_CHECKLIST_STEPS.length) * 100}%` }}
        />
      </div>

      <div className="mt-3 divide-y divide-border-2">
        {TITLE_CHECKLIST_STEPS.map((step) => {
          const entry = checklist[step.key];
          return (
            <label key={step.key} className="flex cursor-pointer items-center justify-between gap-3 py-2">
              <span className="flex items-center gap-2.5">
                <input type="checkbox" checked={!!entry?.done} onChange={() => toggle(step.key)} className="h-3.5 w-3.5 cursor-pointer accent-primary" />
                <span className={`text-[13px] ${entry?.done ? 'text-text' : 'text-text-2'}`}>{step.label}</span>
              </span>
              <span className="text-[11.5px] text-text-3">{entry?.done && entry.completedAt ? formatDate(entry.completedAt) : '—'}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
