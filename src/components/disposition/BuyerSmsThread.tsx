import { useState } from 'react';
import { Loader2, MessageSquare, Send } from 'lucide-react';
import { useBuyerThread, useSendBuyerSms } from '@/hooks/useBuyerMessages';
import { useSmsNumberLabels } from '@/hooks/useSmsNumberLabels';
import { formatDateTime, formatPhone } from '@/lib/utils';
import { SMS_NUMBER_KEYS, type SmsNumberKey } from '@/lib/smsNumbers';
import type { CashBuyer } from '@/types/domain';

export function BuyerSmsThread({ buyer }: { buyer: CashBuyer }) {
  const { data: thread = [], isLoading } = useBuyerThread(buyer.id);
  const { data: numberLabels } = useSmsNumberLabels();
  const sendSms = useSendBuyerSms();
  const [message, setMessage] = useState('');
  const [fromKey, setFromKey] = useState<SmsNumberKey>('1');
  const [error, setError] = useState<string | null>(null);

  function displayNumber(key: SmsNumberKey) {
    const phone = numberLabels?.[key]?.phoneNumber;
    return phone ? formatPhone(phone).replace(/^\+1/, '') : `Number ${key}`;
  }

  const pinnedNumber = buyer.assignedSmsNumber as SmsNumberKey | null;

  async function handleSend() {
    if (!message.trim()) return;
    setError(null);
    try {
      await sendSms.mutateAsync({ buyerId: buyer.id, body: message.trim(), fromKey: pinnedNumber ?? fromKey });
      setMessage('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed.');
    }
  }

  if (!buyer.phone) {
    return (
      <div className="card">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-text">
          <MessageSquare size={15} /> SMS Thread
        </h2>
        <p className="mt-3 text-[13px] text-text-3">Add a phone number for this buyer to text them.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-text">
          <MessageSquare size={15} /> SMS Thread
        </h2>
        <div className="flex items-center gap-2 text-[12px] text-text-3">
          {buyer.smsOptedOut && <span className="rounded-full bg-danger-dim px-2 py-0.5 font-semibold text-danger">Opted out</span>}
          <span>
            {thread.filter((m) => m.direction === 'inbound').length} repl
            {thread.filter((m) => m.direction === 'inbound').length === 1 ? 'y' : 'ies'}
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Loading conversation…
        </div>
      ) : thread.length === 0 ? (
        <div className="py-8 text-center text-[13px] text-text-3">No texts with this buyer yet.</div>
      ) : (
        <div className="max-h-[420px] space-y-2 overflow-y-auto rounded-md border border-border-2 bg-surface-3 p-3">
          {thread.map((m) => (
            <div key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[75%] rounded-lg px-3 py-2 text-[13px] ${
                  m.direction === 'outbound' ? 'bg-primary text-white' : 'border border-border-2 bg-surface text-text'
                }`}
              >
                <div className="whitespace-pre-wrap">{m.body}</div>
                <div className={`mt-0.5 text-[10px] ${m.direction === 'outbound' ? 'text-white/60' : 'text-text-3'}`}>{formatDateTime(m.at)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {buyer.smsOptedOut ? (
        <div className="mt-3 rounded-md border border-danger/40 bg-danger-dim px-3 py-2 text-[12px] text-danger">
          This buyer opted out — sending is disabled to respect that.
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <textarea
            className="input min-h-[60px] w-full"
            placeholder="Type a message…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className="flex items-center justify-between gap-2">
            {pinnedNumber ? (
              <span
                className="rounded-full bg-border-2 px-2 py-1 text-[12px] font-semibold text-text-2"
                title="This buyer's whole thread lives on this number — every message keeps going out from it."
              >
                Sending from {displayNumber(pinnedNumber)}
              </span>
            ) : (
              <div className="flex gap-1">
                {SMS_NUMBER_KEYS.map((key) => (
                  <button
                    key={key}
                    onClick={() => setFromKey(key)}
                    className={`btn !px-2 !py-1 text-[12px] ${fromKey === key ? 'btn-primary' : ''}`}
                  >
                    {displayNumber(key)}
                  </button>
                ))}
              </div>
            )}
            <button onClick={handleSend} disabled={sendSms.isPending || !message.trim()} className="btn btn-primary flex items-center gap-1.5">
              {sendSms.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              Send
            </button>
          </div>
          {error && <div className="rounded-md border border-danger/40 bg-danger-dim px-3 py-2 text-[12px] text-danger">{error}</div>}
        </div>
      )}
    </div>
  );
}
