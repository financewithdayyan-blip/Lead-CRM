import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useGenerateContract } from '@/hooks/useContractInstances';
import { useSmsNumberLabels } from '@/hooks/useSmsNumberLabels';
import { formatCurrency } from '@/lib/currency';
import { formatPhone } from '@/lib/utils';
import type { DocTemplate } from '@/hooks/useDocTemplates';

// Blue Docs always sends/receives from slot 2 — see BLUEDOCS_NUMBER in
// create-contract-instance/submit-signature (ZOOM_FROM_NUMBER_2). The
// buyer's printed contact number on the PSA should always be this same
// number, not a separately typed one that could drift out of sync with it.
const BLUEDOCS_SMS_SLOT = '2';

// The Cash Deal PSA's own field IDs, captured off its live `doc_templates.fields`
// mapping — see supabase/functions/create-contract-instance for how these land
// on the final PDF. "Buyer Full Name" appears twice on the document (the intro
// sentence and the signature block), so one input backs both. If this template
// is ever re-mapped in the field editor, these IDs need updating to match.
const CASH_DEAL_TEMPLATE_ID = 'b7b8fc5c-dfc1-466d-b12f-ada853c9180c';
const FIELD_MAP = {
  sellerName: ['b2e3512b-b59f-4bd4-a6b0-bf4b5e3d4e62', '3b83cbd2-1ab1-4893-9be0-1df6427aed6c'],
  buyerName: ['3c839999-501a-4f5b-b96e-6d39b42ba852', 'b7ad40ae-f2bf-4389-b591-8c604c69349a'],
  address: ['a6f081eb-564c-4291-974b-124f599add42'],
  purchasePrice: ['1cb52efd-968b-4014-a222-5a0f0c8c4b81'],
  emdAmount: ['019eec79-9553-4112-a254-ed07680fe9c6'],
  titleCompany: ['ac919451-c9ba-44fe-894d-90b4f6000458'],
  inspectionPeriod: ['260c07b8-994a-471b-a872-e3f87d274c9a'],
  closingDate: ['2395b34f-cd9c-4d69-89e3-4dcc19fdbec0'],
  governingState: ['f3760950-c478-4586-8a7e-84a3b7b3605c'],
} as const;
type FieldKey = keyof typeof FIELD_MAP;
const CURRENCY_KEYS: FieldKey[] = ['purchasePrice', 'emdAmount'];

// The template's one extra role — Dayyan's own final signature, kept distinct
// from the built-in 'buyer' role (which now only ever gets pre-filled values,
// never a live signing turn) so he signs last without re-typing anything
// that's already in this form.
export function isCashDealTemplate(templateId: string): boolean {
  return templateId === CASH_DEAL_TEMPLATE_ID;
}

function isValidPhone(raw: string): boolean {
  const digits = raw.replace(/[^0-9]/g, '');
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
}

const FIELD_ROWS: Array<{ key: FieldKey; label: string; type: 'text' | 'currency' | 'date'; placeholder?: string }> = [
  { key: 'address', label: 'Property Address', type: 'text', placeholder: '123 Main St, Tampa, FL 33602' },
  { key: 'purchasePrice', label: 'Purchase Price', type: 'currency', placeholder: '410000' },
  { key: 'emdAmount', label: 'Earnest Money Deposit', type: 'currency', placeholder: '1000' },
  { key: 'titleCompany', label: 'Title Company', type: 'text', placeholder: 'e.g. Bluebird Title Co.' },
  { key: 'inspectionPeriod', label: 'Inspection Period (days)', type: 'text', placeholder: 'e.g. 10' },
  { key: 'closingDate', label: 'Closing Date', type: 'date' },
  { key: 'governingState', label: 'Governing State', type: 'text', placeholder: 'e.g. Florida' },
];

/**
 * Replaces the old first signing step (Dayyan filling every deal term
 * through the public signing link) with a plain form filled directly in the
 * CRM. The contract then goes straight to the Seller, and once they sign,
 * Dayyan gets texted to sign last — entering only the Effective Date, his
 * signature, and the date of signing (already mapped to his own role on the
 * template, untouched by this form).
 */
