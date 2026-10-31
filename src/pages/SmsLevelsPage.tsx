import { Link, useNavigate } from 'react-router-dom';
import { Check, CheckCircle2, Lock, Minus } from 'lucide-react';
import { useSmsSendSettings } from '@/hooks/useSmsSendSettings';
import { useSmsLevelProgress } from '@/hooks/useSmsLevelProgress';
import { useSmsSentToday } from '@/hooks/useSms';
import { SMS_DLC_LEVELS, SMS_DLC_LEVEL_DAILY_LIMITS, SMS_DLC_MAX_LEVEL } from '@/lib/smsDlcLevels';
import { formatDate } from '@/lib/utils';

const MIN_DAYS = 5;
const MIN_DELIVERY_RATE = 60;
const MIN_REPLY_RATE = 15;

type Status = 'active' | 'passed' | 'next' | 'locked';

const STATUS_STYLE: Record<Status, { label: string; icon: typeof Lock; badge: string; cardBorder: string }> = {
  active: { label: 'Current', icon: CheckCircle2, badge: 'bg-primary text-primary-text', cardBorder: 'border-primary ring-1 ring-primary/30' },
  passed: { label: 'Done', icon: Check, badge: 'bg-success/15 text-success', cardBorder: 'border-primary/20' },
  next: { label: 'Next up', icon: Lock, badge: 'bg-warning/15 text-warning', cardBorder: 'border-warning/30' },
  locked: { label: 'Locked', icon: Lock, badge: 'bg-surface-3 text-text-3', cardBorder: 'border-border opacity-70' },
};

/** Full detail page for the account's pooled 10DLC sending level — a hero
 * panel for the active level plus live progress toward the next one, and a
 * card per level below for the full ladder. */
