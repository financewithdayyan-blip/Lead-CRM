import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileSignature } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useDocTemplates, type DocTemplate } from '@/hooks/useDocTemplates';
import { FillCashDealContractModal, isCashDealTemplate } from '@/components/bluedocs/FillCashDealContractModal';
import { FillNovationContractModal, isNovationTemplate } from '@/components/bluedocs/FillNovationContractModal';
import { SendContractModal } from '@/components/bluedocs/SendContractModal';
import type { DeliveryResult } from '@/hooks/useContractInstances';
import type { Lead } from '@/types/domain';

function summarizeDelivery(delivery: DeliveryResult): { ok: boolean; message: string } {
  const sent: string[] = [];
  const failed: string[] = [];
  if (delivery.sms.attempted) (delivery.sms.sent ? sent : failed).push('text');
  if (delivery.email.attempted) (delivery.email.sent ? sent : failed).push('email');
  if (sent.length && !failed.length) return { ok: true, message: `Sent by ${sent.join(' and ')} — they should have it now.` };
  if (sent.length && failed.length) {
    return { ok: false, message: `Sent by ${sent.join(' and ')}, but the ${failed.join(' and ')} send failed. Share the link below directly to be safe.` };
  }
  if (failed.length) return { ok: false, message: `The ${failed.join(' and ')} send failed. Copy the link below and send it yourself.` };
  return { ok: false, message: 'No delivery method was selected. Copy the link below and send it yourself.' };
}

export function CreateContractButton({ lead }: { lead: Lead }) {
  const { data: rawTemplates = [] } = useDocTemplates('contract');
  // The cash-deal PSA is the template used for the overwhelming majority of
  // deals — worth surfacing first rather than making it one of 8 alphabetic-
  // ish options to hunt through every time.
  const templates = [...rawTemplates].sort((a, b) => Number(isCashDealTemplate(b.id)) - Number(isCashDealTemplate(a.id)));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sendTarget, setSendTarget] = useState<DocTemplate | null>(null);
  const [sentLink, setSentLink] = useState<{ label: string; url: string; delivery: DeliveryResult } | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    function onClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [pickerOpen]);

  function handleClick() {
    if (templates.length === 0) return;
    if (templates.length === 1) setSendTarget(templates[0]);
    else setPickerOpen((v) => !v);
  }

  const sellerName = `${lead.firstName} ${lead.lastName}`.trim();
  const initialSeller = { name: sellerName, phone: lead.phone ?? '', email: lead.email ?? '' };
  const initialAddress = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ');
  const initialPurchasePrice = lead.maxOffer != null ? String(lead.maxOffer) : '';

  return (
    <div className="relative" ref={pickerRef}>
      <button
        className="btn btn-primary !px-3 !py-1.5 text-[12.5px] disabled:cursor-not-allowed disabled:opacity-50"
        onClick={handleClick}
        disabled={templates.length === 0}
        title={templates.length === 0 ? 'No contract templates yet — add one in Blue Docs' : undefined}
      >
        <FileSignature size={13} /> Create Contract
        {templates.length > 1 && <ChevronDown size={12} />}
      </button>

      {pickerOpen && templates.length > 1 && (
        <div className="absolute left-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-lg border border-border-2 bg-surface shadow-lg">
          {templates.map((t) => (
            <button
              key={t.id}
              className="flex w-full items-center px-3 py-2 text-left text-[13px] text-text hover:bg-surface-2"
              onClick={() => { setSendTarget(t); setPickerOpen(false); }}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {sendTarget && isCashDealTemplate(sendTarget.id) && (
        <FillCashDealContractModal
          template={sendTarget}
          leadId={lead.id}
          initialSeller={initialSeller}
          initialAddress={initialAddress}
          initialPurchasePrice={initialPurchasePrice}
          onClose={() => setSendTarget(null)}
          onSent={(l) => { setSendTarget(null); setSentLink(l); }}
        />
      )}

      {sendTarget && isNovationTemplate(sendTarget.id) && (
        <FillNovationContractModal
          template={sendTarget}
          leadId={lead.id}
          initialSeller={initialSeller}
          onClose={() => setSendTarget(null)}
          onSent={(l) => { setSendTarget(null); setSentLink(l); }}
        />
      )}

      {sendTarget && !isCashDealTemplate(sendTarget.id) && !isNovationTemplate(sendTarget.id) && (
        <SendContractModal
          template={sendTarget}
          leadId={lead.id}
          initialAddress={initialAddress}
          onClose={() => setSendTarget(null)}
          onSent={(l) => { setSendTarget(null); setSentLink(l); }}
        />
      )}

      {sentLink && (() => {
        const summary = summarizeDelivery(sentLink.delivery);
        return (
          <Modal open onClose={() => setSentLink(null)} title={summary.ok ? 'Invitation sent' : 'Invitation created'} width="sm">
            <p className={`text-[13px] ${summary.ok ? 'text-text-2' : 'text-warning'}`}>{summary.message}</p>
            <div className="mt-3 rounded-md border border-border-2 bg-surface-3 p-2.5">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-3">{sentLink.label}</div>
              <input readOnly className="input w-full !text-[11px]" value={sentLink.url} onFocus={(e) => e.target.select()} />
            </div>
            <button className="btn btn-primary mt-4 w-full" onClick={() => setSentLink(null)}>
              Done
            </button>
          </Modal>
        );
      })()}
    </div>
  );
}
