import { getScoreTier } from '@/lib/scoring';
import type { CallLogEntry, Lead } from '@/types/domain';

const TIER_STYLE = {
  hot: { bg: 'rgba(240,82,82,0.14)', text: '#f05252', icon: '🔥' },
  warm: { bg: 'rgba(245,165,36,0.14)', text: '#f5a524', icon: '⚡' },
  cold: { bg: 'rgba(106,113,148,0.14)', text: '#a6acc1', icon: '❄' },
  none: { bg: 'transparent', text: '#6b7184', icon: '' },
};

export function ScoreBadge({ lead, callLog, compact }: { lead: Lead; callLog: CallLogEntry[]; compact?: boolean }) {
  const { tier, score, reasons } = getScoreTier(lead, callLog);
  if (tier === 'none') {
    return compact ? null : <span className="text-[11px] text-text-3">— unscored</span>;
  }
  const style = TIER_STYLE[tier];
  const title = reasons.length ? reasons.join(' · ') : 'No factors yet';
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ backgroundColor: style.bg, color: style.text }}
    >
      {compact ? score : `${style.icon} ${score} ${tier[0].toUpperCase()}${tier.slice(1)}`}
    </span>
  );
}
