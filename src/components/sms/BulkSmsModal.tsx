import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Loader2, Send } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useCreateBulkSmsJob, useSendBulkSms } from '@/hooks/useSms';
import { useTags } from '@/hooks/useTags';
import { useSmsTemplates } from '@/hooks/useSmsTemplates';
import { useSmsSendSettings, DEFAULT_SMS_SEND_SETTINGS } from '@/hooks/useSmsSendSettings';
import { MergeTagButtons } from './MergeTagButtons';
import { SMS_NUMBER_KEYS, type SmsNumberKey } from '@/lib/smsNumbers';
import type { Lead, Tag } from '@/types/domain';

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

export function BulkSmsModal({ leads: selectedLeads, onClose }: { leads: Lead[]; onClose: () => void }) {
  const navigate = useNavigate();
  const { data: tags = [] } = useTags();
  const { data: savedTemplates = [], isSuccess: templatesLoaded } = useSmsTemplates();
  const { data: sendSettings } = useSmsSendSettings();
  const sendBulk = useSendBulkSms();
  const createJob = useCreateBulkSmsJob();

  // Caps how many of the selected leads this send will ever actually queue,
  // so selecting an entire large Kanban column (e.g. all 7,000 in Cold) is
  // safe to do by hand — the first dailyTotalLimit leads (in selection
  // order) go into the job, the rest are simply left selected but untouched.
  // Only kicks in for a genuine bulk send, same as the window check below —
  // a single manual send is never capped.
  const dailyTotalLimit = sendSettings?.dailyTotalLimit ?? 0;
  const isCapped = dailyTotalLimit > 0 && selectedLeads.length > 1 && selectedLeads.length > dailyTotalLimit;
  const leads = useMemo(
    () => (isCapped ? selectedLeads.slice(0, dailyTotalLimit) : selectedLeads),
    [selectedLeads, isCapped, dailyTotalLimit],
  );

  const [fromKey, setFromKey] = useState<SmsNumberKey>('1');
  const [defaultTemplate, setDefaultTemplate] = useState('');
  const [templatesByTag, setTemplatesByTag] = useState<Record<string, string>>({});
  const [dailyLimits, setDailyLimits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const defaultTextareaRef = useRef<HTMLTextAreaElement>(null);
  const tagTextareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  // Pre-fills from the saved Settings default, once, the same guarded
  // pattern used for the message templates below — never overwrites
  // something the admin has already changed once the setting loads in.
  const settingsSeededRef = useRef(false);
  useEffect(() => {
    if (settingsSeededRef.current || !sendSettings) return;
    settingsSeededRef.current = true;
    setDailyLimits(Object.fromEntries(SMS_NUMBER_KEYS.map((k) => [k, String(sendSettings.dailyLimits[k] ?? 0)])));
  }, [sendSettings]);

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

  // Pre-fills from whatever's saved in Settings, once — composing a send is
  // then normally just picking leads and hitting Send, not retyping a
  // message from scratch. A guard rather than a dependency on the (empty by
  // default) template arrays themselves, so it never overwrites something
  // the admin has already started editing once the query resolves.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !templatesLoaded) return;
    seededRef.current = true;
    const byTagId = new Map(savedTemplates.map((t) => [t.tagId, t]));
    const defaultSaved = byTagId.get(null)?.body;
    if (defaultSaved) setDefaultTemplate(defaultSaved);
    const perTag: Record<string, string> = {};
    for (const tag of relevantTags) {
      const saved = byTagId.get(tag.id)?.body;
      if (saved) perTag[tag.name] = saved;
    }
    if (Object.keys(perTag).length) setTemplatesByTag((prev) => ({ ...perTag, ...prev }));
  }, [templatesLoaded, savedTemplates, relevantTags]);

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
      const perMessageDelayMs = sendSettings?.perMessageDelayMs ?? DEFAULT_SMS_SEND_SETTINGS.perMessageDelayMs;
      const normalizedLimits = Object.fromEntries(
        SMS_NUMBER_KEYS.map((k) => [k, Math.max(0, Number(dailyLimits[k]) || 0)]),
      );
      const job = await createJob.mutateAsync({
        leads,
        config: { templatesByTag, defaultTemplate, fromKey, dailyLimits: normalizedLimits, perMessageDelayMs },
      });

      // Not awaited: send-sms keeps running server-side and writes its own
      // progress into bulk_sms_job_items as it goes (including marking the
      // job itself 'failed' with a reason for a same-turn problem like being
      // outside the sending window) — the Bulk SMS page picks all of that up
      // by polling, so this modal doesn't need to stay open to see it. This
      // tab does need to stay open (or the admin needs to hit Resume later)
      // until the whole send finishes — see BULK_CHUNK_SIZE's note in
      // useSms.ts for why a fully server-side version of this was reverted.
      sendBulk.mutate({
        leadIds: leads.map((l) => l.id),
        templatesByTag,
        defaultTemplate,
        fromKey,
        dailyLimits: normalizedLimits,
        perMessageDelayMs,
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

          {isCapped && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-dim px-3 py-2 text-[13px] text-warning">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <div>
                {selectedLeads.length.toLocaleString()} leads were selected, capped to the first{' '}
                {dailyTotalLimit.toLocaleString()} per your daily SMS limit (Settings → Bulk SMS). The rest stay
                selected in the Pipeline — send again tomorrow, or raise the limit in Settings.
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
              Rotates through every configured sending number one lead at a time (1, 2, 3, 4, 1, 2, …), skipping a
              number once it hits its own rolling 24h limit below.
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
              ref={defaultTextareaRef}
              className="input min-h-[70px]"
              value={defaultTemplate}
              onChange={(e) => setDefaultTemplate(e.target.value)}
              placeholder="Hi {{first_name}}, this is Bluebird — we buy houses in {{city}} as-is..."
            />
            <div className="mt-1.5">
              <MergeTagButtons
                getTextarea={() => defaultTextareaRef.current}
                value={defaultTemplate}
                onChange={setDefaultTemplate}
              />
            </div>
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
                      ref={(el) => {
                        tagTextareaRefs.current[t.name] = el;
                      }}
                      className="input min-h-[56px] text-[13px]"
                      value={templatesByTag[t.name] ?? ''}
                      onChange={(e) => setTemplatesByTag((p) => ({ ...p, [t.name]: e.target.value }))}
                      placeholder={`Message for ${t.name} leads (falls back to the default if left blank)`}
                    />
                    <div className="mt-1">
                      <MergeTagButtons
                        getTextarea={() => tagTextareaRefs.current[t.name] ?? null}
                        value={templatesByTag[t.name] ?? ''}
                        onChange={(v) => setTemplatesByTag((p) => ({ ...p, [t.name]: v }))}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <span className="label">Rolling 24h limit per number</span>
            <p className="mt-1 mb-2 text-[11px] text-text-3">
              The most texts each number will send in any trailing 24 hours before this send rotates to the next
              one. Pre-filled from Settings — change it there to update the default for every future send.
            </p>
            <div className="flex flex-wrap gap-3">
              {SMS_NUMBER_KEYS.map((key) => (
                <label key={key} className="block w-[100px]">
                  <span className="text-[11px] text-text-3">Number {key}</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={dailyLimits[key] ?? ''}
                    onChange={(e) => setDailyLimits((prev) => ({ ...prev, [key]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
          </div>

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
