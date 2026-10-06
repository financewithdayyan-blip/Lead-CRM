import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MessageSquareText, Phone, PhoneCall } from 'lucide-react';
import { CardHeader } from '@/components/ui/CardHeader';
import { Modal } from '@/components/ui/Modal';
import { SmsThreadTab } from '@/components/sms/SmsThreadTab';
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
  const [searchParams] = useSearchParams();
  // Lets a link elsewhere (e.g. a Kanban card's "Text" action) land straight
  // on this lead with the Text thread already open, via `?openSms=1` —
  // texting is admin-only, same gate the old dedicated SMS tab had.
  const [smsOpen, setSmsOpen] = useState(isAdmin && searchParams.get('openSms') === '1');
  const [editing, setEditing] = useState(false);
  const [preferred, setPreferred] = useState(lead.preferredContactMethod ?? '');
  const [bestTime, setBestTime] = useState(lead.bestTimeToContact ?? '');
  const [nextFollowUp, setNextFollowUp] = useState(lead.nextFollowUp ?? '');
  const [nextFollowUpTime, setNextFollowUpTime] = useState(lead.nextFollowUpTime ?? '');

  function handleSave() {
    updateLead.mutate(
      {
        id: lead.id,
        preferredContactMethod: (preferred || null) as Lead['preferredContactMethod'],
        bestTimeToContact: bestTime.trim() || null,
        nextFollowUp: nextFollowUp || null,
        nextFollowUpTime: nextFollowUp ? nextFollowUpTime || null : null,
      },
      { onSuccess: () => setEditing(false) },
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2">
        <CardHeader icon={Phone} title="Contact" />
        <button className="text-[11px] font-medium text-primary hover:underline" onClick={() => setEditing((v) => !v)}>
          {editing ? 'Cancel' : 'Edit'}
        </button>
      </div>

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

        {!editing ? (
          <>
            <Row label="Prefers">{lead.preferredContactMethod ? CONTACT_METHOD_LABEL[lead.preferredContactMethod] : '—'}</Row>
            <Row label="Best time">{lead.bestTimeToContact || '—'}</Row>
            <Row label="Next follow-up">
              {lead.nextFollowUp
                ? `${lead.nextFollowUp}${lead.nextFollowUpTime ? ` · ${lead.nextFollowUpTime}` : ''}`
                : '—'}
            </Row>
          </>
        ) : (
          <div className="space-y-2.5 py-2">
            <div>
              <label className="label">Prefers</label>
              <select className="input" value={preferred} onChange={(e) => setPreferred(e.target.value)}>
                <option value="">—</option>
                <option value="call">Call</option>
                <option value="text">Text</option>
                <option value="email">Email</option>
              </select>
            </div>
            <div>
              <label className="label">Best time</label>
              <input className="input" placeholder="e.g. Afternoons" value={bestTime} onChange={(e) => setBestTime(e.target.value)} />
            </div>
            <div>
              <label className="label">Next follow-up</label>
              <div className="flex gap-1.5">
                <input className="input" type="date" value={nextFollowUp} onChange={(e) => setNextFollowUp(e.target.value)} />
                {nextFollowUp && (
                  <input
                    className="input !w-auto"
                    type="time"
                    value={nextFollowUpTime}
                    onChange={(e) => setNextFollowUpTime(e.target.value)}
                  />
                )}
              </div>
            </div>
            <button className="btn btn-primary w-full" onClick={handleSave} disabled={updateLead.isPending}>
              Save
            </button>
          </div>
        )}
      </div>

      {isAdmin && smsOpen && (
        <Modal open onClose={() => setSmsOpen(false)} title={`Text ${lead.firstName} ${lead.lastName}`} width="xl">
          <SmsThreadTab lead={lead} />
        </Modal>
      )}
    </div>
  );
}
