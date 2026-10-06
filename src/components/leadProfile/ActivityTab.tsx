import { useEffect, useRef, useState } from 'react';
import { Archive, CheckCircle2, ChevronDown, Circle, MessageSquareText, Pencil, Send, Trash2 } from 'lucide-react';
import { CardHeader } from '@/components/ui/CardHeader';
import { RadialGauge } from '@/components/ui/RadialGauge';
import { useAuth } from '@/contexts/AuthContext';
import { useTags } from '@/hooks/useTags';
import { useActivities, useAddActivity, useDeleteActivity, useUpdateActivity } from '@/hooks/useActivities';
import { formatDateTime } from '@/lib/utils';
import { getScriptSteps, LIEN_TAG_NAMES } from '@/lib/callScript';
import type { ActivityType, Lead, LeadActivity } from '@/types/domain';

const ACTIVITY_LABEL: Record<ActivityType, string> = {
  note: 'Note',
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  sms: 'Text',
  stage_change: 'Stage changed',
};

function ActivityBubble({
  a,
  isAdmin,
  onDelete,
  onEdit,
}: {
  a: LeadActivity;
  isAdmin: boolean;
  onDelete: () => void;
  onEdit: (body: string) => void;
}) {
  const [editText, setEditText] = useState<string | null>(null);
  const isRight = a.authorRole === 'admin';
  const initials = a.authorName
    .split(' ')
    .map((w: string) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const canEdit = a.type !== 'stage_change';

  return (
    <div className={`group flex items-end gap-2 ${isRight ? 'flex-row-reverse' : ''}`}>
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
          isRight ? 'bg-primary/20 text-primary' : 'bg-surface-3 text-text-3'
        }`}
      >
        {initials}
      </div>

      <div className={`relative max-w-[75%] ${isRight ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`mb-0.5 flex items-center gap-1.5 text-[10px] text-text-3 ${isRight ? 'flex-row-reverse' : ''}`}>
          <span className="font-medium">{a.authorName}</span>
          <span>·</span>
          <span>{formatDateTime(a.createdAt)}</span>
        </div>

        {editText !== null ? (
          <div className="flex w-full flex-col gap-1.5">
            <textarea
              autoFocus
              className="input resize-none text-[13px]"
              rows={3}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setEditText(null); }}
            />
            <div className="flex gap-1.5">
              <button
                className="btn btn-primary !px-2.5 !py-1 text-[12px]"
                disabled={!editText.trim()}
                onClick={() => { onEdit(editText.trim()); setEditText(null); }}
              >
                Save
              </button>
              <button className="btn !px-2.5 !py-1 text-[12px]" onClick={() => setEditText(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div
            className={`rounded-2xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap ${
              isRight
                ? 'rounded-br-sm border border-primary/25 bg-primary/8 text-text'
                : 'rounded-bl-sm border border-border-2 bg-surface-3 text-text'
            }`}
          >
            <span className={`mr-1.5 inline-block rounded px-1 py-0.5 text-[10px] font-semibold ${isRight ? 'bg-primary/15 text-primary' : 'bg-border-2 text-text-3'}`}>
              {ACTIVITY_LABEL[a.type]}
            </span>
            {a.body}
          </div>
        )}
      </div>

      {editText === null && (
        <div className="mb-0.5 flex shrink-0 flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {canEdit && (
            <button className="text-text-3 hover:text-primary" onClick={() => setEditText(a.body)} title="Edit">
              <Pencil size={12} />
            </button>
          )}
          <button className="text-text-3 hover:text-danger" onClick={onDelete} title="Delete">
            <Trash2 size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

function NotesChatSection({ leadId, legacyNote }: { leadId: string; legacyNote: string | null }) {
  const { profile } = useAuth();
  const { data: allActivities = [], isLoading } = useActivities(leadId);
  const addActivity = useAddActivity();
  const deleteActivity = useDeleteActivity();
  const updateActivity = useUpdateActivity();
  const [body, setBody] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [allActivities.length]);

  function handleSend() {
    if (!body.trim()) return;
    addActivity.mutate({ leadId, type: 'note', body: body.trim() }, { onSuccess: () => setBody('') });
  }

  return (
    <div className="card">
      <CardHeader icon={MessageSquareText} title="Activity" sub={`${allActivities.length} logged`} />

      {legacyNote && (
        <div className="mt-3 rounded-lg border border-border-2 bg-surface-3 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-text-3">
            <Archive size={11} /> Legacy note
          </div>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-text-2">{legacyNote}</p>
        </div>
      )}

      {isLoading && <div className="mt-3 text-[13px] text-text-3">Loading…</div>}
      {!isLoading && allActivities.length === 0 && !legacyNote && (
        <div className="mt-4 flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-border-2 py-6 text-center">
          <MessageSquareText size={18} className="text-text-3" />
          <p className="text-[13px] text-text-3">No activity yet — add the first note below.</p>
        </div>
      )}
      {allActivities.length > 0 && (
        <div className="mt-3 max-h-80 space-y-3 overflow-y-auto rounded-lg border border-border-2 bg-surface-3/50 p-3 pr-2">
          {allActivities.map((a) => (
            <ActivityBubble
              key={a.id}
              a={a}
              isAdmin={profile?.role === 'admin'}
              onDelete={() => deleteActivity.mutate({ id: a.id, leadId })}
              onEdit={(body) => updateActivity.mutate({ id: a.id, leadId, body })}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      <div className="mt-3 flex items-end gap-2 rounded-lg border border-border-2 bg-surface p-2 focus-within:border-primary/50">
        <textarea
          className="max-h-32 flex-1 resize-none bg-transparent px-1 py-1 text-[13px] text-text outline-none placeholder:text-text-3"
          rows={1}
          placeholder="Add a note…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
          }}
        />
        <button
          className="btn btn-primary shrink-0 !p-2"
          title="Send (Enter)"
          onClick={handleSend}
          disabled={addActivity.isPending || !body.trim()}
        >
          <Send size={14} />
        </button>
      </div>
      <div className="mt-1 text-[11px] text-text-3">Enter to send · Shift+Enter for new line</div>
    </div>
  );
}

function FrameworkSnapshotCard({ lead }: { lead: Lead }) {
  const { data: tags = [] } = useTags();
  const leadTagNames = lead.tagIds.map((tid) => tags.find((t) => t.id === tid)?.name).filter((n): n is string => !!n);
  const hasMortgageStep = leadTagNames.some((n) => LIEN_TAG_NAMES.includes(n));
  const steps = getScriptSteps(hasMortgageStep);
  const answers = lead.scriptAnswers ?? {};
  const stepComplete = (step: (typeof steps)[number]) => step.questions.every((q) => (answers[q.key] ?? '').trim().length > 0);
  const completedCount = steps.filter(stepComplete).length;
  const [openTitle, setOpenTitle] = useState<string | null>(null);

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3">
        <CardHeader icon={CheckCircle2} title="Qualification Framework" sub={`${completedCount} of ${steps.length} steps answered`} tone="success" />
        <RadialGauge pct={(completedCount / steps.length) * 100} color="#10b981" size={40} strokeWidth={5} centered />
      </div>
      <div className="mt-3 space-y-1">
        {steps.map((step) => {
          const complete = stepComplete(step);
          const open = openTitle === step.title;
          return (
            <div key={step.title} className="rounded-md">
              <button
                onClick={() => setOpenTitle(open ? null : step.title)}
                className="flex w-full items-center gap-2.5 rounded-md px-1 py-1.5 text-left hover:bg-surface-3"
              >
                {complete ? <CheckCircle2 size={15} className="shrink-0 text-success" /> : <Circle size={15} className="shrink-0 text-text-3" />}
                <span className={`flex-1 text-[12.5px] ${complete ? 'text-text' : 'text-text-3'}`}>{step.title}</span>
                <ChevronDown size={13} className={`shrink-0 text-text-3 transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>
              {open && (
                <div className="ml-[23px] space-y-2.5 border-l border-border-2 py-2 pl-3">
                  {step.questions.map((q) => (
                    <div key={q.key}>
                      <p className="text-[11.5px] text-text-3">{q.prompt}</p>
                      <p className={`mt-0.5 text-[12.5px] ${answers[q.key] ? 'text-text' : 'italic text-text-3'}`}>
                        {answers[q.key] || 'No answer recorded'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ActivityTab({ lead }: { lead: Lead }) {
  return (
    <div className="space-y-5">
      <NotesChatSection leadId={lead.id} legacyNote={lead.notes ?? null} />
      <FrameworkSnapshotCard lead={lead} />
    </div>
  );
}
