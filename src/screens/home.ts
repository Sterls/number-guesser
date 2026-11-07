// The menu.

import { show, register } from '../app';
import { $, on } from '../ui/dom';
import { data } from '../store';
import { dailyNumber, todayKey } from '../lib/game';
import { online } from '../net/api';
import { configured, sessionProblem, startSession } from '../net/supabase';
import { account, allGames, loadMe, loadStreak, refreshHistory } from '../account';
import { startDaily, startSingle } from './play';
import { openRoom } from './room';

function renderHome() {
  const today = todayKey();
  const n = dailyNumber(today);
  const done = allGames().find((g) => g.mode === 'daily' && g.date === today && g.ranked);
  $('daily-btn').innerHTML = done
    ? `Daily #${n} ${done.won ? `✓ ${done.guesses.length} guesses` : '✗'}`
    : `Daily code #${n}`;
  $('streak').textContent = account.streak ? `🔥 ${account.streak}-day streak` : '';
  $('streak').classList.toggle('hidden', !account.streak);
  const isOnline = online();
  $('offline-note').classList.toggle('hidden', isOnline || !configured);
  // Online but no account: say why (usually a Supabase setting) instead of "offline".
  const problem = navigator.onLine ? sessionProblem() : '';
  $('offline-text').textContent = problem
    ? `⚠️ Couldn't connect to the game server (${problem}). Single player still works, but won't count on the leaderboard.`
    : navigator.onLine ? '⚠️ Connecting to the game server…'
      : "📴 You're offline. Single player still works, but won't count on the leaderboard.";
  $('retry-btn').classList.toggle('hidden', !navigator.onLine);
  $('daily-btn').classList.toggle('dim', !isOnline);
  $('versus-btn').classList.toggle('hidden', !configured);
  $('versus-btn').classList.toggle('dim', !isOnline);
  $('versus-btn').textContent = data.room ? `⚔️ Back to room ${data.room.code}` : '⚔️ Play friends';
  $('board-btn').classList.toggle('hidden', !configured);
  $('practice-btn').textContent = !isOnline && data.offline ? 'Continue single player' : 'Single player';
}

register('home', renderHome);

on('help-btn', 'click', () => show('help'));
on('help-done', 'click', () => show('home'));
on('settings-btn', 'click', () => show('settings'));
on('stats-btn', 'click', () => show('stats'));
on('board-btn', 'click', () => show('board'));
on('daily-btn', 'click', () => void startDaily($('daily-btn')));
on('practice-btn', 'click', () => void startSingle($('practice-btn')));
on('versus-btn', 'click', () => openRoom());
on('retry-btn', 'click', async () => {
  $('retry-btn').textContent = 'Trying…';
  await startSession().catch(() => '');
  await loadMe();
  void refreshHistory();
  void loadStreak();
  $('retry-btn').textContent = 'Try again';
  renderHome();
});

window.addEventListener('online', () => { if (!$('home').classList.contains('hidden')) renderHome(); });
window.addEventListener('offline', () => { if (!$('home').classList.contains('hidden')) renderHome(); });
