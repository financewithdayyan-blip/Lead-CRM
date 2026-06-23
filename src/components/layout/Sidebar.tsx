import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, Kanban, History, Settings, Shield, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn, initials } from '@/lib/utils';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/leads', label: 'Leads', icon: Users },
  { to: '/kanban', label: 'Pipeline', icon: Kanban },
  { to: '/calls', label: 'Call History', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const { profile, signOut } = useAuth();
  const isOverseer = profile?.role === 'admin' || profile?.role === 'manager';
  const [first, last] = (profile?.fullName ?? '').split(' ');

  return (
    <aside className="flex h-full w-60 flex-col bg-sidebar">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-white">
          LC
        </div>
        <span className="text-base font-semibold text-sidebar-textActive">Lead CRM</span>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
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
        {isOverseer && (
          <NavLink
            to="/team"
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
