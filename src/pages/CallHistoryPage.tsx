import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, X } from 'lucide-react';
import { useRecentActivities } from '@/hooks/useActivities';
import { useLeads } from '@/hooks/useLeads';
import { useTags } from '@/hooks/useTags';
import { StarRating } from '@/components/ui/StarRating';
import { TagPill } from '@/components/ui/TagPill';
import { STAGE_CONFIG } from '@/types/domain';
import { formatDateTime, formatPhone, localIsoDate } from '@/lib/utils';

const OUTCOME_FILTERS: Array<{ key: string; label: string; color: string }> = [
  { key: 'voicemail', label: 'Voicemail', color: STAGE_CONFIG.voicemail.color },
  { key: 'initial_contact', label: 'Initial Contact', color: STAGE_CONFIG.initial_contact.color },
  { key: 'followup', label: 'Follow-Up', color: STAGE_CONFIG.followup.color },
  { key: 'onhold', label: 'On Hold', color: STAGE_CONFIG.onhold.color },
  { key: 'dead', label: 'Dead', color: STAGE_CONFIG.dead_declined.color },
  { key: 'declined', label: 'Declined', color: STAGE_CONFIG.dead_declined.color },
];

const TIME_FILTERS = [
  { key: 'all', label: 'All time' },
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'month', label: 'This month' },
];

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="card !p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">{label}</div>
      <div className="mt-1 text-2xl font-semibold" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

export function CallHistoryPage() {
  const navigate = useNavigate();
  const { data: activities = [], isLoading } = useRecentActivities(undefined, 2000);
  const { data: leads = [] } = useLeads();
  const { data: tags = [] } = useTags();

  const [search, setSearch] = useState('');
  const [outcome, setOutcome] = useState('');
  const [time, setTime] = useState('all');
  const [rating, setRating] = useState('');

  const leadsById = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);
  const calls = useMemo(() => activities.filter((a) => a.type === 'call'), [activities]);

  const enriched = useMemo(
    () =>
      calls.map((a) => {
        const lead = a.leadId ? leadsById.get(a.leadId) : undefined;
        const outcomeKey = (a.meta as { outcome?: string })?.outcome;
        const outcomeInfo = OUTCOME_FILTERS.find((o) => o.key === outcomeKey);
        const isAutoBody = !!outcomeInfo && a.body === `Call outcome: ${outcomeInfo.label}`;
        return {
          activity: a,
          lead,
          outcomeInfo,
          note: isAutoBody ? '' : a.body ?? '',
        };
      }),
    [calls, leadsById],
  );

  const stats = useMemo(() => {
    const todayIso = localIsoDate(new Date());
    return {
      total: calls.length,
      today: calls.filter((a) => localIsoDate(new Date(a.createdAt)) === todayIso).length,
      followUps: calls.filter((a) => (a.meta as { outcome?: string })?.outcome === 'followup').length,
      contracts: enriched.filter((e) => e.lead?.stage === 'contract').length,
      fiveStar: enriched.filter((e) => e.lead?.rating === 5).length,
    };
  }, [calls, enriched]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const now = new Date();
    return enriched.filter(({ activity, lead, outcomeInfo }) => {
      if (outcome && outcomeInfo?.key !== outcome) return false;
      if (rating && lead?.rating !== Number(rating)) return false;
      if (time !== 'all') {
        const d = new Date(activity.createdAt);
        if (time === 'today' && localIsoDate(d) !== localIsoDate(now)) return false;
        if (time === '7d' && now.getTime() - d.getTime() > 7 * 86400000) return false;
        if (time === '30d' && now.getTime() - d.getTime() > 30 * 86400000) return false;
        if (time === 'month' && !(d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth())) return false;
      }
      if (q) {
        const haystack = `${lead?.firstName ?? ''} ${lead?.lastName ?? ''} ${lead?.phone ?? ''} ${lead?.address ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [enriched, search, outcome, time, rating]);

  function clearFilters() {
    setSearch('');
    setOutcome('');
    setTime('all');
    setRating('');
  }

  const hasFilters = search || outcome || time !== 'all' || rating;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-text">Call History</h1>
        <p className="text-sm text-text-3">Every call logged from your calling sessions</p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Total Calls" value={stats.total} color="#10b981" />
        <StatCard label="Today" value={stats.today} color="#4f46e5" />
        <StatCard label="Follow Ups" value={stats.followUps} color="#a78bfa" />
        <StatCard label="Contracts" value={stats.contracts} color="#10b981" />
        <StatCard label="5-Star Calls" value={stats.fiveStar} color="#f59e0b" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder="Search name, phone, address…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input max-w-[160px]" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="">All outcomes</option>
          {OUTCOME_FILTERS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <select className="input max-w-[150px]" value={time} onChange={(e) => setTime(e.target.value)}>
          {TIME_FILTERS.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
        <select className="input max-w-[140px]" value={rating} onChange={(e) => setRating(e.target.value)}>
          <option value="">All ratings</option>
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {n} star{n !== 1 ? 's' : ''}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button className="btn ml-auto" onClick={clearFilters}>
            <X size={14} /> Clear
          </button>
        )}
      </div>

      <div className="card overflow-x-auto !p-0">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-border bg-surface-3 text-[11px] uppercase tracking-wide text-text-3">
            <tr>
              <th className="px-3 py-2.5">#</th>
              <th className="px-3 py-2.5">Date &amp; Time</th>
              <th className="px-3 py-2.5">Lead</th>
              <th className="px-3 py-2.5">Phone</th>
              <th className="px-3 py-2.5">Address</th>
              <th className="px-3 py-2.5">Outcome</th>
              <th className="px-3 py-2.5">Rating</th>
              <th className="px-3 py-2.5">Tags</th>
              <th className="px-3 py-2.5">Note</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-text-3">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-16 text-center text-text-3">
                  <div className="flex flex-col items-center gap-2">
                    <ClipboardList size={28} />
                    <div className="font-medium text-text-2">No calls logged yet</div>
                    <div className="text-[12px]">Logged calls will appear here after you submit outcomes in a session.</div>
                  </div>
                </td>
              </tr>
            )}
            {filtered.map(({ activity, lead, outcomeInfo, note }, i) => (
              <tr
                key={activity.id}
                className={`border-b border-border ${lead ? 'cursor-pointer hover:bg-surface-3' : ''}`}
                onClick={() => lead && navigate(`/leads/${lead.id}`)}
              >
                <td className="px-3 py-2.5 text-text-3">{i + 1}</td>
                <td className="px-3 py-2.5 text-text-2">{formatDateTime(activity.createdAt)}</td>
                <td className="px-3 py-2.5 font-medium text-text">{lead ? `${lead.firstName} ${lead.lastName}` : 'Unknown lead'}</td>
                <td className="px-3 py-2.5 text-text-2">{lead ? formatPhone(lead.phone) : '—'}</td>
                <td className="max-w-[200px] truncate px-3 py-2.5 text-text-2">{lead?.address || '—'}</td>
                <td className="px-3 py-2.5">
                  {outcomeInfo ? (
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={{ background: `${outcomeInfo.color}1a`, color: outcomeInfo.color }}
                    >
                      {outcomeInfo.label}
                    </span>
                  ) : (
                    <span className="text-text-3">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5">{lead ? <StarRating value={lead.rating} size={13} /> : '—'}</td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {lead?.tagIds.map((tid) => {
                      const tag = tags.find((t) => t.id === tid);
                      return tag ? <TagPill key={tid} tag={tag} /> : null;
                    })}
                  </div>
                </td>
                <td className="max-w-[240px] truncate px-3 py-2.5 text-text-2">{note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
