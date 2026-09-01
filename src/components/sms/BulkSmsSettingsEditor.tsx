import { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useSmsSendSettings, useSaveSmsSendSettings } from '@/hooks/useSmsSendSettings';
import { SMS_NUMBER_KEYS } from '@/lib/smsNumbers';

/** Bulk-send defaults (each number's own daily limit, delay between
 * messages) — set once here instead of re-entering on every send. Every
 * slot is offered regardless of which are actually configured, same as the
 * manual single-send picker — the client has no visibility into that. */
export function BulkSmsSettingsEditor() {
  const { data: settings } = useSmsSendSettings();
  const save = useSaveSmsSendSettings();
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [delaySeconds, setDelaySeconds] = useState('0.4');
  const [totalLimit, setTotalLimit] = useState('0');
  const [saved, setSaved] = useState(false);
  const seededRef = useRef(false);

  useEffect(() => {
    if (!settings || seededRef.current) return;
    seededRef.current = true;
    setLimits(Object.fromEntries(SMS_NUMBER_KEYS.map((k) => [k, String(settings.dailyLimits[k] ?? 0)])));
    setDelaySeconds(String(settings.perMessageDelayMs / 1000));
    setTotalLimit(String(settings.dailyTotalLimit));
  }, [settings]);

  const normalizedLimits = Object.fromEntries(SMS_NUMBER_KEYS.map((k) => [k, Math.max(0, Number(limits[k]) || 0)]));
  const normalizedTotalLimit = Math.max(0, Math.round(Number(totalLimit) || 0));
  const dirty =
    !!settings &&
    (SMS_NUMBER_KEYS.some((k) => normalizedLimits[k] !== (settings.dailyLimits[k] ?? 0)) ||
      Math.round((Number(delaySeconds) || 0) * 1000) !== settings.perMessageDelayMs ||
      normalizedTotalLimit !== settings.dailyTotalLimit);

  async function handleSave() {
    await save.mutateAsync({
      dailyLimits: normalizedLimits,
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
        <p className="mt-1 mb-2 text-[11px] text-text-3">
          The most texts each number will go out from per day, resetting at midnight Pakistan time. Once a number
          hits its own limit, a bulk send rotates to the next one instead, which keeps any single number from
          tripping carrier/10DLC volume filtering. Leave a number at 0 for no cap.
        </p>
        <div className="flex flex-wrap gap-3">
          {SMS_NUMBER_KEYS.map((key) => (
            <label key={key} className="block w-[110px]">
              <span className="text-[11px] text-text-3">Number {key}</span>
              <input
                className="input"
                inputMode="numeric"
                value={limits[key] ?? ''}
                onChange={(e) => setLimits((prev) => ({ ...prev, [key]: e.target.value }))}
              />
            </label>
          ))}
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
