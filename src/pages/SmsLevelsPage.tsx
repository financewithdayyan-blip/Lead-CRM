import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Circle, Gauge, Lock } from 'lucide-react';
import { useSmsSendSettings } from '@/hooks/useSmsSendSettings';
import { useSmsLevelProgress } from '@/hooks/useSmsLevelProgress';
import { SmsLevelCard } from '@/components/sms/SmsLevelCard';
import { CardHeader } from '@/components/ui/CardHeader';
import { SMS_DLC_LEVELS, SMS_DLC_LEVEL_DAILY_LIMITS } from '@/lib/smsDlcLevels';

const MIN_DAYS = 10;
const MIN_DELIVERY_RATE = 60;
const MIN_REPLY_RATE = 15;

/** Full detail page for the account's pooled 10DLC sending level — one card
 * per level instead of the old compact reference table, since "everything
 * about that level" (its own daily limit, what it takes to reach it, and
 * where the account stands against it right now) didn't fit in a table row. */
export function SmsLevelsPage() {
  const navigate = useNavigate();
  const { data: settings } = useSmsSendSettings();
  const { data: progress } = useSmsLevelProgress(settings?.dailyLimitLevelStartedAt ?? null);

  const activeLevel = settings?.dailyLimitLevel ?? 0;
  const unlockedLevel = settings?.dailyLimitUnlockedLevel ?? 0;

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <button className="btn !px-2" onClick={() => navigate('/bulk-sms')} title="Back to Bulk SMS">
          <ArrowLeft size={16} />
        </button>
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-text">
            <Gauge size={20} /> Sending Levels
          </h1>
          <p className="text-sm text-text-3">
            One pooled 10DLC level for the whole account — the daily limit is total texts per day across every
            configured number combined, not per number. Levels 1-9 promote automatically; there's nothing to click.
          </p>
        </div>
      </div>

      <div className="card mb-5">
        <SmsLevelCard />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {SMS_DLC_LEVELS.map((level) => {
          const isUnlocked = level <= unlockedLevel;
          const isActive = level === activeLevel;
          const isNext = level === unlockedLevel + 1;
          const isManualStart = level === 1 && unlockedLevel === 0;

          let statusLabel = 'Locked';
          let statusIcon = Lock;
          let statusColor = 'text-text-3';
          if (isActive) {
            statusLabel = 'Active';
            statusIcon = CheckCircle2;
            statusColor = 'text-success';
          } else if (isUnlocked) {
            statusLabel = 'Unlocked';
            statusIcon = Circle;
            statusColor = 'text-primary';
          } else if (isManualStart) {
            statusLabel = 'Ready to start';
            statusIcon = Circle;
            statusColor = 'text-success';
          } else if (isNext) {
            statusLabel = 'Next up';
            statusIcon = Lock;
            statusColor = 'text-warning';
          }
          const StatusIcon = statusIcon;

          const daysOk = (progress?.daysElapsed ?? 0) >= MIN_DAYS;
          const deliveryOk = (progress?.deliveryRate ?? 0) >= MIN_DELIVERY_RATE;
          const replyOk = (progress?.replyRate ?? 0) >= MIN_REPLY_RATE;

          return (
            <div
              key={level}
              className={`card !p-4 ${isActive ? 'border-primary/50 ring-1 ring-primary/30' : isUnlocked ? 'border-primary/20' : ''}`}
            >
              <CardHeader
                icon={Gauge}
                title={`Level ${level}`}
                tone={isActive ? 'primary' : isUnlocked ? 'primary' : 'accent'}
              />

              <div className="mt-3 grid grid-cols-1 gap-2.5">
                <div className="rounded-md border border-border-2 bg-surface-3 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-text-3">Daily limit</div>
                  <div className="font-mono text-lg font-semibold tabular-nums text-text">
                    {SMS_DLC_LEVEL_DAILY_LIMITS[level].toLocaleString()}
                    <span className="ml-1 text-[12px] font-normal text-text-3">texts/day, whole account</span>
                  </div>
                </div>

                <div className="rounded-md border border-border-2 bg-surface-3 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-text-3">Status</div>
                  <div className={`mt-0.5 flex items-center gap-1.5 text-[13px] font-medium ${statusColor}`}>
                    <StatusIcon size={13} />
                    {statusLabel}
                  </div>
                </div>

                <div className="rounded-md border border-border-2 bg-surface-3 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-text-3">Requirements</div>
                  {level === 1 ? (
                    <div className="mt-0.5 text-[12px] text-text-2">
                      Always available — no prior sending history required.
                    </div>
                  ) : (
                    <ul className="mt-1 space-y-1 text-[12px] text-text-2">
                      <li className="flex items-center justify-between gap-2">
                        <span>Minimum {MIN_DAYS} days at Level {level - 1}</span>
                        {isNext && progress && (
                          <span className={daysOk ? 'font-medium text-success' : 'font-medium text-text'}>
                            {Math.min(progress.daysElapsed, MIN_DAYS)}/{MIN_DAYS}
                          </span>
                        )}
                      </li>
                      <li className="flex items-center justify-between gap-2">
                        <span>Delivery rate {MIN_DELIVERY_RATE}%+</span>
                        {isNext && progress && (
                          <span className={deliveryOk ? 'font-medium text-success' : 'font-medium text-text'}>
                            {progress.deliveryRate}%
                          </span>
                        )}
                      </li>
                      <li className="flex items-center justify-between gap-2">
                        <span>Reply rate {MIN_REPLY_RATE}%+</span>
                        {isNext && progress && (
                          <span className={replyOk ? 'font-medium text-success' : 'font-medium text-text'}>
                            {progress.replyRate}%
                          </span>
                        )}
                      </li>
                      {isNext && (
                        <li className="pt-1 text-[11px] text-text-3">
                          {daysOk && deliveryOk && replyOk
                            ? 'All met — promotes automatically on the next daily check.'
                            : 'Checked once a day — promotes on its own once every requirement is met.'}
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
