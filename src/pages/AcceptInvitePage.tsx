import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export function AcceptInvitePage() {
  const { session, loading } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (done) return <Navigate to="/" replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDone(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-xl font-bold text-white">LC</div>
          <h1 className="text-xl font-semibold text-text">Welcome to the team</h1>
        </div>

        {loading ? (
          <div className="card text-center text-text-3">Confirming your invite…</div>
        ) : !session ? (
          <div className="card text-center text-[13px] text-danger">
            This invite link is invalid or has expired. Ask your admin to send a new one.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="card space-y-4">
            <p className="text-[13px] text-text-2">Set a password for {session.user.email} to finish setting up your account.</p>
            <div>
              <label className="label">Password</label>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                minLength={6}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Confirm password</label>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                minLength={6}
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {error && <div className="rounded-md bg-danger-dim px-3 py-2 text-[13px] text-danger">{error}</div>}
            <button type="submit" disabled={busy} className="btn btn-primary w-full">
              Set password &amp; continue
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
