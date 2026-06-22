import { STAGE_CONFIG, type LeadStage } from '@/types/domain';

export function StageBadge({ stage }: { stage: LeadStage }) {
  const cfg = STAGE_CONFIG[stage];
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={{ backgroundColor: `${cfg.color}1f`, color: cfg.color }}
    >
      {cfg.label}
    </span>
  );
}
