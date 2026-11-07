// Player stats, worked out from the list of finished games. Nothing here is
// stored: change a formula and every past game is counted the new way.

import { fitsFeedback, score } from './game';

export type Mode = 'daily' | 'single' | 'room' | 'offline';

// A finished game, from the server (ranked) or played offline on this phone.
export interface PlayedGame {
  mode: Mode;
  length: number;
  date: string;              // YYYY-MM-DD (the daily's day, or when it was played)
  at: number;                // when it finished, ms since 1970
  secret: string | null;     // null if never revealed
  guesses: string[];
  won: boolean;              // cracked the code
  ms: number;                // time to crack (or to the last guess)
  ranked: boolean;           // checked by the server
  result?: 'win' | 'lose' | 'draw'; // games against a friend
  opponent?: string;
}

export interface Tally { value: string; count: number }

function tally(items: string[]): Tally[] {
  const counts = new Map<string, { value: string; count: number; last: number }>();
  items.forEach((item, i) => {
    const c = counts.get(item) || { value: item, count: 0, last: 0 };
    c.count++;
    c.last = i; // later index = played more recently
    counts.set(item, c);
  });
  // Most common first; ties go to the one played most recently.
  return [...counts.values()].sort((a, b) => b.count - a.count || b.last - a.last)
    .map(({ value, count }) => ({ value, count }));
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

function dayAfter(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

// Daily streaks: days in a row with the daily code cracked.
export function dailyStreaks(games: PlayedGame[], today: string): { current: number; best: number } {
  const days = [...new Set(games.filter((g) => g.mode === 'daily' && g.won).map((g) => g.date))].sort();
  let best = 0, run = 0;
  let prev: string | null = null;
  for (const d of days) {
    run = prev && dayAfter(prev) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  // The current streak is still alive if the last win was today or yesterday.
  const current = prev && (prev === today || dayAfter(prev) === today) ? run : 0;
  return { current, best };
}

export interface Stats {
  played: number;
  wins: number;
  gaveUp: number;
  winRate: number | null;
  avgGuesses: number | null;
  best: number | null;
  worst: number | null;
  avgSeconds: number | null;
  recentAvg: number | null;
  distribution: { label: string; count: number }[];
  firsts: Tally[];
  seconds: Tally[];
  firstTwo: Tally[];
  sharpness: number | null;
  streak: { current: number; best: number };
  versus: { win: number; lose: number; draw: number };
}

// `length` limits the stats to one code length (null = all games).
export function computeStats(allGames: PlayedGame[], { length = null as number | null, today = null as string | null } = {}): Stats {
  const games = [...allGames].sort((a, b) => a.at - b.at).filter((g) => length == null || g.length === length);
  const wins = games.filter((g) => g.won);
  const winGuesses = wins.map((g) => g.guesses.length);

  // Guess distribution for wins: 1..9, then "10+".
  const distribution = Array.from({ length: 10 }, (_, i) => ({ label: i === 9 ? '10+' : String(i + 1), count: 0 }));
  for (const n of winGuesses) distribution[Math.min(n, 10) - 1].count++;

  const firsts = tally(games.filter((g) => g.guesses.length >= 1).map((g) => g.guesses[0]));
  const seconds = tally(games.filter((g) => g.guesses.length >= 2).map((g) => g.guesses[1]));
  const firstTwo = tally(games.filter((g) => g.guesses.length >= 2).map((g) => `${g.guesses[0]} → ${g.guesses[1]}`));

  // Sharpness: of the guesses after the first, how many could still have been
  // the code given the feedback so far (i.e. didn't waste information).
  let considered = 0, sharp = 0;
  for (const g of games) {
    if (!g.secret) continue;
    const secret = g.secret;
    const feedback = g.guesses.map((x) => score(secret, x));
    for (let i = 1; i < g.guesses.length; i++) {
      considered++;
      if (fitsFeedback(g.guesses[i], g.guesses.slice(0, i), feedback)) sharp++;
    }
  }

  const versus = { win: 0, lose: 0, draw: 0 };
  for (const g of games) if (g.mode === 'room' && g.result) versus[g.result]++;

  return {
    played: games.length,
    wins: wins.length,
    gaveUp: games.length - wins.length,
    winRate: games.length ? wins.length / games.length : null,
    avgGuesses: avg(winGuesses),
    best: winGuesses.length ? Math.min(...winGuesses) : null,
    worst: winGuesses.length ? Math.max(...winGuesses) : null,
    avgSeconds: wins.length ? avg(wins.map((g) => g.ms / 1000)) : null,
    recentAvg: avg(winGuesses.slice(-10)), // last 10 wins, to see improvement
    distribution,
    firsts,
    seconds,
    firstTwo,
    sharpness: considered ? sharp / considered : null,
    streak: today ? dailyStreaks(allGames, today) : { current: 0, best: 0 },
    versus,
  };
}
