import { X } from 'lucide-react';
import type { Tag } from '@/types/domain';

export function TagPill({ tag, onRemove }: { tag: Tag; onRemove?: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: tag.colorBg, color: tag.colorText }}
    >
      {tag.name}
      {onRemove && (
        <button onClick={onRemove} className="opacity-70 hover:opacity-100">
          <X size={11} />
        </button>
      )}
    </span>
  );
}
