import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ClipboardList, Delete, History, Phone, PhoneCall, Search } from 'lucide-react';
import { useTasks, useToggleTask } from '@/hooks/useTasks';
import { useLeads } from '@/hooks/useLeads';
import { useAddActivity } from '@/hooks/useActivities';
import { cn, formatCurrency, formatPhone, initials, localIsoDate, toE164 } from '@/lib/utils';
import type { Lead } from '@/types/domain';
import { CallHistoryPage } from './CallHistoryPage';

// Same stable per-id palette used on Call History / Leads — kept consistent
// rather than inventing a new one here.
const AVATAR_PALETTE = [
  { bg: 'rgba(255,181,71,.15)', text: '#FFC46B' },
  { bg: 'rgba(110,123,255,.18)', text: '#A9B1FF' },
  { bg: 'rgba(61,214,181,.14)', text: '#4FE0BF' },
  { bg: 'rgba(90,184,255,.14)', text: '#7CC6FF' },
  { bg: 'rgba(180,140,255,.15)', text: '#C7A8FF' },
  { bg: 'rgba(255,107,107,.13)', text: '#FF8A8A' },
];
function avatarColorFor(id: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

const DIALPAD_KEYS = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
  ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
  ['*', ''], ['0', '+'], ['#', ''],
] as const;

/** Grouped digit display while typing — not formatPhone (which expects a
 *  complete number), since this needs to look reasonable at every length
 *  as digits are still being entered. */
function formatDialDigits(digits: string): string {
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return `+${digits.slice(0, digits.length - 10)} (${digits.slice(-10, -7)}) ${digits.slice(-7, -4)}-${digits.slice(-4)}`;
}

