import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, LogOut, Search, Settings } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useNotificationsContext } from '@/contexts/NotificationsContext';
import { cn, initials } from '@/lib/utils';

/** Sits above every page (wired in AppShell) — the search/notifications/
 * profile cluster every reference dashboard puts in a persistent top bar
 * rather than buried in the sidebar. The search box is presentational for
 * now (no cross-page search exists yet in this app to wire it to) — visual
 * parity first, real behavior is a separate, deliberate addition later. */
export function TopBar() {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const { unreadCount } = useNotificationsContext();
  const [first, last] = (profile?.fullName ?? '').split(' ');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-border bg-surface px-6">
      <div className="relative w-full max-w-sm">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
        <input className="input !rounded-full !py-2 !pl-9" placeholder="Search leads, contracts…" />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={() => navigate('/notifications')}
          className="relative flex h-9 w-9 items-center justify-center rounded-full text-text-2 transition-colors hover:bg-surface-3"
          title="Notifications"
        >
          <Bell size={17} />
          {unreadCount > 0 && <span className="absolute right-2 top-2 flex h-2 w-2 rounded-full bg-danger ring-2 ring-surface" />}
        </button>

        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 transition-colors hover:bg-surface-3"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-semibold text-white">
              {initials(first ?? profile?.email ?? '', last ?? '')}
            </div>
            <div className="hidden text-left leading-tight sm:block">
              <div className="text-[13px] font-medium text-text">{profile?.fullName ?? profile?.email}</div>
              <div className="text-[11px] capitalize text-text-3">{profile?.role}</div>
            </div>
            <ChevronDown size={14} className={cn('shrink-0 text-text-3 transition-transform', menuOpen && 'rotate-180')} />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full z-30 mt-2 w-44 rounded-lg border border-border bg-surface p-1.5 shadow-popover">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  navigate('/settings');
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-text-2 hover:bg-surface-3"
              >
                <Settings size={14} /> Settings
              </button>
              <button
                onClick={() => signOut()}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-danger hover:bg-danger-dim"
              >
                <LogOut size={14} /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
