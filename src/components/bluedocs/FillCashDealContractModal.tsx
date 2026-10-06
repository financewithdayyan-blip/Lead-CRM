import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useGenerateContract, useUpdateContractInstance, type ContractInstance, type DeliveryResult } from '@/hooks/useContractInstances';
import { useSmsNumberLabels } from '@/hooks/useSmsNumberLabels';
import { formatCurrency } from '@/lib/currency';
import type { DocTemplate } from '@/hooks/useDocTemplates';

/** Strips a formatted "$410,000" back to "410000" — the reverse of
 * formatCurrency, needed when seeding the edit form from a stored
 * fieldValues that was already stamped through formatCurrency on the way
 * in (see stamp() below). The input only ever displays raw digits, with
 * the $ shown as a separate decorative prefix. */
function stripCurrency(formatted: string): string {
  return formatted.replace(/[^0-9.]/g, '');
}

// Blue Docs always sends/receives from slot 2 — see BLUEDOCS_NUMBER in
// create-contract-instance/submit-signature (ZOOM_FROM_NUMBER_2). Used only
// as the default starting value for the buyer's phone below — editable from
// there, since the buyer party isn't always reachable at the Blue Docs line.
const BLUEDOCS_SMS_SLOT = '2';

// The Cash Deal PSA's own field IDs, captured off its live `doc_templates.fields`
// mapping — see supabase/functions/create-contract-instance for how these land
// on the final PDF. Re-mapped 2026-10-06 for the "Millionaire PSA" template
// (Seller/Buyer Full Name both appear twice — the intro sentence on page 1 and
// the printed-name line in the signature block on page 6 — so one input backs
// both). If this template is ever re-mapped in the field editor, these IDs
// need updating to match.
export const CASH_DEAL_TEMPLATE_ID = 'b7b8fc5c-dfc1-466d-b12f-ada853c9180c';
const FIELD_MAP = {
  sellerName: ['131dbd71-4898-4b86-ae49-c9bc51d6fe49', '8986af33-e41c-4188-b979-31f75ae13900'],
  buyerName: ['a1b3d33f-756f-4754-bd51-cad21d313ef7', '4c27c427-6024-40df-8204-87cf87ebe32f'],
  address: ['07774d27-ebae-4976-bdd2-f8ee70f9ba35'],
  purchasePrice: ['b95b1ea0-a8f0-4fda-a0db-91b232299515'],
  emdAmount: ['c1654e71-3c41-4216-8c91-8130873deec7'],
  titleCompany: ['e9566337-b341-4d88-a02c-e4bcd0ea16c0'],
  // "Option Period" on this template (was "Inspection Period" on the old one)
  // — same concept, Buyer's business days to inspect before Earnest Money
  // goes hard.
  inspectionPeriod: ['ddff239d-497e-4f6e-be3b-8d3cc879cff3'],
  closingDate: ['ebfb718b-a8d6-4017-b426-732dac8fec12'],
  governingState: ['30716627-1ebe-4a1b-9f1e-7875bf6b1226'],
  // Section 13 of the PSA (the "Clause" paragraph field) — left blank by
  // default, filled in with an actual clause when there is one, or typed as
  // "N/A" by hand when there isn't (never auto-filled — that's a deliberate
  // call, not an oversight).
  specialProvisions: ['9080db6f-8758-4b5b-9ed3-7edf56a2b38e'],
} as const;
// The one field id needed outside this form: ContractInstanceRow's address
// fallback matches by field ID rather than label, since a contract created
// before this template's fields got their readable labels froze the OLD
// generic label ("Text field") into its own template_fields_snapshot — a
// label-text search would never match it even though the real address is
// sitting right in that contract's fieldValues.
export const CASH_DEAL_ADDRESS_FIELD_ID = FIELD_MAP.address[0];
type FieldKey = keyof typeof FIELD_MAP;
const CURRENCY_KEYS: FieldKey[] = ['purchasePrice', 'emdAmount'];

// Section 11 ("Tenant Occupancy & Possession") and Section 12 ("Marketing &
// Compensation") are both real checkboxes on this template (tickmark-type
// fields) — mutually exclusive within each section, so these render as radio
// groups below rather than going through FIELD_MAP/FIELD_ROWS like a normal
// typed value. Only the one selected box's field gets written "true"; every
// other box in the group is simply left out of fieldValues, which the
// signing/stamping pipeline renders as unchecked.
const TENANT_OCCUPANCY_OPTIONS = [
  { key: 'vacant', label: 'Vacant at Closing', fieldId: 'e0a41df0-15e9-49ba-8e69-30e33884c5c5' },
  { key: 'buyerAssumesLease', label: 'Buyer Assumes Lease', fieldId: 'bd262f10-1c8b-4735-be3b-27b6f6cb5052' },
  { key: 'postClosing', label: 'Post-Closing Occupancy', fieldId: '3e3d34c4-b0ef-462e-b947-a185165c5d38' },
] as const;
type TenantOccupancyKey = (typeof TENANT_OCCUPANCY_OPTIONS)[number]['key'];

