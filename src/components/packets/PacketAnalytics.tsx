import { useMemo } from 'react';
import { BarChart3, Eye, Mail, MousePointerClick, Radio, Users } from 'lucide-react';
import { summarizeViews, usePacketEmailShares, usePacketViews } from '@/hooks/useDealPackets';
import { usePacketLiveViewers } from '@/hooks/usePacketPresence';
import { formatDateTime } from '@/lib/utils';

function Metric({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded-md border border-border-2 bg-surface-3 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-text-3">
        {icon} {label}
      </div>
      <div className={`mt-0.5 text-[18px] font-semibold tabular-nums ${accent ?? 'text-text'}`}>{value}</div>
    </div>
  );
}

export function PacketAnalytics({ packetId }: { packetId: string }) {
  const { data: views = [] } = usePacketViews(packetId);
  const { data: emailShares = [] } = usePacketEmailShares(packetId);
  const liveCount = usePacketLiveViewers(packetId);
  const { total, unique } = useMemo(() => summarizeViews(views), [views]);

  // Most recent view per viewer, so the log reads as a visitor list rather than
  // one row per refresh.
  const visitors = useMemo(() => {
    const seen = new Map<string, (typeof views)[number]>();
    for (const v of views) if (!seen.has(v.viewerToken)) seen.set(v.viewerToken, v);
    return Array.from(seen.values());
  }, [views]);

  if (!views.length && !emailShares.length) {
    return (
      <div className="mt-2 rounded-md border border-border-2 bg-surface px-3 py-2.5 text-[12px] text-text-3">
        No views yet. Once you share the link, view counts and live viewers appear here.
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-border-2 bg-surface p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
        <BarChart3 size={12} /> Packet analytics
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Metric icon={<Eye size={11} />} label="Total views" value={total} />
        <Metric icon={<Users size={11} />} label="Unique viewers" value={unique} />
        <Metric
          icon={<Radio size={11} className={liveCount ? 'text-success' : ''} />}
          label="Viewing now"
          value={liveCount}
          accent={liveCount ? 'text-success' : 'text-text-3'}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-text-3">
            Visitors ({visitors.length})
          </div>
          <div className="max-h-52 overflow-y-auto rounded border border-border-2">
            <table className="w-full text-left text-[12px]">
              <thead className="sticky top-0 bg-surface-3 text-[10px] uppercase tracking-wide text-text-3">
                <tr>
                  <th className="px-2 py-1.5">Viewer</th>
                  <th className="px-2 py-1.5">Contact</th>
                  <th className="px-2 py-1.5 text-right">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {visitors.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-2 py-2 text-center text-text-3">
                      No visitors yet.
                    </td>
                  </tr>
                )}
                {visitors.map((v) => (
                  <tr key={v.id} className="border-t border-border-2">
                    <td className="px-2 py-1.5 text-text">
                      {v.viewerName || <span className="text-text-3">Anonymous</span>}
                    </td>
                    <td className="px-2 py-1.5 text-text-2">
                      {[v.viewerPhone, v.viewerEmail].filter(Boolean).join(' · ') || (
                        <span className="text-text-3">Token {v.viewerToken.slice(0, 8)}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-text-3">{formatDateTime(v.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[11px] text-text-3">
            Names and contact details appear only where the viewer supplied them via the lead-capture gate.
          </p>
        </div>

        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-text-3">
            Emailed to ({emailShares.length})
          </div>
          <div className="max-h-52 overflow-y-auto rounded border border-border-2">
            <table className="w-full text-left text-[12px]">
              <thead className="sticky top-0 bg-surface-3 text-[10px] uppercase tracking-wide text-text-3">
                <tr>
                  <th className="px-2 py-1.5">To</th>
                  <th className="px-2 py-1.5 text-center">
                    <span title="Email opened?">
                      <Mail size={11} className="inline" />
                    </span>
                  </th>
                  <th className="px-2 py-1.5 text-center">
                    <span title="Link opened?">
                      <MousePointerClick size={11} className="inline" />
                    </span>
                  </th>
                  <th className="px-2 py-1.5 text-right">Sent</th>
                </tr>
              </thead>
              <tbody>
                {emailShares.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-2 py-2 text-center text-text-3">
                      Not emailed to anyone yet.
                    </td>
                  </tr>
                )}
                {emailShares.map((s) => (
                  <tr key={s.id} className="border-t border-border-2">
                    <td className="max-w-[140px] truncate px-2 py-1.5 text-text" title={s.toEmail}>
                      {s.toEmail}
                    </td>
                    <td
                      className="px-2 py-1.5 text-center"
                      title={s.emailOpenedAt ? `Opened ${formatDateTime(s.emailOpenedAt)}` : 'Not opened yet'}
                    >
                      {s.emailOpenedAt ? (
                        <span className="text-success">✓</span>
                      ) : (
                        <span className="text-text-3">–</span>
                      )}
                    </td>
                    <td
                      className="px-2 py-1.5 text-center"
                      title={s.linkClickedAt ? `Opened ${formatDateTime(s.linkClickedAt)}` : 'Not opened yet'}
                    >
                      {s.linkClickedAt ? (
                        <span className="text-success">✓</span>
                      ) : (
                        <span className="text-text-3">–</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-text-3">{formatDateTime(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[11px] text-text-3">
            <Mail size={9} className="inline" /> email opened · <MousePointerClick size={9} className="inline" /> link opened
          </p>
        </div>
      </div>
    </div>
  );
}
