import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, Lock, MapPin } from 'lucide-react';
import { useLogPacketView, usePacketArea, usePublicPacket } from '@/hooks/usePublicPacket';
import { useAnnouncePacketPresence } from '@/hooks/usePacketPresence';
import { getViewerIdentity, saveViewerIdentity, type ViewerIdentity } from '@/lib/viewerToken';
import { packetImageUrl } from '@/hooks/useDealPackets';
import { DEAL_TYPE_CONFIG } from '@/types/domain';

const money = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-text-3">{label}</div>
      <div className="mt-0.5 text-[15px] font-semibold text-text">{value}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-card">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-text-3">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Name + email wall, shown before any packet content when the admin enables it. */
function LeadCaptureGate({ onSubmit }: { onSubmit: (identity: ViewerIdentity) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const valid = name.trim().length > 1 && /\S+@\S+\.\S+/.test(email);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-2 p-4">
      <form
        className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit({ name: name.trim(), email: email.trim(), phone: phone.trim() || undefined });
        }}
      >
        <h1 className="text-[17px] font-semibold text-text">View this deal</h1>
        <p className="mt-1 text-[13px] text-text-3">
          Tell us who you are and the full packet opens straight away.
        </p>
        <div className="mt-4 space-y-3">
          <label className="block"><span className="label">Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
          <label className="block"><span className="label">Email</span>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="block"><span className="label">Phone <span className="text-text-3">(optional)</span></span>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        </div>
        <button type="submit" disabled={!valid} className="btn btn-primary mt-4 w-full justify-center">
          View deal packet
        </button>
      </form>
    </div>
  );
}

