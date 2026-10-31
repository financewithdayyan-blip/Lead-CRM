import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Gauge,
  Loader2,
  Pause,
  RotateCw,
  Send,
  SkipForward,
  Trash2,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import {
  useBulkSmsJob,
  useBulkSmsJobItems,
  useBulkSmsJobs,
  useDeleteBulkSmsJob,
  usePauseBulkSmsJob,
  useResumeBulkSmsJob,
} from '@/hooks/useSms';
import { useLeads } from '@/hooks/useLeads';
import { useSmsSendSettings } from '@/hooks/useSmsSendSettings';
import { SmsLevelCard } from '@/components/sms/SmsLevelCard';
import { withinSendWindow, nextSendWindowOpensIn } from '@/lib/smsSendWindow';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/contexts/AuthContext';
import { formatDateTime, formatDuration, formatPhone, formatTime, initials, localIsoDate } from '@/lib/utils';
import type { BulkSmsItemStatus, BulkSmsJobStatus } from '@/types/domain';

const STATUS_CONFIG: Record<BulkSmsItemStatus, { label: string; color: string; icon: typeof Clock }> = {
  queued: { label: 'Queued', color: '#94a3b8', icon: Clock },
  sending: { label: 'Sending', color: '#4f46e5', icon: Loader2 },
  sent: { label: 'Sent', color: '#10b981', icon: Check },
  failed: { label: 'Failed', color: '#ef4444', icon: X },
  skipped: { label: 'Skipped', color: '#f59e0b', icon: AlertTriangle },
};

const JOB_STATUS_CONFIG: Record<BulkSmsJobStatus, { label: string; color: string }> = {
  running: { label: 'Running', color: '#4f46e5' },
  completed: { label: 'Completed', color: '#10b981' },
  failed: { label: 'Failed', color: '#ef4444' },
  paused: { label: 'Paused', color: '#f59e0b' },
};

// A stable (hashed from id, not random) color per lead for avatar circles —
// same approach used on Leads/Call History so avatars read consistently.
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

function StatCard({ label, value, sub, color, icon: Icon }: { label: string; value: number | string; sub?: string; color: string; icon?: LucideIcon }) {
  return (
    <div className="card !p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">{label}</div>
        {Icon && (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ background: `${color}17`, color }}>
            <Icon size={14} />
          </span>
        )}
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold tabular-nums" style={{ color }}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[12px] text-text-3">{sub}</div>}
    </div>
  );
}

export function BulkSmsPage() {
  const { jobId } = useParams<{ jobId: string }>();
  return jobId ? <BulkSmsJobDetail jobId={jobId} /> : <BulkSmsHistory />;
}

/** The sidebar link's destination — every bulk send ever started, most
 * recent first, since there's no jobId to land on until one is picked. */
