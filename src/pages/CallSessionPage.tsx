import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Clock, Copy, FileText, Square } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeads, useUpdateLead } from '@/hooks/useLeads';
import { useAddActivity, useActivityFeed } from '@/hooks/useActivities';
import { STAGE_CONFIG, type Lead, type LeadStage, type RepairFlags } from '@/types/domain';
import { localIsoDate } from '@/lib/utils';

const REPAIR_OPTIONS: Array<{ key: keyof RepairFlags; label: string }> = [
  { key: 'plumbing', label: 'Plumbing' },
  { key: 'electrical', label: 'Electrical' },
  { key: 'roof', label: 'Roof' },
  { key: 'foundation', label: 'Foundation' },
  { key: 'hvac', label: 'HVAC' },
  { key: 'cosmetics', label: 'Cosmetics' },
  { key: 'flooring', label: 'Flooring' },
];

type OutcomeKey = 'voicemail' | 'initial_contact' | 'followup' | 'onhold' | 'dead' | 'declined';

const OUTCOMES: Array<{ key: OutcomeKey; label: string; stage: LeadStage; shortcut?: string }> = [
  { key: 'voicemail', label: 'Voicemail', stage: 'voicemail', shortcut: 'V' },
  { key: 'initial_contact', label: 'Initial Contact', stage: 'initial_contact' },
  { key: 'followup', label: 'Follow-Up', stage: 'followup', shortcut: 'F' },
  { key: 'onhold', label: 'On Hold', stage: 'onhold', shortcut: 'H' },
  { key: 'dead', label: 'Dead', stage: 'dead_declined', shortcut: 'D' },
  { key: 'declined', label: 'Declined', stage: 'dead_declined' },
];

const SHORTCUT_LEGEND: Array<{ key: string; label: string }> = [
  { key: 'V', label: 'Voicemail' },
  { key: 'F', label: 'Follow-Up' },
  { key: 'D', label: 'Dead' },
  { key: 'H', label: 'Hold' },
  { key: 'N', label: 'Next' },
  { key: 'C', label: 'Copy #' },
];

