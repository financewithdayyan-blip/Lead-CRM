import { useEffect, useRef, useState } from 'react';
import { NavLink, useMatch, useNavigate } from 'react-router-dom';
import {
  ChevronUp,
  LayoutDashboard,
  Users,
  Kanban,
  History,
  Send,
  FileSignature,
  Settings,
  Shield,
  Eye,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamMembers } from '@/hooks/useTeam';
import { usePresence } from '@/contexts/PresenceContext';
import { cn } from '@/lib/utils';

const COLLAPSE_KEY = 'sidebar_collapsed';

/** Active nav item is a solid filled pill rather than a subtle accent —
 * matches the reference dashboards, and reads unambiguously at a glance
 * which page is open. Collapsed mode centers the icon and drops the label
 * instead of shrinking text illegibly. */
function NavItem({ to, label, icon: Icon, end, collapsed }: { to: string; label: string; icon: LucideIcon; end?: boolean; collapsed: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-full py-2 text-sm font-medium transition-colors',
          collapsed ? 'justify-center px-0' : 'px-3.5',
          isActive ? 'bg-primary text-white shadow-sm' : 'text-sidebar-text hover:bg-sidebar-2 hover:text-sidebar-textActive',
        )
      }
    >
      <Icon size={16} className="shrink-0" />
      {!collapsed && label}
    </NavLink>
  );
}

/** Small uppercase eyebrow above a group of nav items — turns a flat list
 * into scannable sections (Workspace / Admin / Account) instead of one
 * undifferentiated stack. Collapses to a thin divider when the sidebar is
 * minimized, since there's no room for the label text. */
function NavGroupLabel({ children, collapsed }: { children: React.ReactNode; collapsed: boolean }) {
  if (collapsed) return <div className="mx-2 mb-1 mt-3 border-t border-sidebar-border first:mt-0" />;
  return <div className="mb-1 mt-3 px-[10px] text-[10px] font-semibold uppercase tracking-wider text-sidebar-text/60 first:mt-0">{children}</div>;
}

function ViewingPullUp({ viewingId }: { viewingId?: string }) {
  const navigate = useNavigate();
  const { data: members = [] } = useTeamMembers();
  const { onlineIds, statusMap } = usePresence();
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
                <span
                  className={cn('h-2 w-2 shrink-0 rounded-full', statusMap[m.memberId] === 'session' ? 'bg-red-500' : isOnline ? 'bg-emerald-500' : 'bg-slate-500')}
                  title={statusMap[m.memberId] === 'session' ? 'In session' : isOnline ? 'Online' : 'Offline'}
                />
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
  const { profile } = useAuth();
  const isOverseer = profile?.role === 'admin';
  const match = useMatch('/team/:memberId/*');
  const viewingId = match?.params.memberId;

  // Persisted across reloads — a preference, not session state, same reason
  // theme/collapse toggles anywhere else always remember the last choice.
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(COLLAPSE_KEY) === 'true';
  });

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, String(collapsed));
  }, [collapsed]);

  const workspaceItems = viewingId
    ? [
        { to: `/team/${viewingId}`, label: 'Dashboard', icon: LayoutDashboard },
        { to: `/team/${viewingId}/leads`, label: 'Leads', icon: Users },
        { to: `/team/${viewingId}/kanban`, label: 'Kanban', icon: Kanban },
      ]
    : [
        { to: '/', label: 'Dashboard', icon: LayoutDashboard },
        { to: '/leads', label: 'Leads', icon: Users },
        { to: '/kanban', label: 'Kanban', icon: Kanban },
        { to: '/calls', label: 'Call History', icon: History },
      ];

  const adminItems = isOverseer && !viewingId
    ? [
        { to: '/bulk-sms', label: 'Bulk SMS', icon: Send },
        { to: '/blue-docs', label: 'Blue Docs', icon: FileSignature },
      ]
    : [];

  return (
    <aside className={cn('flex h-full shrink-0 flex-col bg-sidebar transition-[width] duration-200', collapsed ? 'w-[72px]' : 'w-60')}>
      <div className={cn('flex items-center gap-2.5 border-b border-sidebar-border py-5', collapsed ? 'justify-center px-2' : 'px-5')}>
        <img src="/logo-mark.svg" alt="BlueBird CRM" className="h-8 w-auto shrink-0" />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="font-serif text-base font-semibold leading-tight text-sidebar-textActive">BlueBird</div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-text">CRM</div>
          </div>
        )}
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sidebar-text transition-colors hover:bg-sidebar-2 hover:text-sidebar-textActive"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3">
        <NavGroupLabel collapsed={collapsed}>Workspace</NavGroupLabel>
        <div className="space-y-1">
          {workspaceItems.map((item) => (
            <NavItem key={item.to} {...item} end={item.to === '/' || !!viewingId} collapsed={collapsed} />
          ))}
        </div>

        {adminItems.length > 0 && (
          <>
            <NavGroupLabel collapsed={collapsed}>Admin</NavGroupLabel>
            <div className="space-y-1">
              {adminItems.map((item) => (
                <NavItem key={item.to} {...item} collapsed={collapsed} />
              ))}
              {!viewingId && <NavItem to="/team" label="Team" icon={Shield} end collapsed={collapsed} />}
            </div>
          </>
        )}

        <NavGroupLabel collapsed={collapsed}>Account</NavGroupLabel>
        <div className="space-y-1">
          <NavItem to={viewingId ? `/team/${viewingId}/settings` : '/settings'} label="Settings" icon={Settings} collapsed={collapsed} />
        </div>
      </nav>

      {isOverseer && !collapsed && <ViewingPullUp viewingId={viewingId} />}
    </aside>
  );
}
