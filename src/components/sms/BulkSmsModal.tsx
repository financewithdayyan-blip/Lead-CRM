import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, Send } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useSendBulkSms, type BulkSmsResult } from '@/hooks/useSms';
import { useTags } from '@/hooks/useTags';
import type { Lead, Tag } from '@/types/domain';

const PLACEHOLDER_HINT =
  'Use {{first_name}}, {{last_name}}, {{address}}, {{city}}, {{state}}, or {{zip}} — unmatched fields become blank.';

/** UTC 14:00-01:00 is the 7pm-6am PKT cold-outreach window (see send-sms). */
function withinWindow(): boolean {
  const h = new Date().getUTCHours();
  return h >= 14 || h < 1;
}

function nextWindowOpensIn(): string {
  const now = new Date();
  const utcH = now.getUTCHours();
  const utcM = now.getUTCMinutes();
  const minutesNow = utcH * 60 + utcM;
  const opensAt = 14 * 60; // 14:00 UTC
  let diff = opensAt - minutesNow;
  if (diff <= 0) diff += 24 * 60;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return `${h}h ${m}m`;
}

export function BulkSmsModal({ leads, onClose }: { leads: Lead[]; onClose: () => void }) {
  const { data: tags = [] } = useTags();
  const sendBulk = useSendBulkSms();

  const [fromKey, setFromKey] = useState<'1' | '2'>('1');
  const [defaultTemplate, setDefaultTemplate] = useState('');
  const [templatesByTag, setTemplatesByTag] = useState<Record<string, string>>({});
  const [dailyLimit, setDailyLimit] = useState('150');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkSmsResult | null>(null);

  // The window restricts genuine bulk sends only — selecting a single lead
  // here behaves like the thread view's manual reply and always goes through,
  // matching send-sms's own leadIds.length > 1 check.
  const inWindow = leads.length <= 1 || withinWindow();

  // Tags actually present on the selection, so the template list isn't every
  // tag the account has ever created.
  const relevantTags = useMemo(() => {
    const ids = new Set<string>();
    for (const l of leads) for (const id of l.tagIds) ids.add(id);
    return tags.filter((t) => ids.has(t.id));
  }, [leads, tags]);

  const optedOutCount = leads.filter((l) => l.optedOut).length;
  const sendableCount = leads.length - optedOutCount;

  async function handleSend() {
    setError(null);
    try {
      const res = await sendBulk.mutateAsync({
        leadIds: leads.map((l) => l.id),
        templatesByTag,
        defaultTemplate,
        fromKey,
        dailyLimit: Number(dailyLimit) || 0,
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed.');
    }
  }

  return (
    <Modal open onClose={onClose} title="Send Bulk SMS" width="lg">
      {result ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-[13px] text-success">
            <Check size={15} /> Sent {result.sent} message{result.sent !== 1 ? 's' : ''} from {result.from}.
          </div>
          {result.skipped.length > 0 && (
            <div className="rounded-md border border-warning/40 bg-warning-dim px-3 py-2 text-[12px] text-text-2">
              <div className="font-semibold text-warning">{result.skipped.length} skipped</div>
              <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
                {result.skipped.map((s, i) => (
                  <li key={i}>{s.reason}</li>
                ))}
              </ul>
            </div>
          )}
          {result.failed.length > 0 && (
            <div className="rounded-md border border-danger/40 bg-danger-dim px-3 py-2 text-[12px] text-text-2">
              <div className="font-semibold text-danger">{result.failed.length} failed</div>
              <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
                {result.failed.map((f, i) => (
                  <li key={i}>{f.error}</li>
                ))}
              </ul>
            </div>
          )}
          <button className="btn btn-primary w-full justify-center" onClick={onClose}>
            Done
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {!inWindow && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-dim px-3 py-2 text-[13px] text-warning">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <div>
                Outside the cold-outreach window (7pm-6am Pakistan time). Opens in {nextWindowOpensIn()}. The send
                will be rejected until then — this only applies to bulk sends, not AI replies to inbound texts.
              </div>
            </div>
          )}

          <div className="rounded-md border border-border-2 bg-surface-3 px-3 py-2 text-[13px] text-text-2">
            <strong className="text-text">{leads.length}</strong> lead{leads.length !== 1 ? 's' : ''} selected
            {optedOutCount > 0 && (
              <span className="text-text-3"> · {optedOutCount} opted out and will be skipped ({sendableCount} sendable)</span>
            )}
          </div>

          <div>
            <div className="label">Send from</div>
            <div className="flex gap-2">
              <button
                onClick={() => setFromKey('1')}
                className={`btn flex-1 justify-center ${fromKey === '1' ? 'btn-primary' : ''}`}
              >
                Number 1
              </button>
              <button
                onClick={() => setFromKey('2')}
                className={`btn flex-1 justify-center ${fromKey === '2' ? 'btn-primary' : ''}`}
              >
                Number 2
              </button>
            </div>
          </div>

          <div>
            <label className="label">Default message</label>
            <textarea
              className="input min-h-[70px]"
              value={defaultTemplate}
              onChange={(e) => setDefaultTemplate(e.target.value)}
              placeholder="Hi {{first_name}}, this is Bluebird — we buy houses in {{city}} as-is..."
            />
            <p className="mt-1 text-[11px] text-text-3">{PLACEHOLDER_HINT}</p>
          </div>

          {relevantTags.length > 0 && (
            <div>
              <div className="label">Per-tag overrides</div>
              <p className="mb-2 text-[11px] text-text-3">
                Leads carrying one of these tags use its message instead of the default. If a lead has more than one
                tagged template, the first match wins.
              </p>
              <div className="space-y-2">
                {relevantTags.map((t: Tag) => (
                  <div key={t.id}>
                    <div className="mb-1 flex items-center gap-1.5">
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ backgroundColor: t.colorBg, color: t.colorText }}
                      >
                        {t.name}
                      </span>
                    </div>
                    <textarea
                      className="input min-h-[56px] text-[13px]"
                      value={templatesByTag[t.name] ?? ''}
                      onChange={(e) => setTemplatesByTag((p) => ({ ...p, [t.name]: e.target.value }))}
                      placeholder={`Message for ${t.name} leads (falls back to the default if left blank)`}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <label className="block max-w-[220px]">
            <span className="label">Rolling 24h limit for this number</span>
            <input
              className="input"
              inputMode="numeric"
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
            />
          </label>

          {error && (
            <div className="rounded-md border border-danger/40 bg-danger-dim px-3 py-2 text-[13px] text-danger">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <button className="btn" onClick={onClose} disabled={sendBulk.isPending}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSend}
              disabled={sendBulk.isPending || !inWindow || (!defaultTemplate && !Object.values(templatesByTag).some(Boolean))}
            >
              {sendBulk.isPending ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Sending…
                </>
              ) : (
                <>
                  <Send size={14} /> Send to {sendableCount}
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
