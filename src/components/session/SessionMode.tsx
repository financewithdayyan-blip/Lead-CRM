import { useEffect, useMemo, useState } from 'react';
import { Phone, Copy, X } from 'lucide-react';
import { useUpdateLead } from '@/hooks/useLeads';
import { useLogCall } from '@/hooks/useCallLog';
import { useLogSession } from '@/hooks/useDailyStats';
import { useTags } from '@/hooks/useTags';
import { OUTCOME_TRANSITIONS, STATUS_CONFIG, type Lead, type LeadStatus, type RepairFlags } from '@/types/domain';
import { StarRating } from '@/components/ui/StarRating';
import { TagPill } from '@/components/ui/TagPill';
import { formatCurrency, formatPhone, localIsoDate } from '@/lib/utils';

const REPAIR_OPTIONS: Array<{ key: keyof RepairFlags; icon: string; label: string }> = [
  { key: 'cosmetics', icon: '🖌️', label: 'Cosmetics' },
  { key: 'hvac', icon: '❄️', label: 'HVAC' },
  { key: 'plumbing', icon: '🔧', label: 'Plumbing' },
  { key: 'roof', icon: '🏠', label: 'Roof' },
  { key: 'foundation', icon: '🧱', label: 'Foundation' },
  { key: 'electrical', icon: '⚡', label: 'Electrical' },
];

function buildQueue(leads: Lead[], leadIdFirst?: string): Lead[] {
  const today = localIsoDate(new Date());
  const first = leadIdFirst ? leads.find((l) => l.id === leadIdFirst) : undefined;
  const rest = leads.filter((l) => l.id !== first?.id);
  const cold = rest.filter((l) => l.status === 'new');
  const vmDue = rest.filter((l) => l.status === 'voicemail' && (!l.nextCallDate || l.nextCallDate <= today));
  const fu = rest.filter((l) => l.status === 'followup');
  const fu2 = rest.filter((l) => l.status === 'followup2');
  const fu3 = rest.filter((l) => l.status === 'followup3');
  return [...(first ? [first] : []), ...cold, ...vmDue, ...fu, ...fu2, ...fu3];
}

