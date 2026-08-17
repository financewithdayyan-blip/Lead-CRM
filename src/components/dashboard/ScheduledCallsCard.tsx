import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Loader2, PhoneCall } from 'lucide-react';
import { formatPakistanTime, formatTimeInZone, resolveUsTimeZone } from '@/lib/timezone';
import { useAddActivity } from '@/hooks/useActivities';
import { useUpdateLead } from '@/hooks/useLeads';
import { Modal } from '@/components/ui/Modal';
import { formatPhone, leadDisplayName } from '@/lib/utils';
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

/** Logs what happened on the call as a real activity on the lead, then
 * clears the callback so it drops off this list — the whole point of asking
 * for an update is that a completed call without one leaves no record of
 * what was actually said. */
function MarkCompleteModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const [notes, setNotes] = useState('');
  const addActivity = useAddActivity();
  const updateLead = useUpdateLead();

  const saving = addActivity.isPending || updateLead.isPending;

  async function handleSubmit() {
    if (!notes.trim()) return;
    const body = notes.trim();
    // Logged twice on purpose: as a 'call' activity so it still shows in Call
    // History/stats, and as a 'note' so it actually shows up in the lead's
    // Notes tab too — previously only the former happened, so a completed
    // scheduled call left no visible trace in Notes at all.
    await addActivity.mutateAsync({ leadId: lead.id, type: 'call', body, meta: { scheduledCallCompleted: true } });
    await addActivity.mutateAsync({ leadId: lead.id, type: 'note', body: `Scheduled call: ${body}` });
    await updateLead.mutateAsync({ id: lead.id, scheduledCallbackAt: null, scheduledCallbackNote: null });
    onClose();
  }

  const displayName = leadDisplayName(lead.firstName, lead.lastName) ?? 'this lead';

  return (
    <Modal open onClose={onClose} title={`Mark call with ${displayName} complete`} width="sm">
      <div className="space-y-3">
        {lead.scheduledCallbackNote && (
          <p className="text-[12px] text-text-3">They asked for a call: "{lead.scheduledCallbackNote}"</p>
        )}
        <div>
          <label className="label">What's the update on this lead?</label>
          <textarea
            className="input min-h-[90px] resize-none"
            placeholder="What happened on the call — any new info, next step, etc."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving || !notes.trim()}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Mark completed
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Every lead the AI has actually gotten a real callback time from — its
 * final qualification step asks "what's a good time to call you back
 * tomorrow" and only records an answer once the seller gives one, so
 * everything here is a real commitment, not a guess. */
export function ScheduledCallsCard({ leads }: { leads: Lead[] }) {
  const [completing, setCompleting] = useState<Lead | null>(null);

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
            const sellerTimeZone = resolveUsTimeZone(lead.state, lead.address);
            const pakistanTime = formatPakistanTime(lead.scheduledCallbackAt);
            const sellerTime = sellerTimeZone ? formatTimeInZone(lead.scheduledCallbackAt, sellerTimeZone) : null;
            return (
              <div
                key={lead.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border-2 bg-surface-3 px-3 py-2 text-[13px] hover:border-border"
              >
                <Link to={`/leads/${lead.id}`} className="min-w-0 flex-1">
                  <div className="truncate font-medium text-text">{leadDisplayName(lead.firstName, lead.lastName) ?? formatPhone(lead.phone)}</div>
                  {lead.scheduledCallbackNote && (
                    <div className="truncate text-[11px] text-text-3" title={lead.scheduledCallbackNote}>
                      "{lead.scheduledCallbackNote}"
                    </div>
                  )}
                </Link>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="flex flex-col items-end gap-0.5">
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${style.pill}`}>{style.label}</span>
                    <span className="text-[11px] font-medium text-text-2">{pakistanTime} PKT</span>
                    {sellerTime && <span className="text-[10px] text-text-3">Seller's time: {sellerTime}</span>}
                  </div>
                  <button
                    className="flex shrink-0 items-center gap-1 rounded-md border border-border-2 bg-white px-2 py-1 text-[11px] font-medium text-text-2 hover:border-success hover:text-success"
                    onClick={() => setCompleting(lead)}
                    title="Mark this call completed"
                  >
                    <Check size={12} /> Done
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {completing && <MarkCompleteModal lead={completing} onClose={() => setCompleting(null)} />}
    </div>
  );
}
