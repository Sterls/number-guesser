// The player's account on this phone: name, leaderboard choice and game
// history (from the server, cached here for offline stats).

import { api, online } from './net/api';
import { currentUser } from './net/supabase';
import { data, save } from './store';
import type { Me, ServerGame } from './lib/types';
import type { PlayedGame } from './lib/stats';
import { todayKey } from './lib/game';

export const account = {
  me: null as Me | null,
  streak: 0,
};

export const playerName = () => account.me?.name || data.name || 'Player';

export async function loadMe() {
  if (!online()) return;
  try {
    account.me = await api.me();
    // A name chosen before the account existed (or before going online).
    if (!account.me.name && data.name) account.me = await api.setName(data.name).catch(() => account.me);
    if (account.me?.name && account.me.name !== data.name) {
      data.name = account.me.name;
      save();
    }
  } catch {
    // Offline or not set up yet: the name on this phone still works.
  }
}

export async function loadStreak() {
  if (!online()) return;
  try { account.streak = await api.myStreak(todayKey()); } catch { /* keep the last one */ }
}

export function toPlayed(g: ServerGame): PlayedGame {
  const last = g.guesses[g.guesses.length - 1];
  const at = Date.parse(g.finished_at || g.started_at);
  return {
    mode: g.mode,
    length: g.length,
    date: g.day || todayKey(new Date(at)),
    at,
    secret: g.secret,
    guesses: g.guesses.map((x) => x.guess),
    won: g.cracked,
    ms: last ? last.ms : 0,
    ranked: true,
    result: g.result ?? undefined,
    opponent: g.opponent ?? undefined,
    level: g.mode === 'story' ? g.round ?? undefined : undefined,
  };
}

export async function refreshHistory() {
  const user = currentUser();
  if (!online() || !user) return;
  try {
    const games = await api.history();
    data.history = games.map(toPlayed);
    data.historyFor = user.id;
    save();
  } catch {
    // Keep the cached copy.
  }
}

// Every finished game this player has: ranked (server) and this phone's offline ones.
export function allGames(): PlayedGame[] {
  const user = currentUser();
  const ranked = user && data.historyFor === user.id ? data.history : [];
  return [...ranked, ...data.local];
}

// A game just finished: add it to the cached history straight away.
export function addFinished(g: ServerGame) {
  const user = currentUser();
  if (!user) return;
  if (data.historyFor !== user.id) { data.history = []; data.historyFor = user.id; }
  data.history = data.history.filter((x) => !(x.at === Date.parse(g.finished_at || '') && x.mode === g.mode));
  data.history.push(toPlayed(g));
  save();
}
