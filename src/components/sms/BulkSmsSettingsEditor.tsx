import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Lock } from 'lucide-react';
import { useSmsSendSettings, useSaveSmsSendSettings } from '@/hooks/useSmsSendSettings';
import { useSmsNumberLabels } from '@/hooks/useSmsNumberLabels';
import { useSmsLevelUnlockProgress } from '@/hooks/useSmsLevelUnlockProgress';
import { SMS_NUMBER_KEYS } from '@/lib/smsNumbers';
import { SMS_DLC_LEVELS, SMS_DLC_LEVEL_DAILY_LIMITS, SMS_DLC_MAX_LEVEL } from '@/lib/smsDlcLevels';

const UNLOCK_WINDOW_DAYS = 7;
const UNLOCK_MIN_DAYS_MET = 6;

/** Bulk-send defaults (each number's own daily limit, delay between
 * messages) — set once here instead of re-entering on every send. Every
 * slot is offered regardless of which are actually configured, same as the
 * manual single-send picker — the client has no visibility into that. */
export function BulkSmsSettingsEditor() {
  const { data: settings } = useSmsSendSettings();
  const { data: labels } = useSmsNumberLabels();
  const save = useSaveSmsSendSettings();
  const [activeLevels, setActiveLevels] = useState<Record<string, number>>({});
  const [unlockedLevels, setUnlockedLevels] = useState<Record<string, number>>({});
  const [delaySeconds, setDelaySeconds] = useState('0.4');
  const [totalLimit, setTotalLimit] = useState('0');
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
    setDelaySeconds(String(settings.perMessageDelayMs / 1000));
    setTotalLimit(String(settings.dailyTotalLimit));
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
  const normalizedTotalLimit = Math.max(0, Math.round(Number(totalLimit) || 0));
  const dirty =
    !!settings &&
    (SMS_NUMBER_KEYS.some((k) => (activeLevels[k] ?? 0) !== (settings.dailyLimitLevels[k] ?? 0)) ||
      SMS_NUMBER_KEYS.some((k) => (unlockedLevels[k] ?? 0) !== (settings.dailyLimitUnlockedLevels[k] ?? 0)) ||
      Math.round((Number(delaySeconds) || 0) * 1000) !== settings.perMessageDelayMs ||
      normalizedTotalLimit !== settings.dailyTotalLimit);

  async function handleSave() {
    await save.mutateAsync({
      dailyLimits: normalizedDailyLimits,
      dailyLimitLevels: activeLevels,
      dailyLimitUnlockedLevels: unlockedLevels,
      perMessageDelayMs: Math.max(0, Math.round((Number(delaySeconds) || 0) * 1000)),
      dailyTotalLimit: normalizedTotalLimit,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-text">Bulk SMS sending defaults</div>
          <p className="mt-1 text-[13px] text-text-2">
            Pre-fills the Send Bulk SMS dialog every time — set once instead of re-entering it on every send.
          </p>
        </div>
        {saved && (
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-success">
            <Check size={11} /> Saved
          </span>
        )}
      </div>

      <div className="mt-3">
        <span className="label">Daily limit per number</span>
        <p className="mt-1 mb-3 text-[11px] text-text-3">
          Each number climbs a 10DLC throughput ladder instead of a flat guessed number — Level 1 starts at{' '}
          {SMS_DLC_LEVEL_DAILY_LIMITS[1]}/day. Unlocking the next level needs that day's target actually hit on{' '}
          {UNLOCK_MIN_DAYS_MET} of the last {UNLOCK_WINDOW_DAYS} days (one miss allowed), matching how carriers raise
          a number's real sending limit over time.
        </p>
        <div className="flex flex-col gap-3">
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
      </div>

      <div className="mt-4">
        <label className="block max-w-[240px]">
          <span className="label">Daily total SMS limit</span>
          <input
            className="input"
            inputMode="numeric"
            value={totalLimit}
            onChange={(e) => setTotalLimit(e.target.value)}
          />
          <p className="mt-1 text-[11px] text-text-3">
            The most leads a single bulk send will ever queue, across every number combined, no matter how many are
            selected in the Pipeline — selecting all 7,000 in a column with this set to 1,800 only queues the first
            1,800. Leave at 0 for no cap.
          </p>
        </label>
      </div>

      <div className="mt-4">
        <label className="block max-w-[200px]">
          <span className="label">Delay between messages</span>
          <div className="flex items-center gap-1.5">
            <input
              className="input"
              inputMode="decimal"
              value={delaySeconds}
              onChange={(e) => setDelaySeconds(e.target.value)}
            />
            <span className="text-[12px] text-text-3">sec</span>
          </div>
          <p className="mt-1 text-[11px] text-text-3">
            Pause between each text sent from the same number, so a bulk run doesn't fire messages back to back.
          </p>
        </label>
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
                className={`h-7 min-w-[28px] rounded-full px-2 text-[11px] font-semibold transition ${
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
                className={`flex h-7 min-w-[28px] items-center justify-center gap-0.5 rounded-full px-2 text-[11px] font-semibold transition ${
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
              className="flex h-7 min-w-[28px] items-center justify-center rounded-full bg-bg-2 px-2 text-[11px] text-text-3/50"
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
