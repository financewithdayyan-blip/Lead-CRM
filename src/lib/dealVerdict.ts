import type { DealVerdict } from '@/hooks/useDealPackets';

/**
 * One source of truth for how a verdict looks, so the builder preview and the
 * investor-facing packet can never disagree about what "strong" means.
 */
export const VERDICT_STYLE: Record<DealVerdict, { label: string; pill: string; box: string; bar: string }> = {
  strong: {
    label: 'Strong',
    pill: 'bg-success text-white',
    box: 'border-success/40 bg-success/5',
    bar: 'bg-success',
  },
  fair: {
    label: 'Fair',
    pill: 'bg-warning text-white',
    box: 'border-warning/40 bg-warning-dim',
    bar: 'bg-warning',
  },
  thin: {
    label: 'Thin',
    pill: 'bg-danger text-white',
    box: 'border-danger/40 bg-danger-dim',
    bar: 'bg-danger',
  },
  unknown: {
    label: 'Incomplete',
    pill: 'bg-border-2 text-text-2',
    box: 'border-border-2 bg-surface-3',
    bar: 'bg-border-2',
  },
};
