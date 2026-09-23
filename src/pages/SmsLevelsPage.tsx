import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, CheckCircle2, Circle, Gauge, Lock, Minus } from 'lucide-react';
import { useSmsSendSettings } from '@/hooks/useSmsSendSettings';
import { useSmsLevelProgress } from '@/hooks/useSmsLevelProgress';
import { SmsLevelCard } from '@/components/sms/SmsLevelCard';
import { SMS_DLC_LEVELS, SMS_DLC_LEVEL_DAILY_LIMITS } from '@/lib/smsDlcLevels';

const MIN_DAYS = 7;
const MIN_DELIVERY_RATE = 60;
const MIN_REPLY_RATE = 15;

type Status = 'active' | 'passed' | 'next' | 'locked';

const STATUS_STYLE: Record<Status, { label: string; icon: typeof Lock; badge: string; iconBadge: string; cardBorder: string }> = {
  active: {
    label: 'Active',
    icon: CheckCircle2,
    badge: 'bg-success/15 text-success',
    iconBadge: 'bg-primary/15 text-primary',
    cardBorder: 'border-primary ring-1 ring-primary/30',
  },
  passed: {
    label: 'Passed',
    icon: Check,
    badge: 'bg-primary/15 text-primary',
    iconBadge: 'bg-primary/10 text-primary',
    cardBorder: 'border-primary/20',
  },
  next: {
    label: 'Next up',
    icon: Lock,
    badge: 'bg-warning/15 text-warning',
    iconBadge: 'bg-warning/10 text-warning',
    cardBorder: 'border-warning/30',
  },
  locked: {
    label: 'Locked',
    icon: Lock,
    badge: 'bg-bg-2 text-text-3',
    iconBadge: 'bg-bg-2 text-text-3',
    cardBorder: 'border-border opacity-70',
  },
};

/** Full detail page for the account's pooled 10DLC sending level — one card
 * per level instead of the old compact reference table, since "everything
 * about that level" (its own daily limit, what it takes to reach it, and
 * where the account stands against it right now) didn't fit in a table row. */
export function SmsLevelsPage() {
  const navigate = useNavigate();
  const { data: settings } = useSmsSendSettings();
  const { data: progress } = useSmsLevelProgress(settings?.dailyLimitLevelStartedAt ?? null);

  const currentLevel = settings?.dailyLimitLevel ?? 0;

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
            configured number combined, not per number. Fully automatic; there's nothing to click.
          </p>
        </div>
      </div>

      <div className="card mb-5">
        <SmsLevelCard />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {SMS_DLC_LEVELS.map((level) => {
          const status: Status = level === currentLevel ? 'active' : level < currentLevel ? 'passed' : level === currentLevel + 1 ? 'next' : 'locked';
          const style = STATUS_STYLE[status];
          const StatusIcon = style.icon;

          const daysOk = (progress?.daysElapsed ?? 0) >= MIN_DAYS;
          const deliveryOk = (progress?.deliveryRate ?? 0) >= MIN_DELIVERY_RATE;
          const replyOk = (progress?.replyRate ?? 0) >= MIN_REPLY_RATE;

          // Whatever's already earned (active/passed) shows fully checked —
          // those requirements were already met to get here. Only the "next
          // up" card evaluates live against current progress; anything
          // further out just shows the plain, un-evaluated requirement.
          const earned = status === 'active' || status === 'passed';

          return (
            <div key={level} className={`card relative overflow-hidden !p-0 ${style.cardBorder}`}>
              {status === 'active' && <div className="h-1 w-full bg-primary" />}

              <div className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${style.iconBadge}`}>
                      <Gauge size={15} />
                    </span>
                    <span className="text-sm font-semibold text-text">Level {level}</span>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.badge}`}>
                    <StatusIcon size={11} />
                    {style.label}
                  </span>
                </div>

                <div className="mt-4 flex items-baseline gap-1.5">
                  <span className="font-mono text-3xl font-bold tabular-nums text-text">
                    {SMS_DLC_LEVEL_DAILY_LIMITS[level].toLocaleString()}
                  </span>
                  <span className="text-[12px] text-text-3">texts/day</span>
                </div>
                <div className="text-[11px] text-text-3">whole account, pooled across every number</div>

                <div className="mt-4 border-t border-border-2 pt-3">
                  {level === 1 ? (
                    <div className="flex items-center gap-1.5 text-[12px] font-medium text-success">
                      <CheckCircle2 size={13} /> No prior history required
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <RequirementRow
                        label={`${MIN_DAYS}+ days at Level ${level - 1}`}
                        state={earned ? 'met' : status === 'next' ? (daysOk ? 'met' : 'unmet') : 'plain'}
                        value={status === 'next' && progress ? `${Math.min(progress.daysElapsed, MIN_DAYS)}/${MIN_DAYS}` : undefined}
                      />
                      <RequirementRow
                        label="Consistent sending"
                        state="neutral"
                        value={status === 'next' && progress ? `${progress.daysActive}/${MIN_DAYS} days` : undefined}
                      />
                      <RequirementRow
                        label={`Delivery rate ${MIN_DELIVERY_RATE}%+`}
                        state={earned ? 'met' : status === 'next' ? (deliveryOk ? 'met' : 'unmet') : 'plain'}
                        value={status === 'next' && progress ? `${progress.deliveryRate}%` : undefined}
                      />
                      <RequirementRow
                        label={`Reply rate ${MIN_REPLY_RATE}%+`}
                        state={earned ? 'met' : status === 'next' ? (replyOk ? 'met' : 'unmet') : 'plain'}
                        value={status === 'next' && progress ? `${progress.replyRate}%` : undefined}
                      />
                    </div>
                  )}
                  {status === 'next' && (
                    <div className={`mt-2.5 text-[11px] ${daysOk && deliveryOk && replyOk ? 'font-medium text-success' : 'text-text-3'}`}>
                      {daysOk && deliveryOk && replyOk
                        ? 'All met — promotes automatically on the next daily check.'
                        : 'Checked once a day — promotes on its own once every requirement is met.'}
                    </div>
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

function RequirementRow({
  label,
  state,
  value,
}: {
  label: string;
  state: 'met' | 'unmet' | 'plain' | 'neutral';
  value?: string;
}) {
  const Icon = state === 'met' ? Check : state === 'unmet' ? Circle : Minus;
  const iconColor = state === 'met' ? 'text-success' : state === 'unmet' ? 'text-warning' : 'text-text-3';
  const textColor = state === 'met' ? 'text-text' : state === 'plain' ? 'text-text-3' : 'text-text-2';
  return (
    <div className="flex items-center justify-between gap-2 text-[12px]">
      <span className={`flex items-center gap-1.5 ${textColor}`}>
        <Icon size={12} className={`shrink-0 ${iconColor}`} />
        {label}
      </span>
      {value && <span className={`font-mono font-medium tabular-nums ${state === 'met' ? 'text-success' : 'text-text'}`}>{value}</span>}
    </div>
  );
}
