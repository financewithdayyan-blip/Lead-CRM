import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Loader2, Trash2, Upload, Video } from 'lucide-react';
import { useUpdateLead } from '@/hooks/useLeads';
import { useUploadLeadFile, useDeleteLeadFile, useSignedFileUrl, useSignedFileUrls } from '@/hooks/useLeadFiles';
import { formatCurrency, formatDateTime, isImageFile, isVideoFile } from '@/lib/utils';
import type { Lead } from '@/types/domain';

const OCCUPANCY_LABEL: Record<NonNullable<Lead['occupancy']>, string> = {
  owner_occupied: 'Owner occupied',
  tenant_occupied: 'Tenant occupied',
  vacant: 'Vacant',
};

const REPAIR_FLAGS: Array<{ key: keyof Lead['repairs']; label: string }> = [
  { key: 'cosmetics', label: 'Cosmetics' },
  { key: 'hvac', label: 'HVAC' },
  { key: 'plumbing', label: 'Plumbing' },
  { key: 'roof', label: 'Roof' },
  { key: 'foundation', label: 'Foundation' },
  { key: 'electrical', label: 'Electrical' },
  { key: 'flooring', label: 'Flooring' },
];

function PhotoGallery({ lead }: { lead: Lead }) {
  const uploadFile = useUploadLeadFile();
  const deleteFile = useDeleteLeadFile();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pasteHint, setPasteHint] = useState(false);

  const images = useMemo(() => (lead.files ?? []).filter((f) => isImageFile(f.fileType, f.fileName)), [lead.files]);
  const imagePaths = useMemo(() => images.map((f) => f.storagePath), [images]);
  const { data: imageUrls = {} } = useSignedFileUrls(imagePaths);

  function uploadMany(fileList: FileList | File[]) {
    for (const file of Array.from(fileList)) {
      uploadFile.mutate({ leadId: lead.id, file });
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) uploadMany(e.target.files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      const pasted = Array.from(items)
        .filter((item) => item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((f): f is File => !!f);
      if (pasted.length === 0) return;
      e.preventDefault();
      uploadMany(pasted);
      setPasteHint(true);
      setTimeout(() => setPasteHint(false), 1500);
    }
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [lead.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">Property Photos</h3>
        <label className={`btn cursor-pointer ${uploadFile.isPending ? 'pointer-events-none opacity-60' : ''}`}>
          <Upload size={14} /> {uploadFile.isPending ? 'Uploading…' : 'Add Photos'}
          <input ref={fileInputRef} type="file" multiple accept="image/*" className="hidden" onChange={handleFileChange} />
        </label>
      </div>
      <p className="mb-3 text-[12px] text-text-3">
        {pasteHint ? 'Pasted — uploading…' : 'Tip: copy an image and press Ctrl+V anywhere on this tab to upload it directly.'}
      </p>
      {uploadFile.isError && (
        <div className="mb-3 rounded-md bg-danger-dim px-3 py-2 text-[12px] text-danger">
          Upload failed: {(uploadFile.error as Error)?.message ?? 'Unknown error'}
        </div>
      )}
      {images.length === 0 && !uploadFile.isPending && <div className="text-[13px] text-text-3">No photos yet.</div>}
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {images.map((f) => {
            const url = imageUrls[f.storagePath];
            return (
              <div key={f.id} className="group relative aspect-square overflow-hidden rounded-md border border-border-2 bg-surface-3">
                {url ? (
                  <img
                    src={url}
                    alt={f.fileName}
                    title={f.fileName}
                    className="h-full w-full cursor-pointer object-cover"
                    onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-text-3">
                    <Loader2 size={16} className="animate-spin" />
                  </div>
                )}
                <button
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity hover:bg-danger group-hover:opacity-100"
                  onClick={() => deleteFile.mutate({ id: f.id, storagePath: f.storagePath, leadId: lead.id })}
                  title="Remove"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PropertyDetailsCard({ lead }: { lead: Lead }) {
  const updateLead = useUpdateLead();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    propType: lead.propType ?? '',
    beds: lead.beds?.toString() ?? '',
    baths: lead.baths?.toString() ?? '',
    sqft: lead.sqft?.toString() ?? '',
    yearBuilt: lead.yearBuilt?.toString() ?? '',
    condition: lead.condition ?? '',
    occupancy: lead.occupancy ?? '',
    mortgageBalance: lead.mortgageBalance?.toString() ?? '',
    monthlyPayment: lead.monthlyPayment?.toString() ?? '',
    backTaxes: lead.backTaxes?.toString() ?? '',
    auctionDate: lead.auctionDate ?? '',
    arv: lead.arv?.toString() ?? '',
    asIs: lead.asIs?.toString() ?? '',
  });
  const [repairs, setRepairs] = useState(lead.repairs ?? {});

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSave() {
    updateLead.mutate(
      {
        id: lead.id,
        propType: form.propType || null,
        beds: form.beds ? Number(form.beds) : null,
        baths: form.baths ? Number(form.baths) : null,
        sqft: form.sqft ? Number(form.sqft) : null,
        yearBuilt: form.yearBuilt ? Number(form.yearBuilt) : null,
        condition: form.condition || null,
        occupancy: (form.occupancy || null) as Lead['occupancy'],
        mortgageBalance: form.mortgageBalance ? Number(form.mortgageBalance) : null,
        monthlyPayment: form.monthlyPayment ? Number(form.monthlyPayment) : null,
        backTaxes: form.backTaxes ? Number(form.backTaxes) : null,
        auctionDate: form.auctionDate || null,
        arv: form.arv ? Number(form.arv) : null,
        asIs: form.asIs ? Number(form.asIs) : null,
        repairs,
      },
      { onSuccess: () => setEditing(false) },
    );
  }

  const pricePerSqft = lead.arv != null && lead.sqft ? lead.arv / lead.sqft : null;

  const statRows: Array<[string, string]> = [
    ['Type', lead.propType || '—'],
    ['Bedrooms', lead.beds?.toString() ?? '—'],
    ['Bathrooms', lead.baths?.toString() ?? '—'],
    ['Square Feet', lead.sqft?.toLocaleString() ?? '—'],
    ['Year Built', lead.yearBuilt?.toString() ?? '—'],
    ['Condition', lead.condition || '—'],
    ['Occupancy', lead.occupancy ? OCCUPANCY_LABEL[lead.occupancy] : '—'],
    ['Mortgage Balance', lead.mortgageBalance == null || lead.mortgageBalance === 0 ? 'Paid off' : formatCurrency(lead.mortgageBalance)],
    ['Monthly Payment', formatCurrency(lead.monthlyPayment)],
    ['Back Taxes', lead.backTaxes ? formatCurrency(lead.backTaxes) : 'None'],
    ['ARV', formatCurrency(lead.arv)],
    ['CMV', formatCurrency(lead.asIs)],
    ['Price / Sqft', pricePerSqft != null ? formatCurrency(pricePerSqft) : '—'],
  ];

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2 border-b border-border pb-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Property Details</div>
        <button className="text-[11px] font-medium text-primary hover:underline" onClick={() => setEditing((v) => !v)}>
          {editing ? 'Cancel' : 'Edit'}
        </button>
      </div>

      {!editing ? (
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3.5 sm:grid-cols-3 lg:grid-cols-4">
          {statRows.map(([label, value]) => (
            <div key={label}>
              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-text-3">{label}</div>
              <div className="mt-0.5 text-[13.5px] font-medium text-text">{value}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Property Type</label>
              <input className="input" value={form.propType} onChange={(e) => set('propType', e.target.value)} />
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
            <div>
              <label className="label">Year Built</label>
              <input className="input" type="number" value={form.yearBuilt} onChange={(e) => set('yearBuilt', e.target.value)} />
            </div>
            <div>
              <label className="label">Condition</label>
              <input className="input" value={form.condition} onChange={(e) => set('condition', e.target.value)} />
            </div>
            <div>
              <label className="label">Occupancy</label>
              <select className="input" value={form.occupancy} onChange={(e) => set('occupancy', e.target.value)}>
                <option value="">—</option>
                <option value="owner_occupied">Owner occupied</option>
                <option value="tenant_occupied">Tenant occupied</option>
                <option value="vacant">Vacant</option>
              </select>
            </div>
            <div>
              <label className="label">Mortgage Balance</label>
              <input className="input" inputMode="decimal" value={form.mortgageBalance} onChange={(e) => set('mortgageBalance', e.target.value.replace(/[^0-9.]/g, ''))} />
            </div>
            <div>
              <label className="label">Monthly Payment</label>
              <input className="input" inputMode="decimal" value={form.monthlyPayment} onChange={(e) => set('monthlyPayment', e.target.value.replace(/[^0-9.]/g, ''))} />
            </div>
            <div>
              <label className="label">Back Taxes</label>
              <input className="input" inputMode="decimal" value={form.backTaxes} onChange={(e) => set('backTaxes', e.target.value.replace(/[^0-9.]/g, ''))} />
            </div>
            <div>
              <label className="label">ARV</label>
              <input className="input" inputMode="decimal" value={form.arv} onChange={(e) => set('arv', e.target.value.replace(/[^0-9.]/g, ''))} />
            </div>
            <div>
              <label className="label">CMV (current market value)</label>
              <input className="input" inputMode="decimal" value={form.asIs} onChange={(e) => set('asIs', e.target.value.replace(/[^0-9.]/g, ''))} />
            </div>
            <div>
              <label className="label">Auction Date</label>
              <input className="input" type="date" value={form.auctionDate} onChange={(e) => set('auctionDate', e.target.value)} />
            </div>
          </div>
          <div>
            <div className="label">Repairs needed</div>
            <div className="flex flex-wrap gap-3">
              {REPAIR_FLAGS.map(({ key, label }) => (
                <label key={key} className="flex items-center gap-1.5 text-[13px] text-text-2">
                  <input
                    type="checkbox"
                    checked={!!repairs[key]}
                    onChange={(e) => setRepairs((r) => ({ ...r, [key]: e.target.checked }))}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <button className="btn btn-primary" onClick={handleSave} disabled={updateLead.isPending}>
            Save property details
          </button>
        </div>
      )}
    </div>
  );
}

function OtherFilesSection({ lead }: { lead: Lead }) {
  const uploadFile = useUploadLeadFile();
  const deleteFile = useDeleteLeadFile();
  const signedUrl = useSignedFileUrl();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const videoFiles = useMemo(() => (lead.files ?? []).filter((f) => isVideoFile(f.fileType, f.fileName)), [lead.files]);
  const otherFiles = useMemo(
    () => (lead.files ?? []).filter((f) => !isImageFile(f.fileType, f.fileName) && !isVideoFile(f.fileType, f.fileName)),
    [lead.files],
  );

  async function handleView(storagePath: string) {
    const url = await signedUrl.mutateAsync(storagePath);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) {
      for (const file of Array.from(e.target.files)) uploadFile.mutate({ leadId: lead.id, file });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  if (videoFiles.length === 0 && otherFiles.length === 0) {
    return (
      <div className="card">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text">Other Files</h3>
          <label className="btn cursor-pointer">
            <Upload size={14} /> Upload
            <input ref={fileInputRef} type="file" multiple className="hidden" accept="video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" onChange={handleFileChange} />
          </label>
        </div>
        <div className="mt-3 text-[13px] text-text-3">No videos or documents uploaded yet.</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">Other Files</h3>
        <label className="btn cursor-pointer">
          <Upload size={14} /> Upload
          <input ref={fileInputRef} type="file" multiple className="hidden" accept="video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" onChange={handleFileChange} />
        </label>
      </div>
      <div className="space-y-2">
        {[...videoFiles, ...otherFiles].map((f) => (
          <div key={f.id} className="flex items-center justify-between gap-3 rounded-md border border-border-2 bg-surface-3 p-2.5">
            <div className="flex min-w-0 items-center gap-2">
              {isVideoFile(f.fileType, f.fileName) && <Video size={15} className="shrink-0 text-text-3" />}
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-text">{f.fileName}</div>
                <div className="text-[11px] text-text-3">{formatDateTime(f.createdAt)}</div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button className="text-text-3 hover:text-primary" onClick={() => handleView(f.storagePath)} title="View">
                <ExternalLink size={14} />
              </button>
              <button className="text-text-3 hover:text-danger" onClick={() => deleteFile.mutate({ id: f.id, storagePath: f.storagePath, leadId: lead.id })} title="Delete">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PropertyTab({ lead }: { lead: Lead }) {
  return (
    <div className="space-y-5">
      <PhotoGallery lead={lead} />
      <PropertyDetailsCard lead={lead} />
      <OtherFilesSection lead={lead} />
    </div>
  );
}
