// Story mode: levels on a map. Level 1 is a 1-digit code, level 2 two
// digits, level 3 three, then 4 digits from level 4 on, with no end.
// Every 10 levels is a new chapter: a new place to crack.

export const storyLength = (level: number) => Math.min(Math.max(level, 1), 4);

// Guesses for 3 stars ("par"). 2 stars for up to 3 more; 1 star otherwise.
const PAR: Record<number, number> = { 1: 3, 2: 5, 3: 6, 4: 7 };
export const par = (length: number) => PAR[length] ?? 7;

export function stars(length: number, guesses: number): 1 | 2 | 3 {
  const p = par(length);
  return guesses <= p ? 3 : guesses <= p + 3 ? 2 : 1;
}

export const starText = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);

export const LEVELS_PER_CHAPTER = 10;

const CHAPTERS = [
  { emoji: '🐷', name: 'Piggy Bank' },
  { emoji: '🎒', name: 'School Locker' },
  { emoji: '🚲', name: 'Bike Lock' },
  { emoji: '💼', name: 'Briefcase' },
  { emoji: '🏨', name: 'Hotel Safe' },
  { emoji: '🏦', name: 'Bank Vault' },
  { emoji: '🎰', name: 'Casino Cage' },
  { emoji: '🖼️', name: 'Museum Gallery' },
  { emoji: '💎', name: 'Diamond Exchange' },
  { emoji: '🏛️', name: 'Federal Reserve' },
];

export interface Chapter { number: number; emoji: string; name: string; first: number; last: number }

export function chapterOf(level: number): Chapter {
  const number = Math.floor((level - 1) / LEVELS_PER_CHAPTER) + 1;
  const base = CHAPTERS[(number - 1) % CHAPTERS.length];
  const lap = Math.floor((number - 1) / CHAPTERS.length);
  return {
    number,
    emoji: base.emoji,
    name: lap ? `${base.name} ${['', 'II', 'III', 'IV', 'V'][lap] || lap + 1}` : base.name,
    first: (number - 1) * LEVELS_PER_CHAPTER + 1,
    last: number * LEVELS_PER_CHAPTER,
  };
}
