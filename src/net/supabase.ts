// Accounts. Every phone gets a guest account the first time it opens the
// game, so it can play ranked games straight away. "Sign in with Google"
// turns the guest into a Google account (same games), or, if that Google
// account already plays Vault, switches to it and brings this phone's guest
// games along. One account per phone.

import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { SUPABASE } from '../config';

export const configured = Boolean(SUPABASE.url && SUPABASE.key);

export const supabase: SupabaseClient | null = configured
  ? createClient(SUPABASE.url, SUPABASE.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'vault-auth' },
  })
  : null;

const MERGE_KEY = 'vault-merge-token';
const SWITCHING_KEY = 'vault-switching-to-google';

let user: User | null = null;
let problem = '';
// Why there's no account (shown on the home screen), or ''.
export const sessionProblem = () => problem;
export const currentUser = () => user;
export const isGuest = () => Boolean(user?.is_anonymous);
export const email = () => user?.email || user?.identities?.find((i) => i.provider === 'google')?.identity_data?.email || '';

const here = () => `${location.origin}${location.pathname}`;

// Called once at start-up. Finishes a Google sign-in coming back from
// Google, or makes a guest account if there's no account yet. Returns a
// message to show if something went wrong (or '').
export async function startSession(): Promise<string> {
  if (!supabase) return '';
  const params = new URLSearchParams(location.search + location.hash.replace(/^#/, '&'));
  const errorCode = params.get('error_code') || '';
  const errorText = params.get('error_description') || '';
  if (errorCode || params.has('code')) {
    // Tidy the address bar (supabase-js has already read what it needs).
    history.replaceState(null, '', here());
  }
  const { data } = await supabase.auth.getSession();
  user = data.session?.user ?? null;
  supabase.auth.onAuthStateChange((_event, session) => { user = session?.user ?? null; });

  // Linking failed because that Google account already plays Vault: sign in to it instead.
  if (errorCode === 'identity_already_exists' || /already (linked|exists)/i.test(errorText)) {
    sessionStorage.setItem(SWITCHING_KEY, '1');
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: here() } });
    return '';
  }
  if (errorCode || errorText) return `Google sign-in didn't work: ${errorText || errorCode}.`;

  if (!user) {
    const { data: anon, error } = await supabase.auth.signInAnonymously();
    if (error) {
      problem = navigator.onLine ? error.message : '';
      return '';
    }
    problem = '';
    user = anon.user;
  }
  return '';
}

// After coming back from a Google sign-in that switched accounts: bring the
// guest's games over. `merge` is the server call (passed in to avoid a loop).
export async function finishSwitch(merge: (token: string) => Promise<unknown>): Promise<boolean> {
  const token = localStorage.getItem(MERGE_KEY);
  const switching = sessionStorage.getItem(SWITCHING_KEY);
  sessionStorage.removeItem(SWITCHING_KEY);
  if (!token || !user || user.is_anonymous) return false;
  localStorage.removeItem(MERGE_KEY);
  try {
    await merge(token);
  } catch {
    // The token was for this same account (linking worked) or has expired: nothing to move.
  }
  return Boolean(switching);
}

// Sign in with Google. A guest's games come along either way. `mergeToken`
// is asked for before leaving, in case the Google account already exists.
export async function signInWithGoogle(mergeToken: () => Promise<string>): Promise<void> {
  if (!supabase) return;
  if (user?.is_anonymous) {
    try { localStorage.setItem(MERGE_KEY, await mergeToken()); } catch { /* offline: just sign in */ }
    const { error } = await supabase.auth.linkIdentity({ provider: 'google', options: { redirectTo: here() } });
    if (!error) return; // on its way to Google
    if (!/manual linking/i.test(error.message)) throw error;
    // Linking is switched off in Supabase: sign in instead (the token still moves the games).
  }
  sessionStorage.setItem(SWITCHING_KEY, '1');
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: here() } });
  if (error) throw error;
}

// After the account was deleted on the server: forget it on this phone
// (there's nothing left to sign out of) and start a new guest.
export async function startFresh(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  user = null;
  const { data } = await supabase.auth.signInAnonymously();
  user = data.user;
}

// Sign out of Google; this phone becomes a new guest.
export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
  user = null;
  const { data } = await supabase.auth.signInAnonymously();
  user = data.user;
}