export function FillCashDealContractModal({
  template,
  onClose,
  onSent,
}: {
  template: DocTemplate;
  onClose: () => void;
  onSent: (link: { label: string; url: string }) => void;
}) {
  const generate = useGenerateContract();
  const buyerRole = template.partyRoles[0]?.id;
  const { data: numberLabels } = useSmsNumberLabels();
  const buyerPhone = numberLabels?.[BLUEDOCS_SMS_SLOT]?.phoneNumber ?? '';

  const [sellerName, setSellerName] = useState('');
  const [sellerPhone, setSellerPhone] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [values, setValues] = useState<Record<FieldKey, string>>({
    sellerName: '',
    buyerName: '',
    address: '',
    purchasePrice: '',
    emdAmount: '',
    titleCompany: '',
    inspectionPeriod: '',
    closingDate: '',
    governingState: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setValue(key: FieldKey, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  const allFilled =
    sellerName.trim() && buyerName.trim() && FIELD_ROWS.every((r) => values[r.key].trim());
  const canSubmit = !!buyerRole && allFilled && isValidPhone(sellerPhone) && isValidPhone(buyerPhone);

  async function handleSubmit() {
    if (!canSubmit || !buyerRole) return;
    setSubmitting(true);
    setError(null);
    try {
      const fieldValues: Record<string, string> = {};
      const stamp = (key: FieldKey, raw: string) => {
        const display = CURRENCY_KEYS.includes(key) ? formatCurrency(raw) : raw;
        for (const id of FIELD_MAP[key]) fieldValues[id] = display;
      };
      stamp('sellerName', sellerName.trim());
      stamp('buyerName', buyerName.trim());
      for (const row of FIELD_ROWS) stamp(row.key, values[row.key].trim());

      const { parties: created } = await generate.mutateAsync({
        templateId: template.id,
        name: template.name,
        propertyAddress: values.address.trim(),
        fieldValues,
        parties: [
          { role: 'seller', name: sellerName.trim(), phone: sellerPhone.trim(), signOrder: 1 },
          { role: buyerRole, name: buyerName.trim(), phone: buyerPhone.trim(), signOrder: 2 },
        ],
      });
      const first = [...created].sort((a, b) => a.sign_order - b.sign_order)[0];
      onSent({
        label: `Seller${first.name ? ` — ${first.name}` : ''}`,
        url: `${window.location.origin}/crm/sign/${first.access_token}`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong sending this.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Fill Contract Details" width="md">
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        <p className="text-[12px] text-text-3">
          Fill in the deal terms below — this goes straight to the Seller to sign. Once they sign, you'll get a text
          to sign last.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-text-2">Seller Full Name</label>
            <input className="input" value={sellerName} onChange={(e) => setSellerName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-text-2">Seller Phone</label>
            <input className="input" inputMode="tel" value={sellerPhone} onChange={(e) => setSellerPhone(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-text-2">Buyer Full Name</label>
            <input className="input" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-text-2">Buyer Phone</label>
            {buyerPhone ? (
              <div className="input flex items-center !bg-surface-3 text-text-2">{formatPhone(buyerPhone)}</div>
            ) : (
              <div className="input flex items-center !bg-danger-dim text-danger">Blue Docs number not configured</div>
            )}
            <p className="mt-1 text-[11px] text-text-3">Always matches the number Blue Docs sends and receives from — not editable here.</p>
          </div>
        </div>

        {FIELD_ROWS.map((row) => (
          <div key={row.key}>
            <label className="mb-1 block text-[12px] font-medium text-text-2">{row.label}</label>
            {row.type === 'currency' ? (
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-text-3">$</span>
                <input
                  className="input pl-6"
                  inputMode="decimal"
                  placeholder={row.placeholder}
                  value={values[row.key]}
                  onChange={(e) => setValue(row.key, e.target.value)}
                />
              </div>
            ) : (
              <input
                className="input"
                type={row.type === 'date' ? 'date' : 'text'}
                placeholder={row.placeholder}
                value={values[row.key]}
                onChange={(e) => setValue(row.key, e.target.value)}
              />
            )}
          </div>
        ))}

        {error && <p className="text-[12px] text-danger">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!canSubmit || submitting} onClick={handleSubmit}>
            {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
            Create & Send to Seller
          </button>
        </div>
      </div>
    </Modal>
  );
}
