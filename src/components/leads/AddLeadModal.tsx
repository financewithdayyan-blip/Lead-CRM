import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useCreateLead } from '@/hooks/useLeads';
import { expandStreetSuffix, formatPhone, getErrorMessage } from '@/lib/utils';

export function AddLeadModal({ onClose, targetUserId }: { onClose: () => void; targetUserId?: string }) {
  const createLead = useCreateLead();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    phone2: '',
    email: '',
    address: '',
    city: '',
    state: '',
    source: '',
    beds: '',
    baths: '',
    sqft: '',
  });
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createLead.mutateAsync({
        ...(targetUserId ? { userId: targetUserId } : {}),
        firstName: form.firstName || '—',
        lastName: form.lastName,
        phone: formatPhone(form.phone),
        phone2: form.phone2 ? formatPhone(form.phone2) : null,
        email: form.email || null,
        address: expandStreetSuffix(form.address) || '—',
        city: form.city || null,
        state: form.state || null,
        source: form.source || null,
        beds: form.beds ? Number(form.beds) : null,
        baths: form.baths ? Number(form.baths) : null,
        sqft: form.sqft ? Number(form.sqft) : null,
        stage: 'new',
        rating: 0,
      });
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to add lead.'));
    }
  }

  return (
    <Modal open onClose={onClose} title="Add Lead">
      {error && <div className="mb-4 rounded-md bg-danger-dim px-3 py-2 text-[13px] text-danger">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">First Name *</label>
            <input className="input" required value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
          </div>
          <div>
            <label className="label">Last Name</label>
            <input className="input" value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
          </div>
          <div>
            <label className="label">Phone *</label>
            <input className="input" required value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </div>
          <div>
            <label className="label">Phone 2</label>
            <input className="input" value={form.phone2} onChange={(e) => set('phone2', e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className="label">Address *</label>
            <input className="input" required value={form.address} onChange={(e) => set('address', e.target.value)} />
          </div>
          <div>
            <label className="label">City</label>
            <input className="input" value={form.city} onChange={(e) => set('city', e.target.value)} />
          </div>
          <div>
            <label className="label">State</label>
            <input className="input" value={form.state} onChange={(e) => set('state', e.target.value)} />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div>
            <label className="label">Source</label>
            <input className="input" placeholder="e.g. Cold Call" value={form.source} onChange={(e) => set('source', e.target.value)} />
          </div>
          <div>
            <label className="label">Beds</label>
            <input className="input" type="number" value={form.beds} onChange={(e) => set('beds', e.target.value)} />
          </div>
          <div>
            <label className="label">Baths</label>
            <input className="input" type="number" value={form.baths} onChange={(e) => set('baths', e.target.value)} />
          </div>
          <div>
            <label className="label">Sqft</label>
            <input className="input" type="number" value={form.sqft} onChange={(e) => set('sqft', e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={createLead.isPending} className="btn btn-primary">
            Add Lead
          </button>
        </div>
      </form>
    </Modal>
  );
}
