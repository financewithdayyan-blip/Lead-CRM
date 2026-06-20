import { STATUS_CONFIG, type LeadStatus } from '@/types/domain';

export function StatusBadge({ status }: { status: LeadStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={{ backgroundColor: `${cfg.color}1f`, color: cfg.color }}
    >
      {cfg.label}
    </span>
  );
}
