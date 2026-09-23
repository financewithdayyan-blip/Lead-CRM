import { useSmsSendSettings } from '@/hooks/useSmsSendSettings';
import { useSmsLevelProgress } from '@/hooks/useSmsLevelProgress';
import { SMS_DLC_LEVEL_DAILY_LIMITS, SMS_DLC_MAX_LEVEL } from '@/lib/smsDlcLevels';

const MIN_DAYS = 7;
const MIN_DELIVERY_RATE = 60;
const MIN_REPLY_RATE = 15;

/** One pooled 10DLC level for the whole account — total SMS/day across
 * every configured number combined. Fully automatic, read-only display:
 * auto_promote_sms_levels (0154/0156/0158) bootstraps a fresh account
 * straight to Level 1 and promotes it from there on its own once it's held
 * a level for 7+ days with a 60%+ delivery rate and 15%+ reply rate —
 * there is nothing here to click or save. */
export function SmsLevelCard() {
  const { data: settings } = useSmsSendSettings();
  const { data: progress } = useSmsLevelProgress(settings?.dailyLimitLevelStartedAt ?? null);

  const currentLevel = settings?.dailyLimitLevel ?? 0;
  const nextLevel = currentLevel + 1;
  const daysMet = (progress?.daysElapsed ?? 0) >= MIN_DAYS;
  const deliveryMet = (progress?.deliveryRate ?? 0) >= MIN_DELIVERY_RATE;
  const replyMet = (progress?.replyRate ?? 0) >= MIN_REPLY_RATE;
  const readyToPromote = currentLevel >= 1 && daysMet && deliveryMet && replyMet;

  return (
    <div>
      <span className="text-[13px] font-medium text-text">Account sending level</span>

      {currentLevel === 0 ? (
        <p className="mt-2 text-[12px] text-text-3">
          Not started yet — the account is automatically set to Level 1 on the next daily check.
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MiniStat label="Current level" value={`Level ${currentLevel}`} sub={`${SMS_DLC_LEVEL_DAILY_LIMITS[currentLevel]}/day`} />
          <MiniStat label="Consistent days" value={progress ? `${progress.daysActive}/${MIN_DAYS}` : '—'} sub="days with a real send" />
          <MiniStat
            label="Reply rate"
            value={progress ? `${progress.replyRate}%` : '—'}
            sub={`need ${MIN_REPLY_RATE}%+`}
            good={progress ? progress.replyRate >= MIN_REPLY_RATE : undefined}
          />
          <MiniStat
            label="Delivery rate"
            value={progress ? `${progress.deliveryRate}%` : '—'}
            sub={`need ${MIN_DELIVERY_RATE}%+`}
            good={progress ? progress.deliveryRate >= MIN_DELIVERY_RATE : undefined}
          />
        </div>
      )}

      {currentLevel > 0 && currentLevel < SMS_DLC_MAX_LEVEL && (
        <p className="mt-2 text-[11px] text-text-3">
          {readyToPromote ? (
            <span className="font-medium text-success">Ready — Level {nextLevel} auto-promotes on the next daily check.</span>
          ) : (
            <>Toward Level {nextLevel}: needs {MIN_DAYS}+ days at this level, {MIN_DELIVERY_RATE}%+ delivery, and {MIN_REPLY_RATE}%+ reply, all at once. Checked automatically once a day.</>
          )}
        </p>
      )}
    </div>
  );
}

function MiniStat({ label, value, sub, good }: { label: string; value: string; sub: string; good?: boolean }) {
  return (
    <div className="rounded-md border border-border-2 bg-surface-3 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-text-3">{label}</div>
      <div className={`font-mono text-base font-semibold tabular-nums ${good === true ? 'text-success' : 'text-text'}`}>
        {value}
      </div>
      <div className="text-[10px] text-text-3">{sub}</div>
    </div>
  );
}
