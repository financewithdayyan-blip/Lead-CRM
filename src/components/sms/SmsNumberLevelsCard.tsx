import { useEffect, useRef, useState } from 'react';
import { Check, Gauge, Loader2, Lock } from 'lucide-react';
import { useSmsSendSettings, useSaveSmsSendSettings } from '@/hooks/useSmsSendSettings';
import { useSmsNumberLabels } from '@/hooks/useSmsNumberLabels';
import { useSmsLevelUnlockProgress } from '@/hooks/useSmsLevelUnlockProgress';
import { SMS_NUMBER_KEYS } from '@/lib/smsNumbers';
import { SMS_DLC_LEVELS, SMS_DLC_LEVEL_DAILY_LIMITS, SMS_DLC_MAX_LEVEL } from '@/lib/smsDlcLevels';
import { CardHeader } from '@/components/ui/CardHeader';

const UNLOCK_WINDOW_DAYS = 7;
const UNLOCK_MIN_DAYS_MET = 6;

/** Each number's 10DLC throughput level — lives on the Bulk SMS page (not
 * Settings) since this is status you'd check right before sending, not a
 * one-time account setting. Saving only ever touches dailyLimits/
 * dailyLimitLevels/dailyLimitUnlockedLevels on the shared sms_send_settings
 * row — perMessageDelayMs (owned by SmsNumberLabelsEditor, in Settings) is
 * read from the same query and passed straight through unchanged. */
export function SmsNumberLevelsCard() {
  const { data: settings } = useSmsSendSettings();
  const { data: labels } = useSmsNumberLabels();
  const save = useSaveSmsSendSettings();
  const [activeLevels, setActiveLevels] = useState<Record<string, number>>({});
  const [unlockedLevels, setUnlockedLevels] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState(false);
  const seededRef = useRef(false);

  const phones = SMS_NUMBER_KEYS.map((k) => labels?.[k]?.phoneNumber ?? null);
  const { data: progressByPhone } = useSmsLevelUnlockProgress(phones);

  useEffect(() => {
    if (!settings || seededRef.current) return;
    seededRef.current = true;
    setActiveLevels(Object.fromEntries(SMS_NUMBER_KEYS.map((k) => [k, settings.dailyLimitLevels[k] ?? 0])));
    setUnlockedLevels(
      Object.fromEntries(
        SMS_NUMBER_KEYS.map((k) => [
          k,
          Math.max(settings.dailyLimitUnlockedLevels[k] ?? 0, settings.dailyLimitLevels[k] ?? 0),
        ]),
      ),
    );
  }, [settings]);

  function setLevel(key: string, level: number) {
    setActiveLevels((prev) => ({ ...prev, [key]: level }));
    setUnlockedLevels((prev) => ({ ...prev, [key]: Math.max(prev[key] ?? 0, level) }));
  }

  const normalizedDailyLimits = Object.fromEntries(
    SMS_NUMBER_KEYS.map((k) => {
      const level = activeLevels[k] ?? 0;
      return [k, level >= 1 ? SMS_DLC_LEVEL_DAILY_LIMITS[level] : 0];
    }),
  );
  const dirty =
    !!settings &&
    (SMS_NUMBER_KEYS.some((k) => (activeLevels[k] ?? 0) !== (settings.dailyLimitLevels[k] ?? 0)) ||
      SMS_NUMBER_KEYS.some((k) => (unlockedLevels[k] ?? 0) !== (settings.dailyLimitUnlockedLevels[k] ?? 0)));

  async function handleSave() {
    if (!settings) return;
    await save.mutateAsync({
      ...settings,
      dailyLimits: normalizedDailyLimits,
      dailyLimitLevels: activeLevels,
      dailyLimitUnlockedLevels: unlockedLevels,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-2">
        <CardHeader
          icon={Gauge}
          title="Sending Levels"
          sub="Each number climbs a 10DLC throughput ladder instead of a flat guessed number"
        />
        {saved && (
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-success">
            <Check size={11} /> Saved
          </span>
        )}
      </div>
      <p className="mt-2 text-[11px] text-text-3">
        Level 1 starts at {SMS_DLC_LEVEL_DAILY_LIMITS[1]}/day. Unlocking the next level needs that day's target
        actually hit on {UNLOCK_MIN_DAYS_MET} of the last {UNLOCK_WINDOW_DAYS} days (one miss allowed), matching how
        carriers raise a number's real sending limit over time.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {SMS_NUMBER_KEYS.map((key) => {
          const phone = labels?.[key]?.phoneNumber ?? null;
          const dailyCounts = (phone && progressByPhone?.get(phone)) || [];
          return (
            <NumberLevelLadder
              key={key}
              label={labels?.[key]?.label || `Number ${key}`}
              activeLevel={activeLevels[key] ?? 0}
              unlockedLevel={unlockedLevels[key] ?? 0}
              dailyCounts={dailyCounts}
              onChange={(level) => setLevel(key, level)}
            />
          );
        })}
      </div>
      <div className="mt-3 flex justify-end">
        <button className="btn btn-primary !px-3 !py-1 text-[12px]" onClick={handleSave} disabled={!dirty || save.isPending}>
          {save.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
        </button>
      </div>
    </div>
  );
}

