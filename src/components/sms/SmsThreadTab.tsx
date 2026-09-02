import { useMemo, useState } from 'react';
import { Image as ImageIcon, Loader2, MessageSquare, Send, ThumbsUp } from 'lucide-react';
import { useLeadThread, useSendManualReply } from '@/hooks/useLeadMessages';
import { useSignedFileUrls } from '@/hooks/useLeadFiles';
import { useAiSettings } from '@/hooks/useAiSettings';
import { useSmsNumberLabels } from '@/hooks/useSmsNumberLabels';
import { formatDateTime, formatPhone } from '@/lib/utils';
import { SMS_NUMBER_KEYS, type SmsNumberKey } from '@/lib/smsNumbers';
import type { Lead } from '@/types/domain';

// ai-reply only ever texts a lead sitting in Contacted, Replied, or On Hold
// — any later stage (Qualified, Follow-Up, Negotiation, ...) is silent
// regardless of ai_reply_paused, since a manual Kanban drag or a deal
// handled entirely by phone never touches that flag. Mirrored here so the
// chip doesn't claim "auto-replying" for a lead the AI will actually never
// text again. On Hold leads now stay on that stage through their entire AI
// conversation (migration 0130) rather than moving to Replied/Partial
// Qualified, so it's included outright rather than only via
// photoWaitAiActive; ai_reply_paused (true by default the moment a lead
// enters On Hold) is what actually keeps a silent, never-replied one quiet.
// Partial Qualified (initial_contact) is the other stage gated only via
// photoWaitAiActive rather than being in this set outright — a lead sitting
// there any other way (a manual drag, say) still reads as paused.
const AI_ACTIVE_STAGES = new Set(['contacted', 'replied', 'onhold']);

/**
 * Explains *why* AI is or isn't replying, checking the same gates ai-reply
 * itself checks and in the same order: the global toggle first, then this
 * lead's own pause flag, then its stage. Saying only "paused" leaves an
 * admin guessing which of the independent gates is responsible.
 */
function AiStatusChip({ lead, globalEnabled }: { lead: Lead; globalEnabled: boolean }) {
  if (lead.optedOut) return null; // "Opted out" already covers this case on its own.
  if (!globalEnabled) {
    return (
      <span className="rounded-full bg-border-2 px-2 py-0.5 font-semibold text-text-2" title="Auto-reply is switched off account-wide in Settings.">
        AI off (account-wide)
      </span>
    );
  }
  const photoWaitActive = (lead.stage === 'initial_contact' || lead.stage === 'onhold') && lead.photoWaitAiActive;
  const stageAllows = AI_ACTIVE_STAGES.has(lead.stage) || photoWaitActive;
  const effectivelyPaused = lead.aiReplyPaused && !photoWaitActive;
  if (effectivelyPaused || !stageAllows) {
    return (
      <span className="rounded-full bg-warning-dim px-2 py-0.5 font-semibold text-warning" title="Paused for this lead specifically — fully qualified, past the AI-active stages, or a human already replied by hand.">
        AI paused (this lead)
      </span>
    );
  }
  return (
    <span className="rounded-full bg-success/15 px-2 py-0.5 font-semibold text-success" title={photoWaitActive ? 'Still chasing photos or a callback time for this lead.' : undefined}>
      AI auto-replying
    </span>
  );
}

