import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useUpdateLead } from '@/hooks/useLeads';
import { formatPhone, getErrorMessage } from '@/lib/utils';
import type { Lead } from '@/types/domain';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

export function EditContactModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const updateLead = useUpdateLead();
  const [form, setForm] = useState({
    firstName: lead.firstName,
    lastName: lead.lastName,
    phone: formatPhone(lead.phone),
    phone2: lead.phone2 ? formatPhone(lead.phone2) : '',
    email: lead.email ?? '',
    address: lead.address ?? '',
    city: lead.city ?? '',
    state: lead.state ?? '',
    zip: lead.zip ?? '',
    source: lead.source ?? '',
  });
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    setError(null);
    try {
      await updateLead.mutateAsync({
        id: lead.id,
        firstName: form.firstName,
        lastName: form.lastName,
        phone: formatPhone(form.phone),
        phone2: form.phone2 ? formatPhone(form.phone2) : null,
        email: form.email || null,
        address: form.address || null,
        city: form.city || null,
        state: form.state || null,
        zip: form.zip || null,
        source: form.source || null,
      });
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to save changes.'));
    }
  }

  return (
    <Modal open onClose={onClose} title="Edit Contact Info">
      {error && <div className="mb-4 rounded-md bg-danger-dim px-3 py-2 text-[13px] text-danger">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="First Name">
          <input className="input" value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
        </Field>
        <Field label="Last Name">
          <input className="input" value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
        </Field>
        <Field label="Phone">
          <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Phone 2">
          <input className="input" value={form.phone2} onChange={(e) => set('phone2', e.target.value)} />
        </Field>
        <Field label="Email">
          <input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Source">
          <input className="input" value={form.source} onChange={(e) => set('source', e.target.value)} />
        </Field>
        <div className="col-span-2">
          <Field label="Address">
            <input className="input" value={form.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
        </div>
        <Field label="City">
          <input className="input" value={form.city} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label="State">
          <input className="input" value={form.state} onChange={(e) => set('state', e.target.value)} />
        </Field>
        <Field label="Zip">
          <input className="input" value={form.zip} onChange={(e) => set('zip', e.target.value)} />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={handleSave} disabled={updateLead.isPending}>
          Save changes
        </button>
      </div>
    </Modal>
  );
}
