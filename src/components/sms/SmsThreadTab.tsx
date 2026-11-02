import { useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Bot, Image as ImageIcon, Loader2, MessageSquare, Send, ThumbsUp } from 'lucide-react';
import { useLeadThread, useSendManualReply, type ThreadMessage } from '@/hooks/useLeadMessages';
import { useSignedFileUrls } from '@/hooks/useLeadFiles';
import { useAiSettings } from '@/hooks/useAiSettings';
import { useUpdateLead } from '@/hooks/useLeads';
import { useSmsNumberLabels } from '@/hooks/useSmsNumberLabels';
import { useTags } from '@/hooks/useTags';
import { useSmsTemplates } from '@/hooks/useSmsTemplates';
import { MergeTagButtons } from './MergeTagButtons';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import { Switch } from '@/components/ui/Switch';
import { formatDateTime, formatPhone } from '@/lib/utils';
import { SMS_NUMBER_KEYS, type SmsNumberKey } from '@/lib/smsNumbers';
import type { Lead } from '@/types/domain';

// ai-reply only ever texts a lead sitting in Contacted, Replied, or On Hold
// — any later stage (Qualified, Follow-Up, Negotiation, ...) is silent
// regardless of ai_reply_paused, since a manual Kanban drag or a deal
// handled entirely by phone never touches that flag. On Hold leads now stay
// on that stage through their entire AI conversation (migration 0130)
// rather than moving to Replied/Partial Qualified, so it's included outright
// rather than only via photoWaitAiActive; ai_reply_paused (true by default
// the moment a lead enters On Hold) is what actually keeps a silent,
// never-replied one quiet. Partial Qualified (initial_contact) is the other
// stage gated only via photoWaitAiActive rather than being in this set
// outright — a lead sitting there any other way (a manual drag, say) still
// reads as paused.
const AI_ACTIVE_STAGES = new Set(['contacted', 'replied', 'onhold']);

type AiState = 'optedOut' | 'off' | 'pausedLead' | 'active';

/** Same gating ai-reply itself checks, in the same order, shared by the
 * header chip and the sidebar toggle card so the two can never disagree
 * about why the AI is or isn't replying. */
function aiStatusFor(lead: Lead, globalEnabled: boolean): { state: AiState; label: string; detail: string; canToggle: boolean } {
  if (lead.optedOut) {
    return { state: 'optedOut', label: 'Opted out', detail: 'This lead opted out — the AI will never text them again.', canToggle: false };
  }
  if (!globalEnabled) {
    return { state: 'off', label: 'AI off (account-wide)', detail: 'Auto-reply is switched off account-wide in Settings.', canToggle: false };
  }
  const photoWaitActive = (lead.stage === 'initial_contact' || lead.stage === 'onhold') && lead.photoWaitAiActive;
  const stageAllows = AI_ACTIVE_STAGES.has(lead.stage) || photoWaitActive;
  const effectivelyPaused = lead.aiReplyPaused && !photoWaitActive;
  if (effectivelyPaused || !stageAllows) {
    return {
      state: 'pausedLead',
      label: 'AI paused (this lead)',
      detail: !stageAllows
        ? "Past the stages the AI replies in (fully qualified, negotiating, or further along) — it won't text this lead again regardless of the switch below."
        : 'A human already replied by hand (or this lead fully qualified) — flip the switch to let the AI pick the conversation back up.',
      canToggle: stageAllows,
    };
  }
  return {
    state: 'active',
    label: 'AI auto-replying',
    detail: photoWaitActive ? 'Still chasing photos or a callback time for this lead.' : 'The AI will keep replying to this lead automatically.',
    canToggle: true,
  };
}

/** A real toggle for this lead's own ai_reply_paused flag sitting right
 * where the status used to be a plain pill — no separate card needed for
 * one switch. Disabled (with the reason in its title) whenever flipping it
 * genuinely wouldn't change anything, same cases the old "Resume AI" link
 * only rendered for. */
