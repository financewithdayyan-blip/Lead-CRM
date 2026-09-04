import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useGenerateContract } from '@/hooks/useContractInstances';
import { useSmsNumberLabels } from '@/hooks/useSmsNumberLabels';
import { formatCurrency } from '@/lib/currency';
import type { DocTemplate } from '@/hooks/useDocTemplates';

// Blue Docs always sends/receives from slot 2 — see BLUEDOCS_NUMBER in
// create-contract-instance/submit-signature (ZOOM_FROM_NUMBER_2). Used only
// as the default starting value for the buyer's phone below — editable from
// there, since the buyer party isn't always reachable at the Blue Docs line.
const BLUEDOCS_SMS_SLOT = '2';

// The Novation PSA's own field IDs, captured off its live `doc_templates.fields`
// mapping (see supabase/functions/create-contract-instance for how these land
// on the final PDF) by matching each field's page/position against the actual
// document text, since the template's own field labels are still the generic
// ones the mapper assigns ("Full name", "Text field", "Amount", "Date"). If
// this template is ever re-mapped in the field editor, these IDs need updating.
export const NOVATION_TEMPLATE_ID = 'd14ee41d-bf9f-4d10-b877-233d84ebfd6f';
const FIELD_MAP = {
  sellerName: ['c1f78517-3a5a-43e3-9a31-e634b6f0f417'],
  buyerName: ['d6876a7d-12f2-4551-9295-1c112f5bb9b5'],
  streetAddress: ['febbc59c-2ddf-4e36-bcc1-db5f11196022'],
  cityStateZip: ['07d8f55d-0b72-4f5d-b952-04451f4343f0'],
  legalDescription: ['cec1c0a1-7a9b-4559-8116-1f460f1e8cc1'],
  purchasePrice: ['dc66c03d-7775-4315-99da-ce8ebc4509e3'],
  emdAmount: ['ecdb232b-b761-4391-b2ed-ade28d28f164'],
  cashDueAtClosing: ['89fc85da-05f4-4052-a4a4-17196540bbd1'],
  closingDate: ['bb4ee06b-be3d-44a3-8ee0-e56c76cd50bb'],
  titleCompany: ['81705cf8-8d14-47c0-9974-c2cb5db976fb'],
  inspectionPeriod: ['2649df29-25b2-4238-a7ab-492275f0c981'],
  additionalTerms: ['0aad72a0-4bc6-4cdc-b0a2-339ff2abd083'],
} as const;
type FieldKey = keyof typeof FIELD_MAP;
const CURRENCY_KEYS: FieldKey[] = ['purchasePrice', 'emdAmount', 'cashDueAtClosing'];
// Effective Date is on the template but tagged to the extra/final-signer role,
// not 'buyer' — same as Cash Deal, Dayyan enters it when he countersigns
// last, not here.

// A co-owner's signature — this document already has a second, previously
// unused "Seller: ___" signature line printed right below the first one, now
// retagged to this role so it's addressable separately. Same as Cash Deal,
// there's no separate name field for them; their name goes into the single
// combined Seller Full Name field above.
const CO_SELLER_ROLE = 'seller_2';

// The template's one extra role — Dayyan's own final signature, kept distinct
// from the built-in 'buyer' role (which now only ever gets pre-filled values,
// never a live signing turn) so he signs last without re-typing anything
// that's already in this form.
export function isNovationTemplate(templateId: string): boolean {
  return templateId === NOVATION_TEMPLATE_ID;
}

function isValidPhone(raw: string): boolean {
  const digits = raw.replace(/[^0-9]/g, '');
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
}

function isValidEmail(raw: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw.trim());
}

const FIELD_ROWS: Array<{ key: FieldKey; label: string; type: 'text' | 'currency' | 'date' | 'textarea'; placeholder?: string; required: boolean }> = [
  { key: 'streetAddress', label: 'Street Address', type: 'text', placeholder: '123 Main St', required: true },
  { key: 'cityStateZip', label: 'City, State, Zip', type: 'text', placeholder: 'Tampa, FL 33602', required: true },
  { key: 'legalDescription', label: 'Legal Description', type: 'text', placeholder: 'Optional', required: false },
  { key: 'purchasePrice', label: 'Purchase Price', type: 'currency', placeholder: '410000', required: true },
  { key: 'emdAmount', label: 'Earnest Money Down', type: 'currency', placeholder: '1000', required: true },
  { key: 'cashDueAtClosing', label: 'Cash Due to Seller at Closing', type: 'currency', placeholder: '409000', required: true },
  { key: 'closingDate', label: 'Closing Date', type: 'date', required: true },
  { key: 'titleCompany', label: 'Title Company', type: 'text', placeholder: 'e.g. Bluebird Title Co.', required: true },
  { key: 'inspectionPeriod', label: 'Inspection Period (business days)', type: 'text', placeholder: 'e.g. 10', required: true },
  { key: 'additionalTerms', label: 'Additional Terms (optional)', type: 'textarea', placeholder: 'Any extra terms both parties agreed to', required: false },
];

