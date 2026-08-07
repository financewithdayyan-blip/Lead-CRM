import { useState } from 'react';
import { ArrowDown, ArrowUp, Loader2, Plus, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useGenerateContract } from '@/hooks/useContractInstances';
import { roleLabel, type DocTemplate, type PartyRole } from '@/hooks/useDocTemplates';

interface PartyDraft {
  key: string;
  role: PartyRole;
  name: string;
  email: string;
}

/**
 * Buyer and Seller are always present — their fields are the ones actually
 * mapped on the template, so both need a name to fill them in. Any number of
 * additional signers ("Additional Signer") can be added on top for people who
 * just need to review and sign, with no fields of their own. Signing order is
 * simply each party's position in the list, reorderable with the up/down
 * arrows — first row signs first, and each next party's link only unlocks
 * once the one above them is done.
 */
export function SendContractModal({
  template,
  onClose,
  onSent,
}: {
  template: DocTemplate;
  onClose: () => void;
  onSent: (link: { label: string; url: string }) => void;
}) {
  const generate = useGenerateContract();
  const firstRoleLabel = roleLabel('buyer', template.type);

  const [name, setName] = useState(template.name);
  const [parties, setParties] = useState<PartyDraft[]>([
    { key: 'buyer', role: 'buyer', name: '', email: '' },
    { key: 'seller', role: 'seller', name: '', email: '' },
  ]);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim() && parties.every((p) => p.name.trim());

  function updateParty(key: string, patch: Partial<PartyDraft>) {
    setParties((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  function addParty() {
    setParties((prev) => [...prev, { key: crypto.randomUUID(), role: 'other', name: '', email: '' }]);
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
      const { parties: created } = await generate.mutateAsync({
        templateId: template.id,
        name: name.trim(),
        fieldValues: {},
        parties: parties.map((p, i) => ({ role: p.role, name: p.name.trim(), email: p.email.trim(), signOrder: i + 1 })),
      });
      const first = [...created].sort((a, b) => a.sign_order - b.sign_order)[0];
      onSent({
        label: `${roleLabel(first.role, template.type)}${first.name ? ` — ${first.name}` : ''}`,
        url: `${window.location.origin}/crm/sign/${first.access_token}`,
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
          <div className="mb-2 flex items-center justify-between">
            <label className="text-[12px] font-medium text-text-2">Signing order</label>
            <button className="btn !px-2 !py-1 text-[11px]" onClick={addParty}>
              <Plus size={12} /> Add another signer
            </button>
          </div>
          <div className="space-y-2">
            {parties.map((p, i) => {
              const label = p.role === 'other' ? `Additional Signer` : roleLabel(p.role, template.type);
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
                  <input
                    className="input"
                    placeholder="Email (optional)"
                    value={p.email}
                    onChange={(e) => updateParty(p.key, { email: e.target.value })}
                  />
                </div>
              );
            })}
          </div>
        </div>

        <p className="text-[12px] text-text-3">
          Parties sign in the order above — each one's link only unlocks once everyone before them is done. You'll get{' '}
          {firstRoleLabel === 'Us' ? 'our' : "the first signer's"} link right away; the rest become copyable from this
          template's Sign Inbox as they unlock.
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
