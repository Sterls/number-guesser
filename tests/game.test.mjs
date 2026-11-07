import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  score, guessProblem, makeSecret, dailySecret, dailyNumber, todayKey, allCodes, remaining, rng, fits,
} from '../js/game.js';

test('score counts right-spot and wrong-spot digits', () => {
  assert.deepEqual(score('0472', '4502'), { exact: 1, close: 2 });
  assert.deepEqual(score('0472', '0472'), { exact: 4, close: 0 });
  assert.deepEqual(score('0472', '1356'), { exact: 0, close: 0 });
  assert.deepEqual(score('0472', '2740'), { exact: 0, close: 4 });
  assert.deepEqual(score('123', '321'), { exact: 1, close: 2 });
});

test('guesses must be the right length with no repeated digits', () => {
  assert.equal(guessProblem('1234', 4), '');
  assert.match(guessProblem('123', 4), /4 digits/);
  assert.match(guessProblem('1123', 4), /once/);
  assert.match(guessProblem('12a4', 4), /Digits/);
});

test('secrets have distinct digits of the right length', () => {
  const random = rng(42);
  for (const len of [3, 4, 5]) {
    for (let i = 0; i < 200; i++) {
      const s = makeSecret(len, random);
      assert.equal(s.length, len);
      assert.equal(new Set(s).size, len);
      assert.equal(guessProblem(s, len), '');
    }
  }
});

test('every possible code turns up as a secret', () => {
  const random = rng(7);
  const seen = new Set();
  for (let i = 0; i < 20000; i++) seen.add(makeSecret(3, random));
  assert.equal(seen.size, 720);
});

test('the daily code is the same for everyone on a day and changes daily', () => {
  assert.equal(dailySecret('2026-11-07'), dailySecret('2026-11-07'));
  const week = ['07', '08', '09', '10', '11', '12', '13'].map((d) => dailySecret(`2026-11-${d}`));
  assert.ok(new Set(week).size >= 6);
  assert.equal(dailyNumber('2026-11-07'), 1);
  assert.equal(dailyNumber('2026-12-07'), 31);
  assert.equal(dailyNumber('2027-03-29'), 143); // across the clocks changing
  assert.equal(todayKey(new Date(2026, 0, 5)), '2026-01-05');
});

test('possible codes shrink as guesses come in, and always include the secret', () => {
  assert.equal(allCodes(4).length, 5040);
  const secret = '0472';
  const guesses = ['1234', '5678', '4502'];
  let prev = 5040;
  for (let i = 1; i <= guesses.length; i++) {
    const n = remaining(secret, guesses.slice(0, i));
    assert.ok(n < prev && n >= 1);
    prev = n;
  }
  assert.ok(fits(secret, guesses, secret));
});
