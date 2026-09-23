import { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useSmsNumberLabels, useSaveSmsNumberLabels } from '@/hooks/useSmsNumberLabels';
import { useSmsSendSettings, useSaveSmsSendSettings } from '@/hooks/useSmsSendSettings';
import { SMS_NUMBER_KEYS } from '@/lib/smsNumbers';

/** Maps each Zoom sending slot (1-6) to its real phone number, purely for
 * display — e.g. so the SMS tab can show "Sending from 217-408-2781" instead
 * of "Sending from Number 3". Not read by any edge function; the real
 * numbers those send from live in Deno env vars server-side.
 *
 * Also owns the per-message delay — a genuine one-time account default,
 * unlike the per-number level ladder (see SmsNumberLevelsCard, on the Bulk
 * SMS page — that's status you check right before sending, not settings).
 * Saving here reads the rest of sms_send_settings from the query and passes
 * it straight through unchanged, so it can never clobber the levels/limits
 * that card owns. */
export function SmsNumberLabelsEditor() {
  const { data: numbers } = useSmsNumberLabels();
  const saveLabels = useSaveSmsNumberLabels();
  const { data: sendSettings } = useSmsSendSettings();
  const saveSendSettings = useSaveSmsSendSettings();
  const [phones, setPhones] = useState<Record<string, string>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [delaySeconds, setDelaySeconds] = useState('0.4');
  const [saved, setSaved] = useState(false);
  const seededRef = useRef(false);
  const delaySeededRef = useRef(false);

  useEffect(() => {
    if (!numbers || seededRef.current) return;
    seededRef.current = true;
    setPhones(Object.fromEntries(SMS_NUMBER_KEYS.map((k) => [k, numbers[k]?.phoneNumber ?? ''])));
    setLabels(Object.fromEntries(SMS_NUMBER_KEYS.map((k) => [k, numbers[k]?.label ?? ''])));
  }, [numbers]);

  useEffect(() => {
    if (!sendSettings || delaySeededRef.current) return;
    delaySeededRef.current = true;
    setDelaySeconds(String(sendSettings.perMessageDelayMs / 1000));
  }, [sendSettings]);

  const normalizedDelayMs = Math.max(0, Math.round((Number(delaySeconds) || 0) * 1000));
  const dirty =
    (!!numbers &&
      SMS_NUMBER_KEYS.some(
        (k) => (phones[k] ?? '') !== (numbers[k]?.phoneNumber ?? '') || (labels[k] ?? '') !== (numbers[k]?.label ?? ''),
      )) ||
    (!!sendSettings && normalizedDelayMs !== sendSettings.perMessageDelayMs);

  async function handleSave() {
    await Promise.all([
      saveLabels.mutateAsync(SMS_NUMBER_KEYS.map((k) => ({ slot: k, phoneNumber: phones[k] ?? '', label: labels[k] ?? '' }))),
      sendSettings ? saveSendSettings.mutateAsync({ ...sendSettings, perMessageDelayMs: normalizedDelayMs }) : Promise.resolve(),
    ]);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-text">Bulk SMS sending defaults</div>
          <p className="mt-1 text-[13px] text-text-2">
            The real phone number behind each sending slot, plus the pause between messages during a bulk send.
          </p>
        </div>
        {saved && (
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-success">
            <Check size={11} /> Saved
          </span>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {SMS_NUMBER_KEYS.map((key) => (
          <div key={key} className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-[12px] text-text-3">Number {key}</span>
            <input
              className="input flex-1"
              placeholder="Phone number, e.g. 2174082781"
              value={phones[key] ?? ''}
              onChange={(e) => setPhones((prev) => ({ ...prev, [key]: e.target.value }))}
            />
            <input
              className="input w-40"
              placeholder="Label (optional)"
              value={labels[key] ?? ''}
              onChange={(e) => setLabels((prev) => ({ ...prev, [key]: e.target.value }))}
            />
          </div>
        ))}
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
        <button
          className="btn btn-primary !px-3 !py-1 text-[12px]"
          onClick={handleSave}
          disabled={!dirty || saveLabels.isPending || saveSendSettings.isPending}
        >
          {saveLabels.isPending || saveSendSettings.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
        </button>
      </div>
    </div>
  );
}
