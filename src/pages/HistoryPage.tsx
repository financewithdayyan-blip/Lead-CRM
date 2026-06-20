import { useMemo, useState } from 'react';
import Papa from 'papaparse';
import { Download } from 'lucide-react';
import { useCallLog } from '@/hooks/useCallLog';
import { useTags } from '@/hooks/useTags';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { StarRating } from '@/components/ui/StarRating';
import { TagPill } from '@/components/ui/TagPill';
import { STATUS_CONFIG, type LeadStatus } from '@/types/domain';
import { formatPhone } from '@/lib/utils';

type DateRangeKey = '' | 'today' | 'yesterday' | 'week' | 'lastweek' | 'month' | 'lastmonth';

const RANGE_LABELS: Record<DateRangeKey, string> = {
  '': 'All Time',
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This Week',
  lastweek: 'Last Week',
  month: 'This Month',
  lastmonth: 'Last Month',
};

function getRange(key: DateRangeKey): { start: Date; end: Date } | null {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86400000 - 1);
  if (key === '') return null;
  if (key === 'today') return { start: todayStart, end: todayEnd };
  if (key === 'yesterday') return { start: new Date(todayStart.getTime() - 86400000), end: new Date(todayStart.getTime() - 1) };
  if (key === 'week') {
    const start = new Date(todayStart);
    start.setDate(todayStart.getDate() - todayStart.getDay());
    return { start, end: todayEnd };
  }
  if (key === 'lastweek') {
    const thisWeekStart = new Date(todayStart);
    thisWeekStart.setDate(todayStart.getDate() - todayStart.getDay());
    return { start: new Date(thisWeekStart.getTime() - 7 * 86400000), end: new Date(thisWeekStart.getTime() - 1) };
  }
  if (key === 'month') return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: todayEnd };
  if (key === 'lastmonth')
    return { start: new Date(now.getFullYear(), now.getMonth() - 1, 1), end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999) };
  return null;
}

