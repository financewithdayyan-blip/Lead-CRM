import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Clock, Download, FileCheck2, Phone, RotateCcw, Trophy, X, type LucideIcon } from 'lucide-react';
import { useRecentActivities, useDeleteAllCallActivities } from '@/hooks/useActivities';
import { useLeads } from '@/hooks/useLeads';
import { useTags } from '@/hooks/useTags';
import { TagPill } from '@/components/ui/TagPill';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CardHeader } from '@/components/ui/CardHeader';
import { STAGE_CONFIG } from '@/types/domain';
import { formatDateTime, formatPhone, initials, localIsoDate } from '@/lib/utils';

const OUTCOME_FILTERS: Array<{ key: string; label: string; color: string }> = [
  { key: 'voicemail', label: 'Voicemail', color: STAGE_CONFIG.voicemail.color },
  { key: 'initial_contact', label: 'Qualified', color: STAGE_CONFIG.initial_contact.color },
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

// A stable (hashed from id, not random) color per person for avatar circles —
// same palette/approach as LeadsPage so avatars read consistently app-wide.
const AVATAR_PALETTE = [
  { bg: 'rgba(255,181,71,.15)', text: '#FFC46B' },
  { bg: 'rgba(110,123,255,.18)', text: '#A9B1FF' },
  { bg: 'rgba(61,214,181,.14)', text: '#4FE0BF' },
  { bg: 'rgba(90,184,255,.14)', text: '#7CC6FF' },
  { bg: 'rgba(180,140,255,.15)', text: '#C7A8FF' },
  { bg: 'rgba(255,107,107,.13)', text: '#FF8A8A' },
];
function avatarColorFor(id: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function formatHourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${hour < 12 ? 'a' : 'p'}`;
}

function StatCard({ label, value, sub, color, icon: Icon }: { label: string; value: number; sub: string; color?: string; icon: LucideIcon }) {
  return (
    <div className="card !p-4 transition-transform hover:-translate-y-0.5 hover:shadow-card-hover">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">{label}</div>
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${color ? '' : 'bg-surface-3 text-text-3'}`}
          style={color ? { background: `${color}17`, color } : undefined}
        >
          <Icon size={14} />
        </span>
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold tabular-nums" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="mt-0.5 text-[12px] text-text-3">{sub}</div>
    </div>
  );
}

