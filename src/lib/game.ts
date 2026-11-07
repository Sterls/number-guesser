// The rules, with no screen code, so the tests can check them.
//
// A secret code is a few digits, all different (e.g. 4 digits: 0472).
// After each guess the player is told how many digits are:
//   - "right spot":  the right digit in the right place   (green)
//   - "wrong spot":  in the code, but somewhere else      (amber)
// The feedback is only counts: it never says WHICH digits they were.
//
// Ranked games are checked on the server (supabase/setup.sql repeats these
// rules); this copy is for offline games and for the helpers on screen.

export const LENGTHS = [3, 4, 5] as const;
export const DAILY_LENGTH = 4;
const DAILY_EPOCH = Date.UTC(2026, 10, 7); // Daily #1 is 7 Nov 2026

export interface Feedback { exact: number; close: number }

export function makeSecret(length: number, random: () => number = Math.random): string {
  const digits = [...'0123456789'];
  for (let i = 0; i < length; i++) {
    const j = i + Math.floor(random() * (digits.length - i));
    [digits[i], digits[j]] = [digits[j], digits[i]];
  }
  return digits.slice(0, length).join('');
}

// The phone's local date as YYYY-MM-DD, so the daily code changes at local midnight.
export function todayKey(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function dailyNumber(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - DAILY_EPOCH) / 86400000) + 1;
}

export function score(secret: string, guess: string): Feedback {
  let exact = 0, close = 0;
  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === secret[i]) exact++;
    else if (secret.includes(guess[i])) close++;
  }
  return { exact, close };
}

// Returns what's wrong with a guess, or '' if it can be played.
export function guessProblem(guess: string, length: number): string {
  if (!/^\d*$/.test(guess)) return 'Digits only.';
  if (guess.length !== length) return `Enter ${length} digits.`;
  if (new Set(guess).size !== length) return 'Each digit can only be used once.';
  return '';
}

// Every possible code of this length (720, 5040 or 30240 of them).
const allCache = new Map<number, string[]>();
export function allCodes(length: number): string[] {
  let out = allCache.get(length);
  if (!out) {
    const codes: string[] = [];
    const walk = (prefix: string) => {
      if (prefix.length === length) { codes.push(prefix); return; }
      for (const d of '0123456789') if (!prefix.includes(d)) walk(prefix + d);
    };
    walk('');
    allCache.set(length, codes);
    out = codes;
  }
  return out;
}

// Would `code` have given this feedback for every guess? Guesses still
// waiting for feedback are skipped.
export function fitsFeedback(code: string, guesses: string[], feedback: (Feedback | null | undefined)[]): boolean {
  return guesses.every((g, i) => {
    const f = feedback[i];
    if (!f) return true;
    const b = score(code, g);
    return b.exact === f.exact && b.close === f.close;
  });
}

// How many codes are still possible, from the guesses and their feedback.
export function remainingFrom(length: number, guesses: string[], feedback: (Feedback | null | undefined)[]): number {
  return allCodes(length).filter((c) => fitsFeedback(c, guesses, feedback)).length;
}

const digitWord = (n: number) => `${n} digit${n === 1 ? '' : 's'}`;

// The feedback in plain words, e.g. "4502: 1 digit in the right spot, 2 in the code but in the wrong spot, 1 not in the code."
export function explain(guess: string, { exact, close }: Feedback): string {
  const none = guess.length - exact - close;
  if (exact === guess.length) return `${guess}: all ${guess.length} digits in the right spot!`;
  if (!exact && !close) return `${guess}: none of ${[...guess].join(', ')} are in the code.`;
  const parts: string[] = [];
  if (exact) parts.push(`${digitWord(exact)} in the right spot`);
  if (close) parts.push(`${exact ? close : digitWord(close)} in the code but in the wrong spot`);
  if (none) parts.push(`${none} not in the code`);
  return `${guess}: ${parts.join(', ')}.`;
}
