import type { LucideIcon } from 'lucide-react';

/** Icon badge + title, used above every card in the app so a page reads as
 * a set of distinct, labeled sections instead of identical gray boxes
 * stacked on top of each other. `tone` tints the badge to match whatever
 * the card is about (info/success/warning/danger/accent) — defaults to the
 * brand primary. */
export function CardHeader({
  icon: Icon,
  title,
  sub,
  tone = 'primary',
}: {
  icon: LucideIcon;
  title: string;
  sub?: string;
  tone?: 'primary' | 'info' | 'success' | 'warning' | 'danger' | 'accent';
}) {
  const toneClass: Record<typeof tone, string> = {
    primary: 'bg-primary/10 text-primary',
    info: 'bg-info/10 text-info',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    danger: 'bg-danger/10 text-danger',
    accent: 'bg-accent/10 text-accent',
  };
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${toneClass[tone]}`}>
          <Icon size={15} />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text">{title}</div>
          {sub && <div className="truncate text-[11px] text-text-3">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

/** Small uppercase eyebrow above a group of related cards — groups a
 * dashboard/settings page into scannable sections rather than one long
 * undifferentiated stack. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 mt-1 text-[11px] font-semibold uppercase tracking-wide text-text-3">{children}</div>;
}
