import { useState } from 'react';
import {
  ArrowRightLeft,
  CheckCircle2,
  ChevronDown,
  Circle,
  FileSignature,
  History,
  MessageSquareText,
  PhoneCall,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { CardHeader } from '@/components/ui/CardHeader';
import { RadialGauge } from '@/components/ui/RadialGauge';
import { useAuth } from '@/contexts/AuthContext';
import { useTags } from '@/hooks/useTags';
import { useActivities, useDeleteActivity } from '@/hooks/useActivities';
import { formatDateTime } from '@/lib/utils';
import { getScriptSteps, LIEN_TAG_NAMES } from '@/lib/callScript';
import { STAGE_CONFIG, type ActivityType, type Lead, type LeadActivity, type LeadStage } from '@/types/domain';

const EVENT_ICON: Partial<Record<ActivityType, LucideIcon>> = {
  stage_change: ArrowRightLeft,
  sms: MessageSquareText,
  call: PhoneCall,
  contract: FileSignature,
};

/** The kanban-move/message/call/contract log only — no note or email/
 *  meeting content, and specifically no SMS body text (that's the SMS
 *  tab's job; this just marks that a message happened, and when). */
const SHOWN_TYPES = new Set<ActivityType>(['stage_change', 'sms', 'call', 'contract']);

function describeActivity(a: LeadActivity): string {
  if (a.type === 'stage_change') {
    const from = (a.meta as { from?: string } | null)?.from;
    const to = (a.meta as { to?: string } | null)?.to;
    const fromLabel = from ? (STAGE_CONFIG[from as LeadStage]?.label ?? from) : null;
    const toLabel = to ? (STAGE_CONFIG[to as LeadStage]?.label ?? to) : null;
    if (fromLabel && toLabel) return `Moved from ${fromLabel} to ${toLabel}`;
    if (toLabel) return `Moved to ${toLabel}`;
    return 'Stage changed';
  }
  if (a.type === 'sms') {
    const direction = (a.meta as { direction?: string } | null)?.direction;
    return direction === 'inbound' ? 'Message received' : 'Message sent';
  }
  return a.body || 'Call logged';
}

function ActivityEventRow({ a, canDelete, onDelete }: { a: LeadActivity; canDelete: boolean; onDelete: () => void }) {
  const Icon = EVENT_ICON[a.type] ?? Circle;
  return (
    <div className="group flex items-start gap-3 py-2">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-3 text-text-3">
        <Icon size={13} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-text">{describeActivity(a)}</div>
        <div className="text-[11px] text-text-3">
          {a.authorName} · {formatDateTime(a.createdAt)}
        </div>
      </div>
      {canDelete && (
        <button
          className="shrink-0 text-text-3 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
          onClick={onDelete}
          title="Delete"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}

function ActivityLogCard({ leadId }: { leadId: string }) {
  const { profile } = useAuth();
  const { data: allActivities = [], isLoading } = useActivities(leadId);
  const deleteActivity = useDeleteActivity();
  const events = allActivities.filter((a) => SHOWN_TYPES.has(a.type));
  const isAdmin = profile?.role === 'admin';

  return (
    <div className="card">
      <CardHeader icon={History} title="Activity" sub={`${events.length} logged`} />

      {isLoading && <div className="mt-3 text-[13px] text-text-3">Loading…</div>}
      {!isLoading && events.length === 0 && (
        <div className="mt-4 flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-border-2 py-6 text-center">
          <History size={18} className="text-text-3" />
          <p className="text-[13px] text-text-3">No activity logged yet.</p>
        </div>
      )}
      {events.length > 0 && (
        <div className="mt-3 max-h-96 divide-y divide-border-2 overflow-y-auto rounded-lg border border-border-2 bg-surface-3/50 px-3">
          {events.map((a) => (
            <ActivityEventRow
              key={a.id}
              a={a}
              canDelete={isAdmin}
              onDelete={() => deleteActivity.mutate({ id: a.id, leadId })}
            />
          ))}
        </div>
      )}
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
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
      <ActivityLogCard leadId={lead.id} />
      <FrameworkSnapshotCard lead={lead} />
    </div>
  );
}
