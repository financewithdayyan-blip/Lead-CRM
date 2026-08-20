import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, FolderInput, Loader2, Plus, Trash2, Upload, Video, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import {
  analyzeDeal,
  compSetConfidence,
  estimateComparableArv,
  packetImageUrl,
  packetVideoUrl,
  packetUrl,
  repairTotal,
  useCopyLeadFileToPacket,
  useCopyLeadFileToPacketVideo,
  useSavePacket,
  useUploadPacketImage,
  useUploadPacketVideo,
  usePacket,
} from '@/hooks/useDealPackets';
import { VERDICT_STYLE } from '@/lib/dealVerdict';
import { geocodeAddress, geocodeAddresses } from '@/lib/geocode';
import { isImageFile, isVideoFile } from '@/lib/utils';
import { DEAL_TYPE_CONFIG, type DealType, type Lead, type PacketComp, type PacketImage, type PacketRepair, type PacketStatus, type PacketVideo } from '@/types/domain';

/** Parses a currency-ish input into a number, treating empty as "not set". */
function num(v: string): number | null {
  const n = parseFloat(v.replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? null : n;
}

const money = (n: number | null | undefined) =>
  n == null ? '' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-4">
      <h3 className="text-[13px] font-semibold text-text">{title}</h3>
      {hint && <p className="mt-0.5 text-[12px] text-text-3">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function DealPacketBuilder({ packetId, lead, onClose }: { packetId: string; lead: Lead; onClose: () => void }) {
  const { data: packet, isLoading } = usePacket(packetId);
  const savePacket = useSavePacket();
  const uploadImage = useUploadPacketImage();
  const copyLeadFile = useCopyLeadFileToPacket();
  const uploadVideo = useUploadPacketVideo();
  const copyLeadVideoFile = useCopyLeadFileToPacketVideo();
  const fileRef = useRef<HTMLInputElement>(null);
  const videoFileRef = useRef<HTMLInputElement>(null);
  const [showLeadFiles, setShowLeadFiles] = useState(false);
  const [importedLeadFileIds, setImportedLeadFileIds] = useState<Set<string>>(new Set());
  const [copyingFileIds, setCopyingFileIds] = useState<Set<string>>(new Set());
  const [importingAll, setImportingAll] = useState(false);
  const [showLeadVideoFiles, setShowLeadVideoFiles] = useState(false);
  const [importedLeadVideoFileIds, setImportedLeadVideoFileIds] = useState<Set<string>>(new Set());
  const [copyingVideoFileIds, setCopyingVideoFileIds] = useState<Set<string>>(new Set());
  const [importingAllVideos, setImportingAllVideos] = useState(false);

  const [status, setStatus] = useState<PacketStatus>('draft');
  const [ownerName, setOwnerName] = useState('');
  const [propType, setPropType] = useState('');
  const [beds, setBeds] = useState('');
  const [baths, setBaths] = useState('');
  const [sqft, setSqft] = useState('');
  const [yearBuilt, setYearBuilt] = useState('');
  const [market, setMarket] = useState('');
  const [leadStatus, setLeadStatus] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [closingCost, setClosingCost] = useState('');
  const [arvManual, setArvManual] = useState('');
  const [arvIsManual, setArvIsManual] = useState(false);
  const [assignmentFee, setAssignmentFee] = useState('');
  const [showAssignmentFee, setShowAssignmentFee] = useState(false);
  const [dealTypes, setDealTypes] = useState<DealType[]>([]);
  const [narrative, setNarrative] = useState('');
  const [requireLeadCapture, setRequireLeadCapture] = useState(false);
  const [comps, setComps] = useState<Omit<PacketComp, 'id'>[]>([]);
  const [repairs, setRepairs] = useState<Omit<PacketRepair, 'id'>[]>([]);
  const [images, setImages] = useState<PacketImage[]>([]);
  const [videos, setVideos] = useState<PacketVideo[]>([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [geoWarning, setGeoWarning] = useState<string | null>(null);

  // Hydrate local state once the packet arrives. Keyed on id so reopening a
  // different packet refills rather than keeping the previous one's values.
  useEffect(() => {
    if (!packet) return;
    setStatus(packet.status);
    setOwnerName(packet.ownerName ?? '');
    setPropType(packet.propType ?? '');
    setBeds(packet.beds?.toString() ?? '');
    setBaths(packet.baths?.toString() ?? '');
    setSqft(packet.sqft?.toString() ?? '');
    setYearBuilt(packet.yearBuilt?.toString() ?? '');
    setMarket(packet.market ?? '');
    setLeadStatus(packet.leadStatus ?? '');
    setCity(packet.city ?? '');
    setState(packet.state ?? '');
    setZip(packet.zip ?? '');
    setPurchasePrice(packet.purchasePrice?.toString() ?? '');
    setClosingCost(packet.closingCost?.toString() ?? '');
    setArvManual(packet.arv?.toString() ?? '');
    setArvIsManual(packet.arvIsManual);
    setAssignmentFee(packet.assignmentFee?.toString() ?? '');
    setShowAssignmentFee(packet.showAssignmentFee);
    setDealTypes(packet.dealTypes);
    setNarrative(packet.narrative ?? '');
    setRequireLeadCapture(packet.requireLeadCapture);
    setComps(packet.comps.map(({ id: _id, ...c }) => c));
    setRepairs(packet.repairs.map(({ id: _id, ...r }) => r));
    setImages(packet.images);
    setVideos(packet.videos);
  }, [packet?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const comparable = useMemo(
    () => estimateComparableArv(comps as PacketComp[], num(sqft)),
    [comps, sqft],
  );
  const autoArv = comparable?.value ?? null;
  const effectiveArv = arvIsManual ? num(arvManual) : autoArv;
  const totalRepairs = repairTotal(repairs as PacketRepair[]);

  // What the investor is actually quoted, and what the analysis must price off.
  const quotedPrice = useMemo(() => {
    const base = num(purchasePrice);
    if (base == null) return null;
    return base + (num(assignmentFee) ?? 0);
  }, [purchasePrice, assignmentFee]);

  // Comps carry no id until saved, so index stands in for one here.
  const confidence = useMemo(
    () =>
      compSetConfidence(
        comps.map((c, i) => ({ ...c, id: String(i) })),
        { sqft: num(sqft), beds: num(beds), baths: num(baths) },
      ),
    [comps, sqft, beds, baths],
  );

  // Investors are shown the comparable average as the ARV, so the preview has
  // to price off the same number rather than the entered one.
  const adjustedArv = comparable?.value ?? effectiveArv;

  // Recomputed as you type, so the verdict is visible before you publish.
  const analysis = useMemo(
    () => analyzeDeal({
      purchasePrice: quotedPrice,
      arv: adjustedArv,
      repairs: totalRepairs,
      assignmentFee: null,
      closingCost: num(closingCost),
    }),
    [quotedPrice, adjustedArv, totalRepairs, closingCost],
  );

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setUploading(true);
    try {
      let sortOrder = images.length;
      for (const file of Array.from(files)) {
        const img = await uploadImage.mutateAsync({ packetId, file, sortOrder: sortOrder++ });
        setImages((prev) => [...prev, img]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Image upload failed.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const leadImageFiles = useMemo(
    () => (lead.files ?? []).filter((f) => isImageFile(f.fileType, f.fileName)),
    [lead.files],
  );

  async function handleImportLeadFile(fileId: string, storagePath: string, fileName: string, sortOrder: number) {
    setError(null);
    setCopyingFileIds((prev) => new Set(prev).add(fileId));
    try {
      const img = await copyLeadFile.mutateAsync({ packetId, storagePath, fileName, sortOrder });
      setImages((prev) => [...prev, img]);
      setImportedLeadFileIds((prev) => new Set(prev).add(fileId));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not copy that file into the packet.');
      return false;
    } finally {
      setCopyingFileIds((prev) => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
    }
  }

  /** Imports every not-yet-added lead photo in one go — sequential, not
   * parallel, both so the storage-copy call isn't hit with a burst of 20
   * concurrent requests and so sortOrder can just count up locally instead
   * of racing on the shared `images` state. */
  async function handleImportAllLeadFiles() {
    const remaining = leadImageFiles.filter((f) => !importedLeadFileIds.has(f.id));
    if (remaining.length === 0) return;
    setImportingAll(true);
    let nextSortOrder = images.length;
    for (const f of remaining) {
      const ok = await handleImportLeadFile(f.id, f.storagePath, f.fileName, nextSortOrder);
      if (ok) nextSortOrder++;
    }
    setImportingAll(false);
  }

  async function handleVideoFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setUploadingVideo(true);
    try {
      let sortOrder = videos.length;
      for (const file of Array.from(files)) {
        const vid = await uploadVideo.mutateAsync({ packetId, file, sortOrder: sortOrder++ });
        setVideos((prev) => [...prev, vid]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Video upload failed.');
    } finally {
      setUploadingVideo(false);
      if (videoFileRef.current) videoFileRef.current.value = '';
    }
  }

  const leadVideoFiles = useMemo(
    () => (lead.files ?? []).filter((f) => isVideoFile(f.fileType, f.fileName)),
    [lead.files],
  );

  async function handleImportLeadVideoFile(fileId: string, storagePath: string, fileName: string, sortOrder: number) {
    setError(null);
    setCopyingVideoFileIds((prev) => new Set(prev).add(fileId));
    try {
      const vid = await copyLeadVideoFile.mutateAsync({ packetId, storagePath, fileName, sortOrder });
      setVideos((prev) => [...prev, vid]);
      setImportedLeadVideoFileIds((prev) => new Set(prev).add(fileId));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not copy that video into the packet.');
      return false;
    } finally {
      setCopyingVideoFileIds((prev) => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
    }
  }

  async function handleImportAllLeadVideoFiles() {
    const remaining = leadVideoFiles.filter((f) => !importedLeadVideoFileIds.has(f.id));
    if (remaining.length === 0) return;
    setImportingAllVideos(true);
    let nextSortOrder = videos.length;
    for (const f of remaining) {
      const ok = await handleImportLeadVideoFile(f.id, f.storagePath, f.fileName, nextSortOrder);
      if (ok) nextSortOrder++;
    }
    setImportingAllVideos(false);
  }

  function handleImportLeadComps() {
    if (!lead.comps?.length) return;
    setComps((prev) => [
      ...prev,
      ...lead.comps!.map((c) => ({
        kind: c.kind,
        address: c.address,
        salePrice: c.price,
        saleDate: c.saleDate,
        sqft: c.sqft,
        beds: c.beds,
        baths: c.baths,
        lat: null,
        lng: null,
      })),
    ]);
  }

  async function handleSave(nextStatus?: PacketStatus) {
    setError(null);
    setGeoWarning(null);
    try {
      // Located here rather than on the public page, so a packet with a dozen
      // viewers doesn't put a dozen requests through a free community geocoder.
      const needsGeo = comps.some((c) => c.address && (c.lat == null || c.lng == null));
      // Geocoded once from the lead's real address and never re-requested —
      // only the resulting point is ever persisted, never the address itself.
      const needsSubjectGeo = lead.address && (packet?.subjectLat == null || packet?.subjectLng == null);
      let geocoded = comps;
      let subjectPoint: { lat: number; lng: number } | null = null;
      if (needsGeo || needsSubjectGeo) {
        setGeocoding(true);
        const cityStateHint = [city, state].filter(Boolean).join(', ');
        if (needsGeo) {
          geocoded = await geocodeAddresses(comps, cityStateHint);
          setComps(geocoded);
        }
        if (needsSubjectGeo) {
          subjectPoint = await geocodeAddress(lead.address!, cityStateHint);
        }
        setGeocoding(false);
      }

      // A free geocoder not finding a match is silent by nature — nothing
      // throws, the row just keeps a null lat/lng — so without this, a
      // packet can go out to a buyer with a missing or partial map and the
      // admin has no way to know short of opening the public link
      // themselves. Found for real on 2026-08-11 (this exact gap, on a real
      // packet the admin only noticed once a buyer would have too).
      const stillMissingComps = geocoded.filter((c) => c.address && (c.lat == null || c.lng == null)).length;
      const stillMissingSubject = !!needsSubjectGeo && !subjectPoint;
      const warningMsg =
        stillMissingComps > 0 || stillMissingSubject
          ? `Saved, but the map may be incomplete: ${[
              stillMissingComps > 0 ? `${stillMissingComps} comp address${stillMissingComps === 1 ? '' : 'es'} couldn't be located` : null,
              stillMissingSubject ? "the subject property's area radius couldn't be located" : null,
            ]
              .filter(Boolean)
              .join(' and ')}. This can happen for very new addresses none of the free geocoders have indexed yet — try Save again later, or check the public link before sharing it.`
          : null;
      setGeoWarning(warningMsg);

      await savePacket.mutateAsync({
        id: packetId,
        fields: {
          status: nextStatus ?? status,
          ownerName: ownerName || null,
          propType: propType || null,
          beds: num(beds),
          baths: num(baths),
          sqft: num(sqft),
          yearBuilt: num(yearBuilt),
          market: market || null,
          leadStatus: leadStatus || null,
          purchasePrice: num(purchasePrice),
          closingCost: num(closingCost),
          city: city || null,
          state: state || null,
          zip: zip || null,
          ...(subjectPoint ? { subjectLat: subjectPoint.lat, subjectLng: subjectPoint.lng } : {}),
          // Persist whichever number the packet will actually display.
          arv: effectiveArv,
          arvIsManual,
          assignmentFee: num(assignmentFee),
          showAssignmentFee,
          dealTypes,
          narrative: narrative || null,
          requireLeadCapture,
        },
        comps: geocoded,
        repairs,
        images,
        videos,
      });
      if (nextStatus) setStatus(nextStatus);
      // Stays open when the map came out incomplete, so the warning above
      // is actually seen rather than flashing and vanishing as the panel
      // closes — a normal save with nothing missing closes as before.
      if (!warningMsg) onClose();
    } catch (e) {
      setGeocoding(false);
      setError(e instanceof Error ? e.message : 'Could not save the packet.');
    }
  }

  function copyLink() {
    if (!packet) return;
    navigator.clipboard.writeText(packetUrl(packet.slug)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const saving = savePacket.isPending;

  return (
    <Modal open onClose={onClose} title="Deal Packet" width="xl">
      {isLoading || !packet ? (
        <div className="flex items-center gap-2 py-10 text-[13px] text-text-3">
          <Loader2 size={15} className="animate-spin" /> Loading packet…
        </div>
      ) : (
        <div className="space-y-5">
          {/* ── Status + share link ─────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-border-2 bg-surface-3 px-3 py-2.5">
            <div>
              <div className="label !mb-1">Status</div>
              <select className="input !py-1 text-[13px]" value={status} onChange={(e) => setStatus(e.target.value as PacketStatus)}>
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div className="min-w-0 flex-1">
              <div className="label !mb-1">Shareable link</div>
              {status === 'active' ? (
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded border border-border-2 bg-surface px-2 py-1 text-[12px] text-text-2">
                    {packetUrl(packet.slug)}
                  </code>
                  <button type="button" onClick={copyLink} className="btn !px-2 !py-1 text-[12px]">
                    {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                  </button>
                </div>
              ) : (
                <p className="text-[12px] text-text-3">
                  Only Active packets are reachable. Draft and Archived return nothing to visitors, so switching
                  status revokes a link you've already shared.
                </p>
              )}
            </div>
          </div>

          {/* ── Property summary ────────────────────────────────────────── */}
          <Section title="Property summary" hint="Pre-filled from the lead. Edits here stay on the packet and don't change the lead.">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="col-span-2"><span className="label">Owner name</span>
                <input className="input" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} /></label>
              <label><span className="label">Property type</span>
                <input className="input" value={propType} onChange={(e) => setPropType(e.target.value)} placeholder="Single family" /></label>
              <label><span className="label">Market</span>
                <input className="input" value={market} onChange={(e) => setMarket(e.target.value)} placeholder="Tampa, FL" /></label>
              <label><span className="label">Beds</span>
                <input className="input" value={beds} onChange={(e) => setBeds(e.target.value)} inputMode="decimal" /></label>
              <label><span className="label">Baths</span>
                <input className="input" value={baths} onChange={(e) => setBaths(e.target.value)} inputMode="decimal" /></label>
              <label><span className="label">Sq ft</span>
                <input className="input" value={sqft} onChange={(e) => setSqft(e.target.value)} inputMode="numeric" /></label>
              <label><span className="label">Year built</span>
                <input className="input" value={yearBuilt} onChange={(e) => setYearBuilt(e.target.value)} inputMode="numeric" /></label>
              <label className="col-span-2"><span className="label">Status shown to investors</span>
                <input className="input" value={leadStatus} onChange={(e) => setLeadStatus(e.target.value)} placeholder="Under contract" /></label>
            </div>
          </Section>

          {/* ── Location ────────────────────────────────────────────────── */}
          <Section
            title="Location"
            hint="Packets never show an exact address. Investors see this area only, and no street address is stored on the packet at all."
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="col-span-2"><span className="label">City</span>
                <input className="input" value={city} onChange={(e) => setCity(e.target.value)} /></label>
              <label><span className="label">State</span>
                <input className="input" value={state} onChange={(e) => setState(e.target.value)} /></label>
              <label><span className="label">Zip</span>
                <input className="input" value={zip} onChange={(e) => setZip(e.target.value)} /></label>
            </div>
          </Section>

          {/* ── Images ──────────────────────────────────────────────────── */}
          <Section title="Property images" hint="Shown publicly on the packet. Uploads are immediate — removing a row unlinks it on save.">
            <div className="flex flex-wrap gap-3">
              {images.map((img, i) => (
                <div key={img.id} className="relative">
                  <img src={packetImageUrl(img.storagePath)} alt={img.caption ?? 'Property photo'}
                       className="h-24 w-32 rounded-md border border-border-2 object-cover" />
                  <button
                    type="button"
                    onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                    className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-surface p-0.5 text-danger shadow-card"
                    title="Remove image"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex h-24 w-32 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border-2 text-[12px] text-text-3 hover:border-primary hover:text-primary disabled:opacity-50"
              >
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                {uploading ? 'Uploading…' : 'Add photos'}
              </button>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
            </div>

            {leadImageFiles.length > 0 && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setShowLeadFiles((p) => !p)}
                  className="btn !px-2 !py-1 text-[12px]"
                >
                  <FolderInput size={13} /> {showLeadFiles ? 'Hide' : 'Add from'} lead's uploaded photos ({leadImageFiles.length})
                </button>
                {showLeadFiles && (
                  <div className="mt-2 rounded-md border border-border-2 bg-surface-3 p-2">
                    {leadImageFiles.some((f) => !importedLeadFileIds.has(f.id)) && (
                      <button
                        type="button"
                        disabled={importingAll}
                        onClick={handleImportAllLeadFiles}
                        className="btn btn-primary !px-2 !py-1 mb-2 text-[12px]"
                      >
                        {importingAll ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        {importingAll ? 'Adding all…' : `Add all (${leadImageFiles.filter((f) => !importedLeadFileIds.has(f.id)).length})`}
                      </button>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {leadImageFiles.map((f) => {
                        const alreadyImported = importedLeadFileIds.has(f.id);
                        const copying = copyingFileIds.has(f.id);
                        return (
                          <button
                            key={f.id}
                            type="button"
                            disabled={alreadyImported || copying}
                            onClick={() => handleImportLeadFile(f.id, f.storagePath, f.fileName, images.length)}
                            className="flex items-center gap-1.5 rounded-md border border-border-2 bg-surface px-2 py-1 text-[12px] text-text-2 hover:border-primary hover:text-primary disabled:cursor-default disabled:opacity-50"
                            title={f.fileName}
                          >
                            {copying ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : alreadyImported ? (
                              <Check size={12} className="text-success" />
                            ) : (
                              <Plus size={12} />
                            )}
                            <span className="max-w-[140px] truncate">{f.fileName}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* ── Videos ──────────────────────────────────────────────────── */}
          <Section title="Property video" hint="Shown publicly on the packet, below the photos. Uploads are immediate — removing a row unlinks it on save.">
            <div className="flex flex-wrap gap-3">
              {videos.map((vid, i) => (
                <div key={vid.id} className="relative">
                  <video src={packetVideoUrl(vid.storagePath)} muted
                         className="h-24 w-32 rounded-md border border-border-2 bg-black object-cover" />
                  <button
                    type="button"
                    onClick={() => setVideos((prev) => prev.filter((_, idx) => idx !== i))}
                    className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-surface p-0.5 text-danger shadow-card"
                    title="Remove video"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => videoFileRef.current?.click()}
                disabled={uploadingVideo}
                className="flex h-24 w-32 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border-2 text-[12px] text-text-3 hover:border-primary hover:text-primary disabled:opacity-50"
              >
                {uploadingVideo ? <Loader2 size={16} className="animate-spin" /> : <Video size={16} />}
                {uploadingVideo ? 'Uploading…' : 'Add video'}
              </button>
              <input ref={videoFileRef} type="file" accept="video/*" multiple hidden onChange={(e) => handleVideoFiles(e.target.files)} />
            </div>

            {leadVideoFiles.length > 0 && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setShowLeadVideoFiles((p) => !p)}
                  className="btn !px-2 !py-1 text-[12px]"
                >
                  <FolderInput size={13} /> {showLeadVideoFiles ? 'Hide' : 'Add from'} lead's uploaded videos ({leadVideoFiles.length})
                </button>
                {showLeadVideoFiles && (
                  <div className="mt-2 rounded-md border border-border-2 bg-surface-3 p-2">
                    {leadVideoFiles.some((f) => !importedLeadVideoFileIds.has(f.id)) && (
                      <button
                        type="button"
                        disabled={importingAllVideos}
                        onClick={handleImportAllLeadVideoFiles}
                        className="btn btn-primary !px-2 !py-1 mb-2 text-[12px]"
                      >
                        {importingAllVideos ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        {importingAllVideos ? 'Adding all…' : `Add all (${leadVideoFiles.filter((f) => !importedLeadVideoFileIds.has(f.id)).length})`}
                      </button>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {leadVideoFiles.map((f) => {
                        const alreadyImported = importedLeadVideoFileIds.has(f.id);
                        const copying = copyingVideoFileIds.has(f.id);
                        return (
                          <button
                            key={f.id}
                            type="button"
                            disabled={alreadyImported || copying}
                            onClick={() => handleImportLeadVideoFile(f.id, f.storagePath, f.fileName, videos.length)}
                            className="flex items-center gap-1.5 rounded-md border border-border-2 bg-surface px-2 py-1 text-[12px] text-text-2 hover:border-primary hover:text-primary disabled:cursor-default disabled:opacity-50"
                            title={f.fileName}
                          >
                            {copying ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : alreadyImported ? (
                              <Check size={12} className="text-success" />
                            ) : (
                              <Plus size={12} />
                            )}
                            <span className="max-w-[140px] truncate">{f.fileName}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* ── Comps + listings + ARV ──────────────────────────────────── */}
          <Section
            title="Comps & current listings"
            hint="Sold comps set the ARV. Listings are asking prices, so they appear on the map and table but are excluded from the ARV average."
          >
            <div className="space-y-2">
              {comps.map((c, i) => (
                <div key={i} className="grid grid-cols-[86px_1fr_102px_120px_70px_58px_58px_auto] items-center gap-1.5">
                  <select
                    className="input !py-1 text-[12px]"
                    value={c.kind}
                    onChange={(e) => setComps((p) => p.map((x, idx) => idx === i ? { ...x, kind: e.target.value as 'sold' | 'listing' } : x))}
                  >
                    <option value="sold">Sold</option>
                    <option value="listing">Listed</option>
                  </select>
                  <input className="input !py-1 text-[13px]" placeholder="Address" value={c.address ?? ''}
                         onChange={(e) => setComps((p) => p.map((x, idx) => idx === i ? { ...x, address: e.target.value, lat: null, lng: null } : x))} />
                  <input className="input !py-1 text-[13px]" placeholder={c.kind === 'listing' ? 'List price' : 'Sale price'} inputMode="numeric" value={c.salePrice ?? ''}
                         onChange={(e) => setComps((p) => p.map((x, idx) => idx === i ? { ...x, salePrice: num(e.target.value) } : x))} />
                  <input className="input !py-1 text-[13px]" type="date" value={c.saleDate ?? ''}
                         onChange={(e) => setComps((p) => p.map((x, idx) => idx === i ? { ...x, saleDate: e.target.value || null } : x))} />
                  <input className="input !py-1 text-[13px]" placeholder="Sq ft" inputMode="numeric" value={c.sqft ?? ''}
                         onChange={(e) => setComps((p) => p.map((x, idx) => idx === i ? { ...x, sqft: num(e.target.value) } : x))} />
                  <input className="input !py-1 text-[13px]" placeholder="Bd" inputMode="decimal" value={c.beds ?? ''}
                         onChange={(e) => setComps((p) => p.map((x, idx) => idx === i ? { ...x, beds: num(e.target.value) } : x))} />
                  <input className="input !py-1 text-[13px]" placeholder="Ba" inputMode="decimal" value={c.baths ?? ''}
                         onChange={(e) => setComps((p) => p.map((x, idx) => idx === i ? { ...x, baths: num(e.target.value) } : x))} />
                  <button type="button" onClick={() => setComps((p) => p.filter((_, idx) => idx !== i))}
                          className="rounded p-1 text-text-3 hover:text-danger" title="Remove row">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setComps((p) => [...p, { kind: 'sold', address: '', salePrice: null, saleDate: null, sqft: null, beds: null, baths: null, lat: null, lng: null }])}
                        className="btn !px-2 !py-1 text-[12px]">
                  <Plus size={13} /> Add sold comp
                </button>
                <button type="button" onClick={() => setComps((p) => [...p, { kind: 'listing', address: '', salePrice: null, saleDate: null, sqft: null, beds: null, baths: null, lat: null, lng: null }])}
                        className="btn !px-2 !py-1 text-[12px]">
                  <Plus size={13} /> Add current listing
                </button>
                {lead.comps && lead.comps.length > 0 && (
                  <button type="button" onClick={handleImportLeadComps} className="btn !px-2 !py-1 text-[12px]">
                    <FolderInput size={13} /> Import {lead.comps.length} comp{lead.comps.length !== 1 ? 's' : ''} from lead
                  </button>
                )}
                <span className="text-[11px] text-text-3">
                  Addresses are located on save so they can be mapped. Editing an address re-locates it.
                </span>
              </div>

              {confidence && (
                <div className="rounded-md border border-border-2 bg-surface-3 px-3 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-text-3">
                      Comp confidence
                    </span>
                    <span className="text-[13px] font-semibold text-text">
                      {confidence.label} · <span className="tabular-nums">{confidence.score}/10</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border-2">
                    <div
                      className={`h-full rounded-full ${
                        confidence.label === 'High' ? 'bg-success' : confidence.label === 'Moderate' ? 'bg-warning' : 'bg-danger'
                      }`}
                      style={{ width: `${confidence.score * 10}%` }}
                    />
                  </div>
                  <ul className="mt-1.5 space-y-0.5">
                    {confidence.notes.map((n, i) => (
                      <li key={i} className="text-[11.5px] leading-snug text-text-3">· {n}</li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-[11px] text-text-3">
                    Scored against this property's {num(sqft) ?? '—'} sq ft, {num(beds) ?? '—'} bed,{' '}
                    {num(baths) ?? '—'} bath. Fill those in above for an accurate reading.
                  </p>
                </div>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-border-2 bg-surface-3 px-3 py-2">
              <label className="flex items-center gap-1.5 text-[12px] text-text-2">
                <input type="checkbox" className="accent-primary" checked={arvIsManual} onChange={(e) => setArvIsManual(e.target.checked)} />
                Enter ARV manually
              </label>
              {arvIsManual ? (
                <input className="input !py-1 w-40 text-[13px]" placeholder="ARV" inputMode="numeric"
                       value={arvManual} onChange={(e) => setArvManual(e.target.value)} />
              ) : (
                <span className="text-[13px] text-text-2">
                  Calculated ARV: <strong className="text-text">{autoArv != null ? money(autoArv) : '—'}</strong>
                  {autoArv == null && <span className="ml-1 text-[12px] text-text-3">(needs a sold comp with price + sq ft, and this property's sq ft)</span>}
                  {comparable?.method === 'per_sqft' && comparable.avgPricePerSqft != null && (
                    <span className="ml-1 text-[12px] text-text-3">
                      ({money(Math.round(comparable.avgPricePerSqft))}/sqft avg across {comparable.soldCount} sold comp{comparable.soldCount === 1 ? '' : 's'} × this property's sq ft)
                    </span>
                  )}
                  {comparable?.method === 'flat_average' && (
                    <span className="ml-1 text-[12px] text-text-3">(flat average — sq ft missing from comps or this property)</span>
                  )}
                </span>
              )}
            </div>
          </Section>

          {/* ── Deal types ──────────────────────────────────────────────── */}
          <Section title="Deal structure" hint="Each one you pick renders its description on the investor-facing packet.">
            <div className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(DEAL_TYPE_CONFIG) as DealType[]).map((key) => {
                const cfg = DEAL_TYPE_CONFIG[key];
                const on = dealTypes.includes(key);
                return (
                  <label key={key}
                         className={`cursor-pointer rounded-md border p-2.5 transition-colors ${on ? 'border-primary bg-primary/5' : 'border-border-2 bg-surface hover:border-border'}`}>
                    <span className="flex items-center gap-2 text-[13px] font-medium text-text">
                      <input type="checkbox" className="accent-primary" checked={on}
                             onChange={() => setDealTypes((p) => on ? p.filter((d) => d !== key) : [...p, key])} />
                      {cfg.label}
                    </span>
                    <span className="mt-1 block text-[12px] leading-snug text-text-3">{cfg.description}</span>
                  </label>
                );
              })}
            </div>
          </Section>

          {/* ── Repairs ─────────────────────────────────────────────────── */}
          <Section title="Repair estimate">
            <div className="space-y-2">
              {repairs.map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr_130px_auto] items-center gap-2">
                  <input className="input !py-1 text-[13px]" placeholder="Item — e.g. Roof replacement" value={r.item}
                         onChange={(e) => setRepairs((p) => p.map((x, idx) => idx === i ? { ...x, item: e.target.value } : x))} />
                  <input className="input !py-1 text-[13px]" placeholder="Cost" inputMode="numeric" value={r.cost || ''}
                         onChange={(e) => setRepairs((p) => p.map((x, idx) => idx === i ? { ...x, cost: num(e.target.value) ?? 0 } : x))} />
                  <button type="button" onClick={() => setRepairs((p) => p.filter((_, idx) => idx !== i))}
                          className="rounded p-1 text-text-3 hover:text-danger" title="Remove line">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => setRepairs((p) => [...p, { item: '', cost: 0 }])}
                        className="btn !px-2 !py-1 text-[12px]">
                  <Plus size={13} /> Add line item
                </button>
                <div className="text-[13px] text-text-2">
                  Total: <strong className="text-text">{money(totalRepairs)}</strong>
                </div>
              </div>
            </div>
          </Section>

          {/* ── Numbers + live analysis ─────────────────────────────────── */}
          <Section
            title="Pricing"
            hint="Enter your price and fee separately. Investors are quoted the two combined — your base price never reaches the public page."
          >
            <div className="flex flex-wrap items-end gap-3">
              <label><span className="label">Your purchase price</span>
                <input className="input !py-1 w-40 text-[13px]" placeholder="90,000" inputMode="numeric"
                       value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} /></label>
              <span className="pb-2 text-[15px] text-text-3">+</span>
              <label><span className="label">Assignment fee</span>
                <input className="input !py-1 w-40 text-[13px]" placeholder="10,000" inputMode="numeric"
                       value={assignmentFee} onChange={(e) => setAssignmentFee(e.target.value)} /></label>
              <span className="pb-2 text-[15px] text-text-3">=</span>
              <div className="pb-1">
                <div className="label">Investor is quoted</div>
                <div className="text-[18px] font-bold tabular-nums text-primary">
                  {money(quotedPrice) || '—'}
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label><span className="label">Closing cost</span>
                <input className="input !py-1 w-40 text-[13px]" placeholder="e.g. 12,000" inputMode="numeric"
                       value={closingCost} onChange={(e) => setClosingCost(e.target.value)} /></label>
              <p className="max-w-md pb-1 text-[12px] leading-snug text-text-3">
                Paid by the buyer at closing, so it counts toward their all-in and reduces the equity shown.
                It sits outside the max-offer rule, so it shifts the economics without moving the verdict.
              </p>
            </div>

            <label className="mt-3 flex items-center gap-1.5 text-[12px] text-text-2">
              <input type="checkbox" className="accent-primary" checked={showAssignmentFee}
                     onChange={(e) => setShowAssignmentFee(e.target.checked)} />
              Disclose the fee as a line item on the public packet
            </label>
            <p className="mt-1 text-[12px] text-text-3">
              {showAssignmentFee
                ? 'The quoted price is shown with the fee broken out as part of it — an investor can therefore work back to your base price.'
                : 'Only the combined price is published. The fee and your base price are both withheld from the public payload.'}
            </p>

            <div className={`mt-3 rounded-md border p-3 ${VERDICT_STYLE[analysis.verdict].box}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[12px] font-semibold uppercase tracking-wide text-text-3">Deal analysis preview</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${VERDICT_STYLE[analysis.verdict].pill}`}>
                  {VERDICT_STYLE[analysis.verdict].label}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <div className="text-[11px] text-text-3">Max offer</div>
                  <div className="text-[14px] font-semibold text-text">{money(analysis.mao) || '—'}</div>
                </div>
                <div>
                  <div className="text-[11px] text-text-3">Headroom</div>
                  <div className={`text-[14px] font-semibold ${analysis.headroom != null && analysis.headroom < 0 ? 'text-danger' : 'text-text'}`}>
                    {money(analysis.headroom) || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-text-3">Closing (buyer)</div>
                  <div className="text-[14px] font-semibold text-text">{money(analysis.closingCost) || '—'}</div>
                </div>
                <div>
                  <div className="text-[11px] text-text-3">Equity</div>
                  <div className="text-[14px] font-semibold text-text">{money(analysis.spread) || '—'}</div>
                </div>
              </div>
              <ul className="mt-2 space-y-0.5">
                {analysis.notes.map((n, i) => (
                  <li key={i} className="text-[12px] leading-snug text-text-2">· {n}</li>
                ))}
              </ul>
            </div>
          </Section>

          {/* ── Narrative ───────────────────────────────────────────────── */}
          <Section title="Deal narrative" hint="Investment thesis, seller situation, why this is worth a look.">
            <textarea className="input min-h-[120px]" value={narrative} onChange={(e) => setNarrative(e.target.value)}
                      placeholder="Seller is 45 days from auction and needs certainty over price…" />
            <label className="mt-3 flex items-center gap-1.5 text-[12px] text-text-2">
              <input type="checkbox" className="accent-primary" checked={requireLeadCapture}
                     onChange={(e) => setRequireLeadCapture(e.target.checked)} />
              Require name and email before showing the packet
            </label>
          </Section>

          {error && (
            <div className="rounded-md border border-danger/40 bg-danger-dim px-3 py-2 text-[13px] text-danger">{error}</div>
          )}

          {geoWarning && (
            <div className="rounded-md border border-warning/40 bg-warning-dim px-3 py-2 text-[13px] text-warning">
              {geoWarning}
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn" onClick={() => handleSave('draft')} disabled={saving || geocoding}>Save as draft</button>
            <button className="btn btn-primary" onClick={() => handleSave()} disabled={saving || geocoding}>
              {geocoding ? 'Locating addresses…' : saving ? 'Saving…' : status === 'active' ? 'Save & keep live' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