function formatDueTime(dueTime: string | null): string {
  if (!dueTime) return 'All day';
  const [h, m] = dueTime.split(':').map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** The Dialer — today's call queue pulled straight from the existing Tasks
 *  system (any task linked to a lead, due today, not completed), with the
 *  lead's own underwriting numbers surfaced alongside so a call doesn't
 *  require flipping to the lead profile mid-conversation. "Call now" hands
 *  off to Zoom Phone's own deep link — same mechanism as the Kanban/profile
 *  quick-call actions — not a live in-browser call (no voice/call-control
 *  API is wired into this CRM yet, only SMS). Call History is folded in as
 *  a second tab rather than kept as a separate nav item. */
export function DialerPage() {
  const navigate = useNavigate();
  const { data: tasks = [], isLoading: tasksLoading } = useTasks();
  const { data: leads = [] } = useLeads();
  const toggleTask = useToggleTask();
  const addActivity = useAddActivity();
  const [view, setView] = useState<'dialer' | 'history'>('dialer');
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [justCalled, setJustCalled] = useState<string | null>(null);
  const [dialDigits, setDialDigits] = useState('');
  const [leadSearch, setLeadSearch] = useState('');

  const leadsById = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);

  const queue = useMemo(() => {
    const todayIso = localIsoDate(new Date());
    return tasks
      .filter((t) => !t.completed && t.leadId && t.dueDate === todayIso && leadsById.has(t.leadId))
      .sort((a, b) => (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99'));
  }, [tasks, leadsById]);

  const activeTask = queue.find((t) => t.id === activeTaskId) ?? queue[0] ?? null;
  const activeLead: Lead | undefined = activeTask?.leadId ? leadsById.get(activeTask.leadId) : undefined;

  // A number typed on the dialpad that happens to match a known lead gets
  // the same Deal Numbers treatment as a scheduled call — real caller-ID
  // off real data, not a fabricated match.
  const dialedE164 = dialDigits.length >= 10 ? toE164(dialDigits) : null;
  const matchedLead = dialedE164 ? leads.find((l) => toE164(l.phone) === dialedE164) : undefined;

  const leadResults = useMemo(() => {
    const q = leadSearch.trim().toLowerCase();
    if (q.length < 2) return [];
    return leads
      .filter((l) => `${l.firstName} ${l.lastName} ${l.phone}`.toLowerCase().includes(q))
      .slice(0, 6);
  }, [leads, leadSearch]);

  function handleCall(lead: Lead) {
    addActivity.mutate({ leadId: lead.id, type: 'call', body: 'Call started from Dialer' });
    setJustCalled(lead.id);
    setTimeout(() => setJustCalled((prev) => (prev === lead.id ? null : prev)), 1500);
    const e164 = toE164(lead.phone);
    if (e164) window.location.href = `zoomphonecall://${e164}`;
  }

  function handleDialpadCall() {
    const e164 = toE164(dialDigits);
    if (!e164) return;
    if (matchedLead) {
      addActivity.mutate({ leadId: matchedLead.id, type: 'call', body: 'Call started from Dialer' });
      setJustCalled(matchedLead.id);
      setTimeout(() => setJustCalled((prev) => (prev === matchedLead.id ? null : prev)), 1500);
    }
    window.location.href = `zoomphonecall://${e164}`;
  }

  function pickLeadForDial(lead: Lead) {
    const digits = lead.phone.replace(/[^0-9]/g, '');
    setDialDigits(digits);
    setLeadSearch('');
  }

  function handleMarkDone(taskId: string) {
    toggleTask.mutate({ id: taskId, completed: true });
    setActiveTaskId((prev) => (prev === taskId ? null : prev));
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text">Dialer</h1>
          <p className="text-sm text-text-3">Today's scheduled calls, deal numbers, and your full call history</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-surface-3 p-1">
          <button
            className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium', view === 'dialer' ? 'bg-surface text-text shadow-sm' : 'text-text-3 hover:text-text')}
            onClick={() => setView('dialer')}
          >
            <Phone size={14} /> Dialer
          </button>
          <button
            className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium', view === 'history' ? 'bg-surface text-text shadow-sm' : 'text-text-3 hover:text-text')}
            onClick={() => setView('history')}
          >
            <History size={14} /> Call History
          </button>
        </div>
      </div>

      {view === 'history' ? (
        <CallHistoryPage />
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="w-full shrink-0 lg:w-[300px]">
            <div className="card !p-0">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Scheduled Calls · Today</div>
                <span className="text-[12px] font-semibold text-primary">{queue.length} left</span>
              </div>
              <div className="max-h-[640px] divide-y divide-border overflow-y-auto">
                {tasksLoading && <div className="px-4 py-6 text-center text-[12.5px] text-text-3">Loading…</div>}
                {!tasksLoading && queue.length === 0 && (
                  <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-[12.5px] text-text-3">
                    <ClipboardList size={24} />
                    No calls scheduled for today.
                  </div>
                )}
                {queue.map((t) => {
                  const lead = t.leadId ? leadsById.get(t.leadId) : undefined;
                  if (!lead) return null;
                  const avatar = avatarColorFor(lead.id);
                  const isActive = activeTask?.id === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setActiveTaskId(t.id)}
                      className={cn('flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-colors', isActive ? 'bg-primary-dim' : 'hover:bg-surface-3')}
                    >
                      <span className="w-[42px] shrink-0 pt-1 text-[11.5px] font-medium text-text-3">{formatDueTime(t.dueTime)}</span>
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: avatar.bg, color: avatar.text }}>
                        {initials(lead.firstName, lead.lastName)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-text">{lead.firstName} {lead.lastName}</span>
                        <span className="block truncate text-[12px] text-text-3">{t.title}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            {!activeLead ? (
              <div className="card flex h-full min-h-[400px] flex-col items-center gap-4 py-6 text-center">
                <div>
                  <div className="font-medium text-text-2">Nothing scheduled right now</div>
                  <div className="text-[12.5px] text-text-3">Dial any number manually, or look up a lead below.</div>
                </div>

                <div className="relative w-full max-w-[220px]">
                  <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3" />
                  <input
                    className="input w-full !pl-7 text-[12.5px]"
                    placeholder="Find a lead to dial…"
                    value={leadSearch}
                    onChange={(e) => setLeadSearch(e.target.value)}
                  />
                  {leadResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-surface shadow-popover">
                      {leadResults.map((l) => (
                        <button
                          key={l.id}
                          onClick={() => pickLeadForDial(l)}
                          className="block w-full truncate px-3 py-1.5 text-left text-[12.5px] hover:bg-surface-3"
                        >
                          {l.firstName} {l.lastName} <span className="text-text-3">· {formatPhone(l.phone)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="min-h-[26px] font-mono text-[22px] font-semibold tracking-wide text-text">
                  {dialDigits ? formatDialDigits(dialDigits) : <span className="text-text-3">Enter a number</span>}
                </div>
                {matchedLead && (
                  <button className="-mt-2 text-[12.5px] font-medium text-primary hover:underline" onClick={() => navigate(`/leads/${matchedLead.id}`)}>
                    {matchedLead.firstName} {matchedLead.lastName}
                  </button>
                )}

                <div className="grid grid-cols-3 gap-3">
                  {DIALPAD_KEYS.map(([digit, letters]) => (
                    <button
                      key={digit}
                      onClick={() => setDialDigits((d) => (d.length < 15 ? d + digit : d))}
                      className="flex h-14 w-14 flex-col items-center justify-center rounded-full bg-surface-3 text-[18px] font-semibold text-text transition-colors hover:bg-surface-2 active:bg-primary-dim"
                    >
                      {digit}
                      {letters && <span className="text-[9px] font-normal tracking-wide text-text-3">{letters}</span>}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleDialpadCall}
                    disabled={!toE164(dialDigits)}
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-success text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    <PhoneCall size={20} />
                  </button>
                  {dialDigits && (
                    <button
                      onClick={() => setDialDigits((d) => d.slice(0, -1))}
                      className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-3 text-text-2 hover:bg-surface-2"
                    >
                      <Delete size={16} />
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="card flex flex-col items-center py-8 text-center">
                <span className="flex h-16 w-16 items-center justify-center rounded-full text-[22px] font-bold" style={{ background: avatarColorFor(activeLead.id).bg, color: avatarColorFor(activeLead.id).text }}>
                  {initials(activeLead.firstName, activeLead.lastName)}
                </span>
                <button className="mt-3 text-[20px] font-bold text-text hover:underline" onClick={() => navigate(`/leads/${activeLead.id}`)}>
                  {activeLead.firstName} {activeLead.lastName}
                </button>
                {activeLead.address && (
                  <div className="text-[13.5px] text-text-3">
                    {[activeLead.address, activeLead.city, activeLead.state, activeLead.zip].filter(Boolean).join(', ')}
                  </div>
                )}
                <div className="mt-1 font-mono text-[13px] text-text-2">{formatPhone(activeLead.phone)}</div>
                {activeTask && <div className="mt-3 rounded-full bg-surface-3 px-3 py-1 text-[12px] text-text-2">{activeTask.title}</div>}

                <div className="mt-6 flex items-center gap-2.5">
                  <button className="btn btn-primary !px-5 !py-2.5 text-[14px]" onClick={() => handleCall(activeLead)}>
                    {justCalled === activeLead.id ? (
                      <>
                        <Check size={16} /> Calling…
                      </>
                    ) : (
                      <>
                        <PhoneCall size={16} /> Call {activeLead.firstName} now
                      </>
                    )}
                  </button>
                  {activeTask && (
                    <button className="btn !px-4 !py-2.5 text-[13.5px]" onClick={() => handleMarkDone(activeTask.id)}>
                      <Check size={14} /> Mark done
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="w-full shrink-0 lg:w-[280px]">
            <div className="card">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Deal Numbers</div>
                <span className="text-[10.5px] font-medium text-success">From Underwriting</span>
              </div>
              {(() => {
                const numbersLead = activeLead ?? matchedLead;
                if (!numbersLead) return <div className="text-[12.5px] text-text-3">Select a scheduled call, or dial a known lead's number, to see their numbers.</div>;
                return (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between border-b border-border pb-2">
                      <span className="text-[12.5px] text-text-3">ARV</span>
                      <span className="font-mono text-[13.5px] font-semibold text-text">{formatCurrency(numbersLead.arv)}</span>
                    </div>
                    <div className="flex items-center justify-between border-b border-border pb-2">
                      <span className="text-[12.5px] text-text-3">Est. repairs</span>
                      <span className="font-mono text-[13.5px] font-semibold text-text">{formatCurrency(numbersLead.estRepairs)}</span>
                    </div>
                    <div className="flex items-center justify-between pb-1">
                      <span className="text-[12.5px] text-text-3">Max allowable offer</span>
                      <span className="font-mono text-[13.5px] font-semibold text-text">{formatCurrency(numbersLead.maxOffer)}</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
