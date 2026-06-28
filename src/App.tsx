import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import { PresenceProvider } from '@/contexts/PresenceContext';
import { AppShell } from '@/components/layout/AppShell';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { LoginPage } from '@/pages/LoginPage';
import { AcceptInvitePage } from '@/pages/AcceptInvitePage';
import { DashboardPage } from '@/pages/DashboardPage';
import { LeadsPage } from '@/pages/LeadsPage';
import { LeadProfilePage } from '@/pages/LeadProfilePage';
import { KanbanPage } from '@/pages/KanbanPage';
import { CallHistoryPage } from '@/pages/CallHistoryPage';
import { NotificationsPage } from '@/pages/NotificationsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { TeamPage } from '@/pages/TeamPage';
import { MemberDashboardPage } from '@/pages/MemberDashboardPage';
import { MemberLeadsPage } from '@/pages/MemberLeadsPage';
import { MemberLeadProfilePage } from '@/pages/MemberLeadProfilePage';
import { MemberKanbanPage } from '@/pages/MemberKanbanPage';
import { MemberSettingsPage } from '@/pages/MemberSettingsPage';
import { CallSessionPage } from '@/pages/CallSessionPage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PresenceProvider>
          <BrowserRouter basename="/crm">
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/accept-invite" element={<AcceptInvitePage />} />
              <Route element={<ProtectedRoute />}>
                <Route path="/session" element={<CallSessionPage />} />
                <Route element={<AppShell />}>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/leads" element={<LeadsPage />} />
                  <Route path="/leads/:id" element={<LeadProfilePage />} />
                  <Route path="/kanban" element={<KanbanPage />} />
                  <Route path="/calls" element={<CallHistoryPage />} />
                  <Route path="/notifications" element={<NotificationsPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route element={<ProtectedRoute requireOverseer />}>
                    <Route path="/team" element={<TeamPage />} />
                    <Route path="/team/:memberId" element={<MemberDashboardPage />} />
                    <Route path="/team/:memberId/leads" element={<MemberLeadsPage />} />
                    <Route path="/team/:memberId/leads/:id" element={<MemberLeadProfilePage />} />
                    <Route path="/team/:memberId/kanban" element={<MemberKanbanPage />} />
                    <Route path="/team/:memberId/settings" element={<MemberSettingsPage />} />
                  </Route>
                </Route>
              </Route>
            </Routes>
          </BrowserRouter>
        </PresenceProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
