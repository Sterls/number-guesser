import { test, expect } from 'vitest';
import { score, guessProblem, makeSecret, dailyNumber, todayKey, allCodes, remainingFrom, explain } from '../src/lib/game';

// A repeatable random number generator for the tests.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('score counts right-spot and wrong-spot digits', () => {
  expect(score('0472', '4502')).toEqual({ exact: 1, close: 2 });
  expect(score('0472', '0472')).toEqual({ exact: 4, close: 0 });
  expect(score('0472', '1356')).toEqual({ exact: 0, close: 0 });
  expect(score('0472', '2740')).toEqual({ exact: 0, close: 4 });
  expect(score('123', '321')).toEqual({ exact: 1, close: 2 });
});

test('guesses must be the right length with no repeated digits', () => {
  expect(guessProblem('1234', 4)).toBe('');
  expect(guessProblem('123', 4)).toMatch(/4 digits/);
  expect(guessProblem('1123', 4)).toMatch(/once/);
  expect(guessProblem('12a4', 4)).toMatch(/Digits/);
});

test('secrets have distinct digits of the right length, and every code turns up', () => {
  const random = rng(42);
  for (const len of [3, 4, 5]) {
    for (let i = 0; i < 200; i++) {
      const s = makeSecret(len, random);
      expect(guessProblem(s, len)).toBe('');
    }
  }
  const seen = new Set<string>();
  const r = rng(7);
  for (let i = 0; i < 20000; i++) seen.add(makeSecret(3, r));
  expect(seen.size).toBe(720);
});

test('daily numbers and local dates', () => {
  expect(dailyNumber('2026-11-07')).toBe(1);
  expect(dailyNumber('2026-12-07')).toBe(31);
  expect(dailyNumber('2027-03-29')).toBe(143); // across the clocks changing
  expect(todayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
});

test('possible codes shrink as feedback comes in, and always include the secret', () => {
  expect(allCodes(4).length).toBe(5040);
  const secret = '0472', guesses = ['1234', '5678', '4502'];
  const feedback = guesses.map((g) => score(secret, g));
  let prev = 5040;
  for (let i = 1; i <= guesses.length; i++) {
    const n = remainingFrom(4, guesses.slice(0, i), feedback);
    expect(n).toBeLessThan(prev);
    expect(n).toBeGreaterThanOrEqual(1);
    prev = n;
  }
  expect(remainingFrom(4, guesses, [feedback[0], null, feedback[2]])).toBeGreaterThanOrEqual(prev);
});

test('the result line explains the counts in words', () => {
  expect(explain('4502', score('0472', '4502'))).toBe('4502: 1 digit in the right spot, 2 in the code but in the wrong spot, 1 not in the code.');
  expect(explain('1356', score('0472', '1356'))).toBe('1356: none of 1, 3, 5, 6 are in the code.');
  expect(explain('2740', score('0472', '2740'))).toBe('2740: 4 digits in the code but in the wrong spot.');
  expect(explain('0472', score('0472', '0472'))).toBe('0472: all 4 digits in the right spot!');
});

test('story: code lengths, stars and chapters', async () => {
  const { storyLength, stars, chapterOf } = await import('../src/lib/story');
  expect([1, 2, 3, 4, 5, 50].map(storyLength)).toEqual([1, 2, 3, 4, 4, 4]);
  expect([stars(4, 7), stars(4, 8), stars(4, 10), stars(4, 11)]).toEqual([3, 2, 2, 1]);
  expect(stars(1, 3)).toBe(3);
  expect(chapterOf(1).name).toBe('Piggy Bank');
  expect(chapterOf(10).number).toBe(1);
  expect(chapterOf(11).name).toBe('School Locker');
  expect(chapterOf(101).name).toBe('Piggy Bank II');
});
