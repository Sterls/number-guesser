// Daily code and single player. Online, the server makes the code and checks
// every guess (ranked). Offline, single player is checked on the phone and
// doesn't count on the leaderboard.

import { show, register } from '../app';
import { $, on, ask, toast, formatTime, plural } from '../ui/dom';
import { feel } from '../ui/feel';
import { celebrate, CONFETTI } from '../ui/celebrate';
import { renderGame, rowsHtml, setController, tilesHtml, type Controller, type Row } from '../ui/board';
import { api, online, ApiError } from '../net/api';
import { data, save, settings, type OfflineGame } from '../store';
import { DAILY_LENGTH, dailyNumber, explain, makeSecret, remainingFrom, score, todayKey } from '../lib/game';
import { computeStats, type PlayedGame } from '../lib/stats';
import type { ServerGame } from '../lib/types';
import { account, addFinished, allGames, loadStreak, playerName } from '../account';

export { CONFETTI };

const leftText = (length: number, guesses: string[], feedback: Row['feedback'][], i: number) => {
  if (!settings().showLeft || !feedback[i]) return '';
  const n = remainingFrom(length, guesses.slice(0, i + 1), feedback);
  return ` ${n.toLocaleString()} possible code${n === 1 ? '' : 's'} left.`;
};

function emptyList(length: number) {
  return `<li class="empty">Type any ${length} different digits to start.<br>After each guess you'll see how many of your digits are in the <b class="t-exact">right spot</b> and how many are in the code but in the <b class="t-close">wrong spot</b>.</li>`;
}

// ---------- ranked (server) games ----------

function serverController(start: ServerGame): Controller {
  let g = start;
  const notes = (data.notes[g.id] ||= {});
  const rows = (): Row[] => g.guesses.map((x) => ({ guess: x.guess, feedback: { exact: x.exact, close: x.close } }));
  return {
    title: () => (g.mode === 'daily' ? `Daily #${dailyNumber(g.day || todayKey())}` : `Single player · ${g.length} digits`),
    sub: () => (g.mode === 'daily' ? 'Same code for everyone' : ''),
    length: () => g.length,
    notes: () => notes,
    saveNotes: save,
    canType: () => !g.finished,
    goLabel: () => 'Guess',
    showNotes: () => true,
    async submit(code) {
      if (g.guesses.some((x) => x.guess === code)) return `You already tried ${code}.`;
      try {
        g = await api.guess(g.id, code);
      } catch (e) {
        return e instanceof ApiError && e.offline ? 'No connection, so that guess wasn\'t sent. Try again.' : (e as Error).message;
      }
      const last = g.guesses[g.guesses.length - 1];
      if (!g.cracked) feel.guess(last.exact, last.close);
      renderGame(true);
      if (g.finished) finishServer(g);
    },
    list(list, justGuessed) {
      const r = rows();
      list.innerHTML = r.length ? rowsHtml(r, justGuessed) : emptyList(g.length);
      return r;
    },
    head: () => null,
    panel: () => '',
    explain(i) {
      const r = rows();
      return explain(r[i].guess, r[i].feedback!) + leftText(g.length, r.map((x) => x.guess), r.map((x) => x.feedback), i);
    },
    action: 'flag',
    async onAction() {
      if (g.finished) return;
      if (!await ask('Give up and see the code? It counts as not cracked.', { yes: 'Give up' })) return;
      try {
        g = await api.giveUp(g.id);
        finishServer(g);
      } catch (e) {
        toast((e as Error).message);
      }
    },
  };
}

function finishServer(g: ServerGame) {
  delete data.notes[g.id];
  addFinished(g);
  void loadStreak();
  const n = g.guesses.length;
  if (g.cracked) {
    void celebrate(n === 1 ? 'First try!' : 'Cracked!', `${g.mode === 'daily' ? 'Daily code' : 'Code'} cracked in ${plural(n, 'guess')}`, g.secret || '')
      .then(() => showSoloResult(fromServer(g), g.mode === 'daily', g));
  } else {
    feel.fail();
    setTimeout(() => showSoloResult(fromServer(g), g.mode === 'daily', g), 300);
  }
}

const fromServer = (g: ServerGame) => allGames().find((x) => x.ranked && x.at === Date.parse(g.finished_at || '')) || null;

export async function startDaily(button?: HTMLElement) {
  if (!online()) return toast("The daily code needs internet. Single player works offline.");
  try {
    const g = await withSpinner(button, () => api.start('daily', DAILY_LENGTH, todayKey()));
    if (g.finished) return showSoloResult(fromServer(g) || null, true, g);
    setController(serverController(g));
    show('game');
  } catch (e) {
    toast((e as Error).message);
  }
}

export async function startSingle(button?: HTMLElement) {
  const length = settings().length;
  if (online()) {
    try {
      const g = await withSpinner(button, () => api.start('single', length));
      setController(serverController(g));
      show('game');
      return;
    } catch (e) {
      if (!(e instanceof ApiError && e.offline)) return toast((e as Error).message);
    }
  }
  startOffline();
}

async function withSpinner<T>(button: HTMLElement | undefined, fn: () => Promise<T>): Promise<T> {
  const label = button?.innerHTML;
  if (button) { button.classList.add('busy'); button.innerHTML = '<span class="spinner" aria-hidden="true"></span>Opening…'; }
  try {
    return await fn();
  } finally {
    if (button && label !== undefined) { button.classList.remove('busy'); button.innerHTML = label; }
  }
}

// ---------- offline games ----------

