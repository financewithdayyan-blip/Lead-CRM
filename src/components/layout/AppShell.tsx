import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { BulkSmsProgressBanner } from './BulkSmsProgressBanner';
import { NotificationsProvider } from '@/contexts/NotificationsContext';

export function AppShell() {
  return (
    <NotificationsProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-bg">
        <BulkSmsProgressBanner />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar />
          <main className="min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[1400px] px-6 py-6">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </NotificationsProvider>
  );
}
