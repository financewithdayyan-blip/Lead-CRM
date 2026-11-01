import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

type Pos = { top?: number; bottom?: number; left?: number; right?: number };

/** A small action menu (Preview/Edit/Void/Delete, Download/Delete, etc.)
 * that renders through a portal to document.body instead of as an
 * `absolute` child of its trigger — a horizontally-scrolling ancestor
 * (a table wrapped in overflow-x-auto, a tile carousel) clips or stretches
 * to contain an absolutely-positioned descendant, which is what made these
 * menus scroll the whole row/card area instead of floating above it.
 *
 * Opens downward by default, but flips to open upward from the trigger
 * when there isn't enough room below (e.g. the last row of a long table) —
 * otherwise the menu would run off the bottom of the viewport with no way
 * to see or click its lower items short of scrolling the whole page. */
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
  const [ready, setReady] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const measuredRef = useRef(false);

  function openMenu() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    measuredRef.current = false;
    setReady(false);
    setPos(
      align === 'end'
        ? { top: rect.bottom + 4, right: window.innerWidth - rect.right }
        : { top: rect.bottom + 4, left: rect.left },
    );
    setOpen(true);
  }

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    openMenu();
  }

  // One measurement pass right after the menu first mounts at its
  // provisional (below-trigger) position — if it doesn't actually fit in
  // the remaining viewport height, flip it to hang above the trigger
  // instead. Guarded by measuredRef so flipping (which itself updates pos)
  // doesn't re-trigger another measurement pass.
  useLayoutEffect(() => {
    if (!open || !pos || measuredRef.current) return;
    measuredRef.current = true;
    const menuEl = menuRef.current;
    const triggerRect = triggerRef.current?.getBoundingClientRect();
    if (!menuEl || !triggerRect) {
      setReady(true);
      return;
    }
    const menuHeight = menuEl.getBoundingClientRect().height;
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    if (menuHeight > spaceBelow - 8 && triggerRect.top > menuHeight) {
      setPos((p) => (p ? { ...p, top: undefined, bottom: window.innerHeight - triggerRect.top + 4 } : p));
    }
    setReady(true);
  }, [open, pos]);

  useLayoutEffect(() => {
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
            className={`fixed z-50 ${width} max-h-[70vh] overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-popover`}
            style={{ top: pos.top, bottom: pos.bottom, left: pos.left, right: pos.right, visibility: ready ? 'visible' : 'hidden' }}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </>
  );
}