/**
 * Replaces the old first signing step (Dayyan filling every deal term
 * through the public signing link) with a plain form filled directly in the
 * CRM. The contract then goes straight to the Seller, and once they sign,
 * Dayyan gets notified to sign last — entering only the Effective Date, his
 * signature, and the date of signing (already mapped to his own role on the
 * template, untouched by this form). Same pattern as the Cash Deal template.
 */
export function FillNovationContractModal({
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
  const defaultBuyerPhone = numberLabels?.[BLUEDOCS_SMS_SLOT]?.phoneNumber ?? '';

  const [sellerName, setSellerName] = useState('');
  const [sellerPhone, setSellerPhone] = useState('');
  const [sellerEmail, setSellerEmail] = useState('');
  const [sellerSendSms, setSellerSendSms] = useState(true);
  const [sellerSendEmail, setSellerSendEmail] = useState(false);
  const [ownerCount, setOwnerCount] = useState<1 | 2>(1);
  const [coSellerName, setCoSellerName] = useState('');
  const [coSellerPhone, setCoSellerPhone] = useState('');
  const [coSellerEmail, setCoSellerEmail] = useState('');
  const [coSellerSendSms, setCoSellerSendSms] = useState(true);
  const [coSellerSendEmail, setCoSellerSendEmail] = useState(false);
  const [buyerName, setBuyerName] = useState('');
  const [buyerPhone, setBuyerPhone] = useState(defaultBuyerPhone);
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerSendSms, setBuyerSendSms] = useState(true);
  const [buyerSendEmail, setBuyerSendEmail] = useState(false);
  const [values, setValues] = useState<Record<FieldKey, string>>({
    sellerName: '',
    buyerName: '',
    streetAddress: '',
    cityStateZip: '',
    legalDescription: '',
    purchasePrice: '',
    emdAmount: '',
    cashDueAtClosing: '',
    closingDate: '',
    titleCompany: '',
    inspectionPeriod: '',
    additionalTerms: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seeds the buyer phone from the Blue Docs number once it loads, but only
  // if the field is still untouched — a user typing their own number before
  // this resolves should never be silently overwritten.
  useEffect(() => {
    if (defaultBuyerPhone && !buyerPhone) setBuyerPhone(defaultBuyerPhone);
  }, [defaultBuyerPhone]); // eslint-disable-line react-hooks/exhaustive-deps

  function setValue(key: FieldKey, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  const allFilled =
    sellerName.trim() && buyerName.trim() && FIELD_ROWS.every((r) => !r.required || values[r.key].trim());
  const sellerReady =
    (sellerSendSms || sellerSendEmail) &&
    (!sellerSendSms || isValidPhone(sellerPhone)) &&
    (!sellerSendEmail || isValidEmail(sellerEmail));
  const coSellerReady =
    ownerCount === 1 ||
    (coSellerName.trim() &&
      (coSellerSendSms || coSellerSendEmail) &&
      (!coSellerSendSms || isValidPhone(coSellerPhone)) &&
      (!coSellerSendEmail || isValidEmail(coSellerEmail)));
  const buyerReady =
    (buyerSendSms || buyerSendEmail) &&
    (!buyerSendSms || isValidPhone(buyerPhone)) &&
    (!buyerSendEmail || isValidEmail(buyerEmail));
  const canSubmit = !!buyerRole && allFilled && sellerReady && !!coSellerReady && buyerReady;

  async function handleSubmit() {
    if (!canSubmit || !buyerRole) return;
    setSubmitting(true);
    setError(null);
    try {
      const fieldValues: Record<string, string> = {};
      const stamp = (key: FieldKey, raw: string) => {
        if (!raw) return;
        const display = CURRENCY_KEYS.includes(key) ? formatCurrency(raw) : raw;
        for (const id of FIELD_MAP[key]) fieldValues[id] = display;
      };
      stamp('sellerName', sellerName.trim());
      stamp('buyerName', buyerName.trim());
      for (const row of FIELD_ROWS) stamp(row.key, values[row.key].trim());

      const parties = [
        {
          role: 'seller', name: sellerName.trim(), phone: sellerPhone.trim(), email: sellerEmail.trim(),
          sendSms: sellerSendSms, sendEmail: sellerSendEmail, signOrder: 1,
        },
        ...(ownerCount === 2
          ? [
              {
                role: CO_SELLER_ROLE, name: coSellerName.trim(), phone: coSellerPhone.trim(), email: coSellerEmail.trim(),
                sendSms: coSellerSendSms, sendEmail: coSellerSendEmail, signOrder: 2,
              },
            ]
          : []),
        {
          role: buyerRole, name: buyerName.trim(), phone: buyerPhone.trim(), email: buyerEmail.trim(),
          sendSms: buyerSendSms, sendEmail: buyerSendEmail, signOrder: ownerCount === 2 ? 3 : 2,
        },
      ];

      const { parties: created } = await generate.mutateAsync({
        templateId: template.id,
        name: template.name,
        propertyAddress: [values.streetAddress.trim(), values.cityStateZip.trim()].filter(Boolean).join(', '),
        fieldValues,
        parties,
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
          Fill in the deal terms below — this goes straight to the Seller to sign. Once they sign, you'll be notified
          to sign last.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="mb-1 block text-[12px] font-medium text-text-2">Seller Full Name</label>
            <input className="input" value={sellerName} onChange={(e) => setSellerName(e.target.value)} />
            <p className="mt-1 text-[11px] text-text-3">If there are 2 owners, put both names here — e.g. "Jane Doe and John Doe".</p>
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-text-2">Seller Phone</label>
            <input
              className={`input ${sellerSendSms && !isValidPhone(sellerPhone) ? '!border-danger' : ''}`}
              inputMode="tel"
              value={sellerPhone}
              onChange={(e) => setSellerPhone(e.target.value)}
            />
            <label className="mt-1 flex items-center gap-1.5 text-[11px] text-text-2">
              <input type="checkbox" checked={sellerSendSms} onChange={(e) => setSellerSendSms(e.target.checked)} />
              Send by text
            </label>
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-text-2">Seller Email</label>
            <input
              className={`input ${sellerSendEmail && !isValidEmail(sellerEmail) ? '!border-danger' : ''}`}
              type="email"
              value={sellerEmail}
              onChange={(e) => setSellerEmail(e.target.value)}
            />
            <label className="mt-1 flex items-center gap-1.5 text-[11px] text-text-2">
              <input type="checkbox" checked={sellerSendEmail} onChange={(e) => setSellerSendEmail(e.target.checked)} />
              Send by email
            </label>
          </div>

          <div className="col-span-2">
            <label className="mb-1 block text-[12px] font-medium text-text-2">Number of Owners</label>
            <select className="input" value={ownerCount} onChange={(e) => setOwnerCount(Number(e.target.value) === 2 ? 2 : 1)}>
              <option value={1}>1 — just the Seller</option>
              <option value={2}>2 — Seller has a co-owner</option>
            </select>
          </div>

          {ownerCount === 2 && (
            <>
              <div className="col-span-2">
                <label className="mb-1 block text-[12px] font-medium text-text-2">Co-Owner Full Name</label>
                <input className="input" value={coSellerName} onChange={(e) => setCoSellerName(e.target.value)} />
                <p className="mt-1 text-[11px] text-text-3">They'll get their own signing link and sign separately, right after the Seller.</p>
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-medium text-text-2">Co-Owner Phone</label>
                <input
                  className={`input ${coSellerSendSms && !isValidPhone(coSellerPhone) ? '!border-danger' : ''}`}
                  inputMode="tel"
                  value={coSellerPhone}
                  onChange={(e) => setCoSellerPhone(e.target.value)}
                />
                <label className="mt-1 flex items-center gap-1.5 text-[11px] text-text-2">
                  <input type="checkbox" checked={coSellerSendSms} onChange={(e) => setCoSellerSendSms(e.target.checked)} />
                  Send by text
                </label>
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-medium text-text-2">Co-Owner Email</label>
                <input
                  className={`input ${coSellerSendEmail && !isValidEmail(coSellerEmail) ? '!border-danger' : ''}`}
                  type="email"
                  value={coSellerEmail}
                  onChange={(e) => setCoSellerEmail(e.target.value)}
                />
                <label className="mt-1 flex items-center gap-1.5 text-[11px] text-text-2">
                  <input type="checkbox" checked={coSellerSendEmail} onChange={(e) => setCoSellerSendEmail(e.target.checked)} />
                  Send by email
                </label>
              </div>
            </>
          )}

          <div className="col-span-2">
            <label className="mb-1 block text-[12px] font-medium text-text-2">Buyer Full Name</label>
            <input className="input" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-text-2">Buyer Phone</label>
            <input
              className={`input ${buyerSendSms && !isValidPhone(buyerPhone) ? '!border-danger' : ''}`}
              inputMode="tel"
              value={buyerPhone}
              onChange={(e) => setBuyerPhone(e.target.value)}
            />
            <label className="mt-1 flex items-center gap-1.5 text-[11px] text-text-2">
              <input type="checkbox" checked={buyerSendSms} onChange={(e) => setBuyerSendSms(e.target.checked)} />
              Send by text
            </label>
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-text-2">Buyer Email</label>
            <input
              className={`input ${buyerSendEmail && !isValidEmail(buyerEmail) ? '!border-danger' : ''}`}
              type="email"
              value={buyerEmail}
              onChange={(e) => setBuyerEmail(e.target.value)}
            />
            <label className="mt-1 flex items-center gap-1.5 text-[11px] text-text-2">
              <input type="checkbox" checked={buyerSendEmail} onChange={(e) => setBuyerSendEmail(e.target.checked)} />
              Send by email
            </label>
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
            ) : row.type === 'textarea' ? (
              <textarea
                className="input min-h-[70px] resize-y"
                placeholder={row.placeholder}
                value={values[row.key]}
                onChange={(e) => setValue(row.key, e.target.value)}
              />
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
