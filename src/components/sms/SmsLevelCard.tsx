import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Lock } from 'lucide-react';
import { useSmsSendSettings, useSaveSmsSendSettings } from '@/hooks/useSmsSendSettings';
import { useSmsNumberLabels } from '@/hooks/useSmsNumberLabels';
import { useSmsLevelUnlockProgress } from '@/hooks/useSmsLevelUnlockProgress';
import { SMS_NUMBER_KEYS } from '@/lib/smsNumbers';
import { SMS_DLC_LEVELS, SMS_DLC_LEVEL_DAILY_LIMITS, SMS_DLC_MAX_LEVEL } from '@/lib/smsDlcLevels';

const UNLOCK_WINDOW_DAYS = 7;
const UNLOCK_MIN_DAYS_MET = 6;

/** One pooled 10DLC level for the whole account — total SMS/day across
 * every configured number combined, not a separate ladder per number
 * (feedback was that six independent ladders were confusing). Lives inside
 * the Bulk SMS page's Levels guide rather than always on screen, since it's
 * something you check occasionally, not every visit. */
export function SmsLevelCard() {
  const { data: settings } = useSmsSendSettings();
  const { data: labels } = useSmsNumberLabels();
  const save = useSaveSmsSendSettings();
  const [activeLevel, setActiveLevel] = useState(0);
  const [unlockedLevel, setUnlockedLevel] = useState(0);
  const [saved, setSaved] = useState(false);
  const seededRef = useRef(false);

  const phones = SMS_NUMBER_KEYS.map((k) => labels?.[k]?.phoneNumber ?? null);
  const { data: dailyCounts = [] } = useSmsLevelUnlockProgress(phones);

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

  const ceilingTarget = unlockedLevel >= 1 ? SMS_DLC_LEVEL_DAILY_LIMITS[unlockedLevel] : 0;
  const metDays = unlockedLevel >= 1 ? dailyCounts.filter((c) => c >= ceilingTarget).length : 0;
  const missedDays = UNLOCK_WINDOW_DAYS - metDays;
  const nextLevel = unlockedLevel + 1;
  // Level 1 is the starting rung — no prior sending history to prove, so
  // it's always available. Every level after that needs the 6-of-7-days
  // rule, checked against the whole account's pooled daily volume.
  const canUnlockNext =
    unlockedLevel < SMS_DLC_MAX_LEVEL &&
    (nextLevel === 1 || missedDays <= UNLOCK_WINDOW_DAYS - UNLOCK_MIN_DAYS_MET);

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

          if (l === nextLevel) {
            return (
              <button
                key={l}
                type="button"
                disabled={!canUnlockNext}
                onClick={() => setLevel(l)}
                title={
                  canUnlockNext
                    ? `Unlock Level ${l} — ${SMS_DLC_LEVEL_DAILY_LIMITS[l]}/day`
                    : `Locked — hit ${ceilingTarget}/day on ${UNLOCK_MIN_DAYS_MET} of the last ${UNLOCK_WINDOW_DAYS} days to unlock`
                }
                className={`flex h-8 min-w-[32px] items-center justify-center gap-0.5 rounded-full px-2 text-[12px] font-semibold transition ${
                  canUnlockNext ? 'bg-success/15 text-success hover:bg-success/25' : 'cursor-not-allowed bg-bg-2 text-text-3'
                }`}
              >
                <Lock size={9} />
                {l}
              </button>
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
            {unlockedLevel < SMS_DLC_MAX_LEVEL && (
              <>
                {' · '}
                {canUnlockNext ? (
                  <span className="text-success">
                    Ready to unlock Level {nextLevel} ({SMS_DLC_LEVEL_DAILY_LIMITS[nextLevel]}/day)
                  </span>
                ) : (
                  <span>
                    Hit {ceilingTarget}/day (whole account) on {metDays}/{UNLOCK_WINDOW_DAYS} of the last{' '}
                    {UNLOCK_WINDOW_DAYS} days (need {UNLOCK_MIN_DAYS_MET}) to unlock Level {nextLevel}
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
