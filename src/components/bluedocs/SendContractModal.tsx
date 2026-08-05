import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useGenerateContract } from '@/hooks/useContractInstances';
import { roleLabel, type DocTemplate } from '@/hooks/useDocTemplates';

/**
 * Just enough to identify the deal and both parties — no CRM lead lookup,
 * and neither party's own fields (name, amount, etc.) are collected here.
 * The "buyer" role (shown as "Us" for an LOI) always goes first and fills in
 * their own fields on their signing page; the seller sees what was already
 * entered and fills in the rest on theirs.
 */
export function SendContractModal({
  template,
  onClose,
  onSent,
}: {
  template: DocTemplate;
  onClose: () => void;
  onSent: (links: { seller: string; buyer: string }) => void;
}) {
  const generate = useGenerateContract();
  const firstRoleLabel = roleLabel('buyer', template.type);

  const [name, setName] = useState(template.name);
  const [sellerName, setSellerName] = useState('');
  const [sellerEmail, setSellerEmail] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim() && sellerName.trim() && buyerName.trim();

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const { parties } = await generate.mutateAsync({
        templateId: template.id,
        name: name.trim(),
        fieldValues: {},
        parties: [
          { role: 'buyer', name: buyerName.trim(), email: buyerEmail.trim(), signOrder: 1 },
          { role: 'seller', name: sellerName.trim(), email: sellerEmail.trim(), signOrder: 2 },
        ],
      });
      const seller = parties.find((p) => p.role === 'seller')!;
      const buyer = parties.find((p) => p.role === 'buyer')!;
      onSent({
        seller: `${window.location.origin}/crm/sign/${seller.access_token}`,
        buyer: `${window.location.origin}/crm/sign/${buyer.access_token}`,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Invite to Sign — "${template.name}"`} width="md">
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-text-2">Document name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-border-2 p-3">
            <div className="mb-2 text-[12px] font-semibold text-text">{firstRoleLabel} — fills in first</div>
            <input
              className="input mb-1.5"
              placeholder={firstRoleLabel === 'Us' ? 'Your name or company' : 'Name'}
              value={buyerName}
              onChange={(e) => setBuyerName(e.target.value)}
            />
            <input className="input" placeholder="Email (optional)" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} />
          </div>
          <div className="rounded-md border border-border-2 p-3">
            <div className="mb-2 text-[12px] font-semibold text-text">Seller — reviews after</div>
            <input className="input mb-1.5" placeholder="Name" value={sellerName} onChange={(e) => setSellerName(e.target.value)} />
            <input className="input" placeholder="Email (optional)" value={sellerEmail} onChange={(e) => setSellerEmail(e.target.value)} />
          </div>
        </div>

        <p className="text-[12px] text-text-3">
          {firstRoleLabel === 'Us'
            ? "We fill in our own fields and sign first. Once that's done, the seller's link unlocks — they'll see everything we entered, fill in the rest, and sign."
            : "The buyer fills in their own fields and signs first. Once they're done, the seller's link unlocks — they'll see everything the buyer entered, fill in the rest, and sign."}
        </p>

        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!canSubmit || submitting} onClick={handleSubmit}>
            {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
            Invite to Sign
          </button>
        </div>
      </div>
    </Modal>
  );
}
