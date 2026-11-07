// Nickname rules. supabase/setup.sql repeats these lists so the server
// enforces them too; tests/names.test.ts checks the two copies stay the same.

// Blocked anywhere in a name, even run together or hidden inside other words.
export const BLOCKED_PARTS = [
  'fuck', 'shit', 'cunt', 'nigg', 'fagg', 'whore', 'slut', 'twat', 'bitch',
  'bastard', 'pussy', 'penis', 'vagina', 'porn', 'hitler', 'retard', 'dildo',
  'jizz', 'spunk', 'bollock', 'tosser', 'kike', 'tranny', 'rapist',
];

// Blocked only as whole words (they appear inside innocent words too,
// like "grapes" or "peacock").
export const BLOCKED_WORDS = [
  'ass', 'arse', 'asshole', 'arsehole', 'dick', 'cock', 'tit', 'tits', 'sex',
  'rape', 'nazi', 'nazis', 'paki', 'chink', 'spic', 'wank', 'wanker', 'nonce',
  'fag', 'fags', 'homo', 'cum', 'piss', 'prick', 'dyke', 'gook', 'coon', 'kkk', 'kys',
];

const LEET_FROM = '0134578@$';
const LEET_TO = 'oieastbas';

function normalize(name: string): string {
  let out = '';
  for (const ch of name.toLowerCase()) {
    const i = LEET_FROM.indexOf(ch);
    out += i >= 0 ? LEET_TO[i] : ch;
  }
  return out;
}

// Returns a message saying what's wrong with the name, or '' if it's fine.
export function nameProblem(raw: string): string {
  const name = raw.trim();
  if (!name) return 'Please type a nickname.';
  if (name.length > 20) return 'Nicknames can be up to 20 characters.';
  if (!/^[A-Za-z0-9 _.'!-]+$/.test(name)) return "Use letters, numbers, spaces and _ . ' ! - only.";
  const lower = name.toLowerCase();
  if (/(https?|www\.|\.com|\.net|\.org|@)/.test(lower)) return "Web addresses aren't allowed in nicknames.";
  const n = normalize(name);
  const squashed = n.replace(/[^a-z]/g, '');
  const words = n.split(/[^a-z]+/);
  if (BLOCKED_PARTS.some((p) => squashed.includes(p)) || words.some((w) => BLOCKED_WORDS.includes(w))) {
    return 'Please choose a friendlier nickname.';
  }
  return '';
}
