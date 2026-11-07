import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { nameProblem, BLOCKED_PARTS, BLOCKED_WORDS } from '../src/lib/names';

test('friendly names are allowed', () => {
  for (const name of ['Mom', 'Grandpa Joe', 'Classy Cassie', 'Grapes Peacock', 'Scott_99', "O'Neil!", 'Vault-Fan']) {
    expect(nameProblem(name), name).toBe('');
  }
});

test('rude, disguised or spammy names are refused', () => {
  for (const name of ['sh1tlord', 'S H I T', 'big ass', 'f.u.c.k', 'www.spam.com', 'me@mail', 'héllo', '', '   ', 'x'.repeat(21)]) {
    expect(nameProblem(name), JSON.stringify(name)).not.toBe('');
  }
});

test('the server word lists match the game', () => {
  const sql = readFileSync(new URL('../supabase/setup.sql', import.meta.url), 'utf8');
  const listAfter = (marker: string) => {
    const at = sql.indexOf(marker);
    const body = sql.slice(at).match(/array\[([^\]]*)\]/)![1];
    return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  };
  expect(listAfter('-- BLOCKED_PARTS')).toEqual(BLOCKED_PARTS);
  expect(listAfter('-- BLOCKED_WORDS')).toEqual(BLOCKED_WORDS);
});