function startOffline() {
  const length = settings().length;
  if (!data.offline || data.offline.length !== length) {
    data.offline = { length, secret: makeSecret(length), guesses: [], notes: {}, startedAt: Date.now(), elapsed: 0 };
    save();
  }
  setController(offlineController(data.offline));
  show('game');
}

function offlineController(g: OfflineGame): Controller {
  const rows = (): Row[] => g.guesses.map((guess) => ({ guess, feedback: score(g.secret, guess) }));
  return {
    title: () => `Single player · ${g.length} digits`,
    sub: () => '📴 Offline · not ranked',
    length: () => g.length,
    notes: () => g.notes,
    saveNotes: save,
    canType: () => true,
    goLabel: () => 'Guess',
    showNotes: () => true,
    async submit(code) {
      if (g.guesses.includes(code)) return `You already tried ${code}.`;
      g.guesses.push(code);
      save();
      const f = score(g.secret, code);
      if (code !== g.secret) feel.guess(f.exact, f.close);
      renderGame(true);
      if (code === g.secret) finishOffline(g, true);
    },
    list(list, justGuessed) {
      const r = rows();
      list.innerHTML = r.length ? rowsHtml(r, justGuessed) : emptyList(g.length);
      return r;
    },
    head: () => null,
    panel: () => '',
    explain(i) {
      const r = rows();
      return explain(r[i].guess, r[i].feedback!) + leftText(g.length, g.guesses, r.map((x) => x.feedback), i);
    },
    action: 'flag',
    async onAction() {
      if (await ask('Give up and see the code?', { yes: 'Give up' })) finishOffline(g, false);
    },
  };
}

function finishOffline(g: OfflineGame, won: boolean) {
  const record: PlayedGame = {
    mode: 'offline', length: g.length, date: todayKey(), at: Date.now(), secret: g.secret,
    guesses: [...g.guesses], won, ms: Date.now() - g.startedAt, ranked: false,
  };
  data.local.push(record);
  data.offline = null;
  save();
  const n = record.guesses.length;
  if (won) void celebrate(n === 1 ? 'First try!' : 'Cracked!', `Code cracked in ${plural(n, 'guess')}`, g.secret).then(() => showSoloResult(record, false));
  else { feel.fail(); setTimeout(() => showSoloResult(record, false), 300); }
}

// ---------- result ----------

let last: { record: PlayedGame | null; daily: boolean; game?: ServerGame } | null = null;

export function showSoloResult(record: PlayedGame | null, daily: boolean, game?: ServerGame) {
  last = { record, daily, game };
  const secret = record?.secret || game?.secret || '';
  const won = record ? record.won : Boolean(game?.cracked);
  const n = record ? record.guesses.length : game?.guesses.length ?? 0;
  $('result-title').textContent = won ? (n === 1 ? 'First try?!' : 'Vault open!') : 'Locked out';
  $('result-label').textContent = daily ? `Daily #${dailyNumber(record?.date || todayKey())}` : 'The code';
  $('result-label').classList.remove('hidden');
  $('result-code').innerHTML = tilesHtml(secret);
  $('result-text').textContent = won
    ? `${plural(n, 'guess')}${record ? ` in ${formatTime(record.ms)}` : ''}.`
    : `Not cracked. You made ${plural(n, 'guess')}.`;
  const length = record?.length ?? game?.length ?? 4;
  const s = computeStats(allGames(), { length, today: todayKey() });
  const bits: string[] = [];
  if (s.avgGuesses) bits.push(`${playerName()}'s average for ${length} digits: ${s.avgGuesses.toFixed(1)} guesses`);
  if (daily && account.streak) bits.push(`🔥 ${account.streak}-day streak`);
  if (record && !record.ranked) bits.push('Offline game: not on the leaderboard');
  $('result-extra').textContent = bits.join(' · ');
  $('again-btn').textContent = 'Play again';
  $('again-btn').classList.toggle('hidden', daily);
  $('share-btn').classList.remove('hidden');
  $('result-stats-btn').textContent = daily ? '🏆 Today\'s leaderboard' : '📊 Stats';
  $('result-home-btn').textContent = 'Menu';
  $('result').classList.remove('hidden');
  $('result').dataset.kind = 'solo';
}

function shareText(): string {
  if (!last) return '';
  const r = last.record;
  const g = last.game;
  const guesses = r?.guesses ?? g?.guesses.map((x) => x.guess) ?? [];
  const secret = r?.secret || g?.secret || '';
  const won = r ? r.won : Boolean(g?.cracked);
  const head = last.daily ? `Vault #${dailyNumber(r?.date || todayKey())}` : `Vault single player (${secret.length} digits)`;
  const rows = guesses.map((x) => { const f = score(secret, x); return `🟢${f.exact} 🟡${f.close}`; });
  return `${head} · ${won ? plural(guesses.length, 'guess') : 'not cracked'}\n🟢 right spot · 🟡 wrong spot\n${rows.join('\n')}`;
}

const closeResult = () => $('result').classList.add('hidden');
const isSolo = () => $('result').dataset.kind === 'solo';

export function bindResult(openBoard: () => void, openStats: (length: number) => void) {
  on('again-btn', 'click', () => { if (isSolo()) { closeResult(); void startSingle(); } });
  on('result-home-btn', 'click', () => { if (isSolo()) { closeResult(); show('home'); } });
  on('result-stats-btn', 'click', () => {
    if (!isSolo()) return;
    closeResult();
    if (last?.daily) openBoard();
    else openStats(last?.record?.length ?? settings().length);
  });
  on('share-btn', 'click', async () => {
    if (!isSolo()) return;
    const text = shareText();
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast('Copied. Paste it anywhere.'); }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') toast("Couldn't share on this phone.");
    }
  });
}

register('game', () => renderGame());