function exportCallsCsv(rows: Array<{ activity: { createdAt: string; authorName: string }; lead?: { firstName: string; lastName: string; phone: string; address: string | null }; outcomeInfo?: { label: string }; note: string }>) {
  const header = ['Date', 'Lead', 'Phone', 'Caller', 'Address', 'Outcome', 'Note'];
  const csvRows = rows.map(({ activity, lead, outcomeInfo, note }) => [
    formatDateTime(activity.createdAt),
    lead ? `${lead.firstName} ${lead.lastName}` : 'Unknown lead',
    lead ? formatPhone(lead.phone) : '',
    activity.authorName ?? '',
    lead?.address ?? '',
    outcomeInfo?.label ?? '',
    note,
  ]);
  const csv = [header, ...csvRows]
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `call-history-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function CallHistoryPage() {
  const navigate = useNavigate();
  const { data: activities = [], isLoading } = useRecentActivities(undefined, 2000);
  const { data: leads = [] } = useLeads();
  const { data: tags = [] } = useTags();
  const deleteAllCalls = useDeleteAllCallActivities();

  const [search, setSearch] = useState('');
  const [outcome, setOutcome] = useState('');
  const [time, setTime] = useState('all');
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

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
    };
  }, [calls, enriched]);

  // Who's logging the most qualified calls — ranked by real outcome data
  // (meta.outcome === 'initial_contact', the same "Qualified" bucket the
  // outcome filter above uses), not a fabricated "appointments" concept
  // this CRM doesn't track.
  const leaderboard = useMemo(() => {
    const byAuthor = new Map<string, { id: string; name: string; total: number; qualified: number }>();
    for (const { activity, outcomeInfo } of enriched) {
      const key = activity.userId;
      const entry = byAuthor.get(key) ?? { id: key, name: activity.authorName || 'Unknown', total: 0, qualified: 0 };
      entry.total++;
      if (outcomeInfo?.key === 'initial_contact') entry.qualified++;
      byAuthor.set(key, entry);
    }
    return [...byAuthor.values()].sort((a, b) => b.qualified - a.qualified || b.total - a.total).slice(0, 6);
  }, [enriched]);

  // Qualified-rate by hour of day, 8am-7pm — real call timestamps bucketed,
  // not a simulated "connect rate" (this log is already post-call outcomes,
  // there's no separate dial-vs-connect state to chart).
  const BEST_TIME_HOURS = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 8), []);
  const bestTimeToCall = useMemo(() => {
    const buckets = new Map<number, { total: number; qualified: number }>();
    for (const { activity, outcomeInfo } of enriched) {
      const hour = new Date(activity.createdAt).getHours();
      const b = buckets.get(hour) ?? { total: 0, qualified: 0 };
      b.total++;
      if (outcomeInfo?.key === 'initial_contact') b.qualified++;
      buckets.set(hour, b);
    }
    return BEST_TIME_HOURS.map((hour) => {
      const b = buckets.get(hour);
      return { hour, total: b?.total ?? 0, rate: b && b.total > 0 ? (b.qualified / b.total) * 100 : 0 };
    });
  }, [enriched, BEST_TIME_HOURS]);
  const bestTimeMax = Math.max(...bestTimeToCall.map((b) => b.rate), 1);
  const hasAnyBestTimeData = bestTimeToCall.some((b) => b.total > 0);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const now = new Date();
    return enriched.filter(({ activity, lead, outcomeInfo }) => {
      if (outcome && outcomeInfo?.key !== outcome) return false;
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
  }, [enriched, search, outcome, time]);

  function clearFilters() {
    setSearch('');
    setOutcome('');
    setTime('all');
  }

  const hasFilters = search || outcome || time !== 'all';

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text">Call History</h1>
          <p className="text-sm text-text-3">Every call logged from your calling sessions</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button className="btn" onClick={() => exportCallsCsv(filtered)} disabled={filtered.length === 0}>
            <Download size={14} /> Export
          </button>
          {calls.length > 0 && (
            <button className="btn btn-danger" onClick={() => setConfirmDeleteAll(true)}>
              <X size={14} /> Delete All
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDeleteAll}
        title="Delete all call history?"
        message={`This permanently deletes all ${calls.length} logged call${calls.length === 1 ? '' : 's'}. This can't be undone.`}
        confirmLabel="Delete All"
        danger
        onConfirm={() => {
          deleteAllCalls.mutate();
          setConfirmDeleteAll(false);
        }}
        onCancel={() => setConfirmDeleteAll(false)}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total Calls" value={stats.total} sub="all time" icon={Phone} color="#6E7BFF" />
        <StatCard label="Today" value={stats.today} sub="logged today" icon={Clock} color="#5AB8FF" />
        <StatCard label="Follow Ups" value={stats.followUps} sub="need another touch" icon={RotateCcw} color={STAGE_CONFIG.followup.color} />
        <StatCard label="Contracts" value={stats.contracts} sub="lead is now under contract" icon={FileCheck2} color={STAGE_CONFIG.contract.color} />
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1">
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
            <select className="input ml-auto max-w-[150px]" value={time} onChange={(e) => setTime(e.target.value)}>
              {TIME_FILTERS.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
            {hasFilters && (
              <button className="btn" onClick={clearFilters}>
                <X size={14} /> Clear
              </button>
            )}
          </div>

          <div className="card overflow-x-auto !p-0">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-border bg-surface-3 text-[11px] uppercase tracking-wide text-text-3">
                <tr>
                  <th className="px-3 py-2.5">Date &amp; Time</th>
                  <th className="px-3 py-2.5">Lead</th>
                  <th className="px-3 py-2.5">Caller</th>
                  <th className="px-3 py-2.5">Address</th>
                  <th className="px-3 py-2.5">Outcome</th>
                  <th className="px-3 py-2.5">Tags</th>
                  <th className="px-3 py-2.5">Note</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-text-3">
                      Loading…
                    </td>
                  </tr>
                )}
                {!isLoading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-16 text-center text-text-3">
                      <div className="flex flex-col items-center gap-2">
                        <ClipboardList size={28} />
                        <div className="font-medium text-text-2">No calls logged yet</div>
                        <div className="text-[12px]">Logged calls will appear here after you submit outcomes in a session.</div>
                      </div>
                    </td>
                  </tr>
                )}
                {filtered.map(({ activity, lead, outcomeInfo, note }) => {
                  const avatar = avatarColorFor(lead?.id ?? activity.id);
                  const cityState = [lead?.city, lead?.state].filter(Boolean).join(', ');
                  return (
                    <tr
                      key={activity.id}
                      className={`border-b border-border ${lead ? 'cursor-pointer hover:bg-surface-3' : ''}`}
                      onClick={() => lead && navigate(`/leads/${lead.id}`)}
                    >
                      <td className="px-3 py-2.5 text-text-2">{formatDateTime(activity.createdAt)}</td>
                      <td className="px-3 py-2.5">
                        {lead ? (
                          <div className="flex items-center gap-2.5">
                            <span
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                              style={{ background: avatar.bg, color: avatar.text }}
                            >
                              {initials(lead.firstName, lead.lastName)}
                            </span>
                            <div className="min-w-0">
                              <div className="font-medium text-text">{lead.firstName} {lead.lastName}</div>
                              <div className="font-mono text-[12px] text-text-3">{formatPhone(lead.phone)}</div>
                            </div>
                          </div>
                        ) : (
                          <span className="text-text-3">Unknown lead</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-text-2">{activity.authorName || '—'}</td>
                      <td className="max-w-[200px] px-3 py-2.5 text-text-2">
                        <div className="truncate">{lead?.address || '—'}</div>
                        {cityState && <div className="truncate text-[12px] text-text-3">{cityState}</div>}
                      </td>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex w-full shrink-0 flex-col gap-4 lg:w-[300px]">
          <div className="card">
            <CardHeader icon={Trophy} title="Leaderboard" sub="qualified calls logged" tone="warning" />
            <div className="mt-4 flex flex-col gap-3">
              {leaderboard.length === 0 && <div className="text-[12.5px] text-text-3">No calls logged yet.</div>}
              {leaderboard.map((rep, i) => {
                const maxQualified = leaderboard[0]?.qualified || 1;
                const barPct = Math.max(4, (rep.qualified / maxQualified) * 100);
                const avatar = avatarColorFor(rep.id);
                const [first, ...rest] = rep.name.split(' ');
                return (
                  <div key={rep.id} className="flex items-center gap-2.5">
                    <span className="w-3 shrink-0 text-center text-[11px] font-bold text-text-3">{i + 1}</span>
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                      style={{ background: avatar.bg, color: avatar.text }}
                    >
                      {initials(first ?? '', rest.join(' '))}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[12.5px] font-medium text-text">{rep.name}</span>
                        <span className="shrink-0 font-mono text-[12px] font-semibold text-text">{rep.qualified}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${barPct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <CardHeader icon={Clock} title="Best time to call" sub="qualified rate by hour" tone="info" />
            {!hasAnyBestTimeData ? (
              <div className="mt-4 text-[12.5px] text-text-3">Not enough calls logged yet to tell.</div>
            ) : (
              <>
                <div className="mt-5 flex h-24 items-end gap-1">
                  {bestTimeToCall.map((b) => {
                    const heightPct = b.total > 0 ? Math.max(6, (b.rate / bestTimeMax) * 100) : 3;
                    const isPeak = b.total > 0 && b.rate === bestTimeMax;
                    return (
                      <div
                        key={b.hour}
                        className="relative flex h-full flex-1 flex-col items-center justify-end"
                        title={`${formatHourLabel(b.hour)} — ${b.total} call${b.total === 1 ? '' : 's'}, ${Math.round(b.rate)}% qualified`}
                      >
                        {isPeak && (
                          <span className="absolute -top-4 text-[10px] font-semibold text-primary-text">{Math.round(b.rate)}%</span>
                        )}
                        <div
                          className="w-full rounded-t-[2px]"
                          style={{ height: `${heightPct}%`, background: isPeak ? '#6E7BFF' : 'rgba(110,123,255,0.3)' }}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="mt-1.5 flex gap-1">
                  {bestTimeToCall.map((b) => (
                    <div key={b.hour} className="flex-1 text-center text-[9.5px] text-text-3">
                      {formatHourLabel(b.hour)}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
