import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Mail } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useCreateBulkEmailJob } from '@/hooks/useBulkEmail';
import { MergeTagButtons } from '@/components/sms/MergeTagButtons';
import { getErrorMessage } from '@/lib/utils';
import type { Lead } from '@/types/domain';

export function BulkEmailModal({ leads, onClose }: { leads: Lead[]; onClose: () => void }) {
  const navigate = useNavigate();
  const createJob = useCreateBulkEmailJob();

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);

  const noEmailCount = leads.filter((l) => !l.email?.trim()).length;
  const optedOutCount = leads.filter((l) => l.email?.trim() && l.emailOptedOut).length;
  const sendableCount = leads.length - noEmailCount - optedOutCount;

  async function handleSend() {
    setError(null);
    setStarting(true);
    try {
      const job = await createJob.mutateAsync({ leads, config: { subject, body } });
      navigate(`/bulk-email/history/${job.id}`);
      onClose();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not start the send.'));
      setStarting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Send Bulk Email" width="lg">
      <div className="space-y-4">
        <div className="rounded-md border border-border-2 bg-surface-3 px-3 py-2 text-[13px] text-text-2">
          <strong className="text-text">{leads.length}</strong> lead{leads.length !== 1 ? 's' : ''} selected
          {(noEmailCount > 0 || optedOutCount > 0) && (
            <span className="text-text-3">
              {' '}
              ·{noEmailCount > 0 ? ` ${noEmailCount} with no email` : ''}
              {noEmailCount > 0 && optedOutCount > 0 ? ',' : ''}
              {optedOutCount > 0 ? ` ${optedOutCount} unsubscribed` : ''} — {sendableCount} sendable
            </span>
          )}
        </div>

        <div>
          <label className="label">Subject</label>
          <input
            className="input"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="We'd still like to make you an offer on {{address}}"
          />
        </div>

        <div>
          <label className="label">Message</label>
          <textarea
            ref={bodyTextareaRef}
            className="input min-h-[160px]"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Hi {{first_name}}, we tried reaching you by text about your property at {{address}}..."
          />
          <div className="mt-1.5">
            <MergeTagButtons getTextarea={() => bodyTextareaRef.current} value={body} onChange={setBody} />
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-md border border-border-2 bg-surface-3 px-3 py-2 text-[12px] text-text-2">
          <Mail size={14} className="mt-0.5 shrink-0 text-text-3" />
          Every email includes a one-click unsubscribe link — a lead who clicks it is excluded from all future bulk
          emails automatically, independent of their SMS opt-out status.
        </div>

        {error && (
          <div className="rounded-md border border-danger/40 bg-danger-dim px-3 py-2 text-[13px] text-danger">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <button className="btn" onClick={onClose} disabled={starting}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSend}
            disabled={starting || sendableCount === 0 || !subject.trim() || !body.trim()}
          >
            {starting ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Starting…
              </>
            ) : (
              <>
                <Mail size={14} /> Send to {sendableCount}
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