function AiStatusToggle({ lead, globalEnabled }: { lead: Lead; globalEnabled: boolean }) {
  const updateLead = useUpdateLead();
  const status = aiStatusFor(lead, globalEnabled);
  const checked = status.state === 'active';
  const textCls =
    status.state === 'optedOut'
      ? 'text-danger'
      : status.state === 'off'
        ? 'text-text-2'
        : status.state === 'pausedLead'
          ? 'text-warning'
          : 'text-success';

  return (
    <div className="flex items-center gap-2" title={status.detail}>
      <Switch
        checked={checked}
        disabled={!status.canToggle || updateLead.isPending}
        onChange={() => updateLead.mutate({ id: lead.id, aiReplyPaused: checked })}
        label="AI auto-reply for this lead"
      />
      <span className={`text-[11.5px] font-semibold ${textCls}`}>{status.label}</span>
    </div>
  );
}

/** The account's default template plus any template matching one of this
 * lead's own tags — the same sms_bulk_templates a bulk send would use, just
 * offered here as a quick way to start a manual reply instead of typing one
 * from scratch. Returns null (renders nothing) when none apply. */
function TemplatesMenu({ lead, onPick }: { lead: Lead; onPick: (body: string) => void }) {
  const { data: tags = [] } = useTags();
  const { data: templates = [] } = useSmsTemplates();

  const options = useMemo(() => {
    const defaultTemplate = templates.find((t) => t.tagId === null);
    const leadTagNames = new Set(tags.filter((t) => lead.tagIds.includes(t.id)).map((t) => t.id));
    const tagged = templates.filter((t) => t.tagId !== null && leadTagNames.has(t.tagId));
    const list: Array<{ label: string; body: string }> = [];
    if (defaultTemplate?.body) list.push({ label: 'Default', body: defaultTemplate.body });
    for (const t of tagged) {
      const tag = tags.find((tg) => tg.id === t.tagId);
      if (tag && t.body) list.push({ label: tag.name, body: t.body });
    }
    return list;
  }, [lead.tagIds, tags, templates]);

  if (options.length === 0) return null;

  return (
    <DropdownMenu
      align="start"
      width="w-64"
      trigger={({ onClick, ref }) => (
        <button ref={ref} type="button" className="btn !px-2.5 !py-1.5 text-[12px]" onClick={onClick}>
          Templates
        </button>
      )}
    >
      {(close) => (
        <>
          {options.map((o) => (
            <button
              key={o.label}
              className="block w-full px-3 py-2 text-left hover:bg-surface-3"
              onClick={() => {
                onPick(o.body);
                close();
              }}
            >
              <div className="text-[12px] font-semibold text-text">{o.label}</div>
              <div className="mt-0.5 truncate text-[11.5px] text-text-3">{o.body}</div>
            </button>
          ))}
        </>
      )}
    </DropdownMenu>
  );
}

type ThreadItem = { kind: 'day'; key: string; label: string } | { kind: 'msg'; key: string; msg: ThreadMessage };

// A WhatsApp-style wallpaper for the thread itself — dark base + a faint
// tiled line pattern, always dark regardless of the app's light/dark theme
// (purely decorative, so it doesn't need to track the theme tokens the rest
// of the UI does).
const CHAT_BG_PATTERN =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 200 200'%3E%3Cg fill='none' stroke='%23262c40' stroke-width='1.4' stroke-linecap='round' stroke-opacity='0.6'%3E%3Cpath d='M-10 20 C 20 0, 40 40, 70 20 S 130 0, 160 20 S 220 40, 210 20'/%3E%3Cpath d='M-10 60 C 15 85, 50 40, 80 60 S 140 90, 170 60 S 215 35, 210 60'/%3E%3Cpath d='M-10 100 C 25 120, 55 75, 90 100 S 150 130, 175 100 S 210 70, 210 100'/%3E%3Cpath d='M-10 140 C 20 160, 50 115, 85 140 S 145 170, 175 140 S 215 110, 210 140'/%3E%3Cpath d='M-10 180 C 15 200, 60 155, 95 180 S 150 210, 180 180 S 210 150, 210 180'/%3E%3Cpath d='M20 -10 C 0 20, 40 40, 20 70 S 0 130, 20 160 S 40 195, 20 200'/%3E%3Cpath d='M100 -10 C 80 20, 120 40, 100 70 S 80 130, 100 160 S 120 195, 100 200'/%3E%3Cpath d='M180 -10 C 160 20, 200 40, 180 70 S 160 130, 180 160 S 200 195, 180 200'/%3E%3C/g%3E%3C/svg%3E";

