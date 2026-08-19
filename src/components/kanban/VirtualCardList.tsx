import { useRef, type CSSProperties, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * Virtualized card list for a Kanban column: only the cards near the viewport
 * are mounted, so a column holding thousands of leads costs about the same to
 * render — and to re-render on every keystroke or checkbox tick — as one
 * holding a dozen.
 *
 * Deliberately covers only the scrollable card area. The column shell, its
 * useDroppable ref and its header stay in KanbanPage, so the drop target is
 * always mounted and drag-and-drop is unaffected by which cards are currently
 * windowed in.
 *
 * Card heights vary (tags, auction countdown, address all wrap), so sizes are
 * measured rather than assumed; `estimateSize` only seeds the scrollbar before
 * a row has been measured once.
 */
export function VirtualCardList<T>({
  items,
  getKey,
  renderItem,
  estimateSize = 150,
  className,
  style,
}: {
  items: T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  estimateSize?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    // Keep a few rows mounted past each edge so a card dragged toward the edge
    // of the column still has a live node behind the overlay.
    overscan: 5,
    getItemKey: (index) => getKey(items[index]),
  });

  return (
    <div ref={parentRef} className={className} style={style}>
      <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
              // Stands in for the `space-y-2` the plain list used, and is
              // included in the measured height so spacing stays consistent.
              paddingBottom: 6,
            }}
          >
            {renderItem(items[virtualItem.index])}
          </div>
        ))}
      </div>
    </div>
  );
}
