import { useState } from 'react';
import { History, Loader2 } from 'lucide-react';
import { CardHeader } from '@/components/ui/CardHeader';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { supabase } from '@/lib/supabase';
import { getErrorMessage } from '@/lib/utils';

interface OrphanReport {
  scanned: number;
  ownNumberCandidates: number;
  matched: number;
  unmatchedIds: string[];
  inserted: number;
  alreadyPresent: number;
  leadsTouched: { leadId: string; name: string; count: number }[];
  errors: string[];
  commit: boolean;
}

async function callRecovery(commit: boolean): Promise<OrphanReport> {
  const { data, error } = await supabase.functions.invoke('sms-backfill', {
    body: { mode: 'recover_orphaned_outbound', commit },
  });
  if (error) {
    const errBody = await error.context?.json?.().catch(() => null);
    throw new Error(errBody?.error || error.message);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as OrphanReport;
}

/**
 * One-time (re-run-safe) recovery tool for a specific, now-fixed class of
 * stranded SMS history: before 2026-08-29 (see sms-webhook's
 * sentFromOwnNumber branch), a text sent directly from the Zoom Phone app —
 * bypassing this CRM entirely — got stranded in inbound_messages with no
 * lead_id, so it never reached the thread's outbound side. A lead with real
 * two-way history from before that date shows only the lead's own replies,
 * never ours. This calls sms-backfill's recover_orphaned_outbound mode,
 * which finds exactly those rows and replays the same fix sms-webhook now
 * applies live. Preview first (writes nothing), then Recover — both run
 * under this admin's own session, so no internal secret needs handling here.
 */
export function SmsOrphanRecoveryCard() {
  const [report, setReport] = useState<OrphanReport | null>(null);
  const [loading, setLoading] = useState<'preview' | 'commit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function runPreview() {
    setLoading('preview');
    setError(null);
    try {
      setReport(await callRecovery(false));
    } catch (e) {
      setError(getErrorMessage(e, 'Preview failed.'));
    } finally {
      setLoading(null);
    }
  }

  async function runCommit() {
    setConfirmOpen(false);
    setLoading('commit');
    setError(null);
    try {
      setReport(await callRecovery(true));
    } catch (e) {
      setError(getErrorMessage(e, 'Recovery failed.'));
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="card">
      <CardHeader icon={History} title="SMS History Recovery" />
      <p className="mt-1 text-[13px] text-text-2">
        One-time fix for threads with real conversation history from before Aug 29, 2026 that only ever show the
        lead's side — our own texts sent directly from the Zoom app were silently stranded before that date's fix.
        Preview first to see what it would recover, then run it to actually write those messages back into the
        affected leads' threads. Safe to re-run — already-recovered messages are skipped.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className="btn" disabled={loading !== null} onClick={runPreview}>
          {loading === 'preview' ? <Loader2 size={13} className="animate-spin" /> : null}
          Preview
        </button>
        {report && !report.commit && report.matched > 0 && (
          <button className="btn btn-primary" disabled={loading !== null} onClick={() => setConfirmOpen(true)}>
            {loading === 'commit' ? <Loader2 size={13} className="animate-spin" /> : null}
            Recover {report.matched} message{report.matched === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {error && <div className="mt-3 rounded-md border border-danger/40 bg-danger-dim px-3 py-2 text-[12px] text-danger">{error}</div>}

      {report && (
        <div className="mt-4 rounded-md border border-border-2 bg-surface-3 p-3 text-[12px] text-text-2">
          <div className="font-semibold text-text">{report.commit ? 'Recovery result' : 'Preview result'}</div>
          <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            <div>Scanned: {report.scanned}</div>
            <div>Our-number sends: {report.ownNumberCandidates}</div>
            <div>Matched to a lead: {report.matched}</div>
            <div>Unmatched: {report.unmatchedIds.length}</div>
            {report.commit && <div>Inserted: {report.inserted}</div>}
            {report.commit && <div>Already present: {report.alreadyPresent}</div>}
          </div>
          {report.leadsTouched.length > 0 && (
            <div className="mt-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Leads affected</div>
              <div className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
                {report.leadsTouched.map((l) => (
                  <div key={l.leadId}>
                    {l.name} — {l.count} message{l.count === 1 ? '' : 's'}
                  </div>
                ))}
              </div>
            </div>
          )}
          {report.errors.length > 0 && (
            <div className="mt-2 text-danger">
              {report.errors.length} error{report.errors.length === 1 ? '' : 's'} — see function logs for detail.
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Recover these messages?"
        message={`This writes ${report?.matched ?? 0} message${report?.matched === 1 ? '' : 's'} into the affected leads' SMS threads. Additive only — nothing is deleted or changed.`}
        confirmLabel="Recover"
        onConfirm={runCommit}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
