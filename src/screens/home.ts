// The menu.

import { show, register } from '../app';
import { $, on } from '../ui/dom';
import { data } from '../store';
import { dailyNumber, todayKey } from '../lib/game';
import { online } from '../net/api';
import { configured, isGuest } from '../net/supabase';
import { account, allGames, playerName } from '../account';
import { startDaily, startSingle } from './play';
import { openRoom } from './room';

function renderHome() {
  $('player-name').textContent = playerName();
  $('player-kind').textContent = configured ? (isGuest() ? 'Guest' : 'Google') : '';
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
  $('daily-btn').classList.toggle('dim', !isOnline);
  $('versus-btn').classList.toggle('hidden', !configured);
  $('versus-btn').classList.toggle('dim', !isOnline);
  $('versus-btn').textContent = data.room ? `⚔️ Back to room ${data.room.code}` : '⚔️ Play a friend';
  $('board-btn').classList.toggle('hidden', !configured);
  $('practice-btn').textContent = !isOnline && data.offline ? 'Continue single player' : 'Single player';
}

register('home', renderHome);

on('player-chip', 'click', () => show('account'));
on('help-btn', 'click', () => show('help'));
on('help-done', 'click', () => show('home'));
on('settings-btn', 'click', () => show('settings'));
on('stats-btn', 'click', () => show('stats'));
on('board-btn', 'click', () => show('board'));
on('daily-btn', 'click', () => void startDaily($('daily-btn')));
on('practice-btn', 'click', () => void startSingle($('practice-btn')));
on('versus-btn', 'click', () => openRoom());

window.addEventListener('online', () => { if (!$('home').classList.contains('hidden')) renderHome(); });
window.addEventListener('offline', () => { if (!$('home').classList.contains('hidden')) renderHome(); });
