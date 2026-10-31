import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Send } from 'lucide-react';
import { useActiveBulkSmsJob } from '@/hooks/useSms';
import { formatDuration } from '@/lib/utils';

/** A thin, account-wide progress bar for the one bulk SMS job that can be
 * actively running at a time — mounted once in AppShell so it follows the
 * admin to every page, not just /bulk-sms itself. A send can now run for
 * quite a while (2s between messages, see the per-message delay default),
 * and there was previously no way to notice it's still going — or that it
 * just finished — without staying on that one tab the whole time. */
export function BulkSmsProgressBanner() {
  const { data: job } = useActiveBulkSmsJob();
  // Ticks once a second purely to re-render the elapsed/remaining estimate
  // between the hook's own 4s polls — the real counts only ever change on a
  // poll, this just keeps the clock feeling alive in between.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!job) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [!!job]);

  if (!job) return null;

  const done = job.sentCount + job.skippedCount + job.failedCount;
  const remaining = Math.max(0, job.total - done);
  const elapsedSeconds = Math.max(1, (Date.now() - new Date(job.createdAt).getTime()) / 1000);
  const rate = done / elapsedSeconds; // leads per second, observed so far
  const remainingSeconds = done > 0 && rate > 0 ? remaining / rate : null;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-b border-primary/30 bg-primary-dim px-4 py-2 text-[13px]">
      <div className="flex items-center gap-2 font-semibold text-primary-text">
        <Loader2 size={14} className="animate-spin" />
        <Send size={14} />
        Bulk SMS sending
      </div>
      <span className="text-text-2">
        <span className="font-semibold text-text">{done}</span> / {job.total} done
        <span className="text-text-3"> · {remaining} remaining</span>
      </span>
      <span className="text-success">{job.sentCount} sent</span>
      <span className="text-warning">{job.skippedCount} skipped</span>
      <span className="text-danger">{job.failedCount} failed</span>
      <span className="text-text-2">Running {formatDuration(elapsedSeconds)}</span>
      <span className="text-text-2">
        {remainingSeconds != null ? `~${formatDuration(remainingSeconds)} left` : 'Estimating time left…'}
      </span>
      <Link to={`/bulk-sms/${job.id}`} className="ml-auto shrink-0 font-semibold text-primary-text hover:underline">
        View
      </Link>
    </div>
  );
}