export function SmsThreadTab({ lead }: { lead: Lead }) {
  const { data: thread = [], isLoading } = useLeadThread(lead.id);
  const { data: aiSettings } = useAiSettings();
  const { data: numberLabels } = useSmsNumberLabels();
  const sendReply = useSendManualReply();
  const [message, setMessage] = useState('');
  const [fromKey, setFromKey] = useState<SmsNumberKey>('1');
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Lets an admin deliberately override a lead's pinned number — e.g. a
  // stale/non-responsive lead, worth trying a fresh number to see if that
  // gets a reply. Off by default; the picker otherwise stays hidden per the
  // pinnedNumber logic below.
  const [switchingNumber, setSwitchingNumber] = useState(false);

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

  const items = useMemo<ThreadItem[]>(() => {
    const out: ThreadItem[] = [];
    let lastDay = '';
    for (const m of thread) {
      const d = new Date(m.at);
      const dayKey = d.toDateString();
      if (dayKey !== lastDay) {
        out.push({ kind: 'day', key: `day:${dayKey}`, label: format(d, 'EEEE, MMM d') });
        lastDay = dayKey;
      }
      out.push({ kind: 'msg', key: m.id, msg: m });
    }
    return out;
  }, [thread]);

  function handleSend() {
    if (!message.trim()) return;
    const text = message.trim();
    // Clears immediately rather than waiting on the round trip — the message
    // itself already appears in the thread right away too (useSendManualReply's
    // own optimistic update), so there's nothing left to visibly wait on
    // unless the send actually fails, in which case the draft comes back.
    setMessage('');
    setError(null);
    const overriding = switchingNumber && !!pinnedNumber;
    sendReply.mutate(
      { leadId: lead.id, body: text, fromKey: overriding ? fromKey : (pinnedNumber ?? fromKey), overrideNumber: overriding },
      {
        onSuccess: () => setSwitchingNumber(false),
        onError: (e) => {
          setError(e instanceof Error ? e.message : 'Send failed.');
          setMessage(text);
        },
      },
    );
  }

  return (
    <div className="card !p-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-2 px-4 py-3">
          <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-text">
            <MessageSquare size={15} /> SMS Thread
          </h2>
          <div className="flex flex-wrap items-center gap-3 text-[12px] text-text-3">
            <AiStatusToggle lead={lead} globalEnabled={aiSettings?.autoReplyEnabled ?? true} />
            <span>
              {realMessages.filter((m) => m.direction === 'inbound').length} repl
              {realMessages.filter((m) => m.direction === 'inbound').length === 1 ? 'y' : 'ies'}
            </span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 px-4 py-8 text-[13px] text-text-3">
            <Loader2 size={14} className="animate-spin" /> Loading conversation…
          </div>
        ) : thread.length === 0 ? (
          <div className="px-4 py-8 text-center text-[13px] text-text-3">No texts with this lead yet.</div>
        ) : (
          <div
            className="max-h-[480px] space-y-2.5 overflow-y-auto px-4 py-3.5"
            style={{ backgroundColor: '#0a0c11', backgroundImage: `url("${CHAT_BG_PATTERN}")` }}
          >
            {items.map((item) =>
              item.kind === 'day' ? (
                <div key={item.key} className="flex items-center justify-center py-1">
                  <span className="rounded-full bg-black/40 px-2.5 py-0.5 text-[11px] font-semibold text-white/70">{item.label}</span>
                </div>
              ) : (
                <div key={item.key} className={`flex ${item.msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[75%] rounded-[18px] px-3.5 py-2 text-[13px] ${
                      item.msg.direction === 'outbound' ? 'rounded-br-[4px]' : 'rounded-bl-[4px]'
                    } ${
                      item.msg.isReaction
                        ? 'border border-dashed border-border-2 bg-surface text-text-3 italic'
                        : item.msg.direction === 'outbound'
                          ? item.msg.aiGenerated
                            ? 'border border-dashed border-primary/50 bg-primary/15 text-text'
                            : 'bg-white text-black'
                          : 'border border-border-2 bg-surface text-text'
                    }`}
                  >
                    {item.msg.isReaction && <ThumbsUp size={11} className="mb-1 inline-block opacity-60" />}
                    <div className="whitespace-pre-wrap">{item.msg.body}</div>
                    {item.msg.hasAttachments && item.msg.attachments.length === 0 && (
                      <div className={`mt-1 flex items-center gap-1 text-[11px] ${item.msg.direction === 'outbound' && !item.msg.aiGenerated ? 'text-black/60' : 'text-text-3'}`}>
                        <ImageIcon size={11} /> Attachment (MMS)
                      </div>
                    )}
                    {item.msg.attachments.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {item.msg.attachments.map((att, i) => {
                          const url = att.storage_path ? attachmentUrls[att.storage_path] : undefined;
                          return url ? (
                            <a key={i} href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-border-2">
                              <img src={url} alt={att.name || 'MMS attachment'} className="h-28 w-28 object-cover" />
                            </a>
                          ) : (
                            <div
                              key={i}
                              className={`flex items-center gap-1 text-[11px] ${item.msg.direction === 'outbound' && !item.msg.aiGenerated ? 'text-black/60' : 'text-text-3'}`}
                              title={att.storage_path === undefined ? 'Sent before MMS viewing was supported — no longer retrievable.' : undefined}
                            >
                              <ImageIcon size={11} /> Attachment (MMS)
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div
                      className={`mt-1 flex items-center gap-1 text-[10px] ${
                        item.msg.direction === 'outbound' && !item.msg.aiGenerated ? 'text-black/50' : item.msg.aiGenerated ? 'text-primary-hover' : 'text-text-3'
                      }`}
                    >
                      {item.msg.aiGenerated && <Bot size={10} />}
                      {item.msg.aiGenerated ? 'Sent by AI auto-reply, ' : ''}
                      {formatDateTime(item.msg.at)}
                    </div>
                  </div>
                </div>
              ),
            )}
          </div>
        )}

        {lead.optedOut ? (
          <div className="m-4 rounded-md border border-danger/40 bg-danger-dim px-3 py-2 text-[12px] text-danger">
            This lead opted out — sending is disabled to respect that.
          </div>
        ) : (
          <div className="space-y-2 p-4">
            <textarea
              ref={textareaRef}
              className="input min-h-[70px] w-full"
              placeholder="Type a reply…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <TemplatesMenu lead={lead} onPick={(body) => setMessage(body)} />
              <MergeTagButtons getTextarea={() => textareaRef.current} value={message} onChange={setMessage} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {pinnedNumber && !switchingNumber ? (
                <div className="flex items-center gap-1.5">
                  <span
                    className="rounded-full bg-border-2 px-2 py-1 text-[12px] font-semibold text-text-2"
                    title="This lead's whole thread lives on this number — every reply keeps going out from it."
                  >
                    Sending from {displayNumber(pinnedNumber)}
                  </span>
                  <button
                    onClick={() => {
                      setFromKey(pinnedNumber);
                      setSwitchingNumber(true);
                    }}
                    className="text-[11px] font-medium text-primary hover:underline"
                  >
                    Switch number
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-1">
                  {SMS_NUMBER_KEYS.map((key) => (
                    <button
                      key={key}
                      onClick={() => setFromKey(key)}
                      className={`btn !px-2 !py-1 text-[12px] ${fromKey === key ? 'btn-primary' : ''}`}
                    >
                      {displayNumber(key)}
                    </button>
                  ))}
                  {pinnedNumber && (
                    <button onClick={() => setSwitchingNumber(false)} className="ml-1 text-[11px] text-text-3 hover:underline">
                      Cancel
                    </button>
                  )}
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
            {error && <div className="rounded-md border border-danger/40 bg-danger-dim px-3 py-2 text-[12px] text-danger">{error}</div>}
            <p className="text-[11px] text-text-3">
              {pinnedNumber && switchingNumber
                ? "Sending from a different number moves this lead's whole conversation to it going forward, same as if it had started there."
                : 'A single reply like this always goes out, any time of day — only bulk sends respect the 7pm-6am Pakistan-time window. Sending here pauses AI auto-reply on this lead.'}
            </p>
          </div>
        )}
      </div>
  );
}
