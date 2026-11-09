// Choosing a name (first time) and the account screen: name, Google
// sign-in, leaderboard and deleting your data.

import { show, register } from '../app';
import { $, on, ask, toast, busy, esc } from '../ui/dom';
import { data, save } from '../store';
import { nameProblem } from '../lib/names';
import { api, online } from '../net/api';
import { configured, email, isGuest, signInWithGoogle, signOut, startFresh } from '../net/supabase';
import { account, loadMe, playerName } from '../account';

// After the name is chosen: where to go next (an invite link, help, or the menu).
let afterName: () => void = () => show('home');
export function askName(then: () => void) {
  afterName = then;
  show('name');
}

async function setName(raw: string): Promise<string> {
  const name = raw.trim();
  const problem = nameProblem(name);
  if (problem) return problem;
  if (online()) {
    try {
      account.me = await api.setName(name);
    } catch (e) {
      return (e as Error).message === 'name not allowed' ? 'Please choose a friendlier name.' : (e as Error).message;
    }
  }
  data.name = name;
  save();
  return '';
}

on('name-form', 'submit', async (e) => {
  e.preventDefault();
  const done = busy($('name-form').querySelector('button')!, 'Saving…');
  const problem = await setName($<HTMLInputElement>('new-name').value);
  done();
  $('name-error').textContent = problem;
  if (problem) return;
  $<HTMLInputElement>('new-name').blur();
  afterName();
});

register('name', () => {
  $<HTMLInputElement>('new-name').value = data.name;
  $('name-error').textContent = '';
});

// ---------- account screen ----------

function renderAccount() {
  $('acct-name').textContent = playerName();
  const box = $('acct-sign');
  if (!configured) {
    box.innerHTML = '<p class="fine">Online play is switched off in this copy of the game.</p>';
  } else if (isGuest()) {
    box.innerHTML = `<p><b>Guest account</b> on this phone.</p>
      <p class="fine">Sign in with Google to keep your games and stats if you change or lose your phone, and to play on another one.</p>
      <button id="google-btn" class="btn google"><span class="g" aria-hidden="true">G</span>Sign in with Google</button>`;
    $('google-btn').onclick = () => void googleSignIn();
  } else {
    box.innerHTML = `<p>Signed in with <b>Google</b>${email() ? ` as <b>${esc(email())}</b>` : ''}.</p>
      <p class="fine">Your games and stats are kept with your Google account.</p>
      <button id="signout-btn" class="btn ghost">Sign out</button>`;
    $('signout-btn').onclick = () => void doSignOut();
  }
  const on = account.me?.on_board ?? false;
  $('acct-board').innerHTML = !configured ? '' : on
    ? `<p><b>${esc(playerName())}</b> is on the leaderboard.</p><button id="board-off" class="btn ghost">Hide me from the leaderboard</button>`
    : `<p>You're not on the leaderboard.</p><p class="fine">Joining shows your name and results publicly. Please don't use your real name.</p><button id="board-on" class="btn secondary">Show me on the leaderboard</button>`;
  document.getElementById('board-on')?.addEventListener('click', (e) => void setBoard(true, e.currentTarget as HTMLElement));
  document.getElementById('board-off')?.addEventListener('click', (e) => void setBoard(false, e.currentTarget as HTMLElement));
  $('acct-delete').classList.toggle('hidden', !configured);
}

export async function setBoard(onBoard: boolean, button: HTMLElement): Promise<boolean> {
  if (!online()) { toast('That needs internet.'); return false; }
  const done = busy(button, onBoard ? 'Joining…' : 'Hiding…');
  try {
    account.me = await api.setBoard(onBoard);
    toast(onBoard ? `${playerName()} is on the leaderboard!` : "You're hidden from the leaderboard.");
    return true;
  } catch (e) {
    toast((e as Error).message);
    done();
    return false;
  } finally {
    if (!$('account').classList.contains('hidden')) renderAccount();
  }
}

async function googleSignIn() {
  if (!online()) return toast('Signing in needs internet.');
  const done = busy($('google-btn'), 'Opening Google…');
  try {
    await signInWithGoogle(() => api.mergeToken());
  } catch (e) {
    done();
    toast(`Couldn't sign in: ${(e as Error).message}`);
  }
}

async function doSignOut() {
  if (!await ask("Sign out? This phone will start a new guest account. Your games stay with your Google account.", { yes: 'Sign out' })) return;
  const done = busy($('signout-btn'), 'Signing out…');
  try {
    await signOut();
    data.history = [];
    data.historyFor = '';
    data.name = '';
    data.story = { level: 1, best: {} };
    save();
    account.me = null;
    account.streak = 0;
    await loadMe();
    askName(() => show('home'));
  } catch (e) {
    toast((e as Error).message);
  } finally {
    done();
  }
}

on('acct-rename', 'click', async () => {
  const name = await ask('Your name:', { yes: 'Save', input: playerName() });
  if (typeof name !== 'string') return;
  const problem = await setName(name);
  if (problem) toast(problem);
  renderAccount();
});

on('acct-delete', 'click', async () => {
  if (!online()) return toast('Deleting your account needs internet.');
  const google = !isGuest();
  if (!await ask(`Delete your account${google ? ' (and its link to your Google account)' : ''}, with all your games, stats and leaderboard results? This can't be undone.`, { yes: 'Delete account' })) return;
  const done = busy($('acct-delete'), 'Deleting…');
  try {
    await api.deleteMe();
  } catch (e) {
    done();
    return toast((e as Error).message);
  }
  // Everything kept on this phone goes too, and it starts again as a new guest.
  data.history = [];
  data.historyFor = '';
  data.local = [];
  data.offline = null;
  data.room = null;
  data.notes = {};
  data.name = '';
  data.story = { level: 1, best: {} };
  save();
  account.me = null;
  account.streak = 0;
  await startFresh().catch(() => {});
  done();
  toast('Your account has been deleted.');
  askName(() => show('home'));
});

register('account', () => {
  renderAccount();
  void loadMe().then(() => { if (!$('account').classList.contains('hidden')) renderAccount(); });
});
