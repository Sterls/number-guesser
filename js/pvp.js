// Rules for playing a friend, with no screen or network code, so the tests
// can check them.
//
// Each player sets a secret code for the other to crack. Both guess at the
// same time. Fewest guesses wins; the same number of guesses goes to whoever
// was faster. Giving up loses.
//
// A secret code never leaves its owner's phone during the game: the owner's
// phone scores the opponent's guesses and sends back only the two numbers.
// When a player locks in their code, they send a fingerprint (hash) of it;
// at the end both codes are revealed and checked against the fingerprint and
// against every bit of feedback given, so nobody can change their code or
// give wrong feedback without it showing.

import { score } from './game.js';

const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I/L mix-ups

export function newRoomCode(random = Math.random) {
  let code = '';
  for (let i = 0; i < 5; i++) code += CODE_LETTERS[Math.floor(random() * CODE_LETTERS.length)];
  return code;
}

export function cleanRoomCode(raw) {
  const code = String(raw || '').trim().toUpperCase();
  return /^[A-Z0-9]{5}$/.test(code) ? code : null;
}

export function roomFromUrl(search) {
  return cleanRoomCode(new URLSearchParams(search).get('room'));
}

export function newSalt() {
  return [...crypto.getRandomValues(new Uint8Array(12))].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function fingerprint(round, secret, salt) {
  const bytes = new TextEncoder().encode(`vault:${round}:${secret}:${salt}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// How many guesses it took to crack, or null if not cracked yet.
export function crackedAt(feedback, length) {
  const i = feedback.findIndex((f) => f && f.exact === length);
  return i < 0 ? null : i + 1;
}

// Who has won, from both players' points of view being equal:
//   me / them: { feedback, times, gaveUp }
// `feedback` is the feedback each player has received for their own guesses
// (missing while still waiting for it); `times` is when each guess was made,
// in ms since the game started on that player's phone.
// Returns null while the game is still going, else { result: 'win' | 'lose' | 'draw', reason }.
export function outcome(length, me, them) {
  if (me.gaveUp && them.gaveUp) return { result: 'draw', reason: 'You both gave up.' };
  if (me.gaveUp) return { result: 'lose', reason: 'You gave up.' };
  if (them.gaveUp) return { result: 'win', reason: 'They gave up.' };

  const mine = crackedAt(me.feedback, length);
  const theirs = crackedAt(them.feedback, length);
  // Guesses they've made that have been answered and weren't the code.
  const missed = (p) => p.feedback.filter((f) => f).length;

  if (mine != null && theirs != null) {
    if (mine !== theirs) return mine < theirs
      ? { result: 'win', reason: 'Fewer guesses.' }
      : { result: 'lose', reason: 'They needed fewer guesses.' };
    const myMs = me.times?.[mine - 1], theirMs = them.times?.[theirs - 1];
    if (myMs == null || theirMs == null) return null; // wait for the timings
    if (myMs !== theirMs) return myMs < theirMs
      ? { result: 'win', reason: 'Same number of guesses, but you were faster.' }
      : { result: 'lose', reason: 'Same number of guesses, but they were faster.' };
    return { result: 'draw', reason: 'Same guesses, same time!' };
  }
  // One has cracked it: decided once the other can no longer match them.
  if (mine != null && missed(them) >= mine) return { result: 'win', reason: 'Fewer guesses.' };
  if (theirs != null && missed(me) >= theirs) return { result: 'lose', reason: 'They needed fewer guesses.' };
  return null;
}

// After the game: does their revealed code match their fingerprint, and the
// feedback they gave for each of my guesses? Returns '' if all is well.
export async function checkReveal(round, reveal, hash, myGuesses, feedback) {
  if (!reveal || !hash) return '';
  if (await fingerprint(round, reveal.secret, reveal.salt) !== hash) {
    return "Their revealed code doesn't match the one they locked in.";
  }
  for (let i = 0; i < feedback.length; i++) {
    const f = feedback[i];
    if (!f) continue;
    const real = score(reveal.secret, myGuesses[i]);
    if (real.exact !== f.exact || real.close !== f.close) {
      return `The feedback for your guess ${myGuesses[i]} was wrong.`;
    }
  }
  return '';
}
