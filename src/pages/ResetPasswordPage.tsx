import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { getErrorMessage } from '@/lib/utils';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Supabase fires PASSWORD_RECOVERY once the recovery token in the URL is verified
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true);
    });
    // Also check immediately — the client may have already processed the token before
    // this effect ran (PKCE flow resolves synchronously before mount)
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setMessage('Password updated. Taking you to the dashboard…');
      setTimeout(() => navigate('/'), 1500);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <img src="/logo-mark.svg" alt="BlueBird CRM" className="h-14 w-auto" />
          <h1 className="text-xl font-semibold text-text">BlueBird CRM</h1>
        </div>

        {!ready && (
          <div className="card text-center text-[13px] text-text-3">
            Verifying reset link…
          </div>
        )}

        {ready && (
          <form onSubmit={handleSubmit} className="card space-y-4">
            <h2 className="text-base font-semibold text-text">Set new password</h2>
            <div>
              <label className="label">New password</label>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
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
                required
                minLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {error && (
              <div className="rounded-md bg-danger-dim px-3 py-2 text-[13px] text-danger">{error}</div>
            )}
            {message && (
              <div className="rounded-md bg-success-dim px-3 py-2 text-[13px] text-success">{message}</div>
            )}
            <button type="submit" disabled={busy} className="btn btn-primary w-full">
              {busy ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
