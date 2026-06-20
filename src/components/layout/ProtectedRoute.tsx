import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

export function ProtectedRoute({ requireOverseer }: { requireOverseer?: boolean }) {
  const { session, profile, loading } = useAuth();

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-text-3">Loading…</div>;
  }
  if (!session) return <Navigate to="/login" replace />;
  if (requireOverseer && profile && profile.role === 'rep') return <Navigate to="/" replace />;

  return <Outlet />;
}