const MARKETING_OPTIONS = [
  { key: 'notApplicable', label: 'Not Applicable', fieldId: 'e51d5bd0-bd69-4c79-80bf-a518eb2f8a50' },
  { key: 'listingAgent', label: "Seller's Listing Agent", fieldId: '23eef1ee-11b4-4a07-9cfb-66036593407d' },
] as const;
type MarketingKey = (typeof MARKETING_OPTIONS)[number]['key'];

// Only shown/sent when "Post-Closing Occupancy" is selected above — the two
// blanks on that line ("...remain up to ___ days under a written leaseback;
// $___ withheld from proceeds..."). The days field already exists on the
// template. The withheld-amount field does not yet — it still needs to be
// placed in the mapper (page 4, right after the leaseback-days box) before
// this can actually reach the document; the input below stays disabled with
// an explanatory note until LEASEBACK_WITHHELD_FIELD_ID is filled in.
const LEASEBACK_DAYS_FIELD_ID = '64fe7084-fdf5-4f77-9229-6ec3a460e3d9';
const LEASEBACK_WITHHELD_FIELD_ID: string | null = null;

// A co-owner's signature — needs its own signature field on the template
// tagged with this role (see the Co-Seller Signature field added in the
// mapper on page 6). Their name still goes into the single combined Seller
// Full Name field above, typed by whoever fills this form (e.g. "Jane Doe
// and John Doe").
const CO_SELLER_ROLE = 'seller_2';

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

function isValidEmail(raw: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw.trim());
}

const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware',
  'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
  'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
  'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey',
  'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon',
  'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah',
  'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
];

