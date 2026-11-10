import { useMemo, useState } from 'react';
import { Check, Mail, MessageSquare, Smartphone } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useAllDealPackets, packetUrl } from '@/hooks/useDealPackets';
import { useSendDispositionPacket } from '@/hooks/useDisposition';
import type { CashBuyer, DispositionChannel } from '@/types/domain';
import { cn, formatCurrency, getErrorMessage } from '@/lib/utils';

type Step = 'channel' | 'deal' | 'review';
const STEPS: Array<{ key: Step; label: string }> = [
  { key: 'channel', label: 'Channel' },
  { key: 'deal', label: 'Deal' },
  { key: 'review', label: 'Review & send' },
];

const DEFAULT_TEMPLATE =
  'Hi {{first_name}}, new off-market deal in {{city}}: {{prop_type}}, {{price}}, ARV {{arv}}. Photos, numbers and comps here: {{link}}';

/** 3-step send flow — Channel, Deal, Review & send — matching the exact
 *  flow the user specced from their reference video. Sends via the real
 *  send-disposition-packet function (Zoom SMS + SMTP email, same
 *  infrastructure every other outbound message in this CRM already uses),
 *  logging a disposition_sends/recipients row so Phase 2 (the per-deal
 *  "Deal Room" with buyer replies) has something real to read from. */