export function SessionMode({ leads, startLeadId, onClose }: { leads: Lead[]; startLeadId?: string; onClose: () => void }) {
  const { data: tags = [] } = useTags();
  const updateLead = useUpdateLead();
  const logCall = useLogCall();
  const logSession = useLogSession();

  const queue = useMemo(() => buildQueue(leads, startLeadId), [leads, startLeadId]);
  const [idx, setIdx] = useState(0);
  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [callsLogged, setCallsLogged] = useState(0);

  const [pickedStatus, setPickedStatus] = useState<LeadStatus | null>(null);
  const [rating, setRating] = useState(0);
  const [propertyRating, setPropertyRating] = useState(0);
  const [repairs, setRepairs] = useState<RepairFlags>({});
  const [note, setNote] = useState('');
  const [followupDate, setFollowupDate] = useState('');

  const lead = queue[idx];

  useEffect(() => {
    const t = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  useEffect(() => {
    if (!lead) return;
    setPickedStatus(null);
    setRating(lead.rating || 0);
    setPropertyRating(lead.propertyRating || 0);
    setRepairs(lead.repairs || {});
    setNote(lead.note || '');
    setFollowupDate(lead.followupDate || '');
  }, [lead?.id]);

  function finishSession() {
    logSession.mutate({ sessionDate: localIsoDate(new Date()), durationSeconds: Math.round(elapsed / 1000), callsMade: callsLogged });
    onClose();
  }

  async function handleSubmit() {
    if (!lead) return;
    const status = pickedStatus ?? lead.status;
    let voicemailCount = lead.voicemailCount;
    let finalStatus = status;
    if (status === 'voicemail') {
      voicemailCount = voicemailCount + 1;
      if (voicemailCount >= 3) finalStatus = 'dead';
    }

    await updateLead.mutateAsync({
      id: lead.id,
      status: finalStatus,
      rating,
      propertyRating: propertyRating || null,
      repairs,
      note: note || null,
      followupDate: followupDate || null,
      voicemailCount,
      calledAt: new Date().toISOString(),
    });
    await logCall.mutateAsync({
      leadId: lead.id,
      leadNum: lead.leadNum,
      name: `${lead.firstName} ${lead.lastName}`.trim(),
      phone: lead.phone,
      address: lead.address,
      status: finalStatus,
      rating,
      note: note || null,
      tagIds: lead.tagIds,
    });
    setCallsLogged((n) => n + 1);
    setIdx((i) => i + 1);
  }

  const h = String(Math.floor(elapsed / 3600000)).padStart(2, '0');
  const m = String(Math.floor((elapsed % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0');

  if (queue.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="card max-w-sm text-center">
          <p className="text-text-2">No leads available for a session right now.</p>
          <button className="btn mt-4" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  if (idx >= queue.length) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="card max-w-sm text-center">
          <div className="text-4xl">🎉</div>
          <h3 className="mt-2 font-display text-lg font-semibold text-text">Session complete!</h3>
          <p className="mt-1 text-sm text-text-3">
            You went through all {queue.length} leads.
            <br />
            {callsLogged} call{callsLogged !== 1 ? 's' : ''} logged this session.
          </p>
          <button className="btn btn-primary mt-4 w-full" onClick={finishSession}>
            Close &amp; View Dashboard
          </button>
        </div>
      </div>
    );
  }

  const allowedStatuses = OUTCOME_TRANSITIONS[lead.status] ?? [];
  const showFollowup = pickedStatus === 'followup' || pickedStatus === 'followup2' || pickedStatus === 'followup3';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="text-sm font-medium text-text-2">
          Lead {idx + 1} of {queue.length}
          {lead.batch ? ` · ${lead.batch}` : ''}
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-sm text-blue-bright">
            ⏱ {h}:{m}:{s}
          </span>
          <button onClick={onClose} className="rounded-md p-1.5 text-text-3 hover:bg-surface-3 hover:text-text">
            <X size={18} />
          </button>
        </div>
      </div>
      <div className="h-1 bg-surface-3">
        <div className="h-full bg-blue transition-all" style={{ width: `${Math.round((idx / queue.length) * 100)}%` }} />
      </div>

      <div className="flex flex-1 overflow-y-auto">
        <div className="w-1/2 border-r border-border p-8">
          <div className="mb-2 inline-flex items-center rounded-full bg-blue-dim px-2.5 py-0.5 text-[11px] font-bold text-blue-bright">
            #{lead.leadNum}
          </div>
          <h2 className="font-display text-2xl font-semibold text-text">
            {lead.firstName} {lead.lastName}
          </h2>
          {lead.email && <div className="mt-1 text-sm text-text-3">{lead.email}</div>}
          <div className="mt-1 flex flex-wrap gap-1">
            {lead.tagIds.map((tid) => {
              const tag = tags.find((t) => t.id === tid);
              return tag ? <TagPill key={tid} tag={tag} /> : null;
            })}
          </div>

          <div className="mt-5 space-y-2 rounded-md border border-border bg-surface-3 p-4">
            <div className="flex items-center justify-between">
              <span className="font-display text-xl font-semibold text-text">{formatPhone(lead.phone)}</span>
              <div className="flex gap-2">
                <a href={`tel:${lead.phone}`} className="btn !px-2.5 !py-1.5">
                  <Phone size={14} />
                </a>
                <button onClick={() => navigator.clipboard.writeText(lead.phone)} className="btn !px-2.5 !py-1.5">
                  <Copy size={14} />
                </button>
              </div>
            </div>
            {lead.phone2 && <div className="text-sm text-text-2">{formatPhone(lead.phone2)} (landline)</div>}
            {lead.address && (
              <div className="text-sm text-text-2">
                📍 {lead.address} {lead.state ? `· ${lead.state}` : ''}
              </div>
            )}
          </div>

          {(lead.arv || lead.asIs || lead.estRepairs) && (
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              {lead.arv && (
                <div className="rounded-md bg-surface-3 p-2">
                  <div className="text-[10px] uppercase text-text-3">ARV</div>
                  <div className="text-sm font-semibold text-green">{formatCurrency(lead.arv)}</div>
                </div>
              )}
              {lead.asIs && (
                <div className="rounded-md bg-surface-3 p-2">
                  <div className="text-[10px] uppercase text-text-3">As-Is</div>
                  <div className="text-sm font-semibold text-blue-bright">{formatCurrency(lead.asIs)}</div>
                </div>
              )}
              {lead.estRepairs && (
                <div className="rounded-md bg-surface-3 p-2">
                  <div className="text-[10px] uppercase text-text-3">Repairs</div>
                  <div className="text-sm font-semibold text-amber">{formatCurrency(lead.estRepairs)}</div>
                </div>
              )}
            </div>
          )}

          <div className="mt-5">
            <div className="label">Repairs needed</div>
            <div className="flex flex-wrap gap-1.5">
              {REPAIR_OPTIONS.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRepairs((prev) => ({ ...prev, [r.key]: !prev[r.key] }))}
                  className={`btn !px-2 !py-1 text-[12px] ${repairs[r.key] ? '!border-amber !text-amber' : ''}`}
                >
                  {r.icon} {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <div className="label">Property rating (out of 10)</div>
            <div className="flex gap-1">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  onClick={() => setPropertyRating(n)}
                  className={`h-7 w-7 rounded-md text-[12px] font-semibold transition-colors ${
                    propertyRating >= n ? 'bg-amber text-bg' : 'bg-surface-3 text-text-3'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <div className="label">Rate yourself</div>
            <StarRating value={rating} onChange={setRating} size={22} />
          </div>
        </div>

        <div className="w-1/2 p-8">
          <div className="label">Call outcome</div>
          <div className="flex flex-wrap gap-2">
            {allowedStatuses.map((statusKey) => (
              <button
                key={statusKey}
                onClick={() => setPickedStatus(statusKey)}
                className={`btn text-[13px] ${pickedStatus === statusKey ? '!border-blue !bg-blue-dim !text-blue-bright' : ''}`}
              >
                {STATUS_CONFIG[statusKey].label}
              </button>
            ))}
          </div>

          {pickedStatus === 'voicemail' && lead.voicemailCount > 0 && (
            <div className="mt-3 rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-[12px] text-amber">
              📵 Voicemail attempt {lead.voicemailCount + 1}/3
              {lead.voicemailCount + 1 >= 3 ? ' — this will mark the lead as dead.' : ' — will retry tomorrow.'}
            </div>
          )}

          {showFollowup && (
            <div className="mt-4">
              <label className="label">Follow-up date</label>
              <div className="flex gap-2">
                {[
                  { label: 'Tomorrow', days: 1 },
                  { label: 'In 3 days', days: 3 },
                  { label: 'In a week', days: 7 },
                ].map(({ label, days }) => (
                  <button
                    key={label}
                    className="btn !px-2 !py-1 text-[12px]"
                    onClick={() => setFollowupDate(localIsoDate(new Date(Date.now() + days * 86400000)))}
                  >
                    {label}
                  </button>
                ))}
                <input type="date" className="input" value={followupDate} onChange={(e) => setFollowupDate(e.target.value)} />
              </div>
            </div>
          )}

          <div className="mt-5">
            <label className="label">Notes</label>
            <textarea className="input min-h-[140px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add call notes…" />
          </div>

          <button onClick={handleSubmit} className="btn btn-primary mt-5 w-full !py-3 text-sm">
            Save &amp; Next →
          </button>
        </div>
      </div>
    </div>
  );
}