function BulkSmsHistory() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { data: jobs = [], isLoading } = useBulkSmsJobs();
  const { data: sendSettings } = useSmsSendSettings();
  const deleteJob = useDeleteBulkSmsJob();
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | BulkSmsJobStatus>('all');

  const totals = useMemo(() => {
    const totalSent = jobs.reduce((sum, j) => sum + (j.sentCount ?? 0), 0);
    const totalSkipped = jobs.reduce((sum, j) => sum + (j.skippedCount ?? 0), 0);
    const totalFailed = jobs.reduce((sum, j) => sum + (j.failedCount ?? 0), 0);
    const durations = jobs
      .filter((j) => j.completedAt)
      .map((j) => (new Date(j.completedAt!).getTime() - new Date(j.createdAt).getTime()) / 1000);
    const avgDurationSeconds = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
    return { totalSent, totalSkipped, totalFailed, avgDurationSeconds };
  }, [jobs]);

  // Real texts sent today, summed from today's jobs — the same aggregate
  // bulk-sms-dispatcher itself works from, not a separate estimate.
  const usedToday = useMemo(() => {
    const todayIso = localIsoDate(new Date());
    return jobs
      .filter((j) => localIsoDate(new Date(j.createdAt)) === todayIso)
      .reduce((sum, j) => sum + (j.sentCount ?? 0), 0);
  }, [jobs]);

  const statusCounts = useMemo(() => {
    const c: Record<BulkSmsJobStatus, number> = { running: 0, completed: 0, failed: 0, paused: 0 };
    for (const j of jobs) c[j.status]++;
    return c;
  }, [jobs]);

  const visibleJobs = useMemo(
    () => (statusFilter === 'all' ? jobs : jobs.filter((j) => j.status === statusFilter)),
    [jobs, statusFilter],
  );

  const inWindow = withinSendWindow();

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-text">
            <Send size={20} /> Bulk SMS
          </h1>
          <p className="text-sm text-text-3">
            Select leads in the Pipeline and start a send from there — every run shows up here.
          </p>
        </div>
        <div className="flex gap-2">
          {profile?.role === 'admin' && (
            <button className="btn" onClick={() => navigate('/bulk-sms/levels')}>
              <Gauge size={14} /> Levels
            </button>
          )}
          <button className="btn btn-primary" onClick={() => navigate('/kanban')}>
            Go to Pipeline
          </button>
        </div>
      </div>

      {sendSettings && sendSettings.dailyLimitLevel > 0 && (
        <div className="card mb-4">
          <SmsLevelCard />
          {sendSettings.dailyLimit > 0 && (
            <div className="mt-4 border-t border-border-2 pt-4">
              <div className="flex items-center justify-between text-[12.5px] text-text-2">
                <span>Used today</span>
                <span className="font-mono font-semibold text-text">
                  {usedToday.toLocaleString()} of {sendSettings.dailyLimit.toLocaleString()}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.min(100, (usedToday / sendSettings.dailyLimit) * 100)}%` }}
                />
              </div>
              <div className="mt-2 text-[12px] text-text-3">
                {inWindow
                  ? 'Sending window is open now (7pm-6am Pakistan time).'
                  : `Outside the sending window (7pm-6am Pakistan time) — opens in ${nextSendWindowOpensIn()}.`}
              </div>
            </div>
          )}
        </div>
      )}

      {jobs.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total Sent" value={totals.totalSent} sub={`across ${jobs.length} send${jobs.length !== 1 ? 's' : ''}`} color={STATUS_CONFIG.sent.color} icon={Send} />
          <StatCard label="Total Skipped" value={totals.totalSkipped} sub="no usable number, opted out, etc." color={STATUS_CONFIG.skipped.color} icon={SkipForward} />
          <StatCard label="Total Failed" value={totals.totalFailed} sub="carrier rejected" color={STATUS_CONFIG.failed.color} icon={XCircle} />
          <StatCard
            label="Avg Duration"
            value={totals.avgDurationSeconds != null ? formatDuration(totals.avgDurationSeconds) : '—'}
            sub="per completed send"
            color="#4f46e5"
            icon={Clock}
          />
        </div>
      )}

      <div className="card !p-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-2 px-4 py-3">
          <h2 className="text-[15px] font-semibold text-text">All sends</h2>
          <div className="flex items-center gap-1 rounded-md border border-border-2 bg-surface-2 p-1">
            {(['all', 'running', 'paused', 'completed', 'failed'] as const).map((key) => (
              <button
                key={key}
                className={`rounded-sm px-2.5 py-1 text-[12.5px] font-medium capitalize transition-colors ${
                  statusFilter === key ? 'bg-primary text-primary-text' : 'text-text-2 hover:text-text'
                }`}
                onClick={() => setStatusFilter(key)}
              >
                {key} {key !== 'all' && <span className="font-mono">{statusCounts[key]}</span>}
                {key === 'all' && <span className="font-mono">{jobs.length}</span>}
              </button>
            ))}
          </div>
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2 p-8 text-[13px] text-text-3">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : visibleJobs.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-text-3">
            {jobs.length === 0 ? 'No bulk sends yet — select leads in the Pipeline to start one.' : 'No sends match this filter.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border-2 text-left text-[11px] font-semibold uppercase tracking-wide text-text-3">
                  <th className="px-3 py-2.5">Started</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Progress</th>
                  <th className="px-3 py-2.5">Leads</th>
                  <th className="px-3 py-2.5">Sent</th>
                  <th className="px-3 py-2.5">Skipped</th>
                  <th className="px-3 py-2.5">Failed</th>
                  <th className="px-3 py-2.5">Duration</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {visibleJobs.map((job) => {
                  const cfg = JOB_STATUS_CONFIG[job.status];
                  const sent = job.sentCount ?? 0;
                  const skipped = job.skippedCount ?? 0;
                  const failed = job.failedCount ?? 0;
                  const accounted = sent + skipped + failed;
                  return (
                    <tr
                      key={job.id}
                      className={`border-b border-border-2 last:border-0 ${job.status === 'paused' ? 'bg-warning-dim/40' : ''}`}
                    >
                      <td className="px-3 py-2.5 text-text">
                        <Link to={`/bulk-sms/${job.id}`} className="hover:underline">
                          {formatDateTime(job.createdAt)}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                          style={{ backgroundColor: `${cfg.color}22`, color: cfg.color }}
                        >
                          {job.status === 'running' && <Loader2 size={11} className="animate-spin" />}
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        {accounted > 0 ? (
                          <div className="flex h-1.5 w-[110px] overflow-hidden rounded-full bg-surface-3">
                            <div style={{ width: `${(sent / accounted) * 100}%`, background: STATUS_CONFIG.sent.color }} />
                            <div style={{ width: `${(skipped / accounted) * 100}%`, background: STATUS_CONFIG.skipped.color }} />
                            <div style={{ width: `${(failed / accounted) * 100}%`, background: STATUS_CONFIG.failed.color }} />
                          </div>
                        ) : (
                          <span className="text-text-3">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-text-2">{job.total}</td>
                      <td className="px-3 py-2.5" style={{ color: STATUS_CONFIG.sent.color }}>{sent}</td>
                      <td className="px-3 py-2.5" style={{ color: STATUS_CONFIG.skipped.color }}>{skipped}</td>
                      <td className="px-3 py-2.5" style={{ color: STATUS_CONFIG.failed.color }}>{failed}</td>
                      <td className="px-3 py-2.5 text-text-2">
                        {job.completedAt
                          ? formatDuration((new Date(job.completedAt).getTime() - new Date(job.createdAt).getTime()) / 1000)
                          : job.status === 'running'
                            ? formatDuration((Date.now() - new Date(job.createdAt).getTime()) / 1000)
                            : '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-3">
                          <Link to={`/bulk-sms/${job.id}`} className="inline-flex items-center gap-0.5 text-text-3 hover:text-primary">
                            View <ChevronRight size={13} />
                          </Link>
                          <button
                            className="text-text-3 hover:text-danger"
                            title="Delete this send from the list"
                            onClick={() => setDeleteTarget(job.id)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {jobs.length > 0 && (
          <div className="flex flex-wrap items-center gap-4 border-t border-border-2 px-4 py-2.5 text-[12px] text-text-3">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: STATUS_CONFIG.sent.color }} /> Sent
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: STATUS_CONFIG.skipped.color }} /> Skipped
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: STATUS_CONFIG.failed.color }} /> Failed
            </span>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this send?"
        message="Removes it from this list only — leads that already got a text keep it, and this can't be undone."
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (deleteTarget) deleteJob.mutate(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

const PAGE_SIZE = 100;
type ItemTab = 'all' | BulkSmsItemStatus;

function BulkSmsJobDetail({ jobId }: { jobId: string }) {
  const navigate = useNavigate();
  const { data: job, isLoading: jobLoading } = useBulkSmsJob(jobId);
  const { data: items = [], isLoading: itemsLoading } = useBulkSmsJobItems(jobId, job?.status);
  const { data: leads = [] } = useLeads();
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<ItemTab>('all');
  const [search, setSearch] = useState('');
  const resumeJob = useResumeBulkSmsJob();
  const pauseJob = usePauseBulkSmsJob();

  const leadsById = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);

  const counts = useMemo(() => {
    const c: Record<BulkSmsItemStatus, number> = { queued: 0, sending: 0, sent: 0, failed: 0, skipped: 0 };
    for (const item of items) c[item.status]++;
    return c;
  }, [items]);

  const running = job?.status === 'running';
  const done = counts.sent + counts.failed + counts.skipped;
  const total = job?.total ?? items.length;
  const canResume = (job?.status === 'failed' || job?.status === 'paused') && job.hasConfig && counts.queued > 0;
  const canPause = running;

  // Who this job actually sent from — grouped from the full item set, not
  // just the visible page, so it stays accurate regardless of filtering.
  const sentFromBreakdown = useMemo(() => {
    const byNumber = new Map<string, number>();
    for (const item of items) {
      if (!item.sentFrom) continue;
      byNumber.set(item.sentFrom, (byNumber.get(item.sentFrom) ?? 0) + 1);
    }
    return [...byNumber.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);
  const sentFromMax = Math.max(...sentFromBreakdown.map(([, n]) => n), 1);

  // Why skipped/failed items didn't go out, grouped by their real detail
  // text (the same string shown in the Detail column) — not a fabricated
  // reason taxonomy, just a count of what's already there.
  const skipFailBreakdown = useMemo(() => {
    const byDetail = new Map<string, number>();
    for (const item of items) {
      if (item.status !== 'skipped' && item.status !== 'failed') continue;
      const key = item.detail || 'No reason given';
      byDetail.set(key, (byDetail.get(key) ?? 0) + 1);
    }
    return [...byDetail.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const tabOptions = useMemo(
    () => (['queued', 'sending', 'sent', 'skipped', 'failed'] as const).filter((s) => counts[s] > 0),
    [counts],
  );

  const filteredItems = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter((item) => {
      if (tab !== 'all' && item.status !== tab) return false;
      if (q) {
        const lead = item.leadId ? leadsById.get(item.leadId) : undefined;
        const haystack = `${item.leadName} ${lead?.phone ?? ''} ${item.sentFrom ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [items, tab, search, leadsById]);

  useEffect(() => setPage(1), [tab, search]);

  const pageCount = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount);
  const pageItems = filteredItems.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

  return (
    <div>
      <nav className="mb-2 flex items-center gap-1.5 text-[13px] text-text-3">
        <Link to="/bulk-sms" className="hover:text-text-2">Bulk SMS</Link>
        <span>/</span>
        <span className="text-text-2">{job?.createdAt ? `Send on ${formatDateTime(job.createdAt)}` : 'Send'}</span>
      </nav>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-text">
            <Send size={20} /> Bulk SMS
          </h1>
          <p className="text-sm text-text-3">
            {running
              ? `Sending — ${done} of ${total} done…`
              : job?.status === 'paused'
                ? `Paused after ${done} of ${total} — ${counts.queued} still waiting.`
                : job?.status === 'failed'
                  ? done > 0
                    ? `Stopped after ${done} of ${total} — ${counts.queued} never got a message.`
                    : 'This send failed to start.'
                  : `Finished — ${total} lead${total !== 1 ? 's' : ''}.`}
          </p>
          {job?.createdAt && (
            <p className="mt-0.5 text-[12px] text-text-3">
              Started {formatDateTime(job.createdAt)}
              {job.completedAt && (
                <> · finished {formatTime(job.completedAt)} · took {formatDuration((new Date(job.completedAt).getTime() - new Date(job.createdAt).getTime()) / 1000)}</>
              )}
              {running && <> · running for {formatDuration((Date.now() - new Date(job.createdAt).getTime()) / 1000)}</>}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {canPause && (
            <button className="btn" disabled={pauseJob.isPending} onClick={() => pauseJob.mutate(jobId)}>
              {pauseJob.isPending ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Stopping…
                </>
              ) : (
                <>
                  <Pause size={14} /> Stop
                </>
              )}
            </button>
          )}
          {canResume && (
            <button className="btn btn-primary" disabled={resumeJob.isPending} onClick={() => resumeJob.mutate(jobId)}>
              {resumeJob.isPending ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Resuming…
                </>
              ) : (
                <>
                  <RotateCw size={14} /> Resume ({counts.queued} left)
                </>
              )}
            </button>
          )}
          <button className="btn" onClick={() => navigate('/bulk-sms')}>
            All Sends
          </button>
          <button className="btn" onClick={() => navigate('/kanban')}>
            Back to Pipeline
          </button>
        </div>
      </div>

      {job?.status === 'failed' && job.error && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-danger/40 bg-danger-dim px-3 py-2 text-[13px] text-danger">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {job.error}
        </div>
      )}

      {resumeJob.isError && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-danger/40 bg-danger-dim px-3 py-2 text-[13px] text-danger">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          {resumeJob.error instanceof Error ? resumeJob.error.message : 'Could not resume this send.'}
        </div>
      )}

      {pauseJob.isError && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-danger/40 bg-danger-dim px-3 py-2 text-[13px] text-danger">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          {pauseJob.error instanceof Error ? pauseJob.error.message : 'Could not stop this send.'}
        </div>
      )}

      <div className="card mb-4 !p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Queued" value={counts.queued} color={STATUS_CONFIG.queued.color} />
          <StatCard label="Sending" value={counts.sending} color={STATUS_CONFIG.sending.color} />
          <StatCard label="Sent" value={counts.sent} color={STATUS_CONFIG.sent.color} />
          <StatCard label="Skipped" value={counts.skipped} color={STATUS_CONFIG.skipped.color} />
          <StatCard label="Failed" value={counts.failed} color={STATUS_CONFIG.failed.color} />
        </div>
        {total > 0 && (
          <div className="mt-4 flex h-2 gap-[3px]" aria-hidden="true">
            <div className="rounded-full" style={{ flex: `${Math.max(counts.sent, 0.3)} 1 0`, background: STATUS_CONFIG.sent.color }} />
            <div className="rounded-full" style={{ flex: `${Math.max(counts.skipped, 0.3)} 1 0`, background: STATUS_CONFIG.skipped.color }} />
            <div className="rounded-full" style={{ flex: `${Math.max(counts.failed, 0.3)} 1 0`, background: STATUS_CONFIG.failed.color }} />
            <div className="rounded-full bg-surface-3" style={{ flex: `${Math.max(counts.queued + counts.sending, 0.3)} 1 0` }} />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="card min-w-0 flex-1 !p-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-1 rounded-md border border-border-2 bg-surface-2 p-1">
              <button
                className={`rounded-sm px-2.5 py-1 text-[12.5px] font-medium transition-colors ${
                  tab === 'all' ? 'bg-primary text-primary-text' : 'text-text-2 hover:text-text'
                }`}
                onClick={() => setTab('all')}
              >
                All <span className="font-mono">{items.length}</span>
              </button>
              {tabOptions.map((s) => (
                <button
                  key={s}
                  className={`rounded-sm px-2.5 py-1 text-[12.5px] font-medium transition-colors ${
                    tab === s ? 'bg-primary text-primary-text' : 'text-text-2 hover:text-text'
                  }`}
                  onClick={() => setTab(s)}
                >
                  {STATUS_CONFIG[s].label} <span className="font-mono">{counts[s]}</span>
                </button>
              ))}
            </div>
            <input
              className="input max-w-[180px]"
              placeholder="Name or number…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {jobLoading || itemsLoading ? (
            <div className="flex items-center gap-2 p-8 text-[13px] text-text-3">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="p-8 text-center text-[13px] text-text-3">
              {items.length === 0 ? 'No leads in this send.' : 'No recipients match this filter.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border-2 text-left text-[11px] font-semibold uppercase tracking-wide text-text-3">
                    <th className="px-3 py-2.5">Lead</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Sent From</th>
                    <th className="px-3 py-2.5">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((item) => {
                    const cfg = STATUS_CONFIG[item.status];
                    const Icon = cfg.icon;
                    const lead = item.leadId ? leadsById.get(item.leadId) : undefined;
                    const avatar = avatarColorFor(item.leadId ?? item.id);
                    return (
                      <tr key={item.id} className="border-b border-border-2 last:border-0">
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <span
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                              style={{ background: avatar.bg, color: avatar.text }}
                            >
                              {item.leadName ? initials(item.leadName.split(' ')[0] ?? '', item.leadName.split(' ').slice(1).join(' ')) : '?'}
                            </span>
                            <div className="min-w-0">
                              {lead ? (
                                <button className="truncate font-medium text-text hover:text-primary" onClick={() => navigate(`/leads/${lead.id}`)}>
                                  {item.leadName || '—'}
                                </button>
                              ) : (
                                <div className="truncate font-medium text-text">{item.leadName || '—'}</div>
                              )}
                              {lead?.phone && <div className="font-mono text-[12px] text-text-3">{formatPhone(lead.phone)}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                            style={{ backgroundColor: `${cfg.color}22`, color: cfg.color }}
                          >
                            <Icon size={11} className={item.status === 'sending' ? 'animate-spin' : ''} />
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-text-2">{item.sentFrom ? formatPhone(item.sentFrom) : '—'}</td>
                        <td className="max-w-[320px] truncate px-3 py-2.5 text-text-3" title={item.detail ?? undefined}>
                          {item.detail || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {pageCount > 1 && (
                <div className="flex items-center justify-between border-t border-border-2 px-3 py-2.5 text-[12px] text-text-2">
                  <span>
                    Showing {(clampedPage - 1) * PAGE_SIZE + 1}–{Math.min(clampedPage * PAGE_SIZE, filteredItems.length)} of {filteredItems.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      className="btn !px-2 !py-1"
                      disabled={clampedPage <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft size={13} />
                    </button>
                    <span className="text-text-3">
                      Page {clampedPage} of {pageCount}
                    </span>
                    <button
                      className="btn !px-2 !py-1"
                      disabled={clampedPage >= pageCount}
                      onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                    >
                      <ChevronRight size={13} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex w-full shrink-0 flex-col gap-4 lg:w-[300px]">
          {job?.messageTemplate && (
            <div className="card">
              <h2 className="text-[15px] font-semibold text-text">Message sent</h2>
              <p className="mt-3 whitespace-pre-wrap rounded-lg rounded-bl-[4px] bg-surface-3 px-3.5 py-3 text-[13.5px] leading-relaxed text-text-2">
                {job.messageTemplate}
              </p>
            </div>
          )}

          {sentFromBreakdown.length > 0 && (
            <div className="card">
              <h2 className="text-[15px] font-semibold text-text">Sent from</h2>
              <div className="mt-3 flex flex-col gap-2.5">
                {sentFromBreakdown.map(([number, count]) => (
                  <div key={number}>
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="font-mono text-text-2">{formatPhone(number)}</span>
                      <span className="font-mono font-semibold text-text">{count}</span>
                    </div>
                    <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-surface-3">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(count / sentFromMax) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {skipFailBreakdown.length > 0 && (
            <div className="card">
              <h2 className="text-[15px] font-semibold text-text">
                Why {counts.skipped + counts.failed} didn't send
              </h2>
              <div className="mt-3 flex flex-col gap-2">
                {skipFailBreakdown.map(([detail, count]) => (
                  <div key={detail} className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="min-w-0 truncate text-text-2" title={detail}>{detail}</span>
                    <span className="shrink-0 font-mono font-semibold text-warning">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
