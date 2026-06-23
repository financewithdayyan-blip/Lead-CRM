import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, History, PhoneCall, X } from 'lucide-react';
import { useRecentActivities } from '@/hooks/useActivities';
import { STAGE_CONFIG } from '@/types/domain';
import { formatDateTime, localIsoDate } from '@/lib/utils';

const OUTCOME_FILTERS: Array<{ key: string; label: string; color: string }> = [
  { key: 'voicemail', label: 'Voicemail', color: STAGE_CONFIG.voicemail.color },
  { key: 'initial_contact', label: 'Initial Contact', color: STAGE_CONFIG.initial_contact.color },
  { key: 'followup', label: 'Follow-Up', color: STAGE_CONFIG.followup.color },
  { key: 'onhold', label: 'On Hold', color: STAGE_CONFIG.onhold.color },
  { key: 'dead', label: 'Dead', color: STAGE_CONFIG.dead_declined.color },
  { key: 'declined', label: 'Declined', color: STAGE_CONFIG.dead_declined.color },
];

export function CallHistoryPage() {
  const { data: activities = [], isLoading } = useRecentActivities(undefined, 2000);
  const [date, setDate] = useState('');
  const [outcome, setOutcome] = useState<string | null>(null);

  const calls = useMemo(() => activities.filter((a) => a.type === 'call'), [activities]);

  const filtered = useMemo(() => {
    return calls.filter((a) => {
      if (date && localIsoDate(new Date(a.createdAt)) !== date) return false;
      if (outcome && (a.meta as { outcome?: string })?.outcome !== outcome) return false;
      return true;
    });
  }, [calls, date, outcome]);

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-text">Call History</h1>
        <p className="text-sm text-text-3">Every call logged from your calling sessions</p>
      </div>

      <div className="card mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <CalendarDays size={15} className="text-text-3" />
            <input type="date" className="input !w-auto" value={date} onChange={(e) => setDate(e.target.value)} />
            {date && (
              <button onClick={() => setDate('')} className="text-text-3 hover:text-text">
                <X size={15} />
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            onClick={() => setOutcome(null)}
            className={`btn !px-2.5 !py-1 text-[12px] ${outcome === null ? '!border-primary !text-primary-text' : ''}`}
          >
            All
          </button>
          {OUTCOME_FILTERS.map((o) => (
            <button
              key={o.key}
              onClick={() => setOutcome(o.key)}
              className="btn !px-2.5 !py-1 text-[12px]"
              style={outcome === o.key ? { borderColor: o.color, color: o.color, background: `${o.color}1a` } : undefined}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        {isLoading && <div className="text-[13px] text-text-3">Loading…</div>}
        {!isLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-text-3">
            <History size={28} />
            <div className="text-[13px]">No calls match these filters.</div>
          </div>
        )}
        <div className="divide-y divide-border">
          {filtered.map((a) => {
            const outcomeKey = (a.meta as { outcome?: string })?.outcome;
            const outcomeInfo = OUTCOME_FILTERS.find((o) => o.key === outcomeKey);
            return (
              <div key={a.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-dim text-primary">
                  <PhoneCall size={13} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {a.leadId ? (
                      <Link to={`/leads/${a.leadId}`} className="text-[13px] font-medium text-text hover:text-primary">
                        {a.leadName || 'Unknown lead'}
                      </Link>
                    ) : (
                      <span className="text-[13px] font-medium text-text">{a.leadName || 'Unknown lead'}</span>
                    )}
                    {outcomeInfo && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                        style={{ background: `${outcomeInfo.color}1a`, color: outcomeInfo.color }}
                      >
                        {outcomeInfo.label}
                      </span>
                    )}
                  </div>
                  {a.body && <div className="mt-0.5 text-[13px] text-text-2">{a.body}</div>}
                  <div className="mt-0.5 text-[11px] text-text-3">{formatDateTime(a.createdAt)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
