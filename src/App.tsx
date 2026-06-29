import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SpeedInsights } from "@vercel/speed-insights/react"
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import { PresenceProvider } from '@/contexts/PresenceContext';
import { AttendanceProvider } from '@/contexts/AttendanceContext';
import { AppShell } from '@/components/layout/AppShell';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';

// Each page loads as its own chunk instead of one ~1MB bundle, so the first
// paint only needs the code for the route actually being visited.
const LoginPage = lazy(() => import('@/pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const AcceptInvitePage = lazy(() => import('@/pages/AcceptInvitePage').then((m) => ({ default: m.AcceptInvitePage })));
const DashboardPage = lazy(() => import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const LeadsPage = lazy(() => import('@/pages/LeadsPage').then((m) => ({ default: m.LeadsPage })));
const LeadProfilePage = lazy(() => import('@/pages/LeadProfilePage').then((m) => ({ default: m.LeadProfilePage })));
const KanbanPage = lazy(() => import('@/pages/KanbanPage').then((m) => ({ default: m.KanbanPage })));
const CallHistoryPage = lazy(() => import('@/pages/CallHistoryPage').then((m) => ({ default: m.CallHistoryPage })));
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const TeamPage = lazy(() => import('@/pages/TeamPage').then((m) => ({ default: m.TeamPage })));
const MemberDashboardPage = lazy(() => import('@/pages/MemberDashboardPage').then((m) => ({ default: m.MemberDashboardPage })));
const MemberLeadsPage = lazy(() => import('@/pages/MemberLeadsPage').then((m) => ({ default: m.MemberLeadsPage })));
const MemberLeadProfilePage = lazy(() => import('@/pages/MemberLeadProfilePage').then((m) => ({ default: m.MemberLeadProfilePage })));
const MemberKanbanPage = lazy(() => import('@/pages/MemberKanbanPage').then((m) => ({ default: m.MemberKanbanPage })));
const MemberSettingsPage = lazy(() => import('@/pages/MemberSettingsPage').then((m) => ({ default: m.MemberSettingsPage })));
const CallSessionPage = lazy(() => import('@/pages/CallSessionPage').then((m) => ({ default: m.CallSessionPage })));

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

function RouteFallback() {
  return <div className="flex h-screen items-center justify-center text-text-3">Loading…</div>;
}

export default function App() {
  return (
    <div>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AttendanceProvider>
          <PresenceProvider>
            <BrowserRouter basename="/crm">
              <Suspense fallback={<RouteFallback />}>
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
              </Suspense>
            </BrowserRouter>
          </PresenceProvider>
        </AttendanceProvider>
      </AuthProvider>
    </QueryClientProvider>
    <SpeedInsights />
    </div>
  );
}