const FIELD_ROWS: Array<{ key: FieldKey; label: string; type: 'text' | 'currency' | 'date' | 'state'; placeholder?: string }> = [
  { key: 'address', label: 'Property Address', type: 'text', placeholder: '123 Main St, Tampa, FL 33602' },
  { key: 'purchasePrice', label: 'Purchase Price', type: 'currency', placeholder: '410000' },
  { key: 'emdAmount', label: 'Earnest Money Deposit', type: 'currency', placeholder: '1000' },
  { key: 'titleCompany', label: 'Title Company', type: 'text', placeholder: 'e.g. Bluebird Title Co.' },
  { key: 'inspectionPeriod', label: 'Option Period (business days)', type: 'text', placeholder: 'e.g. 10' },
  { key: 'closingDate', label: 'Closing Date', type: 'date' },
  { key: 'governingState', label: 'Governing State', type: 'state', placeholder: 'Start typing a state…' },
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
  instance,
  leadId,
  initialSeller,
  initialAddress,
  initialPurchasePrice,
  onClose,
  onSent,
  onSaved,
}: {
  template: Pick<DocTemplate, 'id' | 'name' | 'partyRoles'>;
  /** Present only when editing an already-sent contract in place, instead
   * of creating a new one — see EnvelopesTab's Edit action. Every field
   * below gets seeded from this instance's existing values/parties on
   * mount, and submitting calls update-contract-instance instead of
   * create-contract-instance. */
  instance?: ContractInstance;
  /** Links the created contract_instances row back to this lead (see
   * create-contract-instance, which already accepts and stores this — only
   * the Lead Profile's "Create Contract" entry point actually passes it
   * today) so the Deal tab's Contract card can find it afterward. Create
   * mode only; ignored when editing an existing instance. */
  leadId?: string;
  /** Pre-fills the seller fields from a lead's own contact info — create
   * mode only, skipped entirely when editing (the edit-mode effect below
   * always wins since it re-seeds from the instance after mount). */
  initialSeller?: { name: string; phone: string; email: string };
  initialAddress?: string;
  initialPurchasePrice?: string;
  onClose: () => void;
  /** Create mode only. */
  onSent?: (link: { label: string; url: string; delivery: DeliveryResult }) => void;
  /** Edit mode only. */
  onSaved?: () => void;
}) {
  const generate = useGenerateContract();
  const update = useUpdateContractInstance();
  const buyerRole = template.partyRoles[0]?.id;
  const { data: numberLabels } = useSmsNumberLabels();
  const defaultBuyerPhone = numberLabels?.[BLUEDOCS_SMS_SLOT]?.phoneNumber ?? '';

  const [sellerName, setSellerName] = useState(initialSeller?.name ?? '');
  const [sellerPhone, setSellerPhone] = useState(initialSeller?.phone ?? '');
  const [sellerEmail, setSellerEmail] = useState(initialSeller?.email ?? '');
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
    address: initialAddress ?? '',
    purchasePrice: initialPurchasePrice ?? '',
    emdAmount: '',
    titleCompany: '',
    inspectionPeriod: '',
    closingDate: '',
    governingState: '',
    specialProvisions: '',
  });
  const [tenantOccupancy, setTenantOccupancy] = useState<TenantOccupancyKey | null>(null);
  const [marketing, setMarketing] = useState<MarketingKey | null>(null);
  const [leasebackDays, setLeasebackDays] = useState('');
  const [leasebackWithheld, setLeasebackWithheld] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seeds the buyer phone from the Blue Docs number once it loads, but only
  // if the field is still untouched — a user typing their own number before
  // this resolves should never be silently overwritten.
  useEffect(() => {
    if (defaultBuyerPhone && !buyerPhone) setBuyerPhone(defaultBuyerPhone);
  }, [defaultBuyerPhone]); // eslint-disable-line react-hooks/exhaustive-deps

  // Edit mode: seed every field from the existing instance once, on mount.
  // instance's identity is stable for this modal's whole lifetime (the
  // parent only ever opens one edit target at a time), so this is a
  // one-shot init, not a live sync — the user's own typing afterward should
  // never get clobbered by a re-run.
  useEffect(() => {
    if (!instance) return;
    const fv = instance.fieldValues;
    const raw = (key: FieldKey) => fv[FIELD_MAP[key][0]] ?? '';
    const seller = instance.parties.find((p) => p.role === 'seller');
    const coSeller = instance.parties.find((p) => p.role === CO_SELLER_ROLE);
    const buyer = instance.parties.find((p) => p.role === buyerRole);

    if (seller) {
      setSellerName(seller.name);
      setSellerPhone(seller.phone ?? '');
      setSellerEmail(seller.email ?? '');
      setSellerSendSms(seller.sendSms);
      setSellerSendEmail(seller.sendEmail);
    }
    if (coSeller) {
      setOwnerCount(2);
      setCoSellerName(coSeller.name);
      setCoSellerPhone(coSeller.phone ?? '');
      setCoSellerEmail(coSeller.email ?? '');
      setCoSellerSendSms(coSeller.sendSms);
      setCoSellerSendEmail(coSeller.sendEmail);
    }
    if (buyer) {
      setBuyerName(buyer.name);
      setBuyerPhone(buyer.phone ?? '');
      setBuyerEmail(buyer.email ?? '');
      setBuyerSendSms(buyer.sendSms);
      setBuyerSendEmail(buyer.sendEmail);
    }
    setValues({
      sellerName: raw('sellerName'),
      buyerName: raw('buyerName'),
      address: raw('address'),
      purchasePrice: stripCurrency(raw('purchasePrice')),
      emdAmount: stripCurrency(raw('emdAmount')),
      titleCompany: raw('titleCompany'),
      inspectionPeriod: raw('inspectionPeriod'),
      closingDate: raw('closingDate'),
      governingState: raw('governingState'),
      specialProvisions: raw('specialProvisions'),
    });
    setTenantOccupancy(TENANT_OCCUPANCY_OPTIONS.find((o) => fv[o.fieldId] === 'true')?.key ?? null);
    setMarketing(MARKETING_OPTIONS.find((o) => fv[o.fieldId] === 'true')?.key ?? null);
    setLeasebackDays(fv[LEASEBACK_DAYS_FIELD_ID] ?? '');
    setLeasebackWithheld(LEASEBACK_WITHHELD_FIELD_ID ? stripCurrency(fv[LEASEBACK_WITHHELD_FIELD_ID] ?? '') : '');
  }, [instance]); // eslint-disable-line react-hooks/exhaustive-deps

  function setValue(key: FieldKey, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  const allFilled =
    sellerName.trim() && buyerName.trim() && FIELD_ROWS.every((r) => values[r.key].trim());
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
        const display = CURRENCY_KEYS.includes(key) ? formatCurrency(raw) : raw;
        for (const id of FIELD_MAP[key]) fieldValues[id] = display;
      };
      stamp('sellerName', sellerName.trim());
      stamp('buyerName', buyerName.trim());
      for (const row of FIELD_ROWS) stamp(row.key, values[row.key].trim());
      stamp('specialProvisions', values.specialProvisions.trim());

      const tenantOption = TENANT_OCCUPANCY_OPTIONS.find((o) => o.key === tenantOccupancy);
      if (tenantOption) fieldValues[tenantOption.fieldId] = 'true';
      const marketingOption = MARKETING_OPTIONS.find((o) => o.key === marketing);
      if (marketingOption) fieldValues[marketingOption.fieldId] = 'true';
      if (tenantOccupancy === 'postClosing') {
        if (leasebackDays.trim()) fieldValues[LEASEBACK_DAYS_FIELD_ID] = leasebackDays.trim();
        if (leasebackWithheld.trim() && LEASEBACK_WITHHELD_FIELD_ID) {
          fieldValues[LEASEBACK_WITHHELD_FIELD_ID] = formatCurrency(leasebackWithheld.trim());
        }
      }

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

      if (instance) {
        await update.mutateAsync({
          instanceId: instance.id,
          name: template.name,
          propertyAddress: values.address.trim(),
          fieldValues,
          parties,
        });
        onSaved?.();
        return;
      }

      const { parties: created, delivery } = await generate.mutateAsync({
        templateId: template.id,
        leadId,
        name: template.name,
        propertyAddress: values.address.trim(),
        fieldValues,
        parties,
      });
      const first = [...created].sort((a, b) => a.sign_order - b.sign_order)[0];
      onSent?.({
        label: `Seller${first.name ? ` — ${first.name}` : ''}`,
        url: `${window.location.origin}/crm/sign/${first.access_token}`,
        delivery,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : `Something went wrong ${instance ? 'saving' : 'sending'} this.`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={instance ? 'Edit Contract Details' : 'Fill Contract Details'} width="md">
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        <p className="text-[12px] text-text-3">
          {instance
            ? 'Update the deal terms below — this updates the contract your parties already have, no new link or message goes out. Only available while nobody has signed yet.'
            : "Fill in the deal terms below — this goes straight to the Seller to sign. Once they sign, you'll be notified to sign last."}
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
            ) : row.type === 'state' ? (
              <>
                <input
                  className="input"
                  list="governing-state-suggestions"
                  placeholder={row.placeholder}
                  value={values[row.key]}
                  onChange={(e) => setValue(row.key, e.target.value)}
                />
                <datalist id="governing-state-suggestions">
                  {US_STATES.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </>
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

        <div>
          <label className="mb-1 block text-[12px] font-medium text-text-2">Tenant Occupancy &amp; Possession</label>
          <div className="space-y-1.5">
            {TENANT_OCCUPANCY_OPTIONS.map((opt) => (
              <label key={opt.key} className="flex items-center gap-2 text-[12.5px] text-text-2">
                <input
                  type="radio"
                  name="tenantOccupancy"
                  checked={tenantOccupancy === opt.key}
                  onChange={() => setTenantOccupancy(opt.key)}
                />
                {opt.label}
              </label>
            ))}
          </div>
          {tenantOccupancy && (
            <button
              type="button"
              className="mt-1 text-[11px] text-text-3 underline hover:text-text-2"
              onClick={() => setTenantOccupancy(null)}
            >
              Clear selection
            </button>
          )}

          {tenantOccupancy === 'postClosing' && (
            <div className="mt-2 grid grid-cols-2 gap-3 rounded-md border border-border-2 bg-surface-3 p-3">
              <div>
                <label className="mb-1 block text-[11.5px] font-medium text-text-2">Leaseback Days</label>
                <input
                  className="input"
                  inputMode="numeric"
                  placeholder="e.g. 14"
                  value={leasebackDays}
                  onChange={(e) => setLeasebackDays(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11.5px] font-medium text-text-2">Amount Withheld</label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-text-3">$</span>
                  <input
                    className="input pl-6"
                    inputMode="decimal"
                    placeholder="e.g. 5000"
                    value={leasebackWithheld}
                    onChange={(e) => setLeasebackWithheld(e.target.value)}
                    disabled={!LEASEBACK_WITHHELD_FIELD_ID}
                  />
                </div>
                {!LEASEBACK_WITHHELD_FIELD_ID && (
                  <p className="mt-1 text-[10.5px] text-warning">
                    Not wired up yet — this field still needs to be placed on the template.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-text-2">Marketing &amp; Compensation</label>
          <div className="space-y-1.5">
            {MARKETING_OPTIONS.map((opt) => (
              <label key={opt.key} className="flex items-center gap-2 text-[12.5px] text-text-2">
                <input type="radio" name="marketing" checked={marketing === opt.key} onChange={() => setMarketing(opt.key)} />
                {opt.label}
              </label>
            ))}
          </div>
          {marketing && (
            <button type="button" className="mt-1 text-[11px] text-text-3 underline hover:text-text-2" onClick={() => setMarketing(null)}>
              Clear selection
            </button>
          )}
          <p className="mt-1 text-[11px] text-text-3">Leave both unselected if neither applies — the contract itself treats that as Not Applicable.</p>
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-text-2">Special Provisions</label>
          <textarea
            className="input min-h-[72px] resize-y"
            placeholder="Leave blank, or type N/A yourself if there's no special provision for this deal"
            value={values.specialProvisions}
            onChange={(e) => setValue('specialProvisions', e.target.value)}
          />
        </div>

        {error && <p className="text-[12px] text-danger">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!canSubmit || submitting} onClick={handleSubmit}>
            {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
            {instance ? 'Save Changes' : 'Create & Send to Seller'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
