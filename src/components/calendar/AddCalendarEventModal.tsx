import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useCreateCalendarEvent } from '@/hooks/useCalendarEvents';
import { useAuth } from '@/contexts/AuthContext';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { supabase } from '@/lib/supabase';
import { cn, getErrorMessage, leadDisplayName } from '@/lib/utils';
import { CALENDAR_EVENT_TYPE_CONFIG, type CalendarEventType } from '@/types/domain';

interface LeadOption {
  id: string;
  name: string;
  address: string | null;
}

function useLeadSearch(query: string) {
  const { session } = useAuth();
  const debounced = useDebouncedValue(query.trim(), 250);
  return useQuery({
    queryKey: ['calendar_lead_search', session?.user.id, debounced],
    queryFn: async (): Promise<LeadOption[]> => {
      const pattern = `%${debounced}%`;
      const { data, error } = await supabase
        .from('leads')
        .select('id, first_name, last_name, address')
        .eq('user_id', session!.user.id)
        .or(`first_name.ilike.${pattern},last_name.ilike.${pattern},address.ilike.${pattern}`)
        .limit(8);
      if (error) throw error;
      return data.map((r: any) => ({ id: r.id, name: leadDisplayName(r.first_name, r.last_name) || 'Lead', address: r.address }));
    },
    enabled: !!session && debounced.length >= 2,
  });
}

export function AddCalendarEventModal({ onClose, defaultDate }: { onClose: () => void; defaultDate?: Date }) {
  const createEvent = useCreateCalendarEvent();
  const [eventType, setEventType] = useState<CalendarEventType>('walkthrough');
  const [title, setTitle] = useState('');
  const [leadQuery, setLeadQuery] = useState('');
  const [leadOpen, setLeadOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<LeadOption | null>(null);
  const { data: leadResults = [] } = useLeadSearch(leadQuery);
  const [date, setDate] = useState(() => (defaultDate ?? new Date()).toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  function selectLead(lead: LeadOption) {
    setSelectedLead(lead);
    setLeadQuery('');
    setLeadOpen(false);
    if (!location && lead.address) setLocation(lead.address);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim() || !date || !startTime) {
      setError('Title, date, and start time are required.');
      return;
    }
    try {
      await createEvent.mutateAsync({
        eventType,
        title: title.trim(),
        leadId: selectedLead?.id ?? null,
        location: location.trim() || null,
        startsAt: new Date(`${date}T${startTime}`).toISOString(),
        endsAt: endTime ? new Date(`${date}T${endTime}`).toISOString() : null,
        notes: notes.trim() || null,
      });
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to add event.'));
    }
  }

  return (
    <Modal open onClose={onClose} title="Add Event">
      {error && <div className="mb-4 rounded-md bg-danger-dim px-3 py-2 text-[13px] text-danger">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">Type</label>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(CALENDAR_EVENT_TYPE_CONFIG) as CalendarEventType[]).map((key) => {
              const cfg = CALENDAR_EVENT_TYPE_CONFIG[key];
              const active = eventType === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setEventType(key)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors',
                    !active && 'border-border text-text-2 hover:bg-surface-3',
                  )}
                  style={active ? { background: `${cfg.color}1a`, borderColor: cfg.color, color: cfg.color } : undefined}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: cfg.color }} />
                  {cfg.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="label">Title *</label>
          <input
            className="input"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. 310 Cedar Ct walkthrough"
          />
        </div>

        <div className="relative">
          <label className="label">Link a lead (optional)</label>
          {selectedLead ? (
            <div className="flex items-center justify-between rounded-md border border-border bg-surface-3 px-3 py-2 text-[13px]">
              <span className="font-medium text-text">{selectedLead.name}</span>
              <button type="button" onClick={() => setSelectedLead(null)} className="text-text-3 hover:text-text">
                <X size={14} />
              </button>
            </div>
          ) : (
            <>
              <input
                className="input"
                placeholder="Search name or address…"
                value={leadQuery}
                onChange={(e) => {
                  setLeadQuery(e.target.value);
                  setLeadOpen(true);
                }}
                onFocus={() => setLeadOpen(true)}
                onBlur={() => setTimeout(() => setLeadOpen(false), 150)}
              />
              {leadOpen && leadResults.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-surface shadow-popover">
                  {leadResults.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onMouseDown={() => selectLead(l)}
                      className="flex w-full flex-col items-start px-3 py-2 text-left text-[13px] hover:bg-surface-3"
                    >
                      <span className="font-medium text-text">{l.name}</span>
                      {l.address && <span className="text-[12px] text-text-3">{l.address}</span>}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Date *</label>
            <input className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Start *</label>
            <input className="input" type="time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div>
            <label className="label">End</label>
            <input className="input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">Location</label>
          <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={createEvent.isPending} className="btn btn-primary">
            Add Event
          </button>
        </div>
      </form>
    </Modal>
  );
}
