import { test, expect } from 'vitest';
import { computeStats, dailyStreaks, type PlayedGame } from '../src/lib/stats';

let t = 0;
const g = (secret: string, guesses: string[], extra: Partial<PlayedGame> = {}): PlayedGame => ({
  mode: 'single', length: secret.length, date: '2026-11-07', at: ++t, ranked: true,
  secret, guesses, won: guesses.at(-1) === secret, ms: 60000, ...extra,
});

test('average guesses per crack ignores games not cracked', () => {
  const s = computeStats([g('0472', ['1234', '0472']), g('0472', ['1234', '5678', '0472']), g('0472', ['1234'])]);
  expect(s.played).toBe(3);
  expect(s.wins).toBe(2);
  expect(s.gaveUp).toBe(1);
  expect(s.avgGuesses).toBe(2.5);
  expect(s.best).toBe(2);
  expect(s.worst).toBe(3);
  expect(s.distribution[1].count).toBe(1);
  expect(s.distribution[2].count).toBe(1);
});

test('favourite openers: first guess, second guess and the pair', () => {
  const s = computeStats([
    g('0472', ['1234', '5678', '0472']),
    g('0391', ['1234', '5678', '0391']),
    g('0391', ['1234', '0391']),
    g('9876', ['5678', '9876']),
  ]);
  expect(s.firsts[0]).toEqual({ value: '1234', count: 3 });
  expect(s.seconds[0]).toEqual({ value: '5678', count: 2 });
  expect(s.firstTwo[0]).toEqual({ value: '1234 → 5678', count: 2 });
});

test('ties go to the opener played most recently', () => {
  expect(computeStats([g('0472', ['1234', '0472']), g('0472', ['9876', '0472'])]).firsts[0].value).toBe('9876');
});

test('filtering by code length', () => {
  const games = [g('047', ['123', '047']), g('0472', ['1234', '5678', '0472'])];
  expect(computeStats(games, { length: 3 }).played).toBe(1);
  expect(computeStats(games, { length: 4 }).avgGuesses).toBe(3);
  expect(computeStats(games).played).toBe(2);
});

test('sharpness: guesses that ignore earlier feedback count against you', () => {
  // 1234 scores 0 against 5678; guessing 1243 next is impossible (1,2,3,4 ruled out).
  expect(computeStats([g('5678', ['1234', '1243', '5678'])]).sharpness).toBe(0.5);
  // A game whose code was never revealed is skipped.
  expect(computeStats([g('5678', ['1234', '1243', '5678'], { secret: null })]).sharpness).toBe(null);
});

test('games against friends are tallied', () => {
  const s = computeStats([
    g('0472', ['0472'], { mode: 'room', result: 'win' }),
    g('0472', ['1234'], { mode: 'room', result: 'lose' }),
    g('0472', ['0472'], { mode: 'room', result: 'win' }),
  ]);
  expect(s.versus).toEqual({ win: 2, lose: 1, draw: 0 });
});

test('daily streaks', () => {
  const d = (date: string, won = true) => g('0472', won ? ['0472'] : ['1234'], { mode: 'daily', date });
  const games = [d('2026-11-01'), d('2026-11-02'), d('2026-11-03'), d('2026-11-05'), d('2026-11-06'), d('2026-11-07', false)];
  expect(dailyStreaks(games, '2026-11-07')).toEqual({ current: 2, best: 3 });
  expect(dailyStreaks(games, '2026-11-09')).toEqual({ current: 0, best: 3 });
  expect(dailyStreaks([d('2026-12-31'), d('2027-01-01')], '2027-01-01')).toEqual({ current: 2, best: 2 });
});