/** One number's 1-10 level ladder. `unlockedLevel` is the highest level ever
 * earned (only ever grows); `activeLevel` is which of the unlocked levels is
 * currently enforced (or 0 for no cap) — kept separate so dialing a number
 * back down never erases progress already earned toward the next unlock. */
function NumberLevelLadder({
  label,
  activeLevel,
  unlockedLevel,
  dailyCounts,
  onChange,
}: {
  label: string;
  activeLevel: number;
  unlockedLevel: number;
  dailyCounts: number[];
  onChange: (level: number) => void;
}) {
  const ceilingTarget = unlockedLevel >= 1 ? SMS_DLC_LEVEL_DAILY_LIMITS[unlockedLevel] : 0;
  const metDays = unlockedLevel >= 1 ? dailyCounts.filter((c) => c >= ceilingTarget).length : 0;
  const missedDays = UNLOCK_WINDOW_DAYS - metDays;
  const nextLevel = unlockedLevel + 1;
  // Level 1 is the starting rung — no prior sending history to prove, so it's
  // always available. Every level after that needs the 6-of-7-days rule.
  const canUnlockNext =
    unlockedLevel < SMS_DLC_MAX_LEVEL &&
    (nextLevel === 1 || missedDays <= UNLOCK_WINDOW_DAYS - UNLOCK_MIN_DAYS_MET);

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-text">{label}</span>
        <button
          type="button"
          className={`text-[11px] font-medium ${activeLevel === 0 ? 'text-primary' : 'text-text-3 hover:text-text'}`}
          onClick={() => onChange(0)}
        >
          No cap
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {SMS_DLC_LEVELS.map((l) => {
          const unlocked = l <= unlockedLevel;
          const active = l === activeLevel;

          if (unlocked) {
            return (
              <button
                key={l}
                type="button"
                onClick={() => onChange(l)}
                title={`Level ${l} — ${SMS_DLC_LEVEL_DAILY_LIMITS[l]}/day`}
                className={`h-8 min-w-[32px] rounded-full px-2 text-[11px] font-semibold transition ${
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
                onClick={() => onChange(l)}
                title={
                  canUnlockNext
                    ? `Unlock Level ${l} — ${SMS_DLC_LEVEL_DAILY_LIMITS[l]}/day`
                    : `Locked — hit ${ceilingTarget}/day on ${UNLOCK_MIN_DAYS_MET} of the last ${UNLOCK_WINDOW_DAYS} days to unlock`
                }
                className={`flex h-8 min-w-[32px] items-center justify-center gap-0.5 rounded-full px-2 text-[11px] font-semibold transition ${
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
              className="flex h-8 min-w-[32px] items-center justify-center rounded-full bg-bg-2 px-2 text-[11px] text-text-3/50"
            >
              {l}
            </span>
          );
        })}
      </div>

      <div className="mt-1.5 text-[11px] text-text-3">
        {unlockedLevel === 0 ? (
          <span>No level unlocked yet — click Level 1 to start the ladder at {SMS_DLC_LEVEL_DAILY_LIMITS[1]}/day.</span>
        ) : (
          <>
            <span className="font-medium text-text-2">
              {activeLevel === 0 ? 'No daily cap right now' : `Active: Level ${activeLevel} — ${SMS_DLC_LEVEL_DAILY_LIMITS[activeLevel]}/day`}
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
                    Hit {ceilingTarget}/day on {metDays}/{UNLOCK_WINDOW_DAYS} of the last {UNLOCK_WINDOW_DAYS} days
                    (need {UNLOCK_MIN_DAYS_MET}) to unlock Level {nextLevel}
                  </span>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
