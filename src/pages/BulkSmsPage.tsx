import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Check, Clock, Loader2, Send, X } from 'lucide-react';
import { useBulkSmsJob, useBulkSmsJobItems } from '@/hooks/useSms';
import type { BulkSmsItemStatus } from '@/types/domain';

const STATUS_CONFIG: Record<BulkSmsItemStatus, { label: string; color: string; icon: typeof Clock }> = {
  queued: { label: 'Queued', color: '#94a3b8', icon: Clock },
  sending: { label: 'Sending', color: '#4f46e5', icon: Loader2 },
  sent: { label: 'Sent', color: '#10b981', icon: Check },
  failed: { label: 'Failed', color: '#ef4444', icon: X },
  skipped: { label: 'Skipped', color: '#f59e0b', icon: AlertTriangle },
};

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

export function BulkSmsPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const { data: job, isLoading: jobLoading } = useBulkSmsJob(jobId);
  const { data: items = [], isLoading: itemsLoading } = useBulkSmsJobItems(jobId, job?.status);

  const counts = useMemo(() => {
    const c: Record<BulkSmsItemStatus, number> = { queued: 0, sending: 0, sent: 0, failed: 0, skipped: 0 };
    for (const item of items) c[item.status]++;
    return c;
  }, [items]);

  const running = job?.status === 'running';
  const done = counts.sent + counts.failed + counts.skipped;
  const total = job?.total ?? items.length;

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-text">
            <Send size={20} /> Bulk SMS
          </h1>
          <p className="text-sm text-text-3">
            {running ? `Sending — ${done} of ${total} done…` : job?.status === 'failed' ? 'This send failed to start.' : `Finished — ${total} lead${total !== 1 ? 's' : ''}.`}
          </p>
        </div>
        <button className="btn" onClick={() => navigate('/kanban')}>
          Back to Pipeline
        </button>
      </div>

      {job?.status === 'failed' && job.error && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-danger/40 bg-danger-dim px-3 py-2 text-[13px] text-danger">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {job.error}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Queued" value={counts.queued} color={STATUS_CONFIG.queued.color} />
        <StatCard label="Sending" value={counts.sending} color={STATUS_CONFIG.sending.color} />
        <StatCard label="Sent" value={counts.sent} color={STATUS_CONFIG.sent.color} />
        <StatCard label="Skipped" value={counts.skipped} color={STATUS_CONFIG.skipped.color} />
        <StatCard label="Failed" value={counts.failed} color={STATUS_CONFIG.failed.color} />
      </div>

      <div className="card !p-0 overflow-hidden">
        {jobLoading || itemsLoading ? (
          <div className="flex items-center gap-2 p-8 text-[13px] text-text-3">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-text-3">No leads in this send.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border-2 text-left text-[11px] font-semibold uppercase tracking-wide text-text-3">
                  <th className="px-3 py-2.5">Lead</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Number</th>
                  <th className="px-3 py-2.5">Detail</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const cfg = STATUS_CONFIG[item.status];
                  const Icon = cfg.icon;
                  return (
                    <tr key={item.id} className="border-b border-border-2 last:border-0">
                      <td className="px-3 py-2.5 text-text">{item.leadName || '—'}</td>
                      <td className="px-3 py-2.5">
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                          style={{ backgroundColor: `${cfg.color}22`, color: cfg.color }}
                        >
                          <Icon size={11} className={item.status === 'sending' ? 'animate-spin' : ''} />
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-text-2">{item.sentFrom || '—'}</td>
                      <td className="max-w-[320px] truncate px-3 py-2.5 text-text-3" title={item.detail ?? undefined}>
                        {item.detail || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
