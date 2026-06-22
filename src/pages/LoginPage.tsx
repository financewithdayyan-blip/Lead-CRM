import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

type Mode = 'signin' | 'signup' | 'reset';

export function LoginPage() {
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && session) return <Navigate to="/" replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage('Account created. Check your email to confirm, then sign in.');
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) throw error;
        setMessage('Password reset email sent.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-xl font-bold text-white">
            LC
          </div>
          <h1 className="text-xl font-semibold text-text">Lead CRM</h1>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4">
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {mode !== 'reset' && (
            <div>
              <label className="label">Password</label>
              <input
                className="input"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}

          {error && <div className="rounded-md bg-danger-dim px-3 py-2 text-[13px] text-danger">{error}</div>}
          {message && <div className="rounded-md bg-success-dim px-3 py-2 text-[13px] text-success">{message}</div>}

          <button type="submit" disabled={busy} className="btn btn-primary w-full">
            {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset email'}
          </button>
        </form>

        <div className="mt-4 flex justify-center gap-4 text-[13px] text-text-3">
          {mode !== 'signin' && (
            <button onClick={() => setMode('signin')} className="hover:text-text">
              Sign in
            </button>
          )}
          {mode !== 'signup' && (
            <button onClick={() => setMode('signup')} className="hover:text-text">
              Create account
            </button>
          )}
          {mode !== 'reset' && (
            <button onClick={() => setMode('reset')} className="hover:text-text">
              Forgot password?
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
