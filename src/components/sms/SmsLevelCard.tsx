import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Lock } from 'lucide-react';
import { useSmsSendSettings, useSaveSmsSendSettings } from '@/hooks/useSmsSendSettings';
import { useSmsLevelProgress } from '@/hooks/useSmsLevelProgress';
import { SMS_DLC_LEVELS, SMS_DLC_LEVEL_DAILY_LIMITS, SMS_DLC_MAX_LEVEL } from '@/lib/smsDlcLevels';

const MIN_DAYS = 10;
const MIN_DELIVERY_RATE = 60;
const MIN_REPLY_RATE = 15;

/** One pooled 10DLC level for the whole account — total SMS/day across
 * every configured number combined. Levels 1-9 auto-promote on their own
 * (see auto_promote_sms_levels, 0154) once the account has held the level
 * for 10+ days with a 60%+ delivery rate and 15%+ reply rate — there's
 * nothing to click to "unlock" here, only to start at Level 1 or dial the
 * active level among whatever's already been earned. */
export function SmsLevelCard() {
  const { data: settings } = useSmsSendSettings();
  const save = useSaveSmsSendSettings();
  const [activeLevel, setActiveLevel] = useState(0);
  const [unlockedLevel, setUnlockedLevel] = useState(0);
  const [saved, setSaved] = useState(false);
  const seededRef = useRef(false);

  const { data: progress } = useSmsLevelProgress(settings?.dailyLimitLevelStartedAt ?? null);

  useEffect(() => {
    if (!settings || seededRef.current) return;
    seededRef.current = true;
    setActiveLevel(settings.dailyLimitLevel);
    setUnlockedLevel(Math.max(settings.dailyLimitUnlockedLevel, settings.dailyLimitLevel));
  }, [settings]);

  function setLevel(level: number) {
    setActiveLevel(level);
    setUnlockedLevel((prev) => Math.max(prev, level));
  }

  const dirty =
    !!settings &&
    (activeLevel !== settings.dailyLimitLevel || unlockedLevel !== settings.dailyLimitUnlockedLevel);

  async function handleSave() {
    if (!settings) return;
    await save.mutateAsync({
      ...settings,
      dailyLimit: activeLevel >= 1 ? SMS_DLC_LEVEL_DAILY_LIMITS[activeLevel] : 0,
      dailyLimitLevel: activeLevel,
      dailyLimitUnlockedLevel: unlockedLevel,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  const nextLevel = unlockedLevel + 1;
  const daysMet = (progress?.daysElapsed ?? 0) >= MIN_DAYS;
  const deliveryMet = (progress?.deliveryRate ?? 0) >= MIN_DELIVERY_RATE;
  const replyMet = (progress?.replyRate ?? 0) >= MIN_REPLY_RATE;
  const readyToPromote = unlockedLevel >= 1 && daysMet && deliveryMet && replyMet;

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-text">Account sending level</span>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-success">
              <Check size={11} /> Saved
            </span>
          )}
          <button
            type="button"
            className={`text-[11px] font-medium ${activeLevel === 0 ? 'text-primary' : 'text-text-3 hover:text-text'}`}
            onClick={() => setLevel(0)}
          >
            No cap
          </button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {SMS_DLC_LEVELS.map((l) => {
          const unlocked = l <= unlockedLevel;
          const active = l === activeLevel;

          if (unlocked) {
            return (
              <button
                key={l}
                type="button"
                onClick={() => setLevel(l)}
                title={`Level ${l} — ${SMS_DLC_LEVEL_DAILY_LIMITS[l]}/day`}
                className={`h-8 min-w-[32px] rounded-full px-2 text-[12px] font-semibold transition ${
                  active ? 'bg-primary text-white' : 'bg-primary/15 text-primary hover:bg-primary/25'
                }`}
              >
                {l}
              </button>
            );
          }

          if (l === nextLevel && unlockedLevel === 0) {
            // Level 1 is the only manually-startable rung — no history to
            // measure yet, so it's never gated.
            return (
              <button
                key={l}
                type="button"
                onClick={() => setLevel(l)}
                title={`Start at Level ${l} — ${SMS_DLC_LEVEL_DAILY_LIMITS[l]}/day`}
                className="flex h-8 min-w-[32px] items-center justify-center rounded-full bg-success/15 px-2 text-[12px] font-semibold text-success transition hover:bg-success/25"
              >
                {l}
              </button>
            );
          }

          if (l === nextLevel) {
            return (
              <span
                key={l}
                title={
                  readyToPromote
                    ? `Level ${l} promotes automatically on the next daily check`
                    : `Auto-promotes once ${MIN_DAYS}+ days, ${MIN_DELIVERY_RATE}%+ delivery, and ${MIN_REPLY_RATE}%+ reply rate are all met`
                }
                className={`flex h-8 min-w-[32px] items-center justify-center gap-0.5 rounded-full px-2 text-[12px] font-semibold ${
                  readyToPromote ? 'bg-success/15 text-success' : 'bg-bg-2 text-text-3'
                }`}
              >
                <Lock size={9} />
                {l}
              </span>
            );
          }

          return (
            <span
              key={l}
              className="flex h-8 min-w-[32px] items-center justify-center rounded-full bg-bg-2 px-2 text-[12px] text-text-3/50"
            >
              {l}
            </span>
          );
        })}
      </div>

      <div className="mt-2 text-[12px] text-text-3">
        {unlockedLevel === 0 ? (
          <span>No level unlocked yet — click Level 1 to start the ladder at {SMS_DLC_LEVEL_DAILY_LIMITS[1]}/day.</span>
        ) : (
          <>
            <span className="font-medium text-text-2">
              {activeLevel === 0 ? 'No daily cap right now' : `Active: Level ${activeLevel} — ${SMS_DLC_LEVEL_DAILY_LIMITS[activeLevel]}/day total`}
            </span>
            {unlockedLevel < SMS_DLC_MAX_LEVEL && progress && (
              <>
                {' · '}
                {readyToPromote ? (
                  <span className="text-success">Ready — Level {nextLevel} auto-promotes on the next daily check.</span>
                ) : (
                  <span>
                    Toward Level {nextLevel}: {Math.min(progress.daysElapsed, MIN_DAYS)}/{MIN_DAYS} days,{' '}
                    {progress.deliveryRate}% delivery (need {MIN_DELIVERY_RATE}%+), {progress.replyRate}% reply (need{' '}
                    {MIN_REPLY_RATE}%+)
                  </span>
                )}
              </>
            )}
          </>
        )}
      </div>

      <div className="mt-3 flex justify-end">
        <button className="btn btn-primary !px-3 !py-1 text-[12px]" onClick={handleSave} disabled={!dirty || save.isPending}>
          {save.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
        </button>
      </div>
    </div>
  );
}
