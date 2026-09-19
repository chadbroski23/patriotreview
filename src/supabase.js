import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Safety net: refuse to run if someone pasted a secret/service-role key by mistake.
function isSecretKey(k) {
  if (!k) return false;
  if (k.startsWith('sb_secret_')) return true;
  try {
    const payload = JSON.parse(atob(k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

export let configError = '';
if (!url || !key) {
  configError = 'This site is not connected to Supabase yet. See the README (step 10).';
} else if (isSecretKey(key)) {
  configError = 'The wrong Supabase key was used. Use the anon/publishable key, never the service_role/secret key.';
}

export const configured = !configError;
export const supabase = configured ? createClient(url, key) : null;
