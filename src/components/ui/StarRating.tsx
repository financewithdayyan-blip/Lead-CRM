import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

export function StarRating({ value, onChange, size = 16 }: { value: number; onChange?: (v: number) => void; size?: number }) {
  return (
    <div className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(n === value ? 0 : n)}
          className={cn('transition-colors', onChange && 'cursor-pointer hover:scale-110')}
        >
          <Star size={size} className={n <= value ? 'fill-warning text-warning' : 'text-border-2'} />
        </button>
      ))}
    </div>
  );
}