export function SmsThreadTab({ lead }: { lead: Lead }) {
  const { data: thread = [], isLoading } = useLeadThread(lead.id);
  const { data: aiSettings } = useAiSettings();
  const { data: numberLabels } = useSmsNumberLabels();
  const sendReply = useSendManualReply();
  const [message, setMessage] = useState('');
  const [fromKey, setFromKey] = useState<SmsNumberKey>('1');
  const [error, setError] = useState<string | null>(null);

  function displayNumber(key: SmsNumberKey) {
    const phone = numberLabels?.[key]?.phoneNumber;
    return phone ? formatPhone(phone).replace(/^\+1/, '') : `Number ${key}`;
  }

  const realMessages = thread.filter((m) => !m.isReaction);
  // Only messages re-hosted after the MMS-viewing fix have a storage_path —
  // older ones only ever had Zoom's download_url, which is dead within 30
  // minutes of being received and can't be recovered.
  const attachmentPaths = useMemo(
    () => thread.flatMap((m) => m.attachments.map((a) => a.storage_path).filter((p): p is string => !!p)),
    [thread],
  );
  const { data: attachmentUrls = {} } = useSignedFileUrls(attachmentPaths);
  // Once a lead has been texted, every send after that — bulk or manual —
  // sticks to that same number server-side regardless of what's picked here.
  // The picker only matters, and only shows, before that first send exists.
  const pinnedNumber = lead.assignedSmsNumber as SmsNumberKey | null;

  function handleSend() {
    if (!message.trim()) return;
    const text = message.trim();
    // Clears immediately rather than waiting on the round trip — the message
    // itself already appears in the thread right away too (useSendManualReply's
    // own optimistic update), so there's nothing left to visibly wait on
    // unless the send actually fails, in which case the draft comes back.
    setMessage('');
    setError(null);
    sendReply.mutate(
      { leadId: lead.id, body: text, fromKey: pinnedNumber ?? fromKey },
      {
        onError: (e) => {
          setError(e instanceof Error ? e.message : 'Send failed.');
          setMessage(text);
        },
      },
    );
  }

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-text">
          <MessageSquare size={15} /> SMS Thread
        </h2>
        <div className="flex items-center gap-2 text-[12px] text-text-3">
          {lead.optedOut && (
            <span className="rounded-full bg-danger-dim px-2 py-0.5 font-semibold text-danger">Opted out</span>
          )}
          <AiStatusChip lead={lead} globalEnabled={aiSettings?.autoReplyEnabled ?? true} />
          <span>
            {realMessages.filter((m) => m.direction === 'inbound').length} repl
            {realMessages.filter((m) => m.direction === 'inbound').length === 1 ? 'y' : 'ies'}
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Loading conversation…
        </div>
      ) : thread.length === 0 ? (
        <div className="py-8 text-center text-[13px] text-text-3">No texts with this lead yet.</div>
      ) : (
        <div className="max-h-[420px] space-y-2 overflow-y-auto rounded-md border border-border-2 bg-surface-3 p-3">
          {thread.map((m) => (
            <div key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[75%] rounded-lg px-3 py-2 text-[13px] ${
                  m.isReaction
                    ? 'border border-dashed border-border-2 bg-surface text-text-3 italic'
                    : m.direction === 'outbound'
                      ? 'bg-primary text-white'
                      : 'border border-border-2 bg-surface text-text'
                }`}
              >
                {m.isReaction && <ThumbsUp size={11} className="mb-1 inline-block opacity-60" />}
                <div className="whitespace-pre-wrap">{m.body}</div>
                {m.hasAttachments && m.attachments.length === 0 && (
                  <div className={`mt-1 flex items-center gap-1 text-[11px] ${m.direction === 'outbound' ? 'text-white/70' : 'text-text-3'}`}>
                    <ImageIcon size={11} /> Attachment (MMS)
                  </div>
                )}
                {m.attachments.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {m.attachments.map((att, i) => {
                      const url = att.storage_path ? attachmentUrls[att.storage_path] : undefined;
                      return url ? (
                        <a key={i} href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-border-2">
                          <img src={url} alt={att.name || 'MMS attachment'} className="h-28 w-28 object-cover" />
                        </a>
                      ) : (
                        <div
                          key={i}
                          className={`flex items-center gap-1 text-[11px] ${m.direction === 'outbound' ? 'text-white/70' : 'text-text-3'}`}
                          title={att.storage_path === undefined ? 'Sent before MMS viewing was supported — no longer retrievable.' : undefined}
                        >
                          <ImageIcon size={11} /> Attachment (MMS)
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className={`mt-0.5 text-[10px] ${m.direction === 'outbound' ? 'text-white/60' : 'text-text-3'}`}>
                  {formatDateTime(m.at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {lead.optedOut ? (
        <div className="mt-3 rounded-md border border-danger/40 bg-danger-dim px-3 py-2 text-[12px] text-danger">
          This lead opted out — sending is disabled to respect that.
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <textarea
              className="input min-h-[60px] flex-1"
              placeholder="Type a reply…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            {pinnedNumber ? (
              <span
                className="rounded-full bg-border-2 px-2 py-1 text-[12px] font-semibold text-text-2"
                title="This lead's whole thread lives on this number — every reply keeps going out from it."
              >
                Sending from {displayNumber(pinnedNumber)}
              </span>
            ) : (
              <div className="flex gap-1">
                {SMS_NUMBER_KEYS.map((key) => (
                  <button
                    key={key}
                    onClick={() => setFromKey(key)}
                    className={`btn !px-2 !py-1 text-[12px] ${fromKey === key ? 'btn-primary' : ''}`}
                  >
                    {displayNumber(key)}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={handleSend}
              disabled={sendReply.isPending || !message.trim()}
              className="btn btn-primary flex items-center gap-1.5"
            >
              {sendReply.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              Send
            </button>
          </div>
          {error && (
            <div className="rounded-md border border-danger/40 bg-danger-dim px-3 py-2 text-[12px] text-danger">{error}</div>
          )}
          <p className="text-[11px] text-text-3">
            A single reply like this always goes out, any time of day — only bulk sends respect the 7pm-6am
            Pakistan-time window. Sending here pauses AI auto-reply on this lead.
          </p>
        </div>
      )}
    </div>
  );
}
