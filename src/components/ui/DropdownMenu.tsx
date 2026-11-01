import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

type Pos = { top: number; left?: number; right?: number };

/** A small action menu (Preview/Edit/Void/Delete, Download/Delete, etc.)
 * that renders through a portal to document.body instead of as an
 * `absolute` child of its trigger — a horizontally-scrolling ancestor
 * (a table wrapped in overflow-x-auto, a tile carousel) clips or stretches
 * to contain an absolutely-positioned descendant, which is what made these
 * menus scroll the whole row/card area instead of floating above it. */
export function DropdownMenu({
  trigger,
  children,
  align = 'end',
  width = 'w-40',
}: {
  trigger: (props: { onClick: (e: React.MouseEvent) => void; ref: RefObject<HTMLButtonElement> }) => ReactNode;
  children: (close: () => void) => ReactNode;
  /** Which edge of the trigger the menu hangs from. */
  align?: 'start' | 'end';
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function updatePosition() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos(
      align === 'end'
        ? { top: rect.bottom + 4, right: window.innerWidth - rect.right }
        : { top: rect.bottom + 4, left: rect.left },
    );
  }

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (!open) updatePosition();
    setOpen((v) => !v);
  }

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (triggerRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function close() {
      setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    // Capture phase so this also fires for scroll on the table's own
    // overflow-x-auto wrapper, not just window-level scrolling.
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <>
      {trigger({ onClick: toggle, ref: triggerRef })}
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            className={`fixed z-50 ${width} rounded-md border border-border bg-surface py-1 shadow-popover`}
            style={{ top: pos.top, left: pos.left, right: pos.right }}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </>
  );
}