export function HistoryPage() {
  const { data: callLog = [] } = useCallLog();
  const { data: tags = [] } = useTags();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<LeadStatus | ''>('');
  const [dateFilter, setDateFilter] = useState<DateRangeKey>('');
  const [ratingFilter, setRatingFilter] = useState('');

  const range = getRange(dateFilter);

  const inRange = (createdAt: string) => {
    if (!range) return true;
    const t = new Date(createdAt);
    return t >= range.start && t <= range.end;
  };

  const rangeLog = useMemo(() => (range ? callLog.filter((r) => inRange(r.createdAt)) : callLog), [callLog, range]);

  const rows = useMemo(() => {
    const q = search.toLowerCase();
    return rangeLog.filter((r) => {
      if (q && !(r.name.toLowerCase().includes(q) || r.phone.includes(q) || (r.address ?? '').toLowerCase().includes(q))) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (ratingFilter !== '') {
        const rv = parseInt(ratingFilter, 10);
        if (rv === 0 && r.rating > 0) return false;
        if (rv > 0 && r.rating < rv) return false;
      }
      return true;
    });
  }, [rangeLog, search, statusFilter, ratingFilter]);

  const stats = useMemo(() => {
    const total = rangeLog.length;
    const followups = rangeLog.filter((r) => ['followup', 'followup2', 'followup3'].includes(r.status)).length;
    const contracts = rangeLog.filter((r) => r.status === 'contract').length;
    const voicemails = rangeLog.filter((r) => r.status === 'voicemail').length;
    const rated5 = rangeLog.filter((r) => r.rating === 5).length;
    return { total, followups, contracts, voicemails, rated5 };
  }, [rangeLog]);

  function handleExport() {
    if (rangeLog.length === 0) {
      alert('No calls in the selected time range to export.');
      return;
    }
    const csv = Papa.unparse({
      fields: ['#', 'Date', 'Time', 'Name', 'Phone', 'Address', 'Outcome', 'Rating', 'Note'],
      data: rangeLog.map((r) => {
        const dt = new Date(r.createdAt);
        return [
          r.leadNum ?? '',
          dt.toLocaleDateString(),
          dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          r.name,
          formatPhone(r.phone),
          r.address ?? '',
          STATUS_CONFIG[r.status]?.label ?? r.status,
          r.rating,
          r.note ?? '',
        ];
      }),
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `call-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-text">Call History</h1>
          <p className="text-sm text-text-3">
            {rows.length} call{rows.length !== 1 ? 's' : ''} shown · {callLog.length} total logged
          </p>
        </div>
        <button className="btn" onClick={handleExport}>
          <Download size={14} /> Export CSV
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="card !p-3.5">
          <div className="text-[11px] uppercase tracking-wide text-text-3">Total Calls</div>
          <div className="mt-1 font-mono text-2xl font-bold text-blue-bright">{stats.total}</div>
        </div>
        <div className="card !p-3.5">
          <div className="text-[11px] uppercase tracking-wide text-text-3">{RANGE_LABELS[dateFilter]}</div>
          <div className="mt-1 font-mono text-2xl font-bold text-text">{stats.total}</div>
        </div>
        <div className="card !p-3.5">
          <div className="text-[11px] uppercase tracking-wide text-text-3">Follow Ups</div>
          <div className="mt-1 font-mono text-2xl font-bold text-purple">{stats.followups}</div>
        </div>
        <div className="card !p-3.5">
          <div className="text-[11px] uppercase tracking-wide text-text-3">Contracts</div>
          <div className="mt-1 font-mono text-2xl font-bold text-green">{stats.contracts}</div>
        </div>
        <div className="card !p-3.5">
          <div className="text-[11px] uppercase tracking-wide text-text-3">5-Star Calls</div>
          <div className="mt-1 font-mono text-2xl font-bold text-amber">{stats.rated5}</div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search name, phone, address…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input max-w-[170px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as LeadStatus | '')}>
          <option value="">All outcomes</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <select className="input max-w-[150px]" value={dateFilter} onChange={(e) => setDateFilter(e.target.value as DateRangeKey)}>
          {Object.entries(RANGE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select className="input max-w-[140px]" value={ratingFilter} onChange={(e) => setRatingFilter(e.target.value)}>
          <option value="">Any rating</option>
          <option value="0">Unrated</option>
          {[5, 4, 3, 2, 1].map((s) => (
            <option key={s} value={s}>
              {s}+ stars
            </option>
          ))}
        </select>
      </div>

      <div className="card overflow-x-auto !p-0">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-border bg-surface-3 text-[11px] uppercase tracking-wide text-text-3">
            <tr>
              <th className="px-3 py-2.5">#</th>
              <th className="px-3 py-2.5">Date</th>
              <th className="px-3 py-2.5">Name</th>
              <th className="px-3 py-2.5">Phone</th>
              <th className="px-3 py-2.5">Address</th>
              <th className="px-3 py-2.5">Outcome</th>
              <th className="px-3 py-2.5">Rating</th>
              <th className="px-3 py-2.5">Tags</th>
              <th className="px-3 py-2.5">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-text-3">
                  No calls match your filters.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const dt = new Date(r.createdAt);
              return (
                <tr key={r.id} className="border-b border-border hover:bg-surface-3">
                  <td className="px-3 py-2.5 font-mono text-[11px] text-text-3">#{r.leadNum ?? '—'}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <div className="text-text">{dt.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                    <div className="font-mono text-[11px] text-text-3">{dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                  </td>
                  <td className="px-3 py-2.5 font-medium text-text">{r.name}</td>
                  <td className="px-3 py-2.5 font-mono text-blue-bright">{formatPhone(r.phone)}</td>
                  <td className="max-w-[180px] truncate px-3 py-2.5 text-text-2" title={r.address ?? ''}>
                    {r.address || '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-3 py-2.5">
                    <StarRating value={r.rating} size={12} />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {r.tagIds.slice(0, 2).map((tid) => {
                        const tag = tags.find((t) => t.id === tid);
                        return tag ? <TagPill key={tid} tag={tag} /> : null;
                      })}
                    </div>
                  </td>
                  <td className="max-w-[180px] truncate px-3 py-2.5 text-[12px] italic text-text-2" title={r.note ?? ''}>
                    {r.note || '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
