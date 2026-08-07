import { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useSmsSendSettings, useSaveSmsSendSettings } from '@/hooks/useSmsSendSettings';

/** Bulk-send defaults (rolling daily limit per number, delay between
 * messages) — set once here instead of re-entering on every send. */
export function BulkSmsSettingsEditor() {
  const { data: settings } = useSmsSendSettings();
  const save = useSaveSmsSendSettings();
  const [dailyLimit, setDailyLimit] = useState('150');
  const [delaySeconds, setDelaySeconds] = useState('0.4');
  const [saved, setSaved] = useState(false);
  const seededRef = useRef(false);

  useEffect(() => {
    if (!settings || seededRef.current) return;
    seededRef.current = true;
    setDailyLimit(String(settings.dailyLimitPerNumber));
    setDelaySeconds(String(settings.perMessageDelayMs / 1000));
  }, [settings]);

  const dirty =
    !!settings &&
    (Number(dailyLimit) !== settings.dailyLimitPerNumber ||
      Math.round((Number(delaySeconds) || 0) * 1000) !== settings.perMessageDelayMs);

  async function handleSave() {
    await save.mutateAsync({
      dailyLimitPerNumber: Math.max(0, Number(dailyLimit) || 0),
      perMessageDelayMs: Math.max(0, Math.round((Number(delaySeconds) || 0) * 1000)),
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

      <div className="mt-3 flex flex-wrap gap-4">
        <label className="block max-w-[260px]">
          <span className="label">Rolling 24h limit per number</span>
          <input className="input" inputMode="numeric" value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} />
          <p className="mt-1 text-[11px] text-text-3">
            The most texts any one sending number will go out from in any trailing 24 hours — a sliding window, not a
            midnight reset. Once a number hits it, a bulk send rotates to the next configured number instead, which
            keeps any single number from tripping carrier/10DLC volume filtering.
          </p>
        </label>

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
