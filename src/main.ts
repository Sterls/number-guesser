// Start-up: account, then the first screen.

import './style.css';
import { show, offerUpdate, refresh, screen, type Screen } from './app';
import { $, on, toast } from './ui/dom';
import { data, migrate, save } from './store';
import { configured, finishSwitch, startSession } from './net/supabase';
import { api, online } from './net/api';
import { loadMe, loadStreak, refreshHistory } from './account';
import { askName } from './screens/account';
import { bindResult } from './screens/play';
import { joinByCode, resumeRoom } from './screens/room';
import { setStatsLength } from './screens/stats';
import { showToday } from './screens/board';
import './screens/home';
import { loadStory } from './screens/story';
import './screens/settings';

bindResult(
  () => { showToday(); show('board'); },
  (length) => { setStatsLength(length); show('stats'); },
);

document.querySelectorAll<HTMLElement>('.back').forEach((b) => b.addEventListener('click', () => show((b.dataset.to || 'home') as Screen)));

function inviteFromUrl(): string | null {
  const params = new URLSearchParams(location.search);
  const code = params.get('room');
  if (!code) return null;
  params.delete('room');
  const rest = params.toString();
  history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}`);
  return /^[A-Za-z0-9]{5}$/.test(code) ? code.toUpperCase() : null;
}

const SPLASH_MS = 6000;

async function init() {
  setupUpdates();
  migrate();
  const invite = inviteFromUrl();
  $('splash').classList.remove('hidden');
  let problem = '';
  let late = false; // the server took too long: the game opened without it
  const account = async () => {
    if (!configured) return;
    try {
      problem = await startSession();
    } catch {
      problem = '';
    }
    if (await finishSwitch((t) => api.merge(t))) toast('Signed in with Google.');
    await loadMe();
    // History and streak arrive after the first screen: redraw it when they do.
    void Promise.all([refreshHistory(), loadStreak(), loadStory()]).then(() => { if (screen() === 'home' || screen() === 'stats') refresh(); });
    if (late) {
      // Connected after all: bring the first screen up to date.
      if (problem) toast(problem, 6000);
      if (screen() === 'home' || screen() === 'stats') refresh();
      if (screen() === 'home' && data.room && online()) void resumeRoom();
    }
  };
  // Never sit on the loading screen for long: after a few seconds, open the
  // game anyway (offline play works) and let the account catch up.
  let ready = false;
  const opened = account().catch(() => {}).then(() => { ready = true; });
  await Promise.race([opened, new Promise((done) => setTimeout(done, SPLASH_MS))]);
  late = !ready;
  $('splash').classList.add('hidden');
  if (late) toast("Can't reach the server yet. You can play offline for now.", 6000);
  else if (problem) toast(problem, 6000);

  const anyScreen = () => Boolean(document.querySelector('section.screen:not(.hidden)'));
  const next = () => {
    // The server is slow: the menu now; the room (or invite) once it answers.
    if (late) { show('home'); if (invite) void joinByCode(invite); return; }
    if (invite) return void Promise.resolve(joinByCode(invite)).catch(() => {}).then(() => { if (!anyScreen()) show('home'); });
    // Back into the room you were in; if that doesn't work out, the menu.
    if (data.room && online()) return void resumeRoom().catch(() => {}).then(() => { if (!anyScreen()) show('home'); });
    show('home');
  };
  if (!data.name) {
    askName(() => {
      if (!data.settings.seenHelp && !invite) {
        data.settings.seenHelp = true;
        save();
        show('help');
      } else next();
    });
  } else next();
  (window as unknown as { vaultReady: boolean }).vaultReady = true;
}

// ---------- offline copy & updates ----------

let waiting: ServiceWorker | null = null;
function setupUpdates() {
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (import.meta.env.DEV || !('serviceWorker' in navigator) || (location.protocol !== 'https:' && !local)) return;
  let updating = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updating) return;
    updating = false;
    location.reload();
  });
  on('update-btn', 'click', () => {
    if (!waiting) return;
    updating = true;
    $<HTMLButtonElement>('update-btn').disabled = true;
    $('update-btn').textContent = 'Updating…';
    waiting.postMessage('skipWaiting');
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = () => {
      if (!reg.waiting || !navigator.serviceWorker.controller) return;
      waiting = reg.waiting;
      offerUpdate();
    };
    offer();
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => { if (worker.state === 'installed') offer(); });
    });
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    setInterval(check, 60 * 60 * 1000);
  }).catch(() => {});
}

void init();