export function SendDealPacketModal({ buyers, stateLabel, onClose }: { buyers: CashBuyer[]; stateLabel: string; onClose: () => void }) {
  const { data: packets = [], isLoading: packetsLoading } = useAllDealPackets();
  const send = useSendDispositionPacket();

  const [step, setStep] = useState<Step>('channel');
  const [channel, setChannel] = useState<DispositionChannel>('sms');
  const [packetId, setPacketId] = useState<string | null>(null);
  const [message, setMessage] = useState(DEFAULT_TEMPLATE);
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const smsCount = buyers.filter((b) => !!b.phone && !b.smsOptedOut).length;
  const emailCount = buyers.filter((b) => !!b.email).length;

  const readyPackets = useMemo(() => packets.filter((p) => p.status === 'active'), [packets]);
  const selectedPacket = readyPackets.find((p) => p.id === packetId) ?? null;

  const previewText = useMemo(() => {
    if (!selectedPacket) return message;
    const link = packetUrl(selectedPacket.slug);
    return message
      .replace(/\{\{\s*first_name\s*\}\}/gi, 'Ivan')
      .replace(/\{\{\s*city\s*\}\}/gi, selectedPacket.city ?? stateLabel)
      .replace(/\{\{\s*prop_type\s*\}\}/gi, selectedPacket.propType ?? 'property')
      .replace(/\{\{\s*price\s*\}\}/gi, selectedPacket.purchasePrice != null ? formatCurrency(selectedPacket.purchasePrice) : '—')
      .replace(/\{\{\s*arv\s*\}\}/gi, selectedPacket.arv != null ? formatCurrency(selectedPacket.arv) : '—')
      .replace(/\{\{\s*link\s*\}\}/gi, link);
  }, [message, selectedPacket, stateLabel]);

  function goDeal() {
    setStep('deal');
  }
  function goReview() {
    if (!selectedPacket) return;
    const link = packetUrl(selectedPacket.slug);
    setMessage((prev) =>
      prev.includes('{{link}}') && !prev.includes(link)
        ? prev
            .replace(/\{\{\s*city\s*\}\}/gi, selectedPacket.city ?? stateLabel)
            .replace(/\{\{\s*prop_type\s*\}\}/gi, selectedPacket.propType ?? 'property')
            .replace(/\{\{\s*price\s*\}\}/gi, selectedPacket.purchasePrice != null ? formatCurrency(selectedPacket.purchasePrice) : '—')
            .replace(/\{\{\s*arv\s*\}\}/gi, selectedPacket.arv != null ? formatCurrency(selectedPacket.arv) : '—')
        : prev,
    );
    setStep('review');
  }

  async function handleSend() {
    if (!selectedPacket) return;
    setError(null);
    try {
      const finalMessage = message.replace(/\{\{\s*link\s*\}\}/gi, packetUrl(selectedPacket.slug));
      const res = await send.mutateAsync({
        packetId: selectedPacket.id,
        buyerIds: buyers.map((b) => b.id),
        channel,
        message: finalMessage,
        subject: `New off-market deal${selectedPacket.city ? ` in ${selectedPacket.city}` : ''}`,
      });
      setResult({ sent: res.sent, failed: res.failed });
    } catch (e) {
      setError(getErrorMessage(e, 'Failed to send the deal packet.'));
    }
  }

  return (
    <Modal open onClose={onClose} title="Send deal packet" width="lg">
      <p className="mb-4 -mt-1 text-[13px] text-text-3">
        To {buyers.length} selected buyer{buyers.length === 1 ? '' : 's'} · {stateLabel}
      </p>

      {!result && (
        <div className="mb-5 flex items-center gap-2">
          {STEPS.map((s, i) => {
            const isDone = STEPS.findIndex((x) => x.key === step) > i;
            const isCurrent = s.key === step;
            return (
              <div key={s.key} className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold',
                    isCurrent ? 'bg-primary text-white' : isDone ? 'bg-success text-white' : 'bg-surface-3 text-text-3',
                  )}
                >
                  {isDone ? <Check size={12} /> : i + 1}
                </span>
                <span className={cn('text-[12.5px] font-medium', isCurrent ? 'text-text' : 'text-text-3')}>{s.label}</span>
                {i < STEPS.length - 1 && <div className="h-px w-8 bg-border" />}
              </div>
            );
          })}
        </div>
      )}

      {result ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success-dim text-success">
            <Check size={26} />
          </span>
          <div className="text-[16px] font-bold text-text">Deal packet sent to {result.sent} buyer{result.sent === 1 ? '' : 's'}</div>
          {result.failed > 0 && <div className="text-[12.5px] text-danger">{result.failed} failed to send — they likely have no valid phone/email on file.</div>}
          <button className="btn btn-primary !mt-2" onClick={onClose}>
            Back to map
          </button>
        </div>
      ) : step === 'channel' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2.5">
            {(
              [
                { key: 'sms', label: 'Bulk SMS', icon: MessageSquare, sub: `${smsCount} of ${buyers.length} have a mobile number` },
                { key: 'email', label: 'Email', icon: Mail, sub: `${emailCount} of ${buyers.length} have an email` },
                { key: 'both', label: 'SMS + email', icon: Smartphone, sub: 'Reach every buyer both ways' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setChannel(opt.key)}
                className={cn(
                  'flex flex-col items-start gap-2 rounded-lg border p-3.5 text-left transition-colors',
                  channel === opt.key ? 'border-primary bg-primary-dim' : 'border-border-2 bg-surface hover:bg-surface-3',
                )}
              >
                <opt.icon size={18} className={channel === opt.key ? 'text-primary-text' : 'text-text-3'} />
                <span className="text-[13.5px] font-semibold text-text">{opt.label}</span>
                <span className="text-[11.5px] text-text-3">{opt.sub}</span>
              </button>
            ))}
          </div>
          <div className="flex justify-end pt-2">
            <button className="btn btn-primary" onClick={goDeal}>
              Next
            </button>
          </div>
        </div>
      ) : step === 'deal' ? (
        <div className="space-y-3">
          <div className="text-[13px] font-medium text-text-2">Which deal are you sending?</div>
          {packetsLoading && <div className="py-8 text-center text-[13px] text-text-3">Loading deals…</div>}
          {!packetsLoading && readyPackets.length === 0 && (
            <div className="rounded-md border border-dashed border-border-2 py-8 text-center text-[13px] text-text-3">
              No active deal packets yet — build one from a lead's Underwriting tab first.
            </div>
          )}
          <div className="max-h-[320px] space-y-2 overflow-y-auto">
            {readyPackets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPacketId(p.id)}
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors',
                  packetId === p.id ? 'border-primary bg-primary-dim' : 'border-border-2 bg-surface hover:bg-surface-3',
                )}
              >
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-semibold text-text">
                    {p.address ?? p.leadName ?? 'Property'} {p.city ? `· ${p.city}, ${p.state}` : ''}
                  </div>
                  <div className="truncate text-[12px] text-text-3">
                    {[p.beds != null ? `${p.beds} bd` : null, p.baths != null ? `${p.baths} ba` : null, p.propType].filter(Boolean).join(' · ')}
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-text-2">
                    {p.purchasePrice != null ? `${formatCurrency(p.purchasePrice)} price` : ''}
                    {p.arv != null ? ` · ${formatCurrency(p.arv)} ARV` : ''}
                    {p.estRepairs != null ? ` · ~${formatCurrency(p.estRepairs)} repairs` : ''}
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-success-dim px-2 py-0.5 text-[11px] font-medium text-success">Packet ready</span>
              </button>
            ))}
          </div>
          <div className="flex justify-between pt-2">
            <button className="btn" onClick={() => setStep('channel')}>
              Back
            </button>
            <button className="btn btn-primary" onClick={goReview} disabled={!selectedPacket}>
              Next
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[1fr_200px] gap-4">
          <div className="space-y-2">
            <label className="label">Message</label>
            <textarea className="input min-h-[140px] resize-none text-[13px]" value={message} onChange={(e) => setMessage(e.target.value)} />
            <div className="flex flex-wrap gap-1.5">
              {['{{first_name}}', '{{city}}', '{{price}}', '{{arv}}'].map((tok) => (
                <button key={tok} type="button" className="rounded-full border border-border-2 bg-surface px-2 py-0.5 text-[11px] text-text-2 hover:bg-surface-3" onClick={() => setMessage((m) => `${m} ${tok}`)}>
                  + {tok.replace(/[{}]/g, '')}
                </button>
              ))}
              <span className="rounded-full bg-success-dim px-2 py-0.5 text-[11px] font-medium text-success">Packet link included</span>
            </div>
            {error && <div className="rounded-md border border-danger/40 bg-danger-dim px-3 py-2 text-[12.5px] text-danger">{error}</div>}
            <p className="text-[11.5px] text-text-3">
              Sending to {buyers.length} buyers by {channel === 'sms' ? 'Bulk SMS' : channel === 'email' ? 'Email' : 'SMS + email'}. Each buyer gets this link from their own packet page.
            </p>
            <div className="flex justify-between pt-1">
              <button className="btn" onClick={() => setStep('deal')}>
                Back
              </button>
              <button className="btn btn-primary" onClick={handleSend} disabled={send.isPending}>
                {send.isPending ? 'Sending…' : `Send to ${buyers.length} buyer${buyers.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-surface-3 p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">Preview</div>
            <div className="rounded-lg bg-primary px-3 py-2 text-[12.5px] leading-snug text-white">{previewText}</div>
          </div>
        </div>
      )}
    </Modal>
  );
}
