import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePresence } from '@/contexts/PresenceContext';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Ban,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  Clock,
  Copy,
  FileText,
  Loader2,
  MapPin,
  MessageSquare,
  PauseCircle,
  Phone,
  PhoneIncoming,
  PhoneCall,
  Send,
  Square,
  Target,
  Trophy,
  Voicemail,
  Wrench,
  X,
  XCircle,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeads, useUpdateLead } from '@/hooks/useLeads';
import { useActivities, useAddActivity, useTodayCalledLeadIds } from '@/hooks/useActivities';
import { useTags } from '@/hooks/useTags';
import { useScriptAnswers } from '@/hooks/useScriptAnswers';
import { useMyTodaySummary, useSubmitDailySummary } from '@/hooks/useDailySummaries';
import { TagPill } from '@/components/ui/TagPill';
import { SCRIPT_STEPS } from '@/lib/callScript';
import { STAGE_CONFIG, type Lead, type LeadStage, type RepairFlags } from '@/types/domain';
import { callerDisplayName, formatPhone, initials, localIsoDate } from '@/lib/utils';

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

const OUTCOMES: Array<{ key: OutcomeKey; label: string; stage: LeadStage; icon: typeof Voicemail }> = [
  { key: 'voicemail', label: 'Voicemail', stage: 'voicemail', icon: Voicemail },
  { key: 'initial_contact', label: 'Initial Contact', stage: 'initial_contact', icon: PhoneIncoming },
  { key: 'followup', label: 'Follow-Up', stage: 'followup', icon: CalendarClock },
  { key: 'onhold', label: 'On Hold', stage: 'onhold', icon: PauseCircle },
  { key: 'dead', label: 'Dead', stage: 'dead_declined', icon: XCircle },
  { key: 'declined', label: 'Declined', stage: 'dead_declined', icon: Ban },
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

function ratingColor(n: number) {
  if (n <= 4) return '#ef4444';
  if (n <= 7) return '#f59e0b';
  return '#10b981';
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
        className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5 text-left text-[13px] text-slate-300 transition-colors hover:border-slate-600"
      >
        <span className="truncate">{selected.length ? selected.map((r) => r.label).join(', ') : 'Select repairs…'}</span>
        <ChevronDown size={14} className={`shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-10 mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-900 p-2 shadow-2xl shadow-black/50">
          {REPAIR_OPTIONS.map((r) => (
            <label key={r.key} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-slate-300 hover:bg-slate-800">
              <input
                type="checkbox"
                checked={!!repairs[r.key]}
                onChange={(e) => onChange({ ...repairs, [r.key]: e.target.checked })}
                className="accent-emerald-500"
              />
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
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 text-[11px] font-bold text-slate-950 shadow shadow-emerald-500/30">
          {index}
        </span>
        <span className="text-[13px] font-semibold text-slate-100">{title}</span>
      </div>
      <div className="space-y-2 border-l-2 border-emerald-900/60 pl-3.5">{children}</div>
    </div>
  );
}

function ScriptSay({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-[13px] leading-relaxed text-slate-300">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-pink-400">Say</div>
      {children}
    </div>
  );
}

export function CallSessionPage() {
  const navigate = useNavigate();
  const { session, profile } = useAuth();
  const userId = session!.user.id;

  const { setMyStatus } = usePresence();
  const callingSessionIdRef = useRef<string | null>(null);

  const { data: leads = [], isLoading } = useLeads();
  const { data: todayCalledIds = new Set<string>() } = useTodayCalledLeadIds(userId);
  const { data: tags = [] } = useTags();
  const updateLead = useUpdateLead();
  const addActivity = useAddActivity();
  const { data: todaySummary } = useMyTodaySummary();
  const submitSummary = useSubmitDailySummary();

  const [queueIds, setQueueIds] = useState<string[] | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [inFollowUpMode, setInFollowUpMode] = useState(false);
  const [sessionCallsLogged, setSessionCallsLogged] = useState(0);
  // Map<leadId, dateIso> — tracks which date each in-session call was logged on,
  // so calls made before midnight don't bleed into the next day's count.
  const [sessionLeadIdsCalled, setSessionLeadIdsCalled] = useState<Map<string, string>>(new Map());
  const [elapsed, setElapsed] = useState(0);
  const [outcome, setOutcome] = useState<OutcomeKey | null>(null);
  const [notes, setNotes] = useState('');
  const [repairs, setRepairs] = useState<RepairFlags>({});
  const [propertyRating, setPropertyRating] = useState<number | null>(null);
  const [followUpDate, setFollowUpDate] = useState<string | null>(null);
  const [summaryText, setSummaryText] = useState('');
  const [summaryJustSubmitted, setSummaryJustSubmitted] = useState(false);
  const [copiedField, setCopiedField] = useState<'phone' | 'phone2' | null>(null);
  const [smsCopied, setSmsCopied] = useState(false);

  const followUpDays = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      return {
        iso: localIsoDate(d),
        weekday: i === 0 ? 'Today' : d.toLocaleDateString([], { weekday: 'short' }),
        day: d.getDate(),
        month: d.toLocaleDateString([], { month: 'short' }),
      };
    });
  }, []);

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

  // Track the active calling session in DB and flip presence dot to red.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let insertedId: string | null = null;
    let unmounted = false;

    supabase
      .from('calling_sessions')
      .insert({ user_id: userId })
      .select('id')
      .single()
      .then(({ data, error }) => {
        if (!error && data && !unmounted) {
          insertedId = data.id;
          callingSessionIdRef.current = data.id;
        }
      });

    setMyStatus('session');

    return () => {
      unmounted = true;
      setMyStatus('online');
      const id = insertedId ?? callingSessionIdRef.current;
      if (id) {
        supabase
          .from('calling_sessions')
          .update({ ended_at: new Date().toISOString() })
          .eq('id', id)
          .then(() => {});
      }
    };
  }, []); // runs once on mount / cleanup on unmount

  const currentLeadId = queueIds?.[currentIndex];
  const currentLead = leads.find((l) => l.id === currentLeadId) ?? null;
  const script = useScriptAnswers(currentLead);
  const { data: leadActivities = [] } = useActivities(currentLeadId);

  // If a queued lead disappeared (e.g. deleted mid-session), skip past it.
  useEffect(() => {
    if (queueIds && !isLoading && currentIndex < queueIds.length && !currentLead) {
      setCurrentIndex((i) => i + 1);
    }
  }, [queueIds, isLoading, currentIndex, currentLead]);

  useEffect(() => {
    setOutcome(null);
    setNotes(currentLead?.notes ?? '');
    setRepairs(currentLead?.repairs ?? {});
    setPropertyRating(currentLead?.propertyRating ?? null);
    setFollowUpDate(null);
  }, [currentLeadId]);

  useEffect(() => {
    if (outcome === 'followup' && followUpDate === null) {
      setFollowUpDate(followUpDays[0].iso);
    }
  }, [outcome, followUpDate, followUpDays]);

  const todayIso = localIsoDate(new Date());
  // Merge DB-backed today count with in-session leads logged on today's date.
  // Using a Map<leadId, dateIso> for session state means midnight crossings don't bleed over.
  const callsToday = useMemo(() => {
    const merged = new Set(todayCalledIds);
    sessionLeadIdsCalled.forEach((dateIso, leadId) => {
      if (dateIso === todayIso) merged.add(leadId);
    });
    return merged.size;
  }, [todayCalledIds, sessionLeadIdsCalled, todayIso]);
  const dailyGoal = profile?.dailyGoal ?? 20;
  const goalReached = callsToday >= dailyGoal;
  const queueExhausted = queueIds !== null && currentIndex >= queueIds.length;
  // In follow-up mode the goal being met no longer ends the session — only queue exhaustion does.
  const finished = (goalReached && !inFollowUpMode) || queueExhausted;
  const summaryWordCount = summaryText.trim() ? summaryText.trim().split(/\s+/).length : 0;
  const needsSummary = finished && !todaySummary && !summaryJustSubmitted;

  // Leads in 'initial_contact' or 'followup' stage that haven't been called this session —
  // offered as a follow-up queue once the daily goal is met.
  const followUpLeads = useMemo(() => {
    if (!goalReached || inFollowUpMode) return [];
    return leads
      .filter((l) => (l.stage === 'initial_contact' || l.stage === 'followup') && !sessionLeadIdsCalled.has(l.id))
      .sort((a, b) => (a.leadNum ?? 0) - (b.leadNum ?? 0));
  }, [goalReached, inFollowUpMode, leads, sessionLeadIdsCalled]);

  function startFollowUpSession() {
    setQueueIds(followUpLeads.map((l) => l.id));
    setCurrentIndex(0);
    setInFollowUpMode(true);
  }

  function endSession() {
    navigate('/');
  }

  function handleSubmitSummary() {
    const text = summaryText.trim();
    if (!text || summaryWordCount > 200) return;
    submitSummary.mutate(text, { onSuccess: () => setSummaryJustSubmitted(true) });
  }

  function copyPhone(field: 'phone' | 'phone2') {
    if (!currentLead) return;
    const raw = field === 'phone' ? currentLead.phone : currentLead.phone2;
    if (!raw) return;
    navigator.clipboard.writeText(formatPhone(raw));
    setCopiedField(field);
    setTimeout(() => setCopiedField((prev) => (prev === field ? null : prev)), 1200);
  }

  function copySmsMessage() {
    const message = `Hi. I tried reaching you today regarding your property at ${addressLine}. I'd love to have a quick conversation when you have a moment feel free to call or text me back. Thank you!`;
    navigator.clipboard.writeText(message);
    setSmsCopied(true);
    setTimeout(() => setSmsCopied(false), 1500);
  }

  function saveAndNext() {
    if (!currentLead || !outcome) return;
    const chosen = OUTCOMES.find((o) => o.key === outcome);
    updateLead.mutate({
      id: currentLead.id,
      ...(chosen ? { stage: chosen.stage } : {}),
      ...(outcome === 'followup' ? { nextFollowUp: followUpDate } : {}),
      repairs,
      propertyRating,
      notes: notes.trim() || null,
    });
    addActivity.mutate({
      leadId: currentLead.id,
      type: 'call',
      body: notes.trim() || (chosen ? `Call outcome: ${chosen.label}` : 'Call logged from session'),
      meta: chosen ? { outcome: chosen.key } : {},
    });
    if (callingSessionIdRef.current) {
      supabase
        .from('calling_sessions')
        .update({ calls_logged: sessionCallsLogged + 1 })
        .eq('id', callingSessionIdRef.current)
        .then(() => {});
    }
    setSessionCallsLogged((n) => n + 1);
    setSessionLeadIdsCalled((prev) => new Map(prev).set(currentLead.id, localIsoDate(new Date())));
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
      else if (key === 'c') copyPhone('phone');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [finished, currentLead, outcome, notes, repairs, propertyRating, followUpDate]);

  if (queueIds === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-950 to-black text-slate-400">
        <div className="flex items-center gap-2 text-[14px]">
          <Loader2 size={16} className="animate-spin" /> Loading leads…
        </div>
      </div>
    );
  }

  if (finished) {
    const isFollowUpComplete = inFollowUpMode && queueExhausted;
    const title = isFollowUpComplete ? 'Follow-up session complete!' : goalReached ? 'Daily goal reached!' : 'Session complete';

    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-gradient-to-br from-slate-900 via-slate-950 to-black text-center text-slate-200">
        <div className={`flex h-16 w-16 items-center justify-center rounded-full shadow-lg ${isFollowUpComplete ? 'bg-gradient-to-br from-blue-500 to-indigo-400 shadow-blue-500/30' : 'bg-gradient-to-br from-emerald-500 to-teal-400 shadow-emerald-500/30'}`}>
          {isFollowUpComplete ? <PhoneCall size={28} className="text-slate-950" /> : <Trophy size={28} className="text-slate-950" />}
        </div>
        <div className="text-2xl font-bold">{title}</div>
        <div className="text-slate-400">
          {sessionCallsLogged} call{sessionCallsLogged !== 1 ? 's' : ''} logged this session · {callsToday}/{dailyGoal} today
        </div>

        {needsSummary ? (
          <div className="mt-2 w-full max-w-md text-left">
            <div className="mb-1.5 text-[13px] font-semibold text-slate-200">
              Write a quick summary of your day before you go (required)
            </div>
            <textarea
              className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-[13px] text-slate-200 outline-none focus:border-emerald-500"
              rows={5}
              placeholder="What went well, what came up, anything your admin should know…"
              value={summaryText}
              onChange={(e) => setSummaryText(e.target.value)}
            />
            <div className={`mt-1 text-right text-[12px] ${summaryWordCount > 200 ? 'text-danger' : 'text-slate-500'}`}>
              {summaryWordCount} / 200 words
            </div>
            <button
              onClick={handleSubmitSummary}
              disabled={!summaryText.trim() || summaryWordCount > 200 || submitSummary.isPending}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 px-6 py-3 font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send size={15} /> {submitSummary.isPending ? 'Submitting…' : 'Submit summary'}
            </button>
          </div>
        ) : (
          <>
            {summaryJustSubmitted && <div className="text-[13px] text-emerald-400">✓ Summary submitted</div>}

            {/* Follow-up session offer — only shown when daily goal just reached (not in follow-up mode) */}
            {!inFollowUpMode && followUpLeads.length > 0 && (
              <div className="mt-1 flex w-full max-w-sm flex-col items-center gap-3 rounded-2xl border border-blue-900/50 bg-blue-950/30 p-5">
                <div className="text-[13px] text-slate-300">
                  You have <span className="font-semibold text-blue-300">{followUpLeads.length} follow-up lead{followUpLeads.length !== 1 ? 's' : ''}</span> waiting in Initial Contact &amp; Follow-Up stages.
                </div>
                <button
                  onClick={startFollowUpSession}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-400 px-6 py-3 font-semibold text-white shadow-lg shadow-blue-500/20 transition-transform hover:scale-[1.02]"
                >
                  <PhoneCall size={16} /> Start Follow-up Session
                </button>
                <button onClick={endSession} className="text-[12px] text-slate-500 hover:text-slate-400">
                  Skip — back to dashboard
                </button>
              </div>
            )}

            {(inFollowUpMode || followUpLeads.length === 0) && (
              <button
                onClick={endSession}
                className="mt-2 flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 px-6 py-3 font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition-transform hover:scale-[1.02]"
              >
                Back to Dashboard
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  if (!currentLead) {
    return (
      <div className="flex h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-950 to-black text-slate-400">
        <div className="flex items-center gap-2 text-[14px]">
          <Loader2 size={16} className="animate-spin" /> Loading next lead…
        </div>
      </div>
    );
  }

  const addressLine =
    [currentLead.address, currentLead.city, currentLead.state].filter(Boolean).join(', ') + (currentLead.zip ? ` ${currentLead.zip}` : '');
  const fullName = `${currentLead.firstName} ${currentLead.lastName}`.trim();
  const callerName = callerDisplayName(profile?.fullName, session?.user.email);

  return (
    <div className="flex h-screen flex-col bg-gradient-to-br from-slate-900 via-slate-950 to-black text-slate-200">
      <div className="border-b border-slate-800/80 bg-slate-950/60 px-6 py-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/80 px-3 py-1.5 text-[12.5px] text-slate-300">
              <Target size={13} className={goalReached ? 'text-emerald-400' : 'text-slate-500'} />
              <span className="text-slate-500">Leads Called Today:</span>
              <span className="font-semibold text-white">
                {callsToday} / {dailyGoal}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-emerald-900/60 bg-emerald-950/30 px-4 py-1.5 font-mono text-[13px] text-emerald-400 shadow-[0_0_16px_-4px_rgba(16,185,129,0.5)]">
            <Clock size={14} /> {formatElapsed(elapsed)}
          </div>

          <button
            onClick={endSession}
            className="flex items-center gap-1.5 rounded-full border border-red-900/70 bg-red-950/40 px-3.5 py-1.5 text-[12.5px] font-semibold text-red-400 transition-colors hover:bg-red-900/50 hover:text-red-300"
          >
            <Square size={10} className="fill-current" /> End Session
          </button>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-[400px_1fr_480px] gap-4 overflow-hidden p-4">
        <div className="max-h-full overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900/50 p-6 shadow-xl shadow-black/20">
          <div className="flex items-center gap-4">
            <div
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-xl font-bold text-slate-950 shadow-lg"
              style={{ background: STAGE_CONFIG[currentLead.stage].color }}
            >
              {initials(currentLead.firstName, currentLead.lastName)}
            </div>
            <div className="min-w-0">
              <div className="truncate text-2xl font-bold uppercase tracking-wide text-white">{fullName}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span
                  className="rounded-full px-2.5 py-1 text-[12px] font-semibold text-slate-950"
                  style={{ background: STAGE_CONFIG[currentLead.stage].color }}
                >
                  {STAGE_CONFIG[currentLead.stage].label}
                </span>
                <span className="rounded-full bg-slate-800 px-2.5 py-1 text-[12px] text-slate-400">#{currentLead.leadNum}</span>
                {currentLead.tagIds.map((tid) => {
                  const tag = tags.find((t) => t.id === tid);
                  return tag ? <TagPill key={tid} tag={tag} /> : null;
                })}
              </div>
            </div>
          </div>

          <div className="mt-5 space-y-2">
            <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3.5">
              <div className="flex items-center gap-2.5 text-[17px] font-semibold text-slate-100">
                <Phone size={16} className="text-emerald-400" /> {formatPhone(currentLead.phone)}
              </div>
              <button
                onClick={() => copyPhone('phone')}
                className="flex items-center gap-1.5 rounded-full bg-emerald-900/40 px-3 py-1.5 text-[12.5px] font-semibold text-emerald-400 transition-colors hover:bg-emerald-900/70"
              >
                <Copy size={13} /> {copiedField === 'phone' ? 'Copied!' : 'Copy'}
              </button>
            </div>
            {currentLead.phone2 && (
              <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
                <div className="flex items-center gap-2.5 text-[15px] font-medium text-slate-300">
                  <Phone size={14} className="text-emerald-400" /> {formatPhone(currentLead.phone2)}
                  <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                    Alt
                  </span>
                </div>
                <button
                  onClick={() => copyPhone('phone2')}
                  className="flex items-center gap-1.5 rounded-full bg-emerald-900/40 px-3 py-1.5 text-[12.5px] font-semibold text-emerald-400 transition-colors hover:bg-emerald-900/70"
                >
                  <Copy size={13} /> {copiedField === 'phone2' ? 'Copied!' : 'Copy'}
                </button>
              </div>
            )}
          </div>

          {currentLead.address && (
            <div className="mt-3 flex items-start gap-2 text-[16px] font-semibold leading-snug text-amber-300">
              <MapPin size={17} className="mt-0.5 shrink-0 text-amber-400" />
              <span className="uppercase tracking-wide">{addressLine}</span>
            </div>
          )}

          <div className="mt-5 border-t border-slate-800 pt-4">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <Wrench size={12} /> Repairs Needed
            </div>
            <RepairsDropdown repairs={repairs} onChange={setRepairs} />
          </div>

          <div className="mt-5">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Property Rating (out of 10)</div>
            <div className="grid grid-cols-10 gap-1">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
                const filled = propertyRating !== null && n <= propertyRating;
                const selected = n === propertyRating;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setPropertyRating(n)}
                    style={filled ? { background: ratingColor(n) } : undefined}
                    className={`h-7 rounded-md border text-[11px] font-semibold transition-all ${
                      filled
                        ? `border-transparent text-slate-950 shadow-md ${selected ? 'scale-110 ring-2 ring-white/60' : ''}`
                        : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                    }`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="max-h-full overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900/50 p-6 shadow-xl shadow-black/20">
          <div className="mx-auto max-w-sm">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Call Outcome</div>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {OUTCOMES.map((o) => {
                const active = outcome === o.key;
                const Icon = o.icon;
                return (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setOutcome(o.key)}
                    style={
                      active
                        ? { background: STAGE_CONFIG[o.stage].color, boxShadow: `0 8px 18px -8px ${STAGE_CONFIG[o.stage].color}` }
                        : undefined
                    }
                    className={`flex flex-col items-center gap-0.5 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-all ${
                      active
                        ? 'scale-[1.03] border-transparent text-slate-950'
                        : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-600 hover:bg-slate-900'
                    }`}
                  >
                    <Icon size={13} />
                    {o.label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={copySmsMessage}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 py-2 text-[12px] font-semibold text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-900"
            >
              <MessageSquare size={13} /> {smsCopied ? 'Copied!' : 'Copy Text Message'}
            </button>

            {outcome === 'followup' && (
              <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2">
                <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <CalendarDays size={11} /> Follow-Up Date
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {followUpDays.map((d) => {
                    const active = followUpDate === d.iso;
                    return (
                      <button
                        key={d.iso}
                        type="button"
                        onClick={() => setFollowUpDate(d.iso)}
                        className={`flex flex-col items-center rounded-md border py-1 transition-colors ${
                          active
                            ? 'border-emerald-400 bg-emerald-400/10 text-emerald-300'
                            : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-600'
                        }`}
                      >
                        <span className="text-[8px] font-semibold uppercase">{d.weekday}</span>
                        <span className="text-[12px] font-bold text-slate-100">{d.day}</span>
                        <span className="text-[7.5px] uppercase text-slate-500">{d.month}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-500">Custom:</span>
                  <input
                    type="date"
                    value={followUpDate ?? ''}
                    onChange={(e) => setFollowUpDate(e.target.value || null)}
                    className="flex-1 rounded-md border border-slate-800 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-200 outline-none focus:border-emerald-600"
                  />
                  {followUpDate && (
                    <button type="button" onClick={() => setFollowUpDate(null)} className="text-slate-500 hover:text-slate-300">
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Activity chat history for this lead */}
            {leadActivities.length > 0 && (
              <div className="mt-3">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">History</div>
                <div className="max-h-40 space-y-2 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
                  {leadActivities.map((a) => {
                    const isRight = a.authorRole === 'admin';
                    const initials = a.authorName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
                    return (
                      <div key={a.id} className={`flex items-end gap-1.5 ${isRight ? 'flex-row-reverse' : ''}`}>
                        <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold ${isRight ? 'bg-emerald-900/60 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
                          {initials}
                        </div>
                        <div className={`max-w-[80%] rounded-xl px-2.5 py-1.5 text-[11px] leading-snug ${isRight ? 'rounded-br-sm border border-emerald-900/50 bg-emerald-950/40 text-emerald-100' : 'rounded-bl-sm border border-slate-800 bg-slate-900 text-slate-300'}`}>
                          <span className={`mr-1 text-[9px] font-semibold opacity-60`}>[{a.type}]</span>
                          {a.body}
                          <div className={`mt-0.5 text-[9px] opacity-40 ${isRight ? 'text-right' : ''}`}>{a.authorName}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Notes for this call</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What did they say? Objections, timeline, condition details…"
              className="mt-1.5 h-24 w-full resize-none rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-[13px] text-slate-200 outline-none transition-colors placeholder:text-slate-600 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600/40"
            />

            <button
              onClick={saveAndNext}
              disabled={!outcome}
              title={!outcome ? 'Select a call outcome first' : undefined}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 py-2.5 text-[13.5px] font-bold text-slate-950 shadow-lg shadow-emerald-500/20 transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
            >
              Save & Next <ArrowRight size={15} />
            </button>

            <div className="mt-2.5 flex flex-wrap justify-center gap-1.5">
              {SHORTCUT_LEGEND.map((s) => (
                <span
                  key={s.key}
                  className="flex items-center gap-1 rounded-full border border-slate-800 bg-slate-950/60 px-2 py-1 text-[10.5px] text-slate-500"
                >
                  <kbd className="rounded bg-slate-800 px-1 font-mono text-slate-300">{s.key}</kbd> {s.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="max-h-full overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900/50 p-5 shadow-xl shadow-black/20">
          <div className="mb-4 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <span className="flex items-center gap-1.5">
              <FileText size={13} /> Call Script
            </span>
            {script.status === 'saving' && <span className="text-slate-500">Saving…</span>}
            {script.status === 'saved' && <span className="text-emerald-400">Saved</span>}
          </div>
          <ScriptStep index={1} title="Introduction & Permission">
            <ScriptSay>
              "Hi, is this <b className="text-white">{fullName}</b>? My name is <b className="text-amber-300">{callerName}</b>. I'm calling
              about the property at <b className="text-amber-300">{addressLine}</b>. Do you have a few minutes to talk about it?"
            </ScriptSay>
            <ScriptSay>
              "So we are basically an acquisition company — we help homeowners solve problems regarding their properties. We have access to
              public records and we came across your property there, that's how we got your address and number. We are interested in your
              house."
            </ScriptSay>
          </ScriptStep>
          <ScriptStep index={2} title="Confirm They Want to Sell">
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-[13px] text-slate-300">
              › Are you interested in selling your house for the right price?
              <div className="mt-2 flex gap-2">
                <span className="rounded-md border border-emerald-800 bg-emerald-950/60 px-2.5 py-1 text-[12px] text-emerald-400">✓ Yes</span>
                <span className="rounded-md border border-red-800 bg-red-950/60 px-2.5 py-1 text-[12px] text-red-400">✗ No</span>
              </div>
            </div>
          </ScriptStep>
          {SCRIPT_STEPS.map((step, i) => (
            <ScriptStep key={step.key} index={i + 3} title={step.title}>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-[13px] text-slate-300">{step.prompt}</div>
              {step.multiline ? (
                <textarea
                  value={script.answers[step.key] ?? ''}
                  onChange={(e) => script.setAnswer(step.key, e.target.value)}
                  placeholder="Type their answer…"
                  rows={2}
                  className="w-full resize-none rounded-xl border border-slate-800 bg-slate-950/60 p-2.5 text-[13px] text-slate-200 outline-none transition-colors placeholder:text-slate-600 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600/40"
                />
              ) : (
                <input
                  value={script.answers[step.key] ?? ''}
                  onChange={(e) => script.setAnswer(step.key, e.target.value)}
                  placeholder="Type their answer…"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/60 p-2.5 text-[13px] text-slate-200 outline-none transition-colors placeholder:text-slate-600 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600/40"
                />
              )}
            </ScriptStep>
          ))}
        </div>
      </div>
    </div>
  );
}
