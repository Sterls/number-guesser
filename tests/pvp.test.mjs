import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outcome, crackedAt, checkReveal, fingerprint, newRoomCode, cleanRoomCode, roomFromUrl } from '../js/pvp.js';
import { score } from '../js/game.js';

const f = (exact, close = 0) => ({ exact, close });
const player = (feedback, extra = {}) => ({ feedback, times: feedback.map((_, i) => (i + 1) * 1000), gaveUp: false, ...extra });

test('room codes', () => {
  assert.match(newRoomCode(), /^[A-Z2-9]{5}$/);
  assert.equal(cleanRoomCode(' ab3cd '), 'AB3CD');
  assert.equal(cleanRoomCode('abc'), null);
  assert.equal(roomFromUrl('?room=xy7zq'), 'XY7ZQ');
  assert.equal(roomFromUrl('?foo=1'), null);
});

test('nobody has won while both are still guessing', () => {
  assert.equal(outcome(4, player([f(1), f(2)]), player([f(0), f(1)])), null);
});

test('fewest guesses wins once both have cracked it', () => {
  assert.equal(outcome(4, player([f(1), f(4)]), player([f(1), f(2), f(4)])).result, 'win');
  assert.equal(outcome(4, player([f(1), f(2), f(4)]), player([f(4)])).result, 'lose');
});

test('cracking first is only a win once the other can no longer tie', () => {
  // I cracked in 2; they've had 1 answered miss: they could still tie.
  assert.equal(outcome(4, player([f(1), f(4)]), player([f(1)])), null);
  // Their 2nd guess is waiting for feedback: still open.
  assert.equal(outcome(4, player([f(1), f(4)]), player([f(1), undefined])), null);
  // Their 2nd guess missed: they can't match 2 any more.
  assert.equal(outcome(4, player([f(1), f(4)]), player([f(1), f(2)])).result, 'win');
  assert.equal(outcome(4, player([f(1), f(2)]), player([f(1), f(4)])).result, 'lose');
});

test('same number of guesses goes to whoever was faster', () => {
  const quick = player([f(1), f(4)], { times: [1000, 5000] });
  const slow = player([f(2), f(4)], { times: [1000, 9000] });
  assert.equal(outcome(4, quick, slow).result, 'win');
  assert.equal(outcome(4, slow, quick).result, 'lose');
  assert.equal(outcome(4, quick, { ...slow, times: [1000, 5000] }).result, 'draw');
  assert.equal(outcome(4, quick, { ...slow, times: [1000] }), null); // timing not in yet
});

test('giving up loses', () => {
  assert.equal(outcome(4, player([f(1)], { gaveUp: true }), player([f(1)])).result, 'lose');
  assert.equal(outcome(4, player([f(1)]), player([], { gaveUp: true })).result, 'win');
  assert.equal(outcome(4, player([], { gaveUp: true }), player([], { gaveUp: true })).result, 'draw');
});

test('crackedAt', () => {
  assert.equal(crackedAt([f(1), f(3), f(4)], 4), 3);
  assert.equal(crackedAt([f(1)], 4), null);
});

test('revealed codes are checked against the fingerprint and the feedback given', async () => {
  const secret = '0472', salt = 'abc123';
  const hash = await fingerprint(1, secret, salt);
  const guesses = ['1234', '4502'];
  const honest = guesses.map((g) => score(secret, g));
  assert.equal(await checkReveal(1, { secret, salt }, hash, guesses, honest), '');
  assert.match(await checkReveal(1, { secret: '0473', salt }, hash, guesses, honest), /doesn't match/);
  assert.match(await checkReveal(2, { secret, salt }, hash, guesses, honest), /doesn't match/);
  assert.match(await checkReveal(1, { secret, salt }, hash, guesses, [honest[0], f(0, 0)]), /4502 was wrong/);
});
