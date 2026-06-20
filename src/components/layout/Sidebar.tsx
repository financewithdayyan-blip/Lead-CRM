import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, Kanban, History, Settings, PhoneCall, Shield, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/leads', label: 'Leads', icon: Users },
  { to: '/kanban', label: 'Kanban', icon: Kanban },
  { to: '/history', label: 'Call History', icon: History },
  { to: '/script', label: 'Call Script', icon: PhoneCall },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const { profile, signOut } = useAuth();
  const isOverseer = profile?.role === 'admin' || profile?.role === 'manager';

  return (
    <aside className="flex h-full w-60 flex-col border-r border-border bg-surface">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-blue to-[#00b89f] font-display text-sm font-bold text-bg">
          LC
        </div>
        <span className="font-display text-base font-semibold text-text">Lead Caller</span>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-blue-dim text-blue-bright' : 'text-text-2 hover:bg-surface-3 hover:text-text',
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
                isActive ? 'bg-blue-dim text-blue-bright' : 'text-text-2 hover:bg-surface-3 hover:text-text',
              )
            }
          >
            <Shield size={16} />
            Team
          </NavLink>
        )}
      </nav>

      <div className="border-t border-border px-3 py-3">
        <div className="mb-2 px-2">
          <div className="truncate text-sm font-medium text-text">{profile?.callerName ?? profile?.email}</div>
          <div className="text-[11px] uppercase tracking-wide text-text-3">{profile?.role}</div>
        </div>
        <button
          onClick={() => signOut()}
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-text-2 transition-colors hover:bg-surface-3 hover:text-red"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
