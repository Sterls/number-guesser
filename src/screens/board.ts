// Leaderboards. "Today" ranks today's daily code (everyone had the same
// code, so it's the fairest): cracked first, then fewest guesses, then
// fastest, with each player's daily streak. "All time" ranks every
// server-checked game by average guesses or fewest guesses, showing games played.

import { register, screen } from '../app';
import { $, ask, esc, formatTime, toast } from '../ui/dom';
import { api, online } from '../net/api';
import { DAILY_LENGTH, dailyNumber, todayKey } from '../lib/game';
import type { BoardRow, DailyRow } from '../lib/types';
import { account, loadMe, playerName } from '../account';
import { setBoard } from './account';

let view: 'today' | 'all' = 'today';
let order: 'avg' | 'best' = 'avg';
let length = DAILY_LENGTH;
// All-time boards: 3 and 4 digits (no 5-digit board).
const BOARD_LENGTHS = [3, 4];
let seq = 0;

export const showToday = () => { view = 'today'; };

async function renderBoard() {
  $('board-view').querySelectorAll<HTMLElement>('.who').forEach((b) => {
    b.classList.toggle('on', b.dataset.view === view);
    b.onclick = () => { view = b.dataset.view as 'today' | 'all'; void renderBoard(); };
  });
  $('board-order').classList.toggle('hidden', view !== 'all');
  $('board-length').classList.toggle('hidden', view !== 'all');
  $('board-order').querySelectorAll<HTMLElement>('.who').forEach((b) => {
    b.classList.toggle('on', b.dataset.order === order);
    b.onclick = () => { order = b.dataset.order as 'avg' | 'best'; void renderBoard(); };
  });
  const chips = $('board-length');
  chips.innerHTML = '';
  for (const len of BOARD_LENGTHS) {
    const b = document.createElement('button');
    b.className = `chip${len === length ? ' on' : ''}`;
    b.textContent = `${len} digits`;
    b.onclick = () => { length = len; void renderBoard(); };
    chips.appendChild(b);
  }
  const today = todayKey();
  $('board-explain').textContent = view === 'today'
    ? `Daily #${dailyNumber(today)}: everyone cracks the same code. Fewest guesses wins; ties go to the faster.`
    : order === 'avg' ? 'Average guesses per cracked code. Lower is better.' : 'Fewest guesses to crack a single code.';
  renderJoin();

  if (!online()) {
    $('board-table').innerHTML = '';
    $('board-msg').textContent = 'The leaderboard needs internet.';
    return;
  }
  const mine = ++seq;
  $('board-msg').innerHTML = '<span class="spinner" aria-hidden="true"></span>Loading…';
  $('board-table').classList.add('loading');
  try {
    if (view === 'today') {
      const res = await api.dailyBoard(today);
      if (mine !== seq || screen() !== 'board') return;
      drawDaily(res.top, res.me, res.players);
    } else {
      const res = await api.board(length, order);
      if (mine !== seq || screen() !== 'board') return;
      drawAll(res.top, res.me);
    }
  } catch {
    if (mine !== seq) return;
    $('board-table').innerHTML = '';
    $('board-msg').textContent = "Couldn't load the leaderboard. Check your internet and try again.";
  } finally {
    if (mine === seq) $('board-table').classList.remove('loading');
  }
}

function drawDaily(top: DailyRow[], me: DailyRow | null, players: number) {
  const row = (r: DailyRow) => `<tr class="${r.me ? 'me' : ''}" data-name="${esc(r.name)}">
    <td class="rank">${r.rank}</td><td class="name">${esc(r.name)}</td>
    <td class="num sorted">${r.cracked ? r.guesses : '✗'}</td>
    <td class="num">${r.cracked && r.ms != null ? formatTime(r.ms) : '–'}</td>
    <td class="num">${r.streak ? `🔥${r.streak}` : ''}</td></tr>`;
  const rows = top.map(row);
  if (me && !top.some((r) => r.me)) rows.push('<tr class="gap"><td colspan="5">⋯</td></tr>', row(me));
  $('board-table').innerHTML = rows.length
    ? `<thead><tr><th>#</th><th>Player</th><th class="num">Guesses</th><th class="num">Time</th><th class="num">Streak</th></tr></thead><tbody>${rows.join('')}</tbody>`
    : '';
  $('board-msg').textContent = rows.length
    ? `${players} player${players === 1 ? '' : 's'} today. Tap a name to report it.`
    : "Nobody has cracked today's code yet. Be the first!";
  bindReports();
}

function drawAll(top: BoardRow[], me: BoardRow | null) {
  const key = (col: string) => (col === order ? ' sorted' : '');
  const row = (r: BoardRow) => {
    const missed = r.played - r.cracked;
    return `<tr class="${r.me ? 'me' : ''}" data-name="${esc(r.name)}">
      <td class="rank">${r.rank}</td><td class="name">${esc(r.name)}</td>
      <td class="num">${r.played}${missed ? ` <span class="miss" title="${missed} not cracked">✗${missed}</span>` : ''}</td>
      <td class="num${key('avg')}">${Number(r.avg).toFixed(1)}</td>
      <td class="num${key('best')}">${r.best}</td></tr>`;
  };
  const rows = top.map(row);
  if (me && !top.some((r) => r.me)) rows.push('<tr class="gap"><td colspan="5">⋯</td></tr>', row(me));
  $('board-table').innerHTML = rows.length
    ? `<thead><tr><th>#</th><th>Player</th><th class="num">Games</th><th class="num">Avg</th><th class="num">Best</th></tr></thead><tbody>${rows.join('')}</tbody>`
    : '';
  $('board-msg').textContent = rows.length
    ? '✗ = games not cracked. Only games checked by the server count. Tap a name to report it.'
    : `Nobody on the ${length}-digit board yet.`;
  bindReports();
}

function bindReports() {
  $('board-table').querySelectorAll<HTMLElement>('tbody tr:not(.me):not(.gap)').forEach((tr) => {
    tr.onclick = () => void reportName(tr.dataset.name || '');
  });
}

async function reportName(name: string) {
  if (!await ask(`Report "${name}" as an inappropriate name?`, { yes: 'Report' })) return;
  try {
    await api.report(name);
    toast('Thanks. Names reported by several players are hidden.');
  } catch {
    toast("Couldn't send the report. Try again later.");
  }
}

function renderJoin() {
  const box = $('board-join');
  if (!online()) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const name = esc(playerName());
  if (account.me?.on_board) {
    box.innerHTML = `<p><b>${name}</b> is on the leaderboard. <button id="board-hide" class="link">Hide me</button></p>`;
    $('board-hide').onclick = async () => { if (await setBoard(false, $('board-hide'))) void renderBoard(); };
  } else {
    box.innerHTML = `<p><b>Put ${name} on the leaderboard?</b></p>
      <p class="fine">Shows your name and results publicly. Please don't use your real name.</p>
      <button id="board-join-btn" class="btn">Join as ${name}</button>`;
    $('board-join-btn').onclick = async () => { if (await setBoard(true, $('board-join-btn'))) void renderBoard(); };
  }
}

register('board', () => {
  void renderBoard();
  if (!account.me) void loadMe().then(() => { if (screen() === 'board') renderJoin(); });
});
