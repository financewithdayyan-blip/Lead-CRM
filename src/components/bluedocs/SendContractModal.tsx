import { useState } from 'react';
import { ArrowDown, ArrowUp, Loader2, Plus, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useGenerateContract, type DeliveryResult } from '@/hooks/useContractInstances';
import { roleLabel, type DocTemplate, type PartyRole } from '@/hooks/useDocTemplates';

interface PartyDraft {
  key: string;
  role: PartyRole;
  name: string;
  phone: string;
  email: string;
  sendSms: boolean;
  sendEmail: boolean;
}

/** Same 10/11-digit check create-contract-instance applies server-side —
 * this is just a client-side head start so a bad number doesn't need a
 * round trip to be caught. */
function isValidPhone(raw: string): boolean {
  const digits = raw.replace(/[^0-9]/g, '');
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
}

function isValidEmail(raw: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw.trim());
}

/** A party is reachable if every delivery method it has checked actually
 * has a valid value behind it, and at least one method is checked at all —
 * 10DLC blocks SMS containing a link, which is why this isn't SMS-only
 * anymore, but a party still needs to be reachable somehow. */
function isPartyReady(p: PartyDraft): boolean {
  if (!p.sendSms && !p.sendEmail) return false;
  if (p.sendSms && !isValidPhone(p.phone)) return false;
  if (p.sendEmail && !isValidEmail(p.email)) return false;
  return true;
}

/**
 * Buyer, Seller, and any extra roles the template itself defines (mapped in
 * the field editor — a Witness, a Co-Buyer, etc.) are always present, since
 * each has fields on the document that need a name to fill them in. On top
 * of those, any number of ad-hoc "Additional Signer" rows can be added for
 * people who just need to review and sign, with no fields of their own.
 * Signing order is simply each party's position in the list, reorderable
 * with the up/down arrows — first row signs first, and each next party's
 * link only unlocks once the one above them is done.
 */
export function SendContractModal({
  template,
  onClose,
  onSent,
}: {
  template: DocTemplate;
  onClose: () => void;
  onSent: (link: { label: string; url: string; delivery: DeliveryResult }) => void;
}) {
  const generate = useGenerateContract();
  const firstRoleLabel = roleLabel('buyer', template.type);

  const [name, setName] = useState(template.name);
  const [propertyAddress, setPropertyAddress] = useState('');
  const [parties, setParties] = useState<PartyDraft[]>([
    { key: 'buyer', role: 'buyer', name: '', phone: '', email: '', sendSms: true, sendEmail: false },
    { key: 'seller', role: 'seller', name: '', phone: '', email: '', sendSms: true, sendEmail: false },
    ...template.partyRoles.map((r) => ({ key: r.id, role: r.id, name: '', phone: '', email: '', sendSms: true, sendEmail: false })),
  ]);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim() && propertyAddress.trim() && parties.every((p) => p.name.trim() && isPartyReady(p));

  function updateParty(key: string, patch: Partial<PartyDraft>) {
    setParties((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  function addParty() {
    setParties((prev) => [
      ...prev,
      { key: crypto.randomUUID(), role: 'other', name: '', phone: '', email: '', sendSms: true, sendEmail: false },
    ]);
  }

  function removeParty(key: string) {
    setParties((prev) => prev.filter((p) => p.key !== key));
  }

  function moveParty(index: number, dir: -1 | 1) {
    setParties((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const { parties: created, delivery } = await generate.mutateAsync({
        templateId: template.id,
        name: name.trim(),
        propertyAddress: propertyAddress.trim(),
        fieldValues: {},
        parties: parties.map((p, i) => ({
          role: p.role, name: p.name.trim(), phone: p.phone.trim(), email: p.email.trim(),
          sendSms: p.sendSms, sendEmail: p.sendEmail, signOrder: i + 1,
        })),
      });
      const first = [...created].sort((a, b) => a.sign_order - b.sign_order)[0];
      onSent({
        label: `${roleLabel(first.role, template.type, template.partyRoles)}${first.name ? ` — ${first.name}` : ''}`,
        url: `${window.location.origin}/crm/sign/${first.access_token}`,
        delivery,
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

        <div>
          <label className="mb-1 block text-[12px] font-medium text-text-2">Property address</label>
          <input
            className="input"
            placeholder="123 Main St, Tampa, FL 33602"
            value={propertyAddress}
            onChange={(e) => setPropertyAddress(e.target.value)}
          />
          <p className="mt-1 text-[11px] text-text-3">Goes in the invite text so the signer knows which property this is for.</p>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-[12px] font-medium text-text-2">Signing order</label>
            <button className="btn !px-2 !py-1 text-[11px]" onClick={addParty}>
              <Plus size={12} /> Add another signer
            </button>
          </div>
          <div className="space-y-2">
            {parties.map((p, i) => {
              const label = roleLabel(p.role, template.type, template.partyRoles);
              return (
                <div key={p.key} className="rounded-md border border-border-2 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-[12px] font-semibold text-text">
                      {i + 1}. {label}
                      {i === 0 && <span className="ml-1.5 font-normal text-text-3">— fills in first</span>}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        className="btn !p-1"
                        disabled={i === 0}
                        title="Move earlier in signing order"
                        onClick={() => moveParty(i, -1)}
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        className="btn !p-1"
                        disabled={i === parties.length - 1}
                        title="Move later in signing order"
                        onClick={() => moveParty(i, 1)}
                      >
                        <ArrowDown size={12} />
                      </button>
                      {p.role === 'other' && (
                        <button className="btn !p-1 text-danger" title="Remove this signer" onClick={() => removeParty(p.key)}>
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                  <input
                    className="input mb-1.5"
                    placeholder={label === 'Us' ? 'Your name or company' : 'Name'}
                    value={p.name}
                    onChange={(e) => updateParty(p.key, { name: e.target.value })}
                  />
                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      className={`input !py-1.5 ${p.sendSms && !isValidPhone(p.phone) ? '!border-danger' : ''}`}
                      placeholder="Phone number"
                      inputMode="tel"
                      value={p.phone}
                      onChange={(e) => updateParty(p.key, { phone: e.target.value })}
                    />
                    <input
                      className={`input !py-1.5 ${p.sendEmail && !isValidEmail(p.email) ? '!border-danger' : ''}`}
                      placeholder="Email address"
                      type="email"
                      value={p.email}
                      onChange={(e) => updateParty(p.key, { email: e.target.value })}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center gap-4">
                    <label className="flex items-center gap-1.5 text-[12px] text-text-2">
                      <input
                        type="checkbox"
                        checked={p.sendSms}
                        onChange={(e) => updateParty(p.key, { sendSms: e.target.checked })}
                      />
                      Send by text
                    </label>
                    <label className="flex items-center gap-1.5 text-[12px] text-text-2">
                      <input
                        type="checkbox"
                        checked={p.sendEmail}
                        onChange={(e) => updateParty(p.key, { sendEmail: e.target.checked })}
                      />
                      Send by email
                    </label>
                    {!isPartyReady(p) && (p.sendSms || p.sendEmail) && (
                      <span className="text-[11px] text-danger">Needs a valid {p.sendSms && !isValidPhone(p.phone) ? 'phone number' : 'email address'}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <p className="text-[12px] text-text-3">
          Parties sign in the order above — each one's link only unlocks once everyone before them is done.{' '}
          {firstRoleLabel === 'Us' ? 'We get' : 'The first signer gets'} their link the moment you send this, by whichever
          method(s) are checked; everyone after them is notified the same way automatically as their turn comes up.
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
