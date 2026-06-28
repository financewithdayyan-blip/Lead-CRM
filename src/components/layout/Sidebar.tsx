import { useEffect, useRef, useState } from 'react';
import { NavLink, useMatch, useNavigate } from 'react-router-dom';
import { Bell, ChevronUp, LayoutDashboard, Users, Kanban, History, Settings, Shield, LogOut, Eye } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamMembers } from '@/hooks/useTeam';
import { useOnlineUserIds } from '@/contexts/PresenceContext';
import { useNotificationsContext } from '@/contexts/NotificationsContext';
import { cn, initials } from '@/lib/utils';

function ViewingPullUp({ viewingId }: { viewingId?: string }) {
  const navigate = useNavigate();
  const { data: members = [] } = useTeamMembers();
  const onlineIds = useOnlineUserIds();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (members.length === 0) return null;

  const current = viewingId ? members.find((m) => m.memberId === viewingId) : null;
  const currentLabel = current ? current.member.fullName || current.member.email : 'My Dashboard';

  function select(id: string | null) {
    setOpen(false);
    navigate(id ? `/team/${id}` : '/');
  }

  return (
    <div ref={containerRef} className="relative px-3 pb-2">
      {open && (
        <div className="absolute bottom-full left-3 right-3 mb-2 max-h-64 overflow-y-auto rounded-md border border-sidebar-border bg-sidebar-2 p-1.5 shadow-popover">
          <button
            onClick={() => select(null)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] font-medium transition-colors',
              !viewingId ? 'bg-sidebar text-sidebar-textActive' : 'text-sidebar-text hover:bg-sidebar hover:text-sidebar-textActive',
            )}
          >
            My Dashboard
          </button>
          {members.map((m) => {
            const isOnline = onlineIds.has(m.memberId);
            const isSelected = viewingId === m.memberId;
            return (
              <button
                key={m.memberId}
                onClick={() => select(m.memberId)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] font-medium transition-colors',
                  isSelected ? 'bg-sidebar text-sidebar-textActive' : 'text-sidebar-text hover:bg-sidebar hover:text-sidebar-textActive',
                )}
              >
                <span className={cn('h-2 w-2 shrink-0 rounded-full', isOnline ? 'bg-emerald-500' : 'bg-slate-500')} title={isOnline ? 'Online' : 'Offline'} />
                <span className="truncate">{m.member.fullName || m.member.email}</span>
              </button>
            );
          })}
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-sidebar-border bg-sidebar-2 px-2.5 py-2 text-[12px] text-sidebar-textActive"
      >
        <span className="flex items-center gap-1.5 truncate">
          <Eye size={12} className="shrink-0 text-sidebar-text" />
          <span className="truncate">{currentLabel}</span>
        </span>
        <ChevronUp size={14} className={cn('shrink-0 text-sidebar-text transition-transform', open && 'rotate-180')} />
      </button>
    </div>
  );
}

export function Sidebar() {
  const { profile, signOut } = useAuth();
  const isOverseer = profile?.role === 'admin';
  const [first, last] = (profile?.fullName ?? '').split(' ');
  const match = useMatch('/team/:memberId/*');
  const viewingId = match?.params.memberId;
  const { unreadCount } = useNotificationsContext();

  const navItems = viewingId
    ? [
        { to: `/team/${viewingId}`, label: 'Dashboard', icon: LayoutDashboard },
        { to: `/team/${viewingId}/leads`, label: 'Leads', icon: Users },
        { to: `/team/${viewingId}/kanban`, label: 'Pipeline', icon: Kanban },
        { to: `/team/${viewingId}/settings`, label: 'Settings', icon: Settings },
      ]
    : [
        { to: '/', label: 'Dashboard', icon: LayoutDashboard },
        { to: '/leads', label: 'Leads', icon: Users },
        { to: '/kanban', label: 'Pipeline', icon: Kanban },
        { to: '/calls', label: 'Call History', icon: History },
        { to: '/settings', label: 'Settings', icon: Settings },
      ];

  return (
    <aside className="flex h-full w-60 flex-col bg-sidebar">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <img src="/logo-mark.svg" alt="BlueBird CRM" className="h-8 w-auto shrink-0" />
        <span className="text-base font-semibold text-sidebar-textActive">BlueBird CRM</span>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        <NavLink
          to="/notifications"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive ? 'bg-sidebar-2 text-sidebar-textActive' : 'text-sidebar-text hover:bg-sidebar-2 hover:text-sidebar-textActive',
            )
          }
        >
          <Bell size={16} />
          Notifications
          {unreadCount > 0 && (
            <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </NavLink>
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/' || !!viewingId}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-sidebar-2 text-sidebar-textActive' : 'text-sidebar-text hover:bg-sidebar-2 hover:text-sidebar-textActive',
              )
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
        {isOverseer && !viewingId && (
          <NavLink
            to="/team"
            end
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-sidebar-2 text-sidebar-textActive' : 'text-sidebar-text hover:bg-sidebar-2 hover:text-sidebar-textActive',
              )
            }
          >
            <Shield size={16} />
            Team
          </NavLink>
        )}
      </nav>

      {isOverseer && <ViewingPullUp viewingId={viewingId} />}

      <div className="border-t border-sidebar-border px-3 py-3">
        <div className="mb-2 flex items-center gap-2.5 px-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sidebar-2 text-[11px] font-semibold text-sidebar-textActive">
            {initials(first ?? profile?.email ?? '', last ?? '')}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-sidebar-textActive">{profile?.fullName ?? profile?.email}</div>
            <div className="text-[11px] capitalize text-sidebar-text">{profile?.role}</div>
          </div>
        </div>
        <button
          onClick={() => signOut()}
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-sidebar-text transition-colors hover:bg-sidebar-2 hover:text-danger"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