export function SmsLevelsPage() {
  const navigate = useNavigate();
  const { data: settings } = useSmsSendSettings();
  const { data: progress } = useSmsLevelProgress(settings?.dailyLimitLevelStartedAt ?? null);
  const usedToday = useSmsSentToday();

  const currentLevel = settings?.dailyLimitLevel ?? 0;
  const nextLevel = currentLevel + 1;
  const dailyLimit = currentLevel > 0 ? SMS_DLC_LEVEL_DAILY_LIMITS[currentLevel] : 0;

  const daysOk = (progress?.daysElapsed ?? 0) >= MIN_DAYS;
  const deliveryOk = (progress?.deliveryRate ?? 0) >= MIN_DELIVERY_RATE;
  const replyOk = (progress?.replyRate ?? 0) >= MIN_REPLY_RATE;
  const metCount = [daysOk, deliveryOk, replyOk].filter(Boolean).length;
  const readyToPromote = currentLevel >= 1 && daysOk && deliveryOk && replyOk;

  return (
    <div>
      <nav className="mb-2 flex items-center gap-1.5 text-[13px] text-text-3">
        <Link to="/bulk-sms" className="hover:text-text-2">Bulk SMS</Link>
        <span>/</span>
        <span className="text-text-2">Sending levels</span>
      </nav>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text">Sending levels</h1>
          <p className="mt-1 max-w-[68ch] text-sm text-text-3">
            One pooled 10DLC level for the whole account — the daily limit is total texts per day across every
            configured number combined, not per number. Levels go up on their own, checked once a day.
          </p>
        </div>
        <button className="btn shrink-0" onClick={() => navigate('/bulk-sms')}>
          Back to sends
        </button>
      </div>

      {currentLevel === 0 ? (
        <div className="card mb-5 !p-5 text-[13px] text-text-3">
          Not started yet — the account is automatically set to Level 1 on the next daily check.
        </div>
      ) : (
        <div className="card mb-5 flex flex-wrap gap-6 border-primary/35 !bg-primary/5 !p-6">
          <div className="flex min-w-[260px] flex-1 flex-col gap-3.5">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary/20 px-2.5 py-1 text-[12px] font-semibold text-primary-text">
              Current level{settings?.dailyLimitLevelStartedAt && ` · since ${formatDate(settings.dailyLimitLevelStartedAt)}`}
            </span>
            <div className="font-mono text-[40px] font-extrabold leading-none tracking-tight text-text">Level {currentLevel}</div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-2xl font-bold tabular-nums text-text">{dailyLimit.toLocaleString()}</span>
              <span className="text-[14px] text-text-3">texts a day, shared across every configured number</span>
            </div>

            {settings && settings.dailyLimit > 0 && (
              <div>
                <div className="flex items-center justify-between text-[12.5px] text-text-2">
                  <span>Used today</span>
                  <span className="font-mono"><b className="text-text">{usedToday.toLocaleString()}</b> of {settings.dailyLimit.toLocaleString()}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.min(100, (usedToday / settings.dailyLimit) * 100)}%` }}
                  />
                </div>
              </div>
            )}

            <ol aria-label="Level ladder" className="mt-1 grid grid-cols-6 gap-1.5 sm:grid-cols-12">
              {SMS_DLC_LEVELS.map((level) => (
                <li key={level} className="flex flex-col gap-1.5">
                  <span
                    className={`h-1.5 rounded-full ${
                      level < currentLevel ? 'bg-primary' : level === currentLevel ? 'bg-primary ring-2 ring-primary/30' : 'bg-surface-3'
                    }`}
                  />
                  <span className={`font-mono text-[10.5px] ${level === currentLevel ? 'font-bold text-text' : 'text-text-3'}`}>L{level}</span>
                </li>
              ))}
            </ol>
          </div>

          {currentLevel < SMS_DLC_MAX_LEVEL && (
            <div className="flex min-w-[320px] flex-[1.3] flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[15px] font-bold text-text">
                  To reach Level {nextLevel} <span className="font-mono font-medium text-text-3">{SMS_DLC_LEVEL_DAILY_LIMITS[nextLevel].toLocaleString()} a day</span>
                </h2>
                <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 font-mono text-[11.5px] font-semibold text-warning">
                  {metCount} of 3 met
                </span>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <HeroRequirement ok={daysOk} label={`${MIN_DAYS}+ days at Level ${currentLevel}`} sub={progress ? `${progress.daysElapsed} day${progress.daysElapsed === 1 ? '' : 's'} so far` : undefined} />
                <HeroRequirement
                  neutral
                  label="Consistent sending"
                  sub={progress ? `Sent on ${progress.daysActive} of the last ${Math.min(progress.daysElapsed, MIN_DAYS)} days` : undefined}
                />
                <HeroRequirement ok={deliveryOk} label={`Delivery rate ${MIN_DELIVERY_RATE}%+`} rate={progress?.deliveryRate} threshold={MIN_DELIVERY_RATE} />
                <HeroRequirement ok={replyOk} label={`Reply rate ${MIN_REPLY_RATE}%+`} rate={progress?.replyRate} threshold={MIN_REPLY_RATE} />
              </div>

              <div className={`rounded-md bg-surface-2 px-3.5 py-2.5 text-[12.5px] ${readyToPromote ? 'font-medium text-success' : 'text-text-2'}`}>
                {readyToPromote
                  ? `Ready — Level ${nextLevel} auto-promotes on the next daily check.`
                  : 'Checked once a day — promotes on its own once every requirement above is met.'}
              </div>
            </div>
          )}
        </div>
      )}

      <div>
        <h2 className="mb-3 text-[15px] font-bold text-text">All levels</h2>
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
          {SMS_DLC_LEVELS.map((level) => {
            const status: Status = level === currentLevel ? 'active' : level < currentLevel ? 'passed' : level === currentLevel + 1 ? 'next' : 'locked';
            const style = STATUS_STYLE[status];
            const StatusIcon = style.icon;
            const earned = status === 'active' || status === 'passed';

            return (
              <div key={level} className={`card !p-4 ${style.cardBorder}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[15px] font-bold text-text">Level {level}</span>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.badge}`}>
                    <StatusIcon size={11} />
                    {style.label}
                  </span>
                </div>

                <div className="mt-2 flex items-baseline gap-1.5">
                  <span className="font-mono text-[26px] font-extrabold tracking-tight text-text">
                    {SMS_DLC_LEVEL_DAILY_LIMITS[level].toLocaleString()}
                  </span>
                  <span className="text-[12.5px] text-text-3">texts a day</span>
                </div>

                <div className="mt-3 flex flex-col gap-1.5 border-t border-border-2 pt-3">
                  {level === 1 ? (
                    <RequirementRow label="No history needed" state="met" />
                  ) : (
                    <>
                      <RequirementRow
                        label={`${MIN_DAYS}+ days at Level ${level - 1}`}
                        state={earned ? 'met' : status === 'next' ? (daysOk ? 'met' : 'unmet') : 'plain'}
                      />
                      <RequirementRow label="Consistent sending" state={earned ? 'met' : 'plain'} />
                      <RequirementRow
                        label={`Delivery rate ${MIN_DELIVERY_RATE}%+`}
                        state={earned ? 'met' : status === 'next' ? (deliveryOk ? 'met' : 'unmet') : 'plain'}
                      />
                      <RequirementRow
                        label={`Reply rate ${MIN_REPLY_RATE}%+`}
                        state={earned ? 'met' : status === 'next' ? (replyOk ? 'met' : 'unmet') : 'plain'}
                      />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** One requirement row in the hero "To reach Level N" panel — either a
 * plain ok/not-ok fact (days), a rate with its own mini progress bar and
 * threshold tick, or a neutral informational stat that doesn't gate
 * promotion on its own (consistent sending — see sms_level_progress). */
function HeroRequirement({
  label,
  sub,
  ok,
  neutral,
  rate,
  threshold,
}: {
  label: string;
  sub?: string;
  ok?: boolean;
  neutral?: boolean;
  rate?: number;
  threshold?: number;
}) {
  return (
    <div className={`flex flex-col gap-2 rounded-md p-3.5 ${!neutral && ok === false ? 'border border-danger/30 bg-danger-dim/40' : 'bg-surface-2'}`}>
      <div className="flex items-center gap-2 text-[13px]">
        {neutral ? (
          <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-text-3">
            <Minus size={12} />
          </span>
        ) : ok ? (
          <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
            <Check size={11} />
          </span>
        ) : (
          <span className="h-[18px] w-[18px] shrink-0 rounded-full border-[1.5px] border-border-2" />
        )}
        <span className="font-semibold text-text">{label}</span>
      </div>
      {rate !== undefined && threshold !== undefined ? (
        <div className="flex items-center gap-2 pl-[26px]">
          <div className="relative h-[5px] flex-1 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, rate)}%`, background: ok ? 'rgb(var(--color-success))' : 'rgb(var(--color-danger))' }} />
            <div className="absolute -top-[3px] bottom-[-3px] w-[2px] bg-text" style={{ left: `${threshold}%` }} />
          </div>
          <span className={`font-mono text-[12px] font-semibold ${ok ? 'text-success' : 'text-danger'}`}>{rate}%</span>
        </div>
      ) : (
        sub && <div className="pl-[26px] font-mono text-[12px] text-text-3">{sub}</div>
      )}
    </div>
  );
}

function RequirementRow({ label, state }: { label: string; state: 'met' | 'unmet' | 'plain' }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      {state === 'met' ? (
        <span className="flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
          <Check size={9} />
        </span>
      ) : (
        <span className={`h-[15px] w-[15px] shrink-0 rounded-full border-[1.5px] ${state === 'unmet' ? 'border-danger' : 'border-border-2'}`} />
      )}
      <span className={state === 'met' ? 'text-text' : state === 'unmet' ? 'text-danger' : 'text-text-3'}>{label}</span>
    </div>
  );
}
