// Looking back at a finished game: how good was each guess?
//
// Before a guess, some number of codes are still possible. A guess splits
// them into groups by the feedback it would get; the bigger the groups, the
// less it's expected to narrow things down. A guess's "quality" compares how
// many codes it was expected to rule out with the best guess available at
// that moment (100% = as good as the best). It judges the choice, not the luck.

import { allCodes, type Feedback } from './game';

export interface GuessReview {
  before: number;        // codes still possible before this guess
  after: number;         // codes still possible after its feedback (0 = cracked)
  expected: number;      // codes this guess was expected to leave
  bestExpected: number;  // codes the best guess was expected to leave
  best: string;          // one such best guess
  possible: boolean;     // could this guess have been the code?
  quality: number;       // 0..1
  rough: boolean;        // best guess found from a sample (5 digits, many codes left)
}

const BUDGET = 8_000_000; // guess-vs-code comparisons per guess, to stay quick on a phone

// Codes as numbers, for fast scoring: digits[i * length + k], and where[i * 10 + d] = position of digit d (or -1).
const tables = new Map<number, { digits: Uint8Array; where: Int8Array }>();
function table(length: number) {
  let t = tables.get(length);
  if (!t) {
    const codes = allCodes(length);
    const digits = new Uint8Array(codes.length * length);
    const where = new Int8Array(codes.length * 10).fill(-1);
    codes.forEach((c, i) => {
      for (let k = 0; k < length; k++) {
        const d = c.charCodeAt(k) - 48;
        digits[i * length + k] = d;
        where[i * 10 + d] = k;
      }
    });
    tables.set(length, (t = { digits, where }));
  }
  return t;
}

export function reviewGame(length: number, guesses: string[], feedback: Feedback[]): GuessReview[] {
  const codes = allCodes(length);
  const index = new Map(codes.map((c, i) => [c, i] as const));
  const { digits, where } = table(length);
  const kinds = (length + 1) * (length + 1);
  const win = length * (length + 1);
  // Feedback for guess g against code c, as one number: exact * (length + 1) + close.
  const fb = (g: number, c: number) => {
    let exact = 0, close = 0;
    for (let k = 0; k < length; k++) {
      const p = where[c * 10 + digits[g * length + k]];
      if (p === k) exact++;
      else if (p >= 0) close++;
    }
    return exact * (length + 1) + close;
  };
  const counts = new Int32Array(kinds);
  // Codes a guess is expected to leave, out of `left` (cracking it leaves none).
  const expectedLeft = (g: number, left: number[]) => {
    counts.fill(0);
    for (const c of left) counts[fb(g, c)]++;
    let sum = 0;
    for (let f = 0; f < kinds; f++) if (f !== win) sum += counts[f] * counts[f];
    return sum / left.length;
  };

  let left = codes.map((_, i) => i);
  const out: GuessReview[] = [];
  guesses.forEach((guess, n) => {
    const g = index.get(guess);
    const f = feedback[n];
    if (g === undefined || !f || !left.length) return;
    const before = left.length;
    const possibleSet = new Set(left);
    const expected = expectedLeft(g, left);

    // The best guess: every first guess is equally good (nothing is known yet);
    // otherwise try all codes, or a spread of them when that's too many.
    let best = g, bestExpected = expected, rough = false;
    if (n > 0) {
      const room = Math.floor(BUDGET / before);
      let pool: number[];
      if (codes.length <= room) pool = codes.map((_, i) => i);
      else {
        rough = true;
        const step = Math.max(1, Math.ceil(before / Math.max(1, room / 2)));
        const some = left.filter((_, i) => i % step === 0);
        const stride = Math.max(1, Math.ceil(codes.length / Math.max(1, room - some.length)));
        pool = [...some];
        for (let i = 0; i < codes.length; i += stride) pool.push(i);
      }
      for (const c of pool) {
        const e = expectedLeft(c, left);
        // Ties go to a guess that could itself be the code.
        if (e < bestExpected - 1e-9 || (Math.abs(e - bestExpected) < 1e-9 && !possibleSet.has(best) && possibleSet.has(c))) {
          best = c; bestExpected = e;
        }
      }
    }
    const want = f.exact * (length + 1) + f.close;
    const next = left.filter((c) => fb(g, c) === want);
    const ruledOut = before - expected, bestRuledOut = before - bestExpected;
    out.push({
      before,
      after: f.exact === length ? 0 : next.length,
      expected, bestExpected, best: codes[best],
      possible: possibleSet.has(g),
      quality: bestRuledOut > 0 ? Math.max(0, Math.min(1, ruledOut / bestRuledOut)) : 1,
      rough,
    });
    left = next;
  });
  return out;
}

const count = (n: number) => (n >= 10 ? Math.round(n).toLocaleString() : n >= 0.05 ? n.toFixed(1).replace(/\.0$/, '') : '0');
const codesWord = (n: number) => `${n.toLocaleString()} code${n === 1 ? '' : 's'}`;

// In plain words, for the line under a guess.
export function reviewText(r: GuessReview, n: number): string {
  const pct = `${Math.round(r.quality * 100)}%`;
  if (n === 0) return `Quality ${pct}: nothing was known yet, so every first guess is as good as any other.`;
  const was = `${codesWord(r.before)} ${r.before === 1 ? 'was' : 'were'} still possible`;
  if (r.quality >= 0.995) return `Quality ${pct}: ${was}, and no guess was expected to narrow that down more.`;
  const hint = r.possible ? '' : ' This guess couldn\'t have been the code.';
  return `Quality ${pct}: ${was}. This guess was expected to leave about ${count(r.expected)}; the best guess${r.rough ? ' found' : ''} (like ${r.best}) about ${count(r.bestExpected)}.${hint}`;
}
