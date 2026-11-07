// The rules, with no screen code, so the tests can check them.
//
// A secret code is a few digits, all different (e.g. 4 digits: 0472).
// After each guess the player is told how many digits are:
//   - "right spot":  the right digit in the right place   (green)
//   - "wrong spot":  in the code, but somewhere else      (yellow)
// The feedback is only counts: it never says WHICH digits they were.

export const LENGTHS = [3, 4, 5];
export const DAILY_LENGTH = 4;
const DAILY_EPOCH = Date.UTC(2026, 10, 7); // Daily #1 is 7 Nov 2026

// Small, fast, repeatable random numbers (mulberry32), so a seed always
// gives the same daily code on every phone.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a: turns a string into a 32-bit seed.
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function makeSecret(length, random = Math.random) {
  const digits = [...'0123456789'];
  for (let i = 0; i < length; i++) {
    const j = i + Math.floor(random() * (digits.length - i));
    [digits[i], digits[j]] = [digits[j], digits[i]];
  }
  return digits.slice(0, length).join('');
}

// The phone's local date as YYYY-MM-DD, so the daily code changes at local midnight.
export function todayKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function dailyNumber(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - DAILY_EPOCH) / 86400000) + 1;
}

export function dailySecret(dateKey, length = DAILY_LENGTH) {
  return makeSecret(length, rng(hashString(`vault:${dateKey}:${length}`)));
}

export function score(secret, guess) {
  let exact = 0, close = 0;
  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === secret[i]) exact++;
    else if (secret.includes(guess[i])) close++;
  }
  return { exact, close };
}

// Returns what's wrong with a guess, or '' if it can be played.
export function guessProblem(guess, length) {
  if (!/^\d*$/.test(guess)) return 'Digits only.';
  if (guess.length !== length) return `Enter ${length} digits.`;
  if (new Set(guess).size !== length) return 'Each digit can only be used once.';
  return '';
}

// Every possible code of this length (720, 5040 or 30240 of them).
const allCache = new Map();
export function allCodes(length) {
  if (!allCache.has(length)) {
    const out = [];
    const walk = (prefix) => {
      if (prefix.length === length) return void out.push(prefix);
      for (const d of '0123456789') if (!prefix.includes(d)) walk(prefix + d);
    };
    walk('');
    allCache.set(length, out);
  }
  return allCache.get(length);
}

// Would `code` have given exactly the feedback the player saw for every guess so far?
export function fits(code, guesses, secret) {
  return guesses.every((g) => {
    const a = score(secret, g), b = score(code, g);
    return a.exact === b.exact && a.close === b.close;
  });
}

// How many codes are still possible after these guesses.
export function remaining(secret, guesses) {
  return allCodes(secret.length).filter((c) => fits(c, guesses, secret)).length;
}
