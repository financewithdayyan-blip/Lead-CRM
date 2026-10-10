import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Loader2, Trash2, Upload, Video } from 'lucide-react';
import { useUpdateLead } from '@/hooks/useLeads';
import { useUploadLeadFile, useDeleteLeadFile, useSignedFileUrl, useSignedFileUrls } from '@/hooks/useLeadFiles';
import { EditableField } from '@/components/leadProfile/EditableField';
import { formatCurrency, formatDateTime, isImageFile, isVideoFile } from '@/lib/utils';
import type { Lead } from '@/types/domain';

const digitsOnly = (raw: string) => raw.replace(/[^0-9.]/g, '');

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

  function saveField(patch: Partial<Lead>) {
    updateLead.mutate({ id: lead.id, ...patch });
  }

  function toggleRepair(key: keyof Lead['repairs'], checked: boolean) {
    saveField({ repairs: { ...lead.repairs, [key]: checked } });
  }

  const pricePerSqft = lead.arv != null && lead.sqft ? lead.arv / lead.sqft : null;

  return (
    <div className="card">
      <div className="border-b border-border pb-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
        Property Details
      </div>

      {/* One mutation shared by every field and checkbox below — disabling
       *  the whole set while any single save is in flight stops a fast
       *  second edit from computing off a lead snapshot that doesn't have
       *  the first edit's change yet (see EditableField's own disabled
       *  comment; same reasoning fixed the Title & Closing checklist's
       *  lost-update race). */}
      <fieldset disabled={updateLead.isPending} className="contents">
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3.5 sm:grid-cols-3 lg:grid-cols-4">
          <EditableField label="Type" value={lead.propType ?? ''} onSave={(v) => saveField({ propType: v.trim() || null })} />
          <EditableField
            label="Bedrooms"
            type="number"
            value={lead.beds?.toString() ?? ''}
            onSave={(v) => saveField({ beds: v ? Number(v) : null })}
          />
          <EditableField
            label="Bathrooms"
            type="number"
            value={lead.baths?.toString() ?? ''}
            onSave={(v) => saveField({ baths: v ? Number(v) : null })}
          />
          <EditableField
            label="Square Feet"
            type="number"
            value={lead.sqft?.toString() ?? ''}
            display={lead.sqft?.toLocaleString()}
            onSave={(v) => saveField({ sqft: v ? Number(v) : null })}
          />
          <EditableField
            label="Year Built"
            type="number"
            value={lead.yearBuilt?.toString() ?? ''}
            onSave={(v) => saveField({ yearBuilt: v ? Number(v) : null })}
          />
          <EditableField label="Condition" value={lead.condition ?? ''} onSave={(v) => saveField({ condition: v.trim() || null })} />
          <EditableField
            label="Occupancy"
            type="select"
            value={lead.occupancy ?? ''}
            display={lead.occupancy ? OCCUPANCY_LABEL[lead.occupancy] : ''}
            options={[
              { value: '', label: '—' },
              { value: 'owner_occupied', label: 'Owner occupied' },
              { value: 'tenant_occupied', label: 'Tenant occupied' },
              { value: 'vacant', label: 'Vacant' },
            ]}
            onSave={(v) => saveField({ occupancy: (v || null) as Lead['occupancy'] })}
          />
          <EditableField
            label="Mortgage Balance"
            value={lead.mortgageBalance?.toString() ?? ''}
            display={lead.mortgageBalance == null || lead.mortgageBalance === 0 ? 'Paid off' : formatCurrency(lead.mortgageBalance)}
            filter={digitsOnly}
            onSave={(v) => saveField({ mortgageBalance: v ? Number(v) : null })}
          />
          <EditableField
            label="Monthly Payment"
            value={lead.monthlyPayment?.toString() ?? ''}
            display={formatCurrency(lead.monthlyPayment)}
            filter={digitsOnly}
            onSave={(v) => saveField({ monthlyPayment: v ? Number(v) : null })}
          />
          <EditableField
            label="Back Taxes"
            value={lead.backTaxes?.toString() ?? ''}
            display={lead.backTaxes ? formatCurrency(lead.backTaxes) : 'None'}
            filter={digitsOnly}
            onSave={(v) => saveField({ backTaxes: v ? Number(v) : null })}
          />
          <EditableField
            label="ARV"
            value={lead.arv?.toString() ?? ''}
            display={formatCurrency(lead.arv)}
            filter={digitsOnly}
            onSave={(v) => saveField({ arv: v ? Number(v) : null })}
          />
          <EditableField
            label="CMV"
            value={lead.asIs?.toString() ?? ''}
            display={formatCurrency(lead.asIs)}
            filter={digitsOnly}
            onSave={(v) => saveField({ asIs: v ? Number(v) : null })}
          />
          <EditableField
            label="Auction Date"
            type="date"
            value={lead.auctionDate ?? ''}
            onSave={(v) => saveField({ auctionDate: v || null })}
          />
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-text-3">Price / Sqft</div>
            <div className="mt-0.5 text-[13.5px] font-medium text-text">{pricePerSqft != null ? formatCurrency(pricePerSqft) : '—'}</div>
          </div>
        </div>

        <div className="mt-4 border-t border-border pt-3.5">
          <div className="text-[10.5px] font-semibold uppercase tracking-wide text-text-3">Repairs needed</div>
          <div className="mt-2 flex flex-wrap gap-3">
            {REPAIR_FLAGS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-1.5 text-[13px] text-text-2 has-[:disabled]:opacity-60">
                <input type="checkbox" checked={!!lead.repairs?.[key]} onChange={(e) => toggleRepair(key, e.target.checked)} />
                {label}
              </label>
            ))}
          </div>
        </div>
      </fieldset>
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
