import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { NotificationsProvider } from '@/contexts/NotificationsContext';

export function AppShell() {
  return (
    <NotificationsProvider>
      <div className="flex h-screen overflow-hidden bg-bg">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] px-6 py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </NotificationsProvider>
  );
}
