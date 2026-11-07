import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nameProblem, BLOCKED_PARTS, BLOCKED_WORDS } from '../js/names.js';

test('friendly nicknames are allowed', () => {
  for (const name of ['Mom', 'Grandpa Joe', 'Classy Cassie', 'Grapes Peacock', 'Scott_99', "O'Neil!", 'Vault-Fan']) {
    assert.equal(nameProblem(name), '', name);
  }
});

test('rude, disguised or spammy nicknames are refused', () => {
  for (const name of ['sh1tlord', 'S H I T', 'big ass', 'f.u.c.k', 'www.spam.com', 'me@mail', 'héllo', '', '   ', 'x'.repeat(21)]) {
    assert.notEqual(nameProblem(name), '', JSON.stringify(name));
  }
});

test('database word lists match the game', () => {
  const sql = readFileSync(new URL('../supabase/setup.sql', import.meta.url), 'utf8');
  const listAfter = (marker) => {
    const at = sql.indexOf(marker);
    const body = sql.slice(at).match(/array\[([^\]]*)\]/)[1];
    return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  };
  assert.deepEqual(listAfter('-- BLOCKED_PARTS'), BLOCKED_PARTS);
  assert.deepEqual(listAfter('-- BLOCKED_WORDS'), BLOCKED_WORDS);
});
