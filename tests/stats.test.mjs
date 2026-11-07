import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, dailyStreaks } from '../js/stats.js';

let t = 0;
const g = (secret, guesses, extra = {}) => ({
  mode: 'practice', length: secret.length, date: '2026-11-07', at: ++t,
  secret, guesses, won: guesses.at(-1) === secret, ms: 60000, ...extra,
});

test('average guesses per crack ignores games given up', () => {
  const s = computeStats([
    g('0472', ['1234', '0472']),
    g('0472', ['1234', '5678', '0472', ]),
    g('0472', ['1234', '9999'].slice(0, 1)), // gave up after 1 guess
  ]);
  assert.equal(s.played, 3);
  assert.equal(s.wins, 2);
  assert.equal(s.gaveUp, 1);
  assert.equal(s.avgGuesses, 2.5);
  assert.equal(s.best, 2);
  assert.equal(s.worst, 3);
  assert.equal(s.distribution[1].count, 1);
  assert.equal(s.distribution[2].count, 1);
});

test('favourite openers: first guess, second guess and the pair', () => {
  const s = computeStats([
    g('0472', ['1234', '5678', '0472']),
    g('0391', ['1234', '5678', '0391']),
    g('0391', ['1234', '0391']),
    g('9876', ['5678', '9876']),
  ]);
  assert.deepEqual(s.firsts[0], { value: '1234', count: 3 });
  assert.deepEqual(s.seconds[0], { value: '5678', count: 2 });
  assert.deepEqual(s.firstTwo[0], { value: '1234 → 5678', count: 2 });
});

test('ties go to the opener played most recently', () => {
  const s = computeStats([g('0472', ['1234', '0472']), g('0472', ['9876', '0472'])]);
  assert.equal(s.firsts[0].value, '9876');
});

test('filtering by code length', () => {
  const games = [g('047', ['123', '047']), g('0472', ['1234', '5678', '0472'])];
  assert.equal(computeStats(games, { length: 3 }).played, 1);
  assert.equal(computeStats(games, { length: 4 }).avgGuesses, 3);
  assert.equal(computeStats(games).played, 2);
});

test('sharpness: guesses that ignore earlier pegs count against you', () => {
  // 1234 scores 0 against 5678; guessing 1243 next is impossible (1,2,3,4 ruled out).
  const s = computeStats([g('5678', ['1234', '1243', '5678'])]);
  assert.equal(s.sharpness, 0.5);
});

test('daily streaks', () => {
  const d = (date, won = true) => g('0472', won ? ['0472'] : ['1234'], { mode: 'daily', date });
  const games = [d('2026-11-01'), d('2026-11-02'), d('2026-11-03'), d('2026-11-05'), d('2026-11-06'), d('2026-11-07', false)];
  assert.deepEqual(dailyStreaks(games, '2026-11-07'), { current: 2, best: 3 });
  assert.deepEqual(dailyStreaks(games, '2026-11-09'), { current: 0, best: 3 });
  assert.deepEqual(dailyStreaks([d('2026-12-31'), d('2027-01-01')], '2027-01-01'), { current: 2, best: 2 });
});