function formatElapsed(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function RepairsDropdown({ repairs, onChange }: { repairs: RepairFlags; onChange: (r: RepairFlags) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const selected = REPAIR_OPTIONS.filter((r) => repairs[r.key]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-left text-[13px] text-slate-300 hover:border-slate-500"
      >
        <span className="truncate">{selected.length ? selected.map((r) => r.label).join(', ') : 'Select repairs…'}</span>
        <ChevronDown size={14} className="shrink-0 text-slate-500" />
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 shadow-xl">
          {REPAIR_OPTIONS.map((r) => (
            <label key={r.key} className="flex items-center gap-2 rounded px-2 py-1.5 text-[13px] text-slate-300 hover:bg-slate-800">
              <input type="checkbox" checked={!!repairs[r.key]} onChange={(e) => onChange({ ...repairs, [r.key]: e.target.checked })} />
              {r.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function ScriptStep({ index, title, children }: { index: number; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-900 text-[11px] font-semibold text-emerald-300">
          {index}
        </span>
        <span className="text-[13px] font-semibold text-slate-200">{title}</span>
      </div>
      <div className="space-y-2 border-l-2 border-emerald-800 pl-3">{children}</div>
    </div>
  );
}

function ScriptSay({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-slate-700 bg-slate-900 p-3 text-[13px] leading-relaxed text-slate-300">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pink-400">Say</div>
      {children}
    </div>
  );
}

export function CallSessionPage() {
  const navigate = useNavigate();
  const { session, profile } = useAuth();
  const userId = session!.user.id;

  const { data: leads = [], isLoading } = useLeads();
  const { data: yearActivities = [] } = useActivityFeed(userId);
  const updateLead = useUpdateLead();
  const addActivity = useAddActivity();

  const [queueIds, setQueueIds] = useState<string[] | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionCallsLogged, setSessionCallsLogged] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [outcome, setOutcome] = useState<OutcomeKey | null>(null);
  const [notes, setNotes] = useState('');
  const [repairs, setRepairs] = useState<RepairFlags>({});
  const [propertyRating, setPropertyRating] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  // Snapshot the queue once when leads finish loading so the order/membership
  // stays stable for the rest of the session, even as mutations refetch `leads`.
  useEffect(() => {
    if (queueIds === null && !isLoading) {
      const byNum = (a: Lead, b: Lead) => (a.leadNum ?? 0) - (b.leadNum ?? 0);
      const cold = leads.filter((l) => l.stage === 'new').sort(byNum).map((l) => l.id);
      const followups = leads.filter((l) => l.stage === 'followup').sort(byNum).map((l) => l.id);
      setQueueIds([...cold, ...followups]);
    }
  }, [isLoading, leads, queueIds]);

  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const currentLeadId = queueIds?.[currentIndex];
  const currentLead = leads.find((l) => l.id === currentLeadId) ?? null;

  // If a queued lead disappeared (e.g. deleted mid-session), skip past it.
  useEffect(() => {
    if (queueIds && !isLoading && currentIndex < queueIds.length && !currentLead) {
      setCurrentIndex((i) => i + 1);
    }
  }, [queueIds, isLoading, currentIndex, currentLead]);

  useEffect(() => {
    setOutcome(null);
    setNotes('');
    setRepairs(currentLead?.repairs ?? {});
    setPropertyRating(currentLead?.propertyRating ?? null);
  }, [currentLeadId]);

  const todayIso = localIsoDate(new Date());
  const callsTodayBaseline = useMemo(
    () => yearActivities.filter((a) => a.type === 'call' && localIsoDate(new Date(a.createdAt)) === todayIso).length,
    [yearActivities, todayIso],
  );
  const callsToday = callsTodayBaseline + sessionCallsLogged;
  const dailyGoal = profile?.dailyGoal ?? 20;
  const goalReached = callsToday >= dailyGoal;
  const queueExhausted = queueIds !== null && currentIndex >= queueIds.length;
  const finished = goalReached || queueExhausted;

  function endSession() {
    navigate('/');
  }

  function copyPhone() {
    if (!currentLead) return;
    navigator.clipboard.writeText(currentLead.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  function saveAndNext() {
    if (!currentLead) return;
    const chosen = OUTCOMES.find((o) => o.key === outcome);
    updateLead.mutate({
      id: currentLead.id,
      ...(chosen ? { stage: chosen.stage } : {}),
      repairs,
      propertyRating,
    });
    addActivity.mutate({
      leadId: currentLead.id,
      type: 'call',
      body: notes.trim() || (chosen ? `Call outcome: ${chosen.label}` : 'Call logged from session'),
    });
    setSessionCallsLogged((n) => n + 1);
    setCurrentIndex((i) => i + 1);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (finished || !currentLead) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const key = e.key.toLowerCase();
      if (key === 'v') setOutcome('voicemail');
      else if (key === 'f') setOutcome('followup');
      else if (key === 'd') setOutcome('dead');
      else if (key === 'h') setOutcome('onhold');
      else if (key === 'n') saveAndNext();
      else if (key === 'c') copyPhone();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [finished, currentLead, outcome, notes, repairs, propertyRating]);

  if (queueIds === null) {
    return <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-400">Loading leads…</div>;
  }

  if (finished) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-slate-950 text-center text-slate-200">
        <div className="text-2xl font-semibold">{goalReached ? 'Daily goal reached!' : 'Session complete'}</div>
        <div className="text-slate-400">
          {sessionCallsLogged} call{sessionCallsLogged !== 1 ? 's' : ''} logged this session · {callsToday}/{dailyGoal} today
        </div>
        <button onClick={endSession} className="mt-3 rounded-md bg-emerald-500 px-5 py-2.5 font-medium text-slate-950 hover:bg-emerald-400">
          Back to Dashboard
        </button>
      </div>
    );
  }

  if (!currentLead) {
    return <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-400">Loading next lead…</div>;
  }

  const addressLine = [currentLead.address, currentLead.city, currentLead.state].filter(Boolean).join(', ') + (currentLead.zip ? ` ${currentLead.zip}` : '');
  const fullName = `${currentLead.firstName} ${currentLead.lastName}`.trim();

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-200">
      <div className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
        <div className="text-[13px] text-slate-400">
          Lead {currentIndex + 1} of {queueIds.length}
          <span className="ml-3 text-slate-600">·</span>
          <span className="ml-3">
            {callsToday}/{dailyGoal} calls today
          </span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[13px] text-emerald-400">
          <Clock size={14} /> {formatElapsed(elapsed)}
        </div>
        <button
          onClick={endSession}
          className="flex items-center gap-1.5 rounded-md border border-red-900 bg-red-950/60 px-3 py-1.5 text-[13px] font-medium text-red-400 hover:bg-red-900/60"
        >
          <Square size={11} className="fill-current" /> End Session
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-[320px] shrink-0 overflow-y-auto border-r border-slate-800 p-5">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">
            Lead {currentIndex + 1} of {queueIds.length}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">{STAGE_CONFIG[currentLead.stage].label}</span>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">#{currentLead.leadNum}</span>
          </div>
          <div className="mt-2 text-xl font-bold uppercase tracking-wide text-white">{fullName}</div>
          <button
            onClick={copyPhone}
            className="mt-2 flex items-center gap-1.5 rounded-md bg-emerald-900/40 px-2.5 py-1 text-[12px] font-medium text-emerald-400 hover:bg-emerald-900/70"
          >
            <Copy size={12} /> {copied ? 'Copied!' : 'Copy'}
          </button>
          {currentLead.address && (
            <div className="mt-3 text-[13px] uppercase tracking-wide text-emerald-400">📍 {addressLine}</div>
          )}

          <div className="mt-5">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Repairs Needed</div>
            <RepairsDropdown repairs={repairs} onChange={setRepairs} />
          </div>

          <div className="mt-5">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Property Rating (out of 10)</div>
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPropertyRating(n)}
                  className={`h-7 w-7 rounded-md border text-[12px] font-medium transition-colors ${
                    propertyRating === n
                      ? 'border-emerald-400 bg-emerald-400 text-slate-950'
                      : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-md">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Call Outcome</div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {OUTCOMES.map((o) => {
                const active = outcome === o.key;
                return (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setOutcome(o.key)}
                    style={active ? { background: STAGE_CONFIG[o.stage].color } : undefined}
                    className={`rounded-md border px-2 py-2 text-[12.5px] font-semibold transition-colors ${
                      active ? 'border-transparent text-slate-950' : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-500'
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Notes</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add call notes…"
              className="mt-2 h-32 w-full rounded-md border border-slate-700 bg-slate-900 p-3 text-[13px] text-slate-200 outline-none focus:border-emerald-500"
            />

            <button
              onClick={saveAndNext}
              className="mt-4 w-full rounded-md bg-emerald-500 py-2.5 text-[13px] font-semibold text-slate-950 hover:bg-emerald-400"
            >
              Save & Next →
            </button>

            <div className="mt-3 flex flex-wrap justify-center gap-3 text-[11px] text-slate-500">
              {SHORTCUT_LEGEND.map((s) => (
                <span key={s.key}>
                  <kbd className="rounded border border-slate-700 px-1 py-0.5 text-slate-400">{s.key}</kbd> {s.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="w-[380px] shrink-0 overflow-y-auto border-l border-slate-800 p-5">
          <div className="mb-4 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <FileText size={13} /> Call Script
          </div>
          <ScriptStep index={1} title="Introduction & Permission">
            <ScriptSay>
              "Hi, is this <b className="text-white">{fullName}</b>? My name is <b className="text-amber-300">[Your Name]</b>. I'm calling about
              the property at <b className="text-amber-300">{addressLine}</b>. Do you have a few minutes to talk about it?"
            </ScriptSay>
            <ScriptSay>
              "So we are basically fix and flippers and have hired a private investigator to find us properties — he's given us your address
              and number. We are interested in buying your house."
            </ScriptSay>
          </ScriptStep>
          <ScriptStep index={2} title="Confirm They Want to Sell">
            <div className="rounded-md border border-slate-700 bg-slate-900 p-3 text-[13px] text-slate-300">
              › Are you interested in selling your house for the right price?
              <div className="mt-2 flex gap-2">
                <span className="rounded-md border border-emerald-800 bg-emerald-950/60 px-2.5 py-1 text-[12px] text-emerald-400">✓ Yes</span>
                <span className="rounded-md border border-red-800 bg-red-950/60 px-2.5 py-1 text-[12px] text-red-400">✗ No</span>
              </div>
            </div>
          </ScriptStep>
        </div>
      </div>
    </div>
  );
}
