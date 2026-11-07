// Player stats, worked out from the list of finished games. Nothing here is
// stored: change a formula and every past game is counted the new way.
//
// A finished game looks like:
//   { mode: 'daily' | 'practice', length: 4, date: '2026-11-07', at: 1730000000000,
//     secret: '0472', guesses: ['1234', '5678', ...], won: true, ms: 81234 }
// Games against a friend also have mode: 'pvp', result: 'win' | 'lose' | 'draw'
// and opponent: 'Alex'. Their `won` means the player cracked the code; the
// secret is null if the friend left before revealing it.

import { fits } from './game.js';

function tally(items) {
  const counts = new Map();
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

const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

function dayAfter(key) {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return t.toISOString().slice(0, 10);
}

// Daily streaks: days in a row with the daily code cracked.
export function dailyStreaks(games, today) {
  const won = new Set(games.filter((g) => g.mode === 'daily' && g.won).map((g) => g.date));
  const days = [...won].sort();
  let best = 0, run = 0, prev = null;
  for (const d of days) {
    run = prev && dayAfter(prev) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  // The current streak is still alive if the last win was today or yesterday.
  let current = 0;
  if (prev && (prev === today || dayAfter(prev) === today)) current = run;
  return { current, best };
}

// `length` limits the stats to one code length (null = all games).
export function computeStats(allGames, { length = null, today = null } = {}) {
  const games = [...allGames].sort((a, b) => a.at - b.at)
    .filter((g) => length == null || g.length === length);
  const wins = games.filter((g) => g.won);
  const winGuesses = wins.map((g) => g.guesses.length);

  // Guess distribution for wins: 1..9, then "10+".
  const distribution = Array.from({ length: 10 }, (_, i) => ({ label: i === 9 ? '10+' : String(i + 1), count: 0 }));
  for (const n of winGuesses) distribution[Math.min(n, 10) - 1].count++;

  // Openers. Only games of the same length can be compared, but a mixed list
  // still reads fine because guesses of different lengths never match.
  const firsts = tally(games.filter((g) => g.guesses.length >= 1).map((g) => g.guesses[0]));
  const seconds = tally(games.filter((g) => g.guesses.length >= 2).map((g) => g.guesses[1]));
  const firstTwo = tally(games.filter((g) => g.guesses.length >= 2).map((g) => `${g.guesses[0]} → ${g.guesses[1]}`));

  // Sharpness: of the guesses after the first, how many could still have been
  // the code given the feedback so far (i.e. didn't waste information).
  let considered = 0, sharp = 0;
  for (const g of games) {
    if (!g.secret) continue;
    for (let i = 1; i < g.guesses.length; i++) {
      considered++;
      if (fits(g.guesses[i], g.guesses.slice(0, i), g.secret)) sharp++;
    }
  }

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
    versus: ['win', 'lose', 'draw'].reduce((out, r) => ({ ...out, [r]: games.filter((g) => g.mode === 'pvp' && g.result === r).length }), {}),
  };
}
