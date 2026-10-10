import { useRef, useState } from 'react';
import { MessageSquareText, Phone, PhoneCall } from 'lucide-react';
import { CardHeader } from '@/components/ui/CardHeader';
import { Modal } from '@/components/ui/Modal';
import { SmsThreadTab } from '@/components/sms/SmsThreadTab';
import { EditableField } from '@/components/leadProfile/EditableField';
import { useUpdateLead } from '@/hooks/useLeads';
import { formatPhone } from '@/lib/utils';
import type { Lead } from '@/types/domain';

const CONTACT_METHOD_LABEL: Record<NonNullable<Lead['preferredContactMethod']>, string> = {
  call: 'Call',
  text: 'Text',
  email: 'Email',
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="text-[11px] uppercase tracking-wide text-text-3">{label}</div>
      <div className="text-[13px] font-medium text-text">{children}</div>
    </div>
  );
}

/** Next follow-up is one logical field made of two coupled inputs (date +
 *  optional time), so it can't be a single EditableField — click-to-edit
 *  the same way, but commits only once focus actually leaves both inputs
 *  (checked via relatedTarget, same group-blur technique used for the
 *  search dropdowns elsewhere) rather than firing on the date->time tab. */
function NextFollowUpRow({
  date,
  time,
  onSave,
}: {
  date: string | null;
  time: string | null;
  onSave: (date: string | null, time: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftDate, setDraftDate] = useState(date ?? '');
  const [draftTime, setDraftTime] = useState(time ?? '');
  const committedRef = useRef(false);

  function startEdit() {
    committedRef.current = false;
    setDraftDate(date ?? '');
    setDraftTime(time ?? '');
    setEditing(true);
  }

  function commit() {
    if (committedRef.current) return;
    committedRef.current = true;
    setEditing(false);
    const nextDate = draftDate || null;
    const nextTime = nextDate ? draftTime || null : null;
    if (nextDate !== date || nextTime !== time) onSave(nextDate, nextTime);
  }

  function cancel() {
    committedRef.current = true;
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={startEdit}
        className="group/field flex w-full items-center justify-between gap-3 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-60"
      >
        <div className="text-[11px] uppercase tracking-wide text-text-3">Next follow-up</div>
        <div className="border-b border-dashed border-transparent text-[13px] font-medium text-text group-hover/field:border-border-2 group-hover/field:text-primary">
          {date ? `${date}${time ? ` · ${time}` : ''}` : '—'}
        </div>
      </button>
    );
  }

  return (
    <div
      className="flex items-center justify-between gap-3 py-1.5"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) commit();
      }}
    >
      <div className="text-[11px] uppercase tracking-wide text-text-3">Next follow-up</div>
      <div className="flex gap-1.5">
        <input
          autoFocus
          className="input !w-auto !py-1 text-[12px]"
          type="date"
          value={draftDate}
          onChange={(e) => setDraftDate(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') cancel();
          }}
        />
        {draftDate && (
          <input
            className="input !w-auto !py-1 text-[12px]"
            type="time"
            value={draftTime}
            onChange={(e) => setDraftTime(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') cancel();
            }}
          />
        )}
      </div>
    </div>
  );
}

export function ContactSidebarCard({
  lead,
  isAdmin,
  onCall,
}: {
  lead: Lead;
  isAdmin: boolean;
  onCall: (phone: string | null | undefined) => void;
}) {
  const updateLead = useUpdateLead();
  const [smsOpen, setSmsOpen] = useState(false);

  function saveField(patch: Partial<Lead>) {
    updateLead.mutate({ id: lead.id, ...patch });
  }

  return (
    <div className="card">
      <CardHeader icon={Phone} title="Contact" />

      <div className="mt-3 flex gap-2">
        {lead.phone && (
          <button onClick={() => onCall(lead.phone)} className="btn btn-primary flex-1 !py-1.5 text-[12.5px]">
            <PhoneCall size={13} /> Call
          </button>
        )}
        {isAdmin && (
          <button onClick={() => setSmsOpen(true)} className="btn flex-1 !py-1.5 text-[12.5px]">
            <MessageSquareText size={13} /> Text
          </button>
        )}
      </div>

      <div className="mt-3 divide-y divide-border-2">
        <Row label="Phone">{lead.phone ? formatPhone(lead.phone) : '—'}</Row>
        <Row label="Email">{lead.email || '—'}</Row>

        {/* One mutation shared by all three rows — disabling while any save
         *  is in flight stops a fast second edit from computing off a lead
         *  snapshot that doesn't have the first edit's change yet. Native
         *  fieldset cascade reaches NextFollowUpRow's own button/inputs too,
         *  no separate disabled prop needed there. */}
        <fieldset disabled={updateLead.isPending} className="contents">
          <EditableField
            variant="inline"
            label="Prefers"
            type="select"
            value={lead.preferredContactMethod ?? ''}
            display={lead.preferredContactMethod ? CONTACT_METHOD_LABEL[lead.preferredContactMethod] : ''}
            options={[
              { value: '', label: '—' },
              { value: 'call', label: 'Call' },
              { value: 'text', label: 'Text' },
              { value: 'email', label: 'Email' },
            ]}
            onSave={(v) => saveField({ preferredContactMethod: (v || null) as Lead['preferredContactMethod'] })}
          />
          <EditableField
            variant="inline"
            label="Best time"
            value={lead.bestTimeToContact ?? ''}
            placeholder="e.g. Afternoons"
            onSave={(v) => saveField({ bestTimeToContact: v.trim() || null })}
          />
          <NextFollowUpRow
            date={lead.nextFollowUp}
            time={lead.nextFollowUpTime}
            onSave={(date, time) => saveField({ nextFollowUp: date, nextFollowUpTime: time })}
          />
        </fieldset>
      </div>

      {isAdmin && smsOpen && (
        <Modal open onClose={() => setSmsOpen(false)} title={`Text ${lead.firstName} ${lead.lastName}`} width="xl">
          <SmsThreadTab lead={lead} />
        </Modal>
      )}
    </div>
  );
}
