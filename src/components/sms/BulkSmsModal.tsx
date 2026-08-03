import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Loader2, Send } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useCreateBulkSmsJob, useSendBulkSms } from '@/hooks/useSms';
import { useTags } from '@/hooks/useTags';
import { SMS_NUMBER_KEYS, type SmsNumberKey } from '@/lib/smsNumbers';
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
  const navigate = useNavigate();
  const { data: tags = [] } = useTags();
  const sendBulk = useSendBulkSms();
  const createJob = useCreateBulkSmsJob();

  const [fromKey, setFromKey] = useState<SmsNumberKey>('1');
  const [defaultTemplate, setDefaultTemplate] = useState('');
  const [templatesByTag, setTemplatesByTag] = useState<Record<string, string>>({});
  const [dailyLimit, setDailyLimit] = useState('150');
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

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
    setStarting(true);
    try {
      // Created up front so the Bulk SMS page has a job to show — and
      // navigating there is itself what "starting" the send means — rather
      // than waiting out the whole batch inside this modal before anything
      // is visible at all.
      const job = await createJob.mutateAsync(leads);

      // Not awaited: send-sms keeps running server-side and writes its own
      // progress into bulk_sms_job_items as it goes (including marking the
      // job itself 'failed' with a reason for a same-turn problem like being
      // outside the sending window) — the Bulk SMS page picks all of that up
      // by polling, so this modal doesn't need to stay open to see it.
      sendBulk.mutate({
        leadIds: leads.map((l) => l.id),
        templatesByTag,
        defaultTemplate,
        fromKey,
        dailyLimit: Number(dailyLimit) || 0,
        jobId: job.id,
      });

      navigate(`/bulk-sms/${job.id}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the send.');
      setStarting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Send Bulk SMS" width="lg">
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

          {leads.length > 1 ? (
            <div className="rounded-md border border-border-2 bg-surface-3 px-3 py-2 text-[12px] text-text-2">
              Splits evenly across every configured sending number, switching to the next once one reaches its
              rolling 24h limit below.
            </div>
          ) : (
            <div>
              <div className="label">Send from</div>
              <div className="flex gap-2">
                {SMS_NUMBER_KEYS.map((key) => (
                  <button
                    key={key}
                    onClick={() => setFromKey(key)}
                    className={`btn flex-1 justify-center ${fromKey === key ? 'btn-primary' : ''}`}
                  >
                    Number {key}
                  </button>
                ))}
              </div>
            </div>
          )}

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
            <span className="label">Rolling 24h limit per number</span>
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
            <button className="btn" onClick={onClose} disabled={starting}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSend}
              disabled={starting || !inWindow || (!defaultTemplate && !Object.values(templatesByTag).some(Boolean))}
            >
              {starting ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Starting…
                </>
              ) : (
                <>
                  <Send size={14} /> Send to {sendableCount}
                </>
              )}
            </button>
          </div>
        </div>
    </Modal>
  );
}
