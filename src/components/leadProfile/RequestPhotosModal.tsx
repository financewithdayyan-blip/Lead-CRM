import { useState } from 'react';
import { Camera, Check, Copy, MessageSquareText } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useCreateCaptureSession } from '@/hooks/usePhotoCapture';
import { useSendManualReply } from '@/hooks/useLeadMessages';
import type { Lead } from '@/types/domain';
import type { SmsNumberKey } from '@/lib/smsNumbers';

/** The button that starts a guided, camera-only photo request — replaces
 *  "ask the seller to text some photos" with a link that walks them through
 *  a fixed shot list (exterior, kitchen, rooms, bathrooms, basement) using
 *  their phone's live camera, one photo at a time. See CapturePage. */
export function RequestPhotosButton({ lead }: { lead: Lead }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const createSession = useCreateCaptureSession();
  const sendReply = useSendManualReply();
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleOpen() {
    setOpen(true);
    setSent(false);
    setCopied(false);
    const { token } = await createSession.mutateAsync(lead.id);
    // The SPA is served under the /crm basename (BrowserRouter basename="/crm",
    // see App.tsx) — location.origin alone is just the bare domain.
    setLink(`${window.location.origin}/crm/capture/${token}`);
  }

  function copyLink() {
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function sendViaSms() {
    if (!link) return;
    const name = lead.firstName ? ` ${lead.firstName}` : '';
    const body = `Hi${name}, could you take a few quick photos of the property for us? Just tap this link — it'll guide you through it: ${link}`;
    sendReply.mutate(
      { leadId: lead.id, body, fromKey: (lead.assignedSmsNumber as SmsNumberKey | null) ?? '1' },
      { onSuccess: () => setSent(true) },
    );
  }

  return (
    <>
      <button onClick={handleOpen} className="btn">
        <Camera size={14} /> Request Photos
      </button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title="Request photos from seller" width="sm">
          <div className="space-y-4">
            <p className="text-[13px] text-text-2">
              Send this link to the seller — it opens a guided, camera-only flow on their phone (exterior, kitchen, rooms, bathrooms,
              basement) and uploads each photo straight to this lead as they take it. No app, no file picker.
            </p>
            {!link ? (
              <div className="text-[13px] text-text-3">Creating link…</div>
            ) : (
              <>
                <div className="flex items-center gap-2 rounded-md border border-border-2 bg-surface-3 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-text-2">{link}</span>
                  <button onClick={copyLink} className="btn !px-2 !py-1 shrink-0 text-[12px]">
                    {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                {lead.phone && (
                  <button onClick={sendViaSms} disabled={sendReply.isPending || sent} className="btn btn-primary w-full">
                    <MessageSquareText size={14} /> {sent ? 'Sent via SMS' : sendReply.isPending ? 'Sending…' : 'Send via SMS'}
                  </button>
                )}
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
