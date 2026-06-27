import { useEffect, useRef, useState } from 'react';
import { useUpdateLead } from './useLeads';
import type { Lead, ScriptAnswers } from '@/types/domain';

const SAVE_DEBOUNCE_MS = 800;

/**
 * Local answers state for a lead's call script, auto-saved to
 * leads.script_answers after a pause in typing. `lead` may be null/undefined
 * (e.g. while a call session is still loading its queue) - call this
 * unconditionally and it no-ops until a lead is available.
 */
export function useScriptAnswers(lead: Lead | null | undefined) {
  const updateLead = useUpdateLead();
  const [answers, setAnswers] = useState<ScriptAnswers>(lead?.scriptAnswers ?? {});
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const leadId = lead?.id;

  // Switching to a different lead resets local state to that lead's saved answers.
  useEffect(() => {
    setAnswers(lead?.scriptAnswers ?? {});
    dirtyRef.current = false;
    setStatus('idle');
    if (timerRef.current) clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  function setAnswer(key: keyof ScriptAnswers, value: string) {
    if (!leadId) return;
    dirtyRef.current = true;
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }

  useEffect(() => {
    if (!dirtyRef.current || !leadId) return;
    setStatus('saving');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      updateLead.mutate({ id: leadId, scriptAnswers: answers }, { onSuccess: () => setStatus('saved') });
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, leadId]);

  return { answers, setAnswer, status };
}
