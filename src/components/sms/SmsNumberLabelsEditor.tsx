import { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useSmsNumberLabels, useSaveSmsNumberLabels } from '@/hooks/useSmsNumberLabels';
import { SMS_NUMBER_KEYS } from '@/lib/smsNumbers';

/** Maps each Zoom sending slot (1-6) to its real phone number, purely for
 * display — e.g. so the SMS tab can show "Sending from 217-408-2781" instead
 * of "Sending from Number 3". Not read by any edge function; the real
 * numbers those send from live in Deno env vars server-side. */
export function SmsNumberLabelsEditor() {
  const { data: numbers } = useSmsNumberLabels();
  const save = useSaveSmsNumberLabels();
  const [phones, setPhones] = useState<Record<string, string>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const seededRef = useRef(false);

  useEffect(() => {
    if (!numbers || seededRef.current) return;
    seededRef.current = true;
    setPhones(Object.fromEntries(SMS_NUMBER_KEYS.map((k) => [k, numbers[k]?.phoneNumber ?? ''])));
    setLabels(Object.fromEntries(SMS_NUMBER_KEYS.map((k) => [k, numbers[k]?.label ?? ''])));
  }, [numbers]);

  const dirty =
    !!numbers &&
    SMS_NUMBER_KEYS.some(
      (k) => (phones[k] ?? '') !== (numbers[k]?.phoneNumber ?? '') || (labels[k] ?? '') !== (numbers[k]?.label ?? ''),
    );

  async function handleSave() {
    await save.mutateAsync(
      SMS_NUMBER_KEYS.map((k) => ({ slot: k, phoneNumber: phones[k] ?? '', label: labels[k] ?? '' })),
    );
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-text">SMS sending numbers</div>
          <p className="mt-1 text-[13px] text-text-2">
            The real phone number behind each sending slot, so the SMS tab can show it instead of "Number 3". Label
            is optional.
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

      <div className="mt-3 flex justify-end">
        <button className="btn btn-primary !px-3 !py-1 text-[12px]" onClick={handleSave} disabled={!dirty || save.isPending}>
          {save.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
        </button>
      </div>
    </div>
  );
}