export function PublicPacketPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: packet, isLoading, isError } = usePublicPacket(slug);
  const { data: area } = usePacketArea(slug);
  const logView = useLogPacketView();

  const [identity, setIdentity] = useState<ViewerIdentity | null>(() => (slug ? getViewerIdentity(slug) : null));
  const [lightbox, setLightbox] = useState<string | null>(null);
  const loggedRef = useRef(false);

  const gated = !!packet?.requireLeadCapture && !identity;

  // Counts toward the admin's live viewer number for as long as this page is
  // mounted. Suppressed behind the capture gate — someone staring at a form
  // isn't viewing the deal.
  useAnnouncePacketPresence(packet?.id, !!packet && !gated);

  // One view per page load, and never before the capture gate is satisfied.
  useEffect(() => {
    if (!slug || !packet || gated || loggedRef.current) return;
    loggedRef.current = true;
    logView.mutate({ slug, identity });
  }, [slug, packet, gated, identity]); // eslint-disable-line react-hooks/exhaustive-deps

  const repairTotalValue = useMemo(
    () => (packet?.repairs ?? []).reduce((s, r) => s + (Number(r.cost) || 0), 0),
    [packet?.repairs],
  );

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-2 text-text-3">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  // Draft, archived, deleted and mistyped links all land here — deliberately
  // indistinguishable, so a wrong slug reveals nothing about what exists.
  if (isError || !packet) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-surface-2 p-6 text-center">
        <Lock size={22} className="text-text-3" />
        <h1 className="text-[17px] font-semibold text-text">This packet isn't available</h1>
        <p className="max-w-sm text-[13px] text-text-3">
          The link may have expired or been taken down. Check with whoever shared it for an up-to-date link.
        </p>
      </div>
    );
  }

  if (gated) {
    return (
      <LeadCaptureGate
        onSubmit={(id) => {
          saveViewerIdentity(slug!, id);
          setIdentity(id);
        }}
      />
    );
  }

  const areaLine = [area?.city, area?.state, area?.zip].filter(Boolean).join(', ');

  return (
    <div className="min-h-screen bg-surface-2 pb-16">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto max-w-4xl px-5 py-5">
          <div className="text-[11px] uppercase tracking-[0.14em] text-primary">Investment Opportunity</div>
          <h1 className="mt-1 text-2xl font-semibold text-text">
            {packet.propType || 'Property'}{packet.market ? ` · ${packet.market}` : ''}
          </h1>

          <div className="mt-3 flex items-start gap-2 rounded-lg border border-border-2 bg-surface-3 px-3 py-2.5">
            <MapPin size={15} className="mt-0.5 shrink-0 text-text-3" />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium text-text">{areaLine || 'Location available on enquiry'}</div>
              <div className="mt-0.5 text-[12px] text-text-3">
                Contact us to discuss the property directly.
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 px-5 py-6">
        {packet.images.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {packet.images.map((img) => (
              <button key={img.id} onClick={() => setLightbox(packetImageUrl(img.storagePath))} className="group relative">
                <img
                  src={packetImageUrl(img.storagePath)}
                  alt={img.caption ?? 'Property photo'}
                  loading="lazy"
                  className="h-40 w-full rounded-lg border border-border object-cover transition-opacity group-hover:opacity-90"
                />
              </button>
            ))}
          </div>
        )}

        <Card title="Property">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Beds" value={packet.beds ?? '—'} />
            <Stat label="Baths" value={packet.baths ?? '—'} />
            <Stat label="Sq ft" value={packet.sqft?.toLocaleString() ?? '—'} />
            <Stat label="Year built" value={packet.yearBuilt ?? '—'} />
            {packet.leadStatus && <Stat label="Status" value={packet.leadStatus} />}
            {packet.arv != null && <Stat label="ARV" value={money(packet.arv)} />}
            {repairTotalValue > 0 && <Stat label="Est. repairs" value={money(repairTotalValue)} />}
            {packet.showAssignmentFee && packet.assignmentFee != null && (
              <Stat label="Assignment fee" value={money(packet.assignmentFee)} />
            )}
          </div>
        </Card>

        {packet.narrative && (
          <Card title="The opportunity">
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-text-2">{packet.narrative}</p>
          </Card>
        )}

        {packet.dealTypes.length > 0 && (
          <Card title="Deal structures available">
            <div className="grid gap-3 sm:grid-cols-2">
              {packet.dealTypes.map((t) => {
                const cfg = DEAL_TYPE_CONFIG[t];
                if (!cfg) return null;
                return (
                  <div key={t} className="rounded-lg border border-border-2 bg-surface-3 p-3">
                    <div className="text-[13px] font-semibold text-text">{cfg.label}</div>
                    <p className="mt-1 text-[12px] leading-snug text-text-3">{cfg.description}</p>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {packet.comps.length > 0 && (
          <Card title="Comparable sales">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-border text-[11px] uppercase tracking-wide text-text-3">
                  <tr>
                    <th className="pb-2 pr-3">Address</th>
                    <th className="pb-2 pr-3 text-right">Sale price</th>
                    <th className="pb-2 pr-3 text-right">Sq ft</th>
                    <th className="pb-2 text-right">Sold</th>
                  </tr>
                </thead>
                <tbody>
                  {packet.comps.map((c) => (
                    <tr key={c.id} className="border-b border-border last:border-b-0">
                      <td className="py-2 pr-3 text-text-2">{c.address || '—'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-text">{money(c.salePrice)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-text-2">{c.sqft?.toLocaleString() ?? '—'}</td>
                      <td className="py-2 text-right tabular-nums text-text-3">
                        {c.saleDate ? new Date(c.saleDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {packet.repairs.length > 0 && (
          <Card title="Repair estimate">
            <table className="w-full text-left text-[13px]">
              <tbody>
                {packet.repairs.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-b-0">
                    <td className="py-2 text-text-2">{r.item || '—'}</td>
                    <td className="py-2 text-right tabular-nums text-text">{money(r.cost)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="pt-2 text-[13px] font-semibold text-text">Total</td>
                  <td className="pt-2 text-right text-[13px] font-semibold tabular-nums text-text">{money(repairTotalValue)}</td>
                </tr>
              </tbody>
            </table>
          </Card>
        )}

        <p className="px-1 text-center text-[11px] text-text-3">
          Figures are estimates provided for evaluation and are not a warranty or an offer.
        </p>
      </main>

      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="Property photo enlarged" className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}
    </div>
  );
}
