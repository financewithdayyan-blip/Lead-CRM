import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { PhoneCall } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import type { Lead } from '@/types/domain';

/** How urgent this callback reads at a glance — same overdue/today/upcoming
 * scheme the Kanban card already uses for nextFollowUp, applied here to an
 * exact timestamp rather than a plain date. */
function urgency(at: string): 'overdue' | 'soon' | 'upcoming' {
  const diffMs = new Date(at).getTime() - Date.now();
  if (diffMs < 0) return 'overdue';
  if (diffMs < 24 * 60 * 60 * 1000) return 'soon';
  return 'upcoming';
}

const URGENCY_STYLE: Record<ReturnType<typeof urgency>, { pill: string; label: string }> = {
  overdue: { pill: 'bg-danger-dim text-danger', label: 'Overdue' },
  soon: { pill: 'bg-warning-dim text-warning', label: 'Due soon' },
  upcoming: { pill: 'bg-surface-3 text-text-3', label: 'Scheduled' },
};

/** Every lead the AI has actually gotten a real callback time from — its
 * final qualification step asks "what's a good time to call you back
 * tomorrow" and only records an answer once the seller gives one, so
 * everything here is a real commitment, not a guess. */
export function ScheduledCallsCard({ leads }: { leads: Lead[] }) {
  const scheduled = useMemo(
    () =>
      leads
        .filter((l): l is Lead & { scheduledCallbackAt: string } => !!l.scheduledCallbackAt)
        .sort((a, b) => a.scheduledCallbackAt.localeCompare(b.scheduledCallbackAt)),
    [leads],
  );

  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text">
          <PhoneCall size={14} /> Scheduled Calls
        </h3>
        {scheduled.length > 0 && <span className="text-[11px] text-text-3">{scheduled.length} total</span>}
      </div>

      {scheduled.length === 0 ? (
        <p className="text-[13px] text-text-3">
          No calls scheduled yet — the AI books these automatically once a seller gives an actual callback time.
        </p>
      ) : (
        <div className="no-scrollbar max-h-[340px] space-y-1.5 overflow-y-auto pr-0.5">
          {scheduled.map((lead) => {
            const u = urgency(lead.scheduledCallbackAt);
            const style = URGENCY_STYLE[u];
            return (
              <Link
                key={lead.id}
                to={`/leads/${lead.id}`}
                className="flex items-center justify-between gap-2 rounded-md border border-border-2 bg-surface-3 px-3 py-2 text-[13px] hover:border-border"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-text">
                    {lead.firstName} {lead.lastName}
                  </div>
                  {lead.scheduledCallbackNote && (
                    <div className="truncate text-[11px] text-text-3" title={lead.scheduledCallbackNote}>
                      "{lead.scheduledCallbackNote}"
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${style.pill}`}>{style.label}</span>
                  <span className="text-[11px] text-text-3">{formatDateTime(lead.scheduledCallbackAt)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
