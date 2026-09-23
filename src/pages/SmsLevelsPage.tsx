import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Circle, Gauge, Lock } from 'lucide-react';
import { useSmsSendSettings } from '@/hooks/useSmsSendSettings';
import { useSmsNumberLabels } from '@/hooks/useSmsNumberLabels';
import { useSmsLevelUnlockProgress } from '@/hooks/useSmsLevelUnlockProgress';
import { SmsLevelCard } from '@/components/sms/SmsLevelCard';
import { CardHeader } from '@/components/ui/CardHeader';
import { SMS_NUMBER_KEYS } from '@/lib/smsNumbers';
import { SMS_DLC_LEVELS, SMS_DLC_LEVEL_DAILY_LIMITS } from '@/lib/smsDlcLevels';

const UNLOCK_WINDOW_DAYS = 7;
const UNLOCK_MIN_DAYS_MET = 6;

/** Full detail page for the account's pooled 10DLC sending level — one card
 * per level instead of the old compact reference table, since "everything
 * about that level" (its own daily limit, what it takes to reach it, and
 * where the account stands against it right now) didn't fit in a table row. */
export function SmsLevelsPage() {
  const navigate = useNavigate();
  const { data: settings } = useSmsSendSettings();
  const { data: labels } = useSmsNumberLabels();
  const phones = SMS_NUMBER_KEYS.map((k) => labels?.[k]?.phoneNumber ?? null);
  const { data: dailyCounts = [] } = useSmsLevelUnlockProgress(phones);

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
            configured number combined, not per number.
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

          const prevTarget = level > 1 ? SMS_DLC_LEVEL_DAILY_LIMITS[level - 1] : null;
          const metDays = isNext && prevTarget ? dailyCounts.filter((c) => c >= prevTarget).length : 0;

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
          } else if (isNext) {
            statusLabel = 'Next up';
            statusIcon = Lock;
            statusColor = 'text-warning';
          }
          const StatusIcon = statusIcon;

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
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-text-3">To unlock</div>
                  <div className="mt-0.5 text-[12px] text-text-2">
                    {level === 1 ? (
                      'Always available — no prior sending history required.'
                    ) : (
                      <>
                        Hit {prevTarget!.toLocaleString()}/day (Level {level - 1}'s target) on {UNLOCK_MIN_DAYS_MET} of
                        the last {UNLOCK_WINDOW_DAYS} days, across every number combined.
                        {isNext && (
                          <div className="mt-1 font-medium text-text">
                            Progress: {metDays}/{UNLOCK_WINDOW_DAYS} days met
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
