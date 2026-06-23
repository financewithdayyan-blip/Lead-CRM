import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY env vars.');
}

const REMEMBER_ME_KEY = 'lead-crm-remember-me';

/** Lets the login form choose whether the session survives closing the browser (localStorage) or not (sessionStorage). */
export function setRememberMe(remember: boolean) {
  localStorage.setItem(REMEMBER_ME_KEY, remember ? 'true' : 'false');
}

function activeStorage(): Storage {
  return localStorage.getItem(REMEMBER_ME_KEY) === 'false' ? sessionStorage : localStorage;
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: {
      getItem: (key) => activeStorage().getItem(key),
      setItem: (key, value) => activeStorage().setItem(key, value),
      removeItem: (key) => activeStorage().removeItem(key),
    },
  },
});
